/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import ignore, { type Ignore } from 'ignore';
import { createTwoFilesPatch, diffLines } from 'diff';

const MAX_CHANGED_FILES = 40;
const MAX_TOTAL_PATCH_CHARS = 200_000;
const MAX_FALLBACK_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FALLBACK_FILES = 20_000;

export type WorkspaceFileChangeKind = 'added' | 'modified' | 'deleted';

export interface WorkspaceFileChange {
  path: string;
  kind: WorkspaceFileChangeKind;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  patch: string;
}

export interface WorkspaceChangeSet {
  files: WorkspaceFileChange[];
  omittedFiles: number;
}

export interface WorkspaceChangeCheckpoint {
  readonly token: string;
}

interface CaptureBackend<Snapshot> {
  snapshot(): Promise<Snapshot>;
  diff(before: Snapshot, after: Snapshot): Promise<WorkspaceChangeSet>;
  dispose(): Promise<void>;
}

interface GitSnapshot {
  kind: 'git';
  tree: string;
}

interface FileSnapshotEntry {
  hash: string;
  content: string | null;
  binary: boolean;
}

interface FileSnapshot {
  kind: 'filesystem';
  files: Map<string, FileSnapshotEntry>;
}

type BackendSnapshot = GitSnapshot | FileSnapshot;

function emptyChangeSet(): WorkspaceChangeSet {
  return { files: [], omittedFiles: 0 };
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; maxBuffer?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function splitGitPatch(output: string): string[] {
  const starts = Array.from(output.matchAll(/^diff --git /gm), (match) => match.index ?? 0);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? output.length;
    return output.slice(start, end).trimEnd();
  });
}

function parseStatus(output: string): Array<{ status: string; path: string }> {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\t');
      return separator === -1
        ? { status: line, path: line }
        : { status: line.slice(0, separator), path: line.slice(separator + 1) };
    });
}

function parseNumstat(output: string): Array<{
  additions: number | null;
  deletions: number | null;
  path: string;
}> {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const firstTab = line.indexOf('\t');
      const secondTab = firstTab === -1 ? -1 : line.indexOf('\t', firstTab + 1);
      const additionsText = firstTab === -1 ? '-' : line.slice(0, firstTab);
      const deletionsText = secondTab === -1 ? '-' : line.slice(firstTab + 1, secondTab);
      return {
        additions: additionsText === '-' ? null : Number.parseInt(additionsText, 10),
        deletions: deletionsText === '-' ? null : Number.parseInt(deletionsText, 10),
        path: secondTab === -1 ? line : line.slice(secondTab + 1),
      };
    });
}

function statusToKind(status: string): WorkspaceFileChangeKind {
  if (status.startsWith('A')) return 'added';
  if (status.startsWith('D')) return 'deleted';
  return 'modified';
}

function truncateChanges(files: WorkspaceFileChange[]): WorkspaceChangeSet {
  const selected = files.slice(0, MAX_CHANGED_FILES);
  let remainingChars = MAX_TOTAL_PATCH_CHARS;

  const bounded = selected.map((file) => {
    if (file.patch.length <= remainingChars) {
      remainingChars -= file.patch.length;
      return file;
    }

    const visiblePatch = remainingChars > 0
      ? `${file.patch.slice(0, remainingChars)}\n[diff truncated]`
      : '[diff truncated]';
    remainingChars = 0;
    return { ...file, patch: visiblePatch };
  });

  return {
    files: bounded,
    omittedFiles: Math.max(0, files.length - selected.length),
  };
}

class GitCaptureBackend implements CaptureBackend<GitSnapshot> {
  private initialized = false;

  private constructor(
    private readonly workspaceRoot: string,
    private readonly tempRoot: string,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly workspacePrefix: string,
  ) {}

