/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export interface GitStatusEntry {
  status: string;
  path: string;
  originalPath?: string;
}

export interface AutoCommitSnapshot {
  repositoryRoot: string;
  gitDirectory: string;
  status: string;
  files: ReadonlyMap<string, string>;
  indexEntries: ReadonlyMap<string, string>;
  dirtyPaths: ReadonlySet<string>;
}

export function readSnapshotGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || 'Unable to read Git state');
  return result.stdout;
}

export function readGitStatus(cwd: string): { raw: string; entries: GitStatusEntry[] } {
  const raw = readSnapshotGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const chunks = raw.split('\0');
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const line = chunks[i];
    if (!line) continue;
    const status = line.slice(0, 2);
    const entry: GitStatusEntry = { status, path: line.slice(3) };
    if (status.includes('R') || status.includes('C')) entry.originalPath = chunks[++i];
    entries.push(entry);
  }
  return { raw, entries };
}

export function statusEntryPaths(entry: GitStatusEntry): string[] {
  return entry.status.includes('R') && entry.originalPath ? [entry.originalPath, entry.path] : [entry.path];
}

export function readGitIndex(cwd: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readSnapshotGit(cwd, ['ls-files', '--stage', '-z']).split('\0')) {
    if (!line) continue;
    const separator = line.indexOf('\t');
    const name = line.slice(separator + 1);
    const value = line.slice(0, separator);
    entries.set(name, (entries.get(name) ?? '') + value + '\n');
  }
  return entries;
}

export function fingerprintGitPath(root: string, relative: string): string {
  const file = path.resolve(root, relative);
  const location = path.relative(root, file);
  if (location === '..' || location.startsWith('..' + path.sep) || path.isAbsolute(location)) throw new Error('Git path is outside the repository');
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent'; throw error; }
  if (stat.isSymbolicLink()) return 'symlink:' + fs.readlinkSync(file);
  if (stat.isDirectory()) return 'gitlink:' + readSnapshotGit(file, ['rev-parse', 'HEAD']).trim();
  if (!stat.isFile()) throw new Error('Cannot safely fingerprint ' + relative);
  const resolved = path.relative(root, fs.realpathSync(file));
  if (resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) throw new Error('Git path resolves outside the repository');
  const hash = createHash('sha256');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(descriptor);
    if (current.ino !== stat.ino || current.dev !== stat.dev) throw new Error('File changed while capturing Git state: ' + relative);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let size: number;
    while ((size = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
    const after = fs.fstatSync(descriptor);
    if (after.size !== current.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs) throw new Error('File changed while capturing Git state: ' + relative);
  } finally { fs.closeSync(descriptor); }
  return 'file:' + (stat.mode & 0o111) + ':' + hash.digest('hex');
}

export function captureAutoCommitSnapshot(cwd: string): AutoCommitSnapshot {
  const repositoryRoot = fs.realpathSync(readSnapshotGit(cwd, ['rev-parse', '--show-toplevel']).trim());
  const gitDirectory = readSnapshotGit(repositoryRoot, ['rev-parse', '--absolute-git-dir']).trim();
  const status = readGitStatus(repositoryRoot);
  const paths = [...new Set(readSnapshotGit(repositoryRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))];
  if (paths.length > 100_000) throw new Error('Repository exceeds the safe automatic-commit snapshot limit');
  return {
    repositoryRoot, gitDirectory, status: status.raw,
    files: new Map(paths.map(file => [file, fingerprintGitPath(repositoryRoot, file)])),
    indexEntries: readGitIndex(repositoryRoot),
    dirtyPaths: new Set(status.entries.flatMap(statusEntryPaths)),
  };
}

export interface SessionGitState {
  workspaceRoot: string;
  sessionGitSnapshot?: AutoCommitSnapshot | null;
  sessionGitSnapshotError?: string;
  sessionGitSnapshotFinalized?: boolean;
}

/** A new session captures its baseline at the first instruction, after setup. */
export function resetSessionGitSnapshot(runtime: SessionGitState | undefined): void {
  if (!runtime) return;
  delete runtime.sessionGitSnapshot;
  delete runtime.sessionGitSnapshotError;
  runtime.sessionGitSnapshotFinalized = false;
}

export function initializeSessionGitSnapshot(runtime: SessionGitState | undefined, force = false): void {
  if (!runtime?.workspaceRoot) return;
  if (!force && runtime.sessionGitSnapshot !== undefined) return;
  runtime.sessionGitSnapshotFinalized = false;
  try {
    runtime.sessionGitSnapshot = captureAutoCommitSnapshot(runtime.workspaceRoot);
    runtime.sessionGitSnapshotError = undefined;
  } catch (error) {
    runtime.sessionGitSnapshot = null;
    runtime.sessionGitSnapshotError = error instanceof Error ? error.message : 'Unable to capture Git state';
  }
}

/** Freeze the baseline after setup, before the first agent instruction can edit files. */
export function finalizeSessionGitSnapshot(runtime: SessionGitState): void {
  if (runtime.sessionGitSnapshotFinalized) return;
  initializeSessionGitSnapshot(runtime, true);
  runtime.sessionGitSnapshotFinalized = true;
}
