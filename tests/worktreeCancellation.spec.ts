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

/**
 * Spawning a shell, exec'ing node, and writing the marker takes ~40ms idle and
 * ~165ms under heavy load. The generous ceiling exists to bound pathology, not
 * normal variance: vi.waitFor returns the moment the file appears, so a large
 * timeout costs nothing when the machine is healthy and removes a false failure
 * when a full parallel suite stalls the box.
 */
const CHILD_START_TIMEOUT_MS = 30_000;

/**
 * Races the marker file against the run itself. runParallel records a spawn
 * failure as a failed result and moves on to the next worktree, so without this
 * race a failed spawn surfaces as a bare ENOENT on the marker and looks
 * identical to a slow machine.
 */
async function waitForFile(filePath: string, run: Promise<unknown>): Promise<void> {
  const marker = path.basename(filePath);
  const settledEarly = run.then(
    (value) => {
      throw new Error(`runParallel resolved before "${marker}" appeared: ${JSON.stringify(value)}`);
    },
    (error: unknown) => {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`runParallel rejected before "${marker}" appeared: ${reason}`);
    },
  );

  const appeared = vi.waitFor(async () => {
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  }, { timeout: CHILD_START_TIMEOUT_MS, interval: 10 });

  await Promise.race([appeared, settledEarly]);
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
    await waitForFile(startedFile, run);
    controller.abort();

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.access(secondStartedFile)).rejects.toThrow();

    const childPid = Number(await fs.readFile(startedFile, 'utf8'));
    await vi.waitFor(() => {
      expect(() => process.kill(childPid, 0)).toThrow();
    }, { timeout: CHILD_START_TIMEOUT_MS, interval: 10 });
  });
});
