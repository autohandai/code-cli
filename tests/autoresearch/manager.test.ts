/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { AutoResearchManager } from '../../src/autoresearch/manager.js';
import { appendLogEntry, writeConfigJson, writePromptMd } from '../../src/autoresearch/session.js';

describe('AutoResearchManager', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-manager-'));
  });

  it('starts a new session and writes state', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    const result = await manager.start('optimize test runtime', 25);

    expect(result.message).toContain('started');
    expect(result.instruction).toContain('Auto-research loop');
    expect(result.instruction).toContain('optimize test runtime');

    const state = await manager.getState();
    expect(state?.active).toBe(true);
    expect(state?.goal).toBe('optimize test runtime');
    expect(state?.iteration).toBe(0);
    expect(state?.maxIterations).toBe(25);
  });

  it('resumes an existing session and appends context', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    const result = await manager.resume('focus on mocks');

    expect(result.message).toContain('Resuming');
    expect(result.instruction).toContain('focus on mocks');

    const state = await manager.getState();
    expect(state?.active).toBe(true);
  });

  it('resumes from prompt.md when state is missing', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await writePromptMd(workspaceRoot, {
      goal: 'optimize unit test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    const result = await manager.resume('continue from persisted prompt');

    expect(result.message).toContain('optimize unit test runtime');
    expect(result.instruction).toContain('Additional context: continue from persisted prompt');
    const state = await manager.getState();
    expect(state?.active).toBe(true);
    expect(state?.goal).toBe('optimize unit test runtime');
  });

  it('pauses the session', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime');

    await manager.pause();

    const state = await manager.getState();
    expect(state?.active).toBe(false);
  });

  it('builds a loop instruction that mentions subagents and git actions', () => {
    const manager = new AutoResearchManager(workspaceRoot);
    const instruction = manager.buildLoopInstruction('optimize test runtime');

    expect(instruction).toContain('Session setup contract');
    expect(instruction).toContain('benchmark command');
    expect(instruction).toContain('metric name, metric unit, and optimization direction');
    expect(instruction).toContain('editable scope');
    expect(instruction).toContain('correctness checks');
    expect(instruction).toContain('maximum iterations');
    expect(instruction).toContain('subagent phases');
    expect(instruction).toContain('delegate_task');
    expect(instruction).toContain('run_experiment');
    expect(instruction).toContain('log_experiment');
    expect(instruction).toContain('git_commit');
    expect(instruction).toContain('revert');
    expect(instruction).toContain('.auto/log.jsonl');
  });

  it('reports status with config and run count', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
    });

    const status = await manager.getStatus();
    expect(status).toContain('test-speed');
    expect(status).toContain('total_ms');
  });

  it('reports persisted best metric and confidence after three logged runs', async () => {
    const manager = new AutoResearchManager(workspaceRoot);
    await manager.start('optimize test runtime', 10);
    await writeConfigJson(workspaceRoot, {
      name: 'test-speed',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      maxIterations: 10,
    });
    await appendLogEntry(workspaceRoot, {
      run: 1,
      status: 'kept',
      metric: 100,
      description: 'baseline',
      timestamp: '2026-07-08T00:00:00.000Z',
    });
    await appendLogEntry(workspaceRoot, {
      run: 2,
      status: 'discarded',
      metric: 95,
      description: 'minor tweak',
      timestamp: '2026-07-08T00:01:00.000Z',
    });
    await appendLogEntry(workspaceRoot, {
      run: 3,
      status: 'kept',
      metric: 80,
      description: 'cached setup',
      timestamp: '2026-07-08T00:02:00.000Z',
    });

    const status = await manager.getStatus();

    expect(status).toContain('Runs logged: 3 (2 kept, 1 discarded, 0 checks failed, 0 crashed)');
    expect(status).toContain('Best: run 3 at 80 ms (baseline 100 ms)');
    expect(status).toContain('Confidence: 4.00 (MAD 5 ms)');
  });
});
