/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import { minimatch } from 'minimatch';
import packageJson from '../../package.json' with { type: 'json' };
import {
  CandidateRecordSchema,
  LedgerStore,
  assertSafeAutoresearchStorage,
  createLedgerId,
  type CandidateRecord,
  type EnvironmentFingerprint,
  type JsonValue,
} from './ledger.js';

const execFileAsync = promisify(execFile);
const LOCKFILE_NAMES = ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];
const SECRET_ENVIRONMENT_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|API_?KEY|AUTH|COOKIE|SESSION)/i;

export interface ReplayableBaseline {
  repositoryRoot: string;
  baseCommit: string;
}

export interface CaptureCandidateInput {
  description: string;
  expectedBaseCommit: string;
  parentAttemptId: string | null;
  filesInScope?: string[];
  evaluator: {
    config: Record<string, JsonValue>;
    measureScript: string;
    checksScript?: string;
    beforeHookScript?: string;
    afterHookScript?: string;
  };
  environmentAllowlist: string[];
  context?: Record<string, JsonValue>;
}

export function candidateReplayObjectIds(candidate: CandidateRecord): string[] {
  return [
    candidate.patchObject,
    candidate.evaluator.configObject,
    candidate.evaluator.measureObject,
    candidate.evaluator.checksObject,
    candidate.evaluator.beforeHookObject,
    candidate.evaluator.afterHookObject,
    ...candidate.untrackedFiles.map((file) => file.object),
  ].filter((objectId): objectId is string => objectId !== null && objectId !== undefined);
}

interface GitNameStatus {
  kind: CandidateRecord['changedPaths'][number]['kind'];
  paths: string[];
}

async function runGit(cwd: string, args: string[], maxBuffer = 100 * 1024 * 1024): Promise<string> {
  try {
    const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer });
    return result.stdout;
  } catch (error) {
    const details = error as Error & { stderr?: string; stdout?: string };
    throw new Error((details.stderr || details.stdout || details.message).trim());
  }
}

function normalizeWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const absolute = path.resolve(workspaceRoot);
  return fs.realpath(absolute).catch(() => absolute);
}

