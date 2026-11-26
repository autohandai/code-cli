/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';
import {
  GOAL_STATUS_EVENTS,
  GOAL_STATUS_LIFECYCLE,
  GOAL_STATUSES,
  canTransitionGoalStatus,
  type GoalStatus,
} from '../../src/goals/types.js';
import { reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const OPEN: GoalStatus[] = ['active', 'paused', 'blocked', 'waiting'];

describe('goal status lifecycle table', () => {
  it('declares every persisted status and reaches each from a new goal', () => {
    expect(Object.keys(GOAL_STATUS_LIFECYCLE.transitions).sort()).toEqual([...GOAL_STATUSES].sort());
    expect([...reachableStates(GOAL_STATUS_LIFECYCLE)].sort()).toEqual([...GOAL_STATUSES].sort());
    expect(terminalStates(GOAL_STATUS_LIFECYCLE)).toEqual([]);
  });

  it.each(OPEN.flatMap((from) => OPEN.map((to) => [from, to] as const)))('lets an open goal move %s -> %s', (from, to) => {
    expect(canTransitionGoalStatus(from, to)).toBe(true);
  });

  it.each(OPEN)('lets a %s goal complete', (from) => {
    expect(canTransitionGoalStatus(from, 'complete')).toBe(true);
  });

  it('only exhausts the budget of a running goal', () => {
    expect(canTransitionGoalStatus('active', 'budgetLimited')).toBe(true);
    for (const from of ['paused', 'blocked', 'waiting', 'complete', 'budgetLimited'] as const) {
      expect(canTransitionGoalStatus(from, 'budgetLimited')).toBe(false);
    }
  });

  it('reopens terminal goals only by resuming them', () => {
    expect(canTransitionGoalStatus('complete', 'active')).toBe(true);
    expect(canTransitionGoalStatus('budgetLimited', 'active')).toBe(true);
    expect(canTransitionGoalStatus('budgetLimited', 'complete')).toBe(true);
    for (const to of ['paused', 'blocked', 'waiting'] as const) {
      expect(canTransitionGoalStatus('complete', to)).toBe(false);
      expect(canTransitionGoalStatus('budgetLimited', to)).toBe(false);
    }
    expect(canTransitionGoalStatus('complete', 'complete')).toBe(false);
  });

  it('accepts exactly the table edges for any event sequence', () => {
    randomEventWalk(GOAL_STATUS_LIFECYCLE, GOAL_STATUS_EVENTS, { seeds: 50, steps: 60 });
  });
});

describe('GoalManager status transitions', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-lifecycle-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it.each(['paused', 'blocked', 'waiting'] as const)('refuses to turn a completed goal into %s and keeps it replaceable', async (status) => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'finished work' });
    await manager.updateGoal({ status: 'complete' });
    const before = await manager.getSnapshot();

    const progress = status === 'paused' ? {} : { stopReason: 'Need input', resumeWhen: 'Answered' };
    const result = await manager.updateGoal({ status, ...progress });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('complete');
    expect(result.message).toContain('Resume the goal first.');
    expect(await manager.getSnapshot()).toEqual(before);
    expect((await manager.createGoal({ objective: 'next work' })).ok).toBe(true);
  });

  it('refuses to pause a budget-limited goal so a new goal can still replace it', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'bounded work', tokenBudget: 5 });
    await manager.recordTurnUsage({ tokensUsed: 5 });

    const paused = await manager.updateGoal({ status: 'paused' });

    expect(paused.ok).toBe(false);
    expect(paused.message).toContain('Raise the budget, then resume the goal.');
    expect(paused.message).not.toContain('Resume the goal first.');
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('budgetLimited');
    expect((await manager.createGoal({ objective: 'next work' })).ok).toBe(true);
  });

  it('refuses to mark a stopped goal budget-limited without exhausting it', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'parked work' });
    await manager.updateGoal({ status: 'paused' });

    expect((await manager.updateGoal({ status: 'budgetLimited' })).ok).toBe(false);
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused');
  });

  it('keeps legitimate flows: reopen a completed goal, resume a raised budget, complete a parked goal', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'iterative work', tokenBudget: 5 });
    await manager.updateGoal({ status: 'complete' });
    expect((await manager.updateGoal({ status: 'active' })).goal?.status).toBe('active');

    await manager.recordTurnUsage({ tokensUsed: 5 });
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('budgetLimited');
    expect((await manager.updateGoal({ status: 'active', tokenBudget: 50 })).goal?.status).toBe('active');

    await manager.updateGoal({ status: 'waiting', stopReason: 'CI', resumeWhen: 'CI passes' });
    expect((await manager.updateGoal({ status: 'complete' })).goal?.status).toBe('complete');
  });

  it('still reports an already complete goal with the existing message', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'done' });
    await manager.updateGoal({ status: 'complete' });

    expect(await manager.updateGoal({ status: 'complete' })).toMatchObject({ ok: false, message: 'Goal is already complete.' });
  });

  it('loads persisted goals in every status without throwing', async () => {
    for (const status of GOAL_STATUSES) {
      const manager = new GoalManager(workspaceRoot, { sessionId: `s-${status}` });
      await manager.createGoal({ objective: `goal ${status}` });
    }
    const file = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    const raw = await fs.readJson(file) as { goals: Record<string, { status: GoalStatus; stopReason?: string; resumeWhen?: string }> };
    for (const status of GOAL_STATUSES) {
      const goal = raw.goals[`s-${status}`];
      goal.status = status;
      if (status === 'blocked' || status === 'waiting') Object.assign(goal, { stopReason: 'r', resumeWhen: 'w' });
    }
    await fs.writeJson(file, raw);

    const snapshot = await new GoalManager(workspaceRoot).getSnapshot();
    expect(Object.values(snapshot.goals).map((goal) => goal.status).sort()).toEqual([...GOAL_STATUSES].sort());
  });
});
