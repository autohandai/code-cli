/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSpawnSync, mockExistsSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

import { isSessionWorktreeEnabled, prepareSessionWorktree } from '../../src/utils/sessionWorktree.js';

describe('prepareSessionWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('creates a new worktree and branch for auto-named sessions', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '/tmp/repo\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const result = prepareSessionWorktree({
      cwd: '/tmp/repo',
      worktree: true,
      mode: 'cli',
    });

    expect(result.repoRoot).toBe('/tmp/repo');
    expect(result.createdBranch).toBe(true);
    expect(result.branchName).toMatch(/^autohand-cli-/);
    expect(mockSpawnSync).toHaveBeenCalledTimes(3);

    const addArgs = mockSpawnSync.mock.calls[2]?.[1] as string[];
    expect(addArgs[0]).toBe('worktree');
    expect(addArgs[1]).toBe('add');
    expect(addArgs[2]).toBe('-b');
    expect(addArgs[3]).toBe(result.branchName);
    expect(addArgs[4]).toBe(`/tmp/repo-${result.branchName}`);
  });

  it('uses an existing branch when the requested branch already exists', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '/workspace/proj\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const result = prepareSessionWorktree({
      cwd: '/workspace/proj',
      worktree: 'Feature/Fix #42',
      mode: 'rpc',
    });

    expect(result.branchName).toBe('feature-fix-42');
    expect(result.createdBranch).toBe(false);

    const addArgs = mockSpawnSync.mock.calls[2]?.[1] as string[];
    expect(addArgs).toEqual([
      'worktree',
      'add',
      '/workspace/proj-feature-fix-42',
      'feature-fix-42',
    ]);
  });

  it('finds a suffixed worktree path when the default path already exists', () => {
    mockExistsSync.mockImplementation((candidate: string) => candidate === '/tmp/repo-feature');

    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '/tmp/repo\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const result = prepareSessionWorktree({
      cwd: '/tmp/repo',
      worktree: 'feature',
      mode: 'acp',
    });

    expect(result.worktreePath).toBe('/tmp/repo-feature-2');

    const addArgs = mockSpawnSync.mock.calls[2]?.[1] as string[];
    expect(addArgs).toEqual([
      'worktree',
      'add',
      '-b',
      'feature',
      '/tmp/repo-feature-2',
    ]);
  });

  it('throws a clear error when cwd is not a git repository', () => {
    mockSpawnSync.mockReturnValueOnce({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });

    expect(() =>
      prepareSessionWorktree({
        cwd: '/tmp/not-git',
        worktree: true,
      })
    ).toThrow('--worktree requires a git repository');
  });

  it('normalizes invalid custom names to a safe default branch', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '/tmp/repo\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' });

    const result = prepareSessionWorktree({
      cwd: '/tmp/repo',
      worktree: '   !!!   ',
      mode: 'cli',
    });

    expect(result.branchName).toBe('autohand-worktree');

    const addArgs = mockSpawnSync.mock.calls[2]?.[1] as string[];
    expect(addArgs).toEqual([
      'worktree',
      'add',
      '-b',
      'autohand-worktree',
      '/tmp/repo-autohand-worktree',
    ]);
  });

  it('throws when git worktree add fails', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: '/tmp/repo\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'fatal: add failed' });

    expect(() =>
      prepareSessionWorktree({
        cwd: '/tmp/repo',
        worktree: true,
        mode: 'cli',
      })
    ).toThrow('Failed to create git worktree: fatal: add failed');
  });
});

describe('isSessionWorktreeEnabled', () => {
  it('returns true for enabled variants and false otherwise', () => {
    expect(isSessionWorktreeEnabled(true)).toBe(true);
    expect(isSessionWorktreeEnabled('feature')).toBe(true);
    expect(isSessionWorktreeEnabled(false)).toBe(false);
    expect(isSessionWorktreeEnabled(undefined)).toBe(false);
  });
});