export async function assertCleanReplayableBaseline(workspaceRoot: string): Promise<ReplayableBaseline> {
  const root = await normalizeWorkspaceRoot(workspaceRoot);
  await assertSafeAutoresearchStorage(root);
  let repositoryRoot: string;
  let baseCommit: string;
  try {
    repositoryRoot = (await runGit(root, ['rev-parse', '--show-toplevel'])).trim();
    baseCommit = (await runGit(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Replayable autoresearch requires a Git repository with at least one commit: ${details}`);
  }
  const canonicalRepositoryRoot = await normalizeWorkspaceRoot(repositoryRoot);
  if (canonicalRepositoryRoot !== root) {
    throw new Error('Replayable autoresearch currently requires the workspace root to be the Git repository root.');
  }

  const status = await runGit(root, [
    '-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z',
    '--untracked-files=all', '--ignore-submodules=none', '--', '.',
  ]);
  const paths = parsePorcelainPaths(status).filter((filePath) => !isInternalAutoPath(filePath));
  if (paths.length > 0) {
    throw new Error(`Replayable autoresearch requires a clean Git working tree. Dirty paths: ${paths.join(', ')}`);
  }
  await assertNoChangedSubmodules(root);
  return { repositoryRoot: canonicalRepositoryRoot, baseCommit };
}

export async function captureCandidate(
  workspaceRoot: string,
  input: CaptureCandidateInput
): Promise<CandidateRecord> {
  const root = await normalizeWorkspaceRoot(workspaceRoot);
  const repositoryRoot = (await runGit(root, ['rev-parse', '--show-toplevel'])).trim();
  if (await normalizeWorkspaceRoot(repositoryRoot) !== root) {
    throw new Error('Replayable autoresearch currently requires the workspace root to be the Git repository root.');
  }
  const head = (await runGit(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (head !== input.expectedBaseCommit) {
    throw new Error(`Autoresearch HEAD drift detected: expected ${input.expectedBaseCommit}, found ${head}.`);
  }
  await assertNoChangedSubmodules(root);

  const trackedStatus = parseNameStatus(await runGit(root, [
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames', 'HEAD', '--', '.',
  ]));
  const untrackedPaths = (await runGit(root, [
    '-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z', '--', '.',
  ])).split('\0').filter(Boolean).filter((filePath) => !isInternalAutoPath(filePath));
  const changedPaths = [...new Set([
    ...trackedStatus.flatMap((entry) => entry.paths),
    ...untrackedPaths,
  ])].sort();
  if (changedPaths.length === 0) {
    throw new Error('run_experiment requires at least one candidate change outside .auto/.');
  }
  for (const changedPath of changedPaths) {
    assertSafeRelativePath(changedPath);
  }
  const outOfScope = changedPaths.filter((changedPath) => !isPathInScope(changedPath, input.filesInScope));
  if (outOfScope.length > 0) {
    throw new Error(`Changes outside the configured autoresearch scope: ${outOfScope.join(', ')}`);
  }

  const store = new LedgerStore(root);
  const patch = await runGit(root, [
    'diff', '--binary', '--full-index', '--no-ext-diff', '--no-color', 'HEAD', '--', '.',
    ':(exclude).auto',
  ]);
  const patchObject = patch.length > 0 ? await store.putObject(patch) : null;
  const untrackedFiles: CandidateRecord['untrackedFiles'] = [];
  for (const relativePath of untrackedPaths.sort()) {
    const absolutePath = path.join(root, relativePath);
    const stats = await fs.lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      untrackedFiles.push({
        path: relativePath,
        kind: 'symlink',
        object: await store.putObject(await fs.readlink(absolutePath)),
        mode: stats.mode & 0o777,
      });
    } else if (stats.isFile()) {
      untrackedFiles.push({
        path: relativePath,
        kind: 'file',
        object: await store.putObject(await fs.readFile(absolutePath)),
        mode: stats.mode & 0o777,
      });
    } else {
      throw new Error(`Unsafe untracked candidate path ${relativePath}: only regular files and symlinks are supported.`);
    }
  }

  const configObject = await store.putObject(JSON.stringify(input.evaluator.config));
  const measureObject = await store.putObject(input.evaluator.measureScript);
  const checksObject = input.evaluator.checksScript === undefined
    ? undefined
    : await store.putObject(input.evaluator.checksScript);
  const beforeHookObject = input.evaluator.beforeHookScript === undefined
    ? undefined
    : await store.putObject(input.evaluator.beforeHookScript);
  const afterHookObject = input.evaluator.afterHookScript === undefined
    ? undefined
    : await store.putObject(input.evaluator.afterHookScript);
  const environment = await createEnvironmentFingerprint(root, {
    measure: input.evaluator.measureScript,
    ...(input.evaluator.checksScript === undefined ? {} : { checks: input.evaluator.checksScript }),
    ...(input.evaluator.beforeHookScript === undefined ? {} : { beforeHook: input.evaluator.beforeHookScript }),
    ...(input.evaluator.afterHookScript === undefined ? {} : { afterHook: input.evaluator.afterHookScript }),
  }, input.environmentAllowlist);
  const kindByPath = new Map<string, CandidateRecord['changedPaths'][number]['kind']>();
  for (const entry of trackedStatus) {
    for (const entryPath of entry.paths) kindByPath.set(entryPath, entry.kind);
  }
  for (const untrackedPath of untrackedPaths) kindByPath.set(untrackedPath, 'added');

  const candidate = CandidateRecordSchema.parse({
    schemaVersion: 1,
    type: 'candidate',
    id: createLedgerId('event'),
    attemptId: createLedgerId('attempt'),
    timestamp: new Date().toISOString(),
    context: input.context ?? {},
    description: input.description,
    baseCommit: head,
    parentAttemptId: input.parentAttemptId,
    patchObject,
    untrackedFiles,
    changedPaths: await Promise.all(changedPaths.map(async (relativePath) => {
      const absolutePath = path.join(root, relativePath);
      if (!(await fs.pathExists(absolutePath)) && !(await fs.lstat(absolutePath).catch(() => null))) {
        return { path: relativePath, kind: kindByPath.get(relativePath) ?? 'deleted', hash: null, mode: null };
      }
      const stats = await fs.lstat(absolutePath);
      const content = stats.isSymbolicLink()
        ? Buffer.from(await fs.readlink(absolutePath), 'utf8')
        : await fs.readFile(absolutePath);
      return {
        path: relativePath,
        kind: kindByPath.get(relativePath) ?? 'modified',
        hash: createHash('sha256').update(content).digest('hex'),
        mode: stats.mode & 0o777,
      };
    })),
    evaluator: {
      configObject,
      measureObject,
      ...(checksObject ? { checksObject } : {}),
      ...(beforeHookObject ? { beforeHookObject } : {}),
      ...(afterHookObject ? { afterHookObject } : {}),
    },
    environment,
  });
  await store.append(candidate);
  return candidate;
}

export async function applyCandidateToWorktree(
  worktreeRoot: string,
  candidate: CandidateRecord,
  store: LedgerStore
): Promise<void> {
  const root = await normalizeWorkspaceRoot(worktreeRoot);
  if (candidate.patchObject) {
    const patchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-patch-'));
    try {
      const patchPath = path.join(patchRoot, 'candidate.patch');
      await fs.writeFile(patchPath, await store.readObject(candidate.patchObject));
      await runGit(root, ['apply', '--binary', '--whitespace=nowarn', patchPath]);
    } finally {
      await fs.remove(patchRoot);
    }
  }
  for (const file of candidate.untrackedFiles) {
    assertSafeRelativePath(file.path);
    const destination = path.resolve(root, file.path);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Candidate path escapes replay worktree: ${file.path}`);
    }
    if (await fs.pathExists(destination) || await fs.lstat(destination).catch(() => null)) {
      throw new Error(`Candidate artifact conflicts with replay worktree path: ${file.path}`);
    }
    await fs.ensureDir(path.dirname(destination));
    const content = await store.readObject(file.object);
    if (file.kind === 'symlink') {
      await fs.symlink(content.toString('utf8'), destination);
    } else {
      await fs.writeFile(destination, content, { mode: file.mode });
    }
  }
}

