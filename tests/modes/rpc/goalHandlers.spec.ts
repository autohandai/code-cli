/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => new Date().toISOString(),
  generateId: (prefix: string) => `${prefix}_test123`,
}));

import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';

describe('RPC goal handlers', () => {
  let workspaceRoot: string;
  let adapter: RPCAdapter;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-rpc-goals-'));
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
      {
        configPath: path.join(workspaceRoot, 'config.json'),
        features: { slashGoal: true },
      } as any,
    );
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('creates, reads, queues, and starts goals through JSON-RPC handlers', async () => {
    const created = await adapter.handleGoalCreate({ objective: 'rpc goal' }) as any;
    expect(created.ok).toBe(true);
    expect(created.goal.objective).toBe('rpc goal');

    const snapshot = await adapter.handleGoalGet() as any;
    expect(snapshot.goal.objective).toBe('rpc goal');

    const queuedByCreate = await adapter.handleGoalCreate({ objective: 'second rpc goal' }) as any;
    expect(queuedByCreate.ok).toBe(true);
    expect(queuedByCreate.queued[0].objective).toBe('second rpc goal');

    const completed = await adapter.handleGoalUpdate({ status: 'complete' }) as any;
    expect(completed.completed.objective).toBe('rpc goal');
    expect(completed.goal.objective).toBe('second rpc goal');
    expect(completed.goal.status).toBe('active');

    const queued = await adapter.handleGoalQueue({ objective: 'queued rpc goal' }) as any;
    expect(queued.queued).toHaveLength(1);

    await adapter.handleGoalUpdate({ status: 'complete' });

    const finalSnapshot = await adapter.handleGoalGet() as any;
    expect(finalSnapshot.goal.objective).toBe('queued rpc goal');
    expect(finalSnapshot.queue).toEqual([]);
  });

  it('returns a disabled result when slash_goal is off', async () => {
    const disabledAdapter = new RPCAdapter();
    disabledAdapter.initialize(
      {
        getImageManager: vi.fn(),
        setStatusListener: vi.fn(),
        setOutputListener: vi.fn(),
      } as any,
      { history: vi.fn().mockReturnValue([]) } as any,
      'test-model',
      workspaceRoot,
      {
        configPath: path.join(workspaceRoot, 'config.json'),
      } as any,
    );

    const result = await disabledAdapter.handleGoalCreate({ objective: 'rpc goal' }) as any;

    expect(result.ok).toBe(false);
    expect(result.message).toContain('slash_goal');
  });

  it('preserves queued criteria and completion evidence across RPC handlers', async () => {
    await adapter.handleGoalQueue({ objective: 'RPC evidence', acceptance_criteria: ['Tests pass'] });
    await adapter.handleGoalStartQueued();
    expect(await adapter.handleGoalUpdate({ status: 'complete' })).toMatchObject({ ok: false });

    expect(await adapter.handleGoalUpdate({ status: 'complete', completion_evidence: {
      summary: 'RPC verification', checks: [{ criterion: 'Tests pass', status: 'passed', evidence: 'RPC test log' }],
    } })).toMatchObject({ ok: true, completed: { completionReceipt: { summary: 'RPC verification', provenance: 'reported' } } });
  });

  it('rejects invalid RPC statuses without editing the objective', async () => {
    await adapter.handleGoalCreate({ objective: 'original RPC objective' });
    await expect(adapter.handleGoalUpdate({ status: 'typo', objective: 'must not be saved' })).rejects.toThrow('status');
    expect(await adapter.handleGoalGet()).toMatchObject({ goal: { objective: 'original RPC objective' } });
  });

  it('persists waiting metadata and a checkpoint through RPC', async () => {
    await adapter.handleGoalCreate({ objective: 'wait for CI' });
    expect(await adapter.handleGoalUpdate({ status: 'waiting', stop_reason: 'CI running', resume_when: 'CI passes', checkpoint: { summary: 'Patch ready' } }))
      .toMatchObject({ ok: true, goal: { status: 'waiting', checkpoint: { summary: 'Patch ready' } } });
  });
});
