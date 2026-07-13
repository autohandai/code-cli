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

describe('RPC autoresearch handlers', () => {
  let workspaceRoot: string;
  let adapter: RPCAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWriteNotification.mockClear();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-rpc-autoresearch-'));
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
      measureCommand: 'bun test --reporter dot',
      checksCommand: 'bun run lint',
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
    expect(await readMeasureSh(workspaceRoot)).toContain('bun test --reporter dot');
    expect(await fs.readFile(path.join(workspaceRoot, '.auto', 'checks.sh'), 'utf-8')).toContain('bun run lint');

    const prompt = await readPromptMd(workspaceRoot);
    expect(prompt?.filesInScope).toEqual(['src', 'tests']);
    expect(prompt?.subagentPlan).toEqual(expect.arrayContaining([
      expect.stringContaining('idea generation'),
      expect.stringContaining('measurement analysis'),
      expect.stringContaining('finalization'),
    ]));
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

    const source = await fs.readFile(path.join(process.cwd(), 'src/modes/rpc/index.ts'), 'utf-8');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_START');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_STATUS');
    expect(source).toContain('RPC_METHODS.AUTORESEARCH_STOP');
  });
});