export async function verifyCandidateCommit(
  workspaceRoot: string,
  candidate: CandidateRecord,
  commit: string
): Promise<void> {
  const root = await normalizeWorkspaceRoot(workspaceRoot);
  const lineage = (await runGit(root, ['rev-list', '--parents', '-n', '1', commit])).trim().split(/\s+/);
  const parents = lineage.slice(1);
  if (parents.length !== 1 || parents[0] !== candidate.baseCommit) {
    throw new Error(
      `Accepted attempt ${candidate.attemptId} commit must directly advance its recorded base ${candidate.baseCommit}.`
    );
  }

  const { expectedTree, actualTree } = await materializeCandidateTrees(root, candidate, commit);
  if (actualTree !== expectedTree) {
    throw new Error(
      `Accepted attempt ${candidate.attemptId} commit does not match the captured candidate tree.`
    );
  }
}

async function materializeCandidateTrees(
  repositoryRoot: string,
  candidate: CandidateRecord,
  commit: string
): Promise<{ expectedTree: string; actualTree: string }> {
  const placeholder = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-materialization-'));
  await fs.remove(placeholder);
  try {
    await runGit(repositoryRoot, ['worktree', 'add', '--detach', placeholder, candidate.baseCommit]);
    await applyCandidateToWorktree(placeholder, candidate, new LedgerStore(repositoryRoot));
    await runGit(placeholder, ['add', '-A', '--', '.']);
    await removeSessionMetadataFromIndex(placeholder);
    const expectedTree = (await runGit(placeholder, ['write-tree'])).trim();

    await runGit(placeholder, ['reset', '--hard', commit]);
    await runGit(placeholder, ['clean', '-fdx']);
    await removeSessionMetadataFromIndex(placeholder);
    const actualTree = (await runGit(placeholder, ['write-tree'])).trim();
    return { expectedTree, actualTree };
  } finally {
    try {
      await runGit(repositoryRoot, ['worktree', 'remove', '--force', placeholder]);
    } catch {
      await fs.remove(placeholder);
      await runGit(repositoryRoot, ['worktree', 'prune']).catch(() => '');
    }
  }
}

async function removeSessionMetadataFromIndex(worktreeRoot: string): Promise<void> {
  await runGit(worktreeRoot, ['rm', '-r', '--cached', '--ignore-unmatch', '--', '.auto']);
}

