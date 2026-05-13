/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';

describe('GoalManager', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goals-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.remove(workspaceRoot);
  });

  it('persists active goals under the project .autohand directory', async () => {
    const manager = new GoalManager(workspaceRoot);
    const created = await manager.createGoal({ objective: 'ship durable goals' });

    expect(created.ok).toBe(true);
    expect(created.goal?.objective).toBe('ship durable goals');

    const reloaded = new GoalManager(workspaceRoot);
    const snapshot = await reloaded.getSnapshot();

    expect(snapshot.goal?.goalId).toBe(created.goal?.goalId);
    expect(snapshot.goal?.status).toBe('active');
    expect(await fs.pathExists(path.join(workspaceRoot, '.autohand', 'goals.local.json'))).toBe(true);
  });

  it('queues multi-item goal blocks in FIFO order', async () => {
    const manager = new GoalManager(workspaceRoot);
    const result = await manager.enqueueGoalBlock('[1] first goal\n[2] second goal', 'command');

    expect(result.ok).toBe(true);
    expect(result.queued).toHaveLength(2);

    const snapshot = await manager.getSnapshot();
    expect(snapshot.queue.map((item) => item.objective)).toEqual(['first goal', 'second goal']);
  });

  it('starts a queued goal only after creating the active goal', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.enqueueGoal({ objective: 'queued work', source: 'tool' });

    const result = await manager.startQueuedGoal();

    expect(result.ok).toBe(true);
    expect(result.goal?.objective).toBe('queued work');
    expect(result.started?.objective).toBe('queued work');
    expect((await manager.getSnapshot()).queue).toEqual([]);
  });

  it('tracks active elapsed time and refuses to resume exhausted time budgets', async () => {
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-13T00:00:00.000Z').getTime());

    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'bounded work', timeBudgetSeconds: 10 });

    dateSpy.mockReturnValue(new Date('2026-05-13T00:00:12.000Z').getTime());
    const limited = await manager.recordTurnUsage({ tokensUsed: 0 });

    expect(limited.goal?.status).toBe('budgetLimited');

    const resumed = await manager.updateGoal({ status: 'active' });
    expect(resumed.ok).toBe(false);
    expect(resumed.message).toContain('budget is exhausted');
  });

  it('blocks goal completion until configured floors are met', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'floor work', minTokensBeforeWrapUp: 50 });

    const early = await manager.updateGoal({ status: 'complete' });
    expect(early.ok).toBe(false);
    expect(early.message).toContain('Completion floor is not met');

    await manager.recordTurnUsage({ tokensUsed: 50 });
    const complete = await manager.updateGoal({ status: 'complete' });
    expect(complete.ok).toBe(true);
    expect(complete.goal?.status).toBe('complete');
  });
});
