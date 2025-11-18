/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';

export function applyGitPatch(cwd: string, patch: string): string {
  const result = spawnSync('git', ['apply', '-'], {
    cwd,
    input: patch,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git apply failed');
  }
  return result.stdout ?? '';
}

export function diffFile(cwd: string, file: string): string {
  const result = spawnSync('git', ['diff', '--', file], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git diff failed for ${file}`);
  }
  return result.stdout || 'No diff';
}

export function checkoutFile(cwd: string, file: string): void {
  const result = spawnSync('git', ['checkout', '--', file], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git checkout failed for ${file}`);
  }
}

export function gitStatus(cwd: string): string {
  const result = spawnSync('git', ['status', '-sb'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git status failed');
  }
  return result.stdout || 'clean';
}

export function gitListUntracked(cwd: string): string {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git ls-files failed');
  }
  return result.stdout || '';
}

export interface GitDiffRangeOptions {
  range?: string;
  staged?: boolean;
  paths?: string[];
}

export function gitDiffRange(cwd: string, options: GitDiffRangeOptions = {}): string {
  const args = ['diff'];
  if (options.staged) {
    args.push('--staged');
  }
  if (options.range) {
    args.push(options.range);
  }
  if (options.paths?.length) {
    args.push('--', ...options.paths);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git diff failed');
  }
  return result.stdout || 'No diff output.';
}

export function gitListWorktrees(cwd: string): string {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree list failed');
  }
  return result.stdout || 'No worktrees.';
}

export function gitAddWorktree(cwd: string, pathArg: string, ref?: string): string {
  const args = ['worktree', 'add', pathArg];
  if (ref) {
    args.push(ref);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree add failed');
  }
  return result.stdout || `Added worktree at ${pathArg}`;
}

export function gitRemoveWorktree(cwd: string, pathArg: string, force = false): string {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(pathArg);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree remove failed');
  }
  return result.stdout || `Removed worktree ${pathArg}`;
}
