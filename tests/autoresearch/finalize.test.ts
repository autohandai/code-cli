/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { finalizeSession } from '../../src/autoresearch/finalize.js';
import { appendLogEntry, writeConfigJson } from '../../src/autoresearch/session.js';

describe('autoresearch finalize', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-finalize-'));
  });

  it('returns a clear message when there are no kept runs', async () => {
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    const result = await finalizeSession(workspaceRoot);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No kept auto-research runs');
  });

  it('writes a finalize report grouping kept runs into reviewable changesets', async () => {
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    await appendLogEntry(workspaceRoot, {
      run: 1,
      status: 'kept',
      metric: 100,
      description: 'baseline',
      commit: 'abc123',
      hypothesis: 'capture baseline',
      learned: 'baseline is stable',
      timestamp: '2026-07-08T00:00:00.000Z',
    });
    await appendLogEntry(workspaceRoot, {
      run: 2,
      status: 'discarded',
      metric: 120,
      description: 'slow attempt',
      timestamp: '2026-07-08T00:01:00.000Z',
    });
    await appendLogEntry(workspaceRoot, {
      run: 3,
      status: 'kept',
      metric: 80,
      description: 'cache test harness',
      commit: 'def456',
      nextFocus: 'check fixture cleanup',
      timestamp: '2026-07-08T00:02:00.000Z',
    });

    const result = await finalizeSession(workspaceRoot);

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(path.join(workspaceRoot, '.auto', 'finalize.md'));
    expect(result.manifestPath).toBe(path.join(workspaceRoot, '.auto', 'finalize-branches.json'));

    const report = await fs.readFile(result.filePath!, 'utf-8');
    expect(report).toContain('# Auto-research Finalize Plan');
    expect(report).toContain('test-speed');
    expect(report).toContain('Branch manifest: .auto/finalize-branches.json');
    expect(report).toContain('run 1');
    expect(report).toContain('baseline');
    expect(report).toContain('abc123');
    expect(report).toContain('git branch autoresearch/test-speed-run-1 abc123');
    expect(report).toContain('run 3');
    expect(report).toContain('cache test harness');
    expect(report).toContain('def456');
    expect(report).toContain('autoresearch/test-speed-run-3');
    expect(report).toContain('git switch autoresearch/test-speed-run-3');
    expect(report).toContain('No branch operations were performed');
    expect(report).not.toContain('slow attempt');

    const manifest = await fs.readJson(result.manifestPath!);
    expect(manifest).toMatchObject({
      session: {
        name: 'test-speed',
        metricName: 'total_ms',
        metricUnit: 'ms',
        direction: 'lower',
      },
      branches: [
        {
          run: 1,
          branch: 'autoresearch/test-speed-run-1',
          commit: 'abc123',
          createBranch: {
            command: 'git',
            args: ['branch', 'autoresearch/test-speed-run-1', 'abc123'],
          },
          reviewBranch: {
            command: 'git',
            args: ['switch', 'autoresearch/test-speed-run-1'],
          },
        },
        {
          run: 3,
          branch: 'autoresearch/test-speed-run-3',
          commit: 'def456',
          createBranch: {
            command: 'git',
            args: ['branch', 'autoresearch/test-speed-run-3', 'def456'],
          },
          reviewBranch: {
            command: 'git',
            args: ['switch', 'autoresearch/test-speed-run-3'],
          },
        },
      ],
      approval: {
        safeDefault: expect.stringContaining('writes plan files only'),
        requiresApproval: expect.arrayContaining([
          'creating or switching branches',
          'resetting history',
        ]),
      },
    });
  });

  it('does not generate branch commands without a usable commit hash', async () => {
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    await appendLogEntry(workspaceRoot, {
      run: 1,
      status: 'kept',
      metric: 100,
      description: 'missing commit',
      timestamp: '2026-07-08T00:00:00.000Z',
    });
    await appendLogEntry(workspaceRoot, {
      run: 2,
      status: 'kept',
      metric: 90,
      description: 'invalid commit',
      commit: 'origin/main; rm -rf .',
      timestamp: '2026-07-08T00:01:00.000Z',
    });

    const result = await finalizeSession(workspaceRoot);

    expect(result.success).toBe(true);

    const manifest = await fs.readJson(result.manifestPath!);
    expect(manifest.branches[0]).toEqual(expect.objectContaining({
      run: 1,
      note: expect.stringContaining('No commit hash'),
    }));
    expect(manifest.branches[0].createBranch).toBeUndefined();
    expect(manifest.branches[1]).toEqual(expect.objectContaining({
      run: 2,
      commit: 'origin/main; rm -rf .',
      note: expect.stringContaining('not a hex commit hash'),
    }));
    expect(manifest.branches[1].createBranch).toBeUndefined();

    const report = await fs.readFile(result.filePath!, 'utf-8');
    expect(report).not.toContain('git branch');
    expect(report).toContain('No commit hash was recorded');
    expect(report).toContain('Recorded commit is not a hex commit hash');
  });
});