  static async create(workspaceRoot: string): Promise<GitCaptureBackend | null> {
    let tempRoot: string | null = null;
    try {
      const repositoryRoot = (await runProcess(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd: workspaceRoot }
      )).trim();
      const workspacePrefix = path.relative(repositoryRoot, workspaceRoot).split(path.sep).join('/');
      tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-change-index-'));
      const environment = {
        ...process.env,
        GIT_INDEX_FILE: path.join(tempRoot, 'index'),
      };
      try {
        await runProcess('git', ['read-tree', 'HEAD'], { cwd: workspaceRoot, env: environment });
      } catch {
        await runProcess('git', ['read-tree', '--empty'], { cwd: workspaceRoot, env: environment });
      }
      return new GitCaptureBackend(workspaceRoot, tempRoot, environment, workspacePrefix);
    } catch {
      if (tempRoot) await fs.remove(tempRoot);
      return null;
    }
  }

  async snapshot(): Promise<GitSnapshot> {
    if (!this.initialized) {
      await this.runGit(['add', '-A', '--', '.']);
      this.initialized = true;
    } else {
      const changedPaths = await this.getWorkingTreeChanges();
      for (let index = 0; index < changedPaths.length; index += 200) {
        await this.runGit(['add', '-A', '--', ...changedPaths.slice(index, index + 200)]);
      }
    }
    const tree = (await this.runGit(['write-tree'])).trim();
    return { kind: 'git', tree };
  }

  async diff(before: GitSnapshot, after: GitSnapshot): Promise<WorkspaceChangeSet> {
    if (before.tree === after.tree) {
      return emptyChangeSet();
    }

    const baseArgs = [
      '-c',
      'core.quotepath=false',
      'diff',
      '--no-renames',
      '--no-ext-diff',
      '--no-color',
      '--relative',
    ];
    const rangeArgs = [before.tree, after.tree, '--', '.'];
    const [statusOutput, numstatOutput, patchOutput] = await Promise.all([
      this.runGit([...baseArgs, '--name-status', ...rangeArgs]),
      this.runGit([...baseArgs, '--numstat', ...rangeArgs]),
      this.runGit([...baseArgs, '--unified=3', ...rangeArgs], 50 * 1024 * 1024),
    ]);

    const statuses = parseStatus(statusOutput);
    const stats = parseNumstat(numstatOutput);
    const patches = splitGitPatch(patchOutput);
    const statsByPath = new Map(stats.map((entry) => [entry.path, entry]));

    const files = statuses.map((entry, index): WorkspaceFileChange => {
      const stat = statsByPath.get(entry.path) ?? stats[index];
      return {
        path: entry.path,
        kind: statusToKind(entry.status),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        binary: stat?.additions === null || stat?.deletions === null,
        patch: patches[index] ?? '',
      };
    });

    return truncateChanges(files);
  }

  async dispose(): Promise<void> {
    await fs.remove(this.tempRoot);
  }

  private runGit(args: string[], maxBuffer?: number): Promise<string> {
    return runProcess('git', args, {
      cwd: this.workspaceRoot,
      env: this.environment,
      maxBuffer,
    });
  }

  private async getWorkingTreeChanges(): Promise<string[]> {
    const status = await this.runGit([
      '-c',
      'core.quotepath=false',
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--',
      '.',
    ]);

    return status
      .split('\0')
      .filter(Boolean)
      .flatMap((entry) => {
        const indexStatus = entry[0];
        const workingTreeStatus = entry[1];
        const isUntracked = indexStatus === '?' && workingTreeStatus === '?';
        if (!isUntracked && (!workingTreeStatus || workingTreeStatus === ' ')) return [];

        const repositoryPath = entry.slice(3);
        if (!this.workspacePrefix) return [repositoryPath];
        const prefix = `${this.workspacePrefix}/`;
        return repositoryPath.startsWith(prefix)
          ? [repositoryPath.slice(prefix.length)]
          : [];
      });
  }
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

function buildIgnoreMatcher(contents: string): Ignore {
  const matcher = ignore();
  matcher.add(['.git/', 'node_modules/']);
  if (contents.trim()) {
    matcher.add(contents);
  }
  return matcher;
}

async function readFallbackSnapshot(workspaceRoot: string): Promise<FileSnapshot> {
  const gitignore = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf8').catch(() => '');
  const matcher = buildIgnoreMatcher(gitignore);
  const files = new Map<string, FileSnapshotEntry>();

  const visit = async (directory: string): Promise<void> => {
    if (files.size >= MAX_FALLBACK_FILES) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (files.size >= MAX_FALLBACK_FILES) break;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
      const ignorePath = entry.isDirectory() ? `${relativePath}/` : relativePath;
      if (matcher.ignores(ignorePath)) continue;

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      try {
        const buffer = entry.isSymbolicLink()
          ? Buffer.from(await fs.readlink(absolutePath), 'utf8')
          : await fs.readFile(absolutePath);
        const binary = isBinary(buffer);
        files.set(relativePath, {
          hash: createHash('sha256').update(buffer).digest('hex'),
          content: !binary && buffer.length <= MAX_FALLBACK_FILE_BYTES ? buffer.toString('utf8') : null,
          binary,
        });
      } catch {
        // Files can disappear while an external tool is still completing.
      }
    }
  };

  await visit(workspaceRoot);
  return { kind: 'filesystem', files };
}