/** Restore exactly the captured candidate state to HEAD after a non-accepted decision. */
export async function restoreCandidateWorkingTree(
  workspaceRoot: string,
  candidate: CandidateRecord
): Promise<void> {
  const root = await normalizeWorkspaceRoot(workspaceRoot);
  const head = (await runGit(root, ['rev-parse', '--verify', 'HEAD'])).trim();
  if (head !== candidate.baseCommit) {
    throw new Error(
      `Cannot safely revert autoresearch candidate ${candidate.attemptId}: HEAD drifted from ${candidate.baseCommit} to ${head}.`
    );
  }
  const untrackedPaths = new Set(candidate.untrackedFiles.map((file) => file.path));
  const trackedPaths = candidate.changedPaths
    .map((changedPath) => changedPath.path)
    .filter((changedPath) => !untrackedPaths.has(changedPath));
  if (trackedPaths.length > 0) {
    await runGit(root, [
      'restore', '--source=HEAD', '--staged', '--worktree', '--', ...trackedPaths,
    ]);
  }
  for (const file of candidate.untrackedFiles) {
    assertSafeRelativePath(file.path);
    const destination = path.resolve(root, file.path);
    if (destination !== root && !destination.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Cannot safely remove candidate path outside workspace: ${file.path}`);
    }
    await fs.remove(destination);
  }
}

export async function createEnvironmentFingerprint(
  workspaceRoot: string,
  evaluators: Record<string, string>,
  environmentAllowlist: string[]
): Promise<EnvironmentFingerprint> {
  const rejected = environmentAllowlist.filter((name) => SECRET_ENVIRONMENT_NAME.test(name));
  if (rejected.length > 0) {
    throw new Error(`Secret-like environment names cannot be persisted: ${rejected.join(', ')}`);
  }
  const lockfiles: Record<string, string> = {};
  for (const filename of LOCKFILE_NAMES) {
    const filePath = path.join(workspaceRoot, filename);
    if (!(await fs.pathExists(filePath))) continue;
    lockfiles[filename] = createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  }
  const allowedEnvironment = Object.fromEntries(environmentAllowlist
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name] ?? '']));
  return {
    platform: process.platform,
    architecture: process.arch,
    cliVersion: packageJson.version,
    nodeVersion: process.version,
    bunVersion: process.versions.bun ?? '',
    gitVersion: (await runGit(workspaceRoot, ['--version'])).trim(),
    lockfiles,
    evaluators: Object.fromEntries(Object.entries(evaluators).map(([name, script]) => [
      name,
      createHash('sha256').update(script).digest('hex'),
    ])),
    allowedEnvironment,
  };
}

function parsePorcelainPaths(status: string): string[] {
  const entries = status.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.push(entry.slice(3));
    if (entry.startsWith('R') || entry.startsWith('C')) {
      const secondPath = entries[index + 1];
      if (secondPath) paths.push(secondPath);
      index += 1;
    }
  }
  return paths;
}

function parseNameStatus(output: string): GitNameStatus[] {
  const tokens = output.split('\0').filter(Boolean);
  const results: GitNameStatus[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const from = tokens[index++];
      const to = tokens[index++];
      if (from && to) results.push({ kind: 'renamed', paths: [from, to] });
      continue;
    }
    const filePath = tokens[index++];
    if (!filePath) continue;
    const kind = status.startsWith('A')
      ? 'added'
      : status.startsWith('D')
        ? 'deleted'
        : 'modified';
    results.push({ kind, paths: [filePath] });
  }
  return results;
}

function isInternalAutoPath(relativePath: string): boolean {
  return relativePath === '.auto' || relativePath.startsWith('.auto/');
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = relativePath.split('\\').join('/');
  if (
    !normalized
    || normalized.includes('\0')
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').includes('..')
    || normalized === '.git'
    || normalized.startsWith('.git/')
    || isInternalAutoPath(normalized)
  ) {
    throw new Error(`Unsafe autoresearch candidate path: ${relativePath}`);
  }
}

function isPathInScope(relativePath: string, filesInScope?: string[]): boolean {
  if (!filesInScope || filesInScope.length === 0) return true;
  return filesInScope.some((scope) => {
    const normalized = scope.replace(/^\.\//, '').replace(/\/$/, '');
    return relativePath === normalized
      || relativePath.startsWith(`${normalized}/`)
      || minimatch(relativePath, normalized, { dot: true });
  });
}

async function assertNoChangedSubmodules(workspaceRoot: string): Promise<void> {
  const raw = await runGit(workspaceRoot, ['diff', '--raw', 'HEAD', '--', '.']);
  if (/(?:^|\n):160000\s|\s160000\s/.test(raw)) {
    throw new Error('Replayable autoresearch does not allow changed submodules.');
  }
  const status = await runGit(workspaceRoot, ['submodule', 'status', '--recursive']).catch(() => '');
  const changed = status.split('\n').filter((line) => /^[+\-U]/.test(line));
  if (changed.length > 0) {
    throw new Error(`Replayable autoresearch does not allow changed submodules: ${changed.join(', ')}`);
  }
}
