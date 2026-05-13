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

    const completed = await adapter.handleGoalUpdate({ status: 'complete' }) as any;
    expect(completed.goal.status).toBe('complete');

    const queued = await adapter.handleGoalQueue({ objective: 'queued rpc goal' }) as any;
    expect(queued.queued).toHaveLength(1);

    const started = await adapter.handleGoalStartQueued() as any;
    expect(started.goal.objective).toBe('queued rpc goal');
    expect(started.queue).toEqual([]);
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
});
