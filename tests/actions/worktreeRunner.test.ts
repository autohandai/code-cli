/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { WorktreeManager } from '../../src/actions/worktree.js';

type RunInWorktree = (worktreePath: string, command: string, timeoutMs?: number) => Promise<string>;

describe('WorktreeManager.runInWorktree', () => {
  it('rejects and kills the child when a setup command never exits', async () => {
    const manager = new WorktreeManager(process.cwd());
    const runInWorktree = (manager as unknown as { runInWorktree: RunInWorktree }).runInWorktree.bind(manager);
    const startedAt = Date.now();

    await expect(runInWorktree(os.tmpdir(), 'sleep 30', 200)).rejects.toThrow(/timed out/i);

    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });

  it('resolves stdout for a command that exits normally', async () => {
    const manager = new WorktreeManager(process.cwd());
    const runInWorktree = (manager as unknown as { runInWorktree: RunInWorktree }).runInWorktree.bind(manager);

    await expect(runInWorktree(os.tmpdir(), 'echo ready')).resolves.toBe('ready\n');
  });
});
