/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorktreeManager, type WorktreeInfo } from '../src/actions/worktree.js';

async function waitForFile(filePath: string): Promise<void> {
  await vi.waitFor(async () => {
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  }, { timeout: 2_000, interval: 10 });
}

function worktreeInfo(worktreePath: string, branch: string): WorktreeInfo {
  return {
    path: worktreePath,
    head: 'abc123',
    branch,
    bare: false,
    detached: false,
    locked: false,
    prunable: false,
  };
}

describe('WorktreeManager cancellation', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    ));
  });

  it('terminates started foreground children and does not start another worktree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-worktree-cancel-'));
    temporaryDirectories.push(root);
    const first = path.join(root, 'first');
    const second = path.join(root, 'second');
    await Promise.all([fs.mkdir(first), fs.mkdir(second)]);
    const manager = new WorktreeManager(process.cwd());
    vi.spyOn(manager, 'list').mockReturnValue([
      worktreeInfo(first, 'first'),
      worktreeInfo(second, 'second'),
    ]);
    const controller = new AbortController();
    const startedFile = path.join(first, 'started');
    const secondStartedFile = path.join(second, 'started');
    const script = "require('node:fs').writeFileSync('started', String(process.pid)); setInterval(() => {}, 1000)";
    const command = `exec ${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;

    const run = manager.runParallel(command, {
      maxConcurrent: 1,
      timeout: 30_000,
      signal: controller.signal,
    });
    await waitForFile(startedFile);
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.access(secondStartedFile)).rejects.toThrow();

    const childPid = Number(await fs.readFile(startedFile, 'utf8'));
    await vi.waitFor(() => {
      expect(() => process.kill(childPid, 0)).toThrow();
    }, { timeout: 2_000, interval: 10 });
  });
});
