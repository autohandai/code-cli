/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type SessionWorktreeOption = boolean | string | undefined;

export interface SessionWorktreeInput {
  cwd: string;
  worktree: Exclude<SessionWorktreeOption, undefined | false>;
  mode?: 'cli' | 'rpc' | 'acp' | 'patch';
}

export interface SessionWorktreeInfo {
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  createdBranch: boolean;
}

interface GitResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

function runGit(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

function ensureGitRepo(cwd: string): string {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || 'unknown error';
    throw new Error(`--worktree requires a git repository (git rev-parse failed: ${details})`);
  }

  return result.stdout.trim();
}

function sanitizeName(input: string): string {
  const trimmed = input.trim();
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return normalized || 'autohand-worktree';
}

function buildAutoBranchName(mode: SessionWorktreeInput['mode']): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return sanitizeName(`autohand-${mode ?? 'cli'}-${ts}-${rand}`);
}

function branchExists(repoRoot: string, branchName: string): boolean {
  const result = runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
  return result.status === 0;
}

function findAvailablePath(basePath: string): string {
  if (!existsSync(basePath)) {
    return basePath;
  }

  for (let i = 2; i < 1000; i++) {
    const candidate = `${basePath}-${i}`;
    if (!existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to find available worktree path near ${basePath}`);
}

export function isSessionWorktreeEnabled(worktree: SessionWorktreeOption): worktree is Exclude<SessionWorktreeOption, undefined | false> {
  return worktree !== undefined && worktree !== false;
}

export function prepareSessionWorktree(input: SessionWorktreeInput): SessionWorktreeInfo {
  const repoRoot = ensureGitRepo(input.cwd);
  const branchName = typeof input.worktree === 'string'
    ? sanitizeName(input.worktree)
    : buildAutoBranchName(input.mode);

  const repoName = path.basename(repoRoot);
  const parentDir = path.dirname(repoRoot);
  const basePath = path.join(parentDir, `${repoName}-${branchName}`);
  const worktreePath = findAvailablePath(basePath);
  const existingBranch = branchExists(repoRoot, branchName);

  const args = existingBranch
    ? ['worktree', 'add', worktreePath, branchName]
    : ['worktree', 'add', '-b', branchName, worktreePath];

  const result = runGit(repoRoot, args);
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || 'unknown error';
    throw new Error(`Failed to create git worktree: ${details}`);
  }

  return {
    repoRoot,
    worktreePath,
    branchName,
    createdBranch: !existingBranch,
  };
}
