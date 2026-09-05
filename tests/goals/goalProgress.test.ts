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

describe('goal stop states and checkpoints', () => {
  let workspaceRoot: string;
  let manager: GoalManager;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-progress-'));
    manager = new GoalManager(workspaceRoot, { sessionId: 'owner' });
    await manager.createGoal({ objective: 'resume reliable work' });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it.each(['blocked', 'waiting'] as const)('persists %s and resumes deliberately without losing the checkpoint', async (status) => {
    const checkpoint = { summary: 'Parser implemented', nextStep: 'Run integration test', artifacts: ['artifacts/test.log'] };
    const stopped = await manager.updateGoal({ status, stopReason: 'Need test credentials', resumeWhen: 'Credentials are available', checkpoint });
    expect(stopped.ok).toBe(true);
    const reloaded = new GoalManager(workspaceRoot, { sessionId: 'owner' });
    expect(await reloaded.getActiveGoalForSession()).toBeNull();
    expect((await reloaded.getSessionSnapshot()).goal).toMatchObject({ status, stopReason: 'Need test credentials', checkpoint });
    const peer = new GoalManager(workspaceRoot, { sessionId: 'peer', isSessionAlive: async () => false });
    expect((await peer.getSessionSnapshot()).peers).toContainEqual(expect.objectContaining({ sessionId: 'owner', status }));

    const resumed = await reloaded.updateGoal({ status: 'active' });

    expect(resumed.ok).toBe(true);
    expect(resumed.goal?.stopReason).toBeUndefined();
    expect(resumed.goal?.resumeWhen).toBeUndefined();
    expect(resumed.goal?.checkpoint).toMatchObject(checkpoint);
    expect(await reloaded.getActiveGoalForSession()).not.toBeNull();
  });

  it.each([
    { status: 'blocked' as const },
    { status: 'waiting' as const, stopReason: 'Need credentials' },
    { status: 'blocked' as const, stopReason: ' ', resumeWhen: 'Approved' },
    { checkpoint: { summary: ' ' } },
    { checkpoint: { summary: 'Saved', artifacts: [''] } },
    { checkpoint: { summary: 'Saved', artifacts: Array.from({ length: 21 }, () => 'artifact.log') } },
    { checkpoint: { summary: 'Saved', nextStep: ' ' } },
    { checkpoint: { summary: 'x'.repeat(4001) } },
    { stopReason: 'Cannot attach a stop reason to active work' },
  ])('rejects invalid progress updates without changing state: %j', async (input) => {
    const before = await fs.readFile(path.join(workspaceRoot, '.autohand', 'goals.local.json'), 'utf8');
    expect((await manager.updateGoal(input)).ok).toBe(false);
    expect(await fs.readFile(path.join(workspaceRoot, '.autohand', 'goals.local.json'), 'utf8')).toBe(before);
  });

  it('saves a checkpoint without pausing and stops accruing elapsed time while waiting', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    expect((await manager.updateGoal({ checkpoint: { summary: 'Saved work' } })).ok).toBe(true);
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
    const stopped = await manager.updateGoal({ status: 'waiting', stopReason: 'CI is running', resumeWhen: 'CI finishes' });
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_050_000);
    expect((await manager.getSessionSnapshot()).goal?.timeUsedSeconds).toBe(stopped.goal?.timeUsedSeconds);
    await manager.recordTurnUsage({ goalId: stopped.goal?.goalId, tokensUsed: 12 });
    expect((await manager.getSessionSnapshot()).goal).toMatchObject({ status: 'waiting', tokensUsed: 12, checkpoint: { summary: 'Saved work' } });
  });

  it('rejects null stop metadata from untyped callers instead of retaining the old reason', async () => {
    await manager.updateGoal({ status: 'blocked', stopReason: 'Approval required', resumeWhen: 'Approved' });
    const input = JSON.parse('{"stopReason":null}');
    expect((await manager.updateGoal(input)).ok).toBe(false);
  });

  it('refuses malformed persisted checkpoints without discarding them', async () => {
    const statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    const snapshot = await manager.getSnapshot();
    await fs.writeJson(statePath, { ...snapshot, goals: { owner: { ...snapshot.goals.owner, checkpoint: { summary: 'valuable progress', recordedAt: -1 } } } });
    await expect(manager.getSessionSnapshot()).rejects.toThrow('Goal storage');
    await expect(manager.updateGoal({ status: 'paused' })).rejects.toThrow('Goal storage');
  });
});
