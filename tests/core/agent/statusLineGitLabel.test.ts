/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveStatusLineGitLabel,
  type StatusLineGitLabelHost,
} from '../../../src/core/agent/AgentContextRuntime.js';

const tmpDirs: string[] = [];
const GIT_EXEC_OPTIONS = {
  env: {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  },
  stdio: 'ignore',
  timeout: 10_000,
} as const;

async function createRepo(branch: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-status-git-'));
  tmpDirs.push(dir);
  execFileSync('git', ['init', '--initial-branch', branch], { cwd: dir, ...GIT_EXEC_OPTIONS });
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.remove(dir)));
});

describe('resolveStatusLineGitLabel', () => {
  // Regression: this ran two blocking spawnSync git calls from the 1Hz status
  // refresh, freezing the event loop mid-keystroke while a turn was running.
  it('never runs git on the calling thread', async () => {
    const repo = await createRepo('main');
    const host: StatusLineGitLabelHost = { runtime: { workspaceRoot: repo } };

    // Measure several cold hosts in one batch. A synchronous implementation
    // pays the process-spawn cost on every call, while an asynchronous one only
    // schedules work. The aggregate budget tolerates an isolated CI preemption.
    const hosts = [
      host,
      ...Array.from({ length: 4 }, () => ({
        runtime: { workspaceRoot: repo },
      }) satisfies StatusLineGitLabelHost),
    ];
    const start = performance.now();
    for (const coldHost of hosts) {
      resolveStatusLineGitLabel(coldHost);
    }

    expect(performance.now() - start).toBeLessThan(30);
    await vi.waitFor(() => {
      expect(resolveStatusLineGitLabel(host)).toBe('main');
    }, { timeout: 10_000, interval: 25 });
  });

  it('resolves the branch name in the background', async () => {
    const repo = await createRepo('feature-branch');
    const host: StatusLineGitLabelHost = { runtime: { workspaceRoot: repo } };

    resolveStatusLineGitLabel(host);

    await vi.waitFor(() => {
      expect(resolveStatusLineGitLabel(host)).toBe('feature-branch');
    }, { timeout: 10_000, interval: 25 });
  });

  it('returns undefined outside a work tree', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-status-nogit-'));
    tmpDirs.push(dir);
    const host: StatusLineGitLabelHost = { runtime: { workspaceRoot: dir } };

    resolveStatusLineGitLabel(host);
    await new Promise((resolve) => { setTimeout(resolve, 300); });

    expect(resolveStatusLineGitLabel(host)).toBeUndefined();
  });

  it('returns undefined without a workspace root', () => {
    expect(resolveStatusLineGitLabel({})).toBeUndefined();
  });
});
