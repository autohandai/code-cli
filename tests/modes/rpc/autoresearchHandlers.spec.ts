/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var mockWriteNotification: ReturnType<typeof vi.fn>;

vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: (mockWriteNotification = vi.fn()),
  createTimestamp: () => '2026-07-08T00:00:00.000Z',
  generateId: (prefix: string) => `${prefix}_test123`,
}));

import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { RPC_METHODS, RPC_NOTIFICATIONS } from '../../../src/modes/rpc/types.js';
import { AutoResearchManager } from '../../../src/autoresearch/manager.js';
import { readConfigJson, readMeasureSh, readPromptMd } from '../../../src/autoresearch/session.js';
import { initExperiment, runExperiment } from '../../../src/autoresearch/tools.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('RPC autoresearch handlers', () => {
  let workspaceRoot: string;
  let adapter: RPCAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWriteNotification.mockClear();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-rpc-autoresearch-'));
    await execFileAsync('git', ['init'], { cwd: workspaceRoot });
    await execFileAsync('git', ['config', 'user.email', 'tests@autohand.ai'], { cwd: workspaceRoot });
    await execFileAsync('git', ['config', 'user.name', 'Autohand Tests'], { cwd: workspaceRoot });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '100\n');
    await execFileAsync('git', ['add', 'value.txt'], { cwd: workspaceRoot });
    await execFileAsync('git', ['commit', '-m', 'baseline'], { cwd: workspaceRoot });
    adapter = new RPCAdapter();
    adapter.initialize(
      {
        getImageManager: vi.fn(),
        setStatusListener: vi.fn(),
        setOutputListener: vi.fn(),
      } as any,
      { history: vi.fn().mockReturnValue([]) } as any,
      'test-model',
      workspaceRoot,
    );
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('starts, queries, and stops an autoresearch session through JSON-RPC handlers', async () => {
    const started = await (adapter as any).handleAutoresearchStart({
      objective: 'optimize test runtime',
      maxIterations: 12,
    });

    expect(started.success).toBe(true);
    expect(started.state).toMatchObject({
      active: true,
      goal: 'optimize test runtime',
      iteration: 0,
      maxIterations: 12,
    });
    expect(started.instruction).toContain('run_experiment');
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_START,
      expect.objectContaining({
        goal: 'optimize test runtime',
        active: true,
        maxIterations: 12,
      })
    );

    const status = await (adapter as any).handleAutoresearchStatus();
    expect(status.success).toBe(true);
    expect(status.active).toBe(true);
    expect(status.statusText).toContain('optimize test runtime');

    const stopped = await (adapter as any).handleAutoresearchStop();
    expect(stopped.success).toBe(true);
    expect(stopped.state.active).toBe(false);
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_PAUSE,
      expect.objectContaining({
        goal: 'optimize test runtime',
        active: false,
      })
    );
  });

  it('initializes benchmark session files from JSON-RPC start params', async () => {
    const started = await (adapter as any).handleAutoresearchStart({
      objective: 'optimize test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureCommand: 'echo "METRIC total_ms=42"',
      checksCommand: 'echo checks',
      maxIterations: 12,
      timeoutMs: 5000,
      filesInScope: ['src', 'tests'],
      subagents: {
        ideaGeneration: true,
        measurementAnalysis: true,
        finalization: true,
      },
    });

    expect(started.success).toBe(true);
    expect(started.message).toContain('Initialized benchmark config from RPC options.');
    expect(started.statusText).toContain('Metric: total_ms (ms)');

    expect(await readConfigJson(workspaceRoot)).toEqual(expect.objectContaining({
      name: 'optimize test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      maxIterations: 12,
      timeoutMs: 5000,
      subagents: {
        ideaGeneration: true,
        measurementAnalysis: true,
        finalization: true,
      },
    }));
    expect(await readMeasureSh(workspaceRoot)).toContain('METRIC total_ms=42');
    expect(await fs.readFile(path.join(workspaceRoot, '.auto', 'checks.sh'), 'utf-8')).toContain('echo checks');

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.filesInScope).toEqual(['src', 'tests']);
    expect(prompt?.subagentPlan).toEqual(expect.arrayContaining([
      expect.stringContaining('idea generation'),
      expect.stringContaining('measurement analysis'),
      expect.stringContaining('finalization'),
    ]));
  });

  it('does not persist resumable RPC state when clean-baseline initialization fails', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), 'dirty\n');

    const started = await adapter.handleAutoresearchStart({
      objective: 'optimize test runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureCommand: 'echo "METRIC total_ms=42"',
    });

    expect(started).toMatchObject({ success: false, error: expect.stringMatching(/clean Git working tree/i) });
    await expect(new AutoResearchManager(workspaceRoot).canResume()).resolves.toBe(false);
  });

  it('resumes a paused JSON-RPC session without resetting goal or iteration cap', async () => {
    await (adapter as any).handleAutoresearchStart({
      objective: 'optimize test runtime',
      maxIterations: 12,
    });
    await new AutoResearchManager(workspaceRoot).recordLoggedIteration(3);
    await (adapter as any).handleAutoresearchStop();
    mockWriteNotification.mockClear();

    const resumed = await (adapter as any).handleAutoresearchStart({
      objective: 'focus on setup cache',
      maxIterations: 99,
    });

    expect(resumed.success).toBe(true);
    expect(resumed.message).toContain('Resuming auto-research session: optimize test runtime');
    expect(resumed.instruction).toContain('Additional context: focus on setup cache');
    expect(resumed.state).toMatchObject({
      active: true,
      goal: 'optimize test runtime',
      iteration: 3,
      maxIterations: 12,
    });
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_START,
      expect.objectContaining({
        goal: 'optimize test runtime',
        active: true,
        maxIterations: 12,
        subcommand: 'resume',
      })
    );
  });

  it('exposes autoresearch methods and routes them through runRpcMode', async () => {
    expect(RPC_METHODS.AUTORESEARCH_START).toBe('autohand.autoresearch.start');
    expect(RPC_METHODS.AUTORESEARCH_STATUS).toBe('autohand.autoresearch.status');
    expect(RPC_METHODS.AUTORESEARCH_STOP).toBe('autohand.autoresearch.stop');
    expect(RPC_METHODS.AUTORESEARCH_HISTORY).toBe('autohand.autoresearch.history');
    expect(RPC_METHODS.AUTORESEARCH_REPLAY).toBe('autohand.autoresearch.replay');
    expect(RPC_METHODS.AUTORESEARCH_RESCORE).toBe('autohand.autoresearch.rescore');
    expect(RPC_METHODS.AUTORESEARCH_COMPARE).toBe('autohand.autoresearch.compare');
    expect(RPC_METHODS.AUTORESEARCH_PARETO).toBe('autohand.autoresearch.pareto');
    expect(RPC_METHODS.AUTORESEARCH_PIN).toBe('autohand.autoresearch.pin');
    expect(RPC_METHODS.AUTORESEARCH_PRUNE).toBe('autohand.autoresearch.prune');

    const source = await fs.readFile(path.join(process.cwd(), 'src/modes/rpc/index.ts'), 'utf-8');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_START');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_STATUS');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_STOP');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_REPLAY');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_PRUNE');
  });

  it('exposes immutable history, replay, rescoring, comparison, Pareto, pinning, and preview-first pruning', async () => {
    const initialized = await initExperiment(workspaceRoot, {
      name: 'runtime',
      metricName: 'total_ms',
      metricUnit: 'ms',
      direction: 'lower',
      measureScript: '#!/bin/bash\nvalue=$(cat value.txt)\necho "METRIC total_ms=$value"',
      filesInScope: ['value.txt'],
    });
    await fs.writeFile(path.join(workspaceRoot, 'value.txt'), '120\n');
    const candidate = await runExperiment(workspaceRoot, 'regression');

    const history = await adapter.handleAutoresearchHistory();
    expect(history).toMatchObject({ success: true });
    expect(history.attempts.map((attempt) => attempt.attemptId)).toContain(candidate.attemptId);
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_EVENT,
      expect.objectContaining({ operation: 'history', phase: 'started' })
    );

    const replay = await adapter.handleAutoresearchReplay({
      attemptId: candidate.attemptId!,
      evaluator: 'original',
    });
    expect(replay).toMatchObject({ success: true, decision: { outcome: 'rejected' } });
    expect(replay.samples).toHaveLength(3);

    const compare = await adapter.handleAutoresearchCompare({
      leftAttemptId: initialized.baselineAttemptId!,
      rightAttemptId: candidate.attemptId!,
    });
    expect(compare).toMatchObject({ success: true });
    expect(compare.comparison.right.aggregates.total_ms.median).toBe(120);

    const rescore = await adapter.handleAutoresearchRescore({ attemptId: candidate.attemptId! });
    expect(rescore.decisions[0]).toMatchObject({ source: 'rescore', materialized: false });

    const pareto = await adapter.handleAutoresearchPareto();
    expect(pareto.attemptIds).toContain(initialized.baselineAttemptId);

    const pin = await adapter.handleAutoresearchPin({ attemptId: candidate.attemptId!, pinned: true });
    expect(pin).toMatchObject({ success: true, pinned: true });

    const prune = await adapter.handleAutoresearchPrune({ yes: false });
    expect(prune).toMatchObject({ success: true, applied: false });
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_EVENT,
      expect.objectContaining({ operation: 'prune', phase: 'completed', applied: false })
    );
  });

  it('rejects an unknown replay evaluator and emits a failed operation phase', async () => {
    const result = await adapter.handleAutoresearchReplay({
      attemptId: 'attempt_invalid',
      evaluator: 'future' as 'original',
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/evaluator.*original.*current/i),
    });
    expect(mockWriteNotification).toHaveBeenCalledWith(
      RPC_NOTIFICATIONS.AUTORESEARCH_EVENT,
      expect.objectContaining({ operation: 'replay', phase: 'failed', success: false })
    );
  });
});