function countChangedLines(oldContent: string, newContent: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(oldContent, newContent)) {
    const count = part.value.split('\n').filter((line, index, lines) => (
      index < lines.length - 1 || line.length > 0
    )).length;
    if (part.added) additions += count;
    if (part.removed) deletions += count;
  }
  return { additions, deletions };
}

class FileSystemCaptureBackend implements CaptureBackend<FileSnapshot> {
  constructor(private readonly workspaceRoot: string) {}

  snapshot(): Promise<FileSnapshot> {
    return readFallbackSnapshot(this.workspaceRoot);
  }

  async diff(before: FileSnapshot, after: FileSnapshot): Promise<WorkspaceChangeSet> {
    const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort();
    const files: WorkspaceFileChange[] = [];

    for (const filePath of paths) {
      const oldFile = before.files.get(filePath);
      const newFile = after.files.get(filePath);
      if (oldFile?.hash === newFile?.hash) continue;

      const kind: WorkspaceFileChangeKind = !oldFile
        ? 'added'
        : !newFile
          ? 'deleted'
          : 'modified';
      const binary = oldFile?.binary === true || newFile?.binary === true
        || oldFile?.content === null || newFile?.content === null;
      const oldContent = oldFile?.content ?? '';
      const newContent = newFile?.content ?? '';
      const counts = binary
        ? { additions: null, deletions: null }
        : countChangedLines(oldContent, newContent);

      files.push({
        path: filePath,
        kind,
        additions: counts.additions,
        deletions: counts.deletions,
        binary,
        patch: binary
          ? 'Binary file changed'
          : createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, oldContent, newContent, '', '', { context: 3 }),
      });
    }

    return truncateChanges(files);
  }

  async dispose(): Promise<void> {}
}

export class WorkspaceChangeCapture {
  private readonly checkpoints = new Map<string, BackendSnapshot>();

  private constructor(
    private readonly backend: CaptureBackend<GitSnapshot> | CaptureBackend<FileSnapshot>
  ) {}

  static async create(workspaceRoot: string): Promise<WorkspaceChangeCapture> {
    const absoluteRoot = path.resolve(workspaceRoot);
    const resolvedRoot = await fs.realpath(absoluteRoot).catch(() => absoluteRoot);
    const gitBackend = await GitCaptureBackend.create(resolvedRoot);
    return new WorkspaceChangeCapture(gitBackend ?? new FileSystemCaptureBackend(resolvedRoot));
  }

  async begin(): Promise<WorkspaceChangeCheckpoint> {
    const token = randomUUID();
    const snapshot = await this.backend.snapshot() as BackendSnapshot;
    this.checkpoints.set(token, snapshot);
    return { token };
  }

  async finish(checkpoint: WorkspaceChangeCheckpoint): Promise<WorkspaceChangeSet> {
    const before = this.checkpoints.get(checkpoint.token);
    if (!before) {
      return emptyChangeSet();
    }
    this.checkpoints.delete(checkpoint.token);
    const after = await this.backend.snapshot() as BackendSnapshot;

    if (before.kind === 'git' && after.kind === 'git') {
      return (this.backend as CaptureBackend<GitSnapshot>).diff(before, after);
    }
    if (before.kind === 'filesystem' && after.kind === 'filesystem') {
      return (this.backend as CaptureBackend<FileSnapshot>).diff(before, after);
    }
    return emptyChangeSet();
  }

  async dispose(): Promise<void> {
    this.checkpoints.clear();
    await this.backend.dispose();
  }
}

export function serializeWorkspaceChangeSet(changeSet: WorkspaceChangeSet): string {
  return JSON.stringify({ version: 1, ...changeSet });
}

export function parseWorkspaceChangeSet(value: string): WorkspaceChangeSet | null {
  try {
    const parsed = JSON.parse(value) as {
      version?: unknown;
      files?: unknown;
      omittedFiles?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) return null;

    const files: WorkspaceFileChange[] = [];
    for (const candidate of parsed.files) {
      if (!candidate || typeof candidate !== 'object') return null;
      const file = candidate as Partial<WorkspaceFileChange>;
      if (
        typeof file.path !== 'string'
        || !['added', 'modified', 'deleted'].includes(file.kind ?? '')
        || (typeof file.additions !== 'number' && file.additions !== null)
        || (typeof file.deletions !== 'number' && file.deletions !== null)
        || typeof file.binary !== 'boolean'
        || typeof file.patch !== 'string'
      ) {
        return null;
      }
      files.push(file as WorkspaceFileChange);
    }

    return {
      files,
      omittedFiles: typeof parsed.omittedFiles === 'number' ? parsed.omittedFiles : 0,
    };
  } catch {
    return null;
  }
}
