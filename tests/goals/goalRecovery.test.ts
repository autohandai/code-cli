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

describe('offline goal session recovery', () => {
  let workspaceRoot: string;
  let owner: GoalManager;

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-recovery-'));
    owner = new GoalManager(workspaceRoot, { sessionId: 'offline-owner' });
    await owner.createGoal({ objective: 'unfinished original goal' });
    await owner.updateGoal({ checkpoint: { summary: 'Saved progress' } });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('pauses an offline owner without transferring ownership, charging downtime, or starting the queue', async () => {
    const before = await owner.getSnapshot();
    await owner.enqueueGoal({ objective: 'pending goal', source: 'command' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    const recovering = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => false });

    expect((await recovering.prepareSessionRecovery('offline-owner')).ok).toBe(true);

    const snapshot = await recovering.getSnapshot();
    expect(snapshot.goals['offline-owner']).toMatchObject({
      goalId: before.goals['offline-owner'].goalId, status: 'paused',
      timeUsedSeconds: before.goals['offline-owner'].timeUsedSeconds, checkpoint: { summary: 'Saved progress' },
    });
    expect(snapshot.goals['new-session']).toBeUndefined();
    expect(snapshot.queue).toHaveLength(1);
  });

  it('rechecks liveness after discovery and refuses a newly live owner', async () => {
    let alive = false;
    const recovering = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => alive });
    expect((await recovering.getSessionSnapshot()).peers[0].ownerAlive).toBe(false);
    alive = true;

    expect((await recovering.prepareSessionRecovery('offline-owner')).ok).toBe(false);
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('refuses recovery when liveness is uncertain or the current session is still working', async () => {
    const uncertain = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => { throw new Error('registry unavailable'); } });
    expect((await uncertain.prepareSessionRecovery('offline-owner')).ok).toBe(false);
    const busy = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => false });
    await busy.createGoal({ objective: 'current work' });
    expect((await busy.prepareSessionRecovery('offline-owner')).message).toContain('Pause');
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it.each(['missing', '__unscoped__', '../outside', '.', '..'])('refuses a nonrecoverable session reference: %s', async (sessionId) => {
    const recovering = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => false });
    expect((await recovering.prepareSessionRecovery(sessionId)).ok).toBe(false);
  });

  it.each(['paused', 'blocked', 'waiting'] as const)('rejects live or uncertain ownership for a saved %s goal without changing it', async status => {
    await owner.updateGoal({ status, ...(status === 'paused' ? {} : { stopReason: 'Waiting for the approved dependency', resumeWhen: 'Dependency is available' }) });
    await owner.enqueueGoal({ objective: 'Keep queued', source: 'command' });
    const filename = path.join(workspaceRoot, '.autohand/goals.local.json'); const before = await fs.readFile(filename, 'utf8');
    for (const isSessionAlive of [async () => true, async () => { throw new Error('Unknown owner'); }]) {
      const recovering = new GoalManager(workspaceRoot, { sessionId: 'offline-owner', isSessionAlive });
      expect((await recovering.restoreSessionCheckpoint()).ok).toBe(false);
      expect(await fs.readFile(filename, 'utf8')).toBe(before);
    }
    const offline = new GoalManager(workspaceRoot, { sessionId: 'offline-owner', isSessionAlive: async () => false });
    expect((await offline.restoreSessionCheckpoint()).ok).toBe(true);
    expect((await offline.getSessionSnapshot()).goal?.status).toBe(status);
    expect(await fs.readFile(filename, 'utf8')).toBe(before);
  });

  it.each(['complete', 'budgetLimited'] as const)('does not claim terminal %s history or require an owner probe', async status => {
    await owner.updateGoal({ status }); const alive = vi.fn(async () => true);
    const recovering = new GoalManager(workspaceRoot, { sessionId: 'offline-owner', isSessionAlive: alive });
    expect((await recovering.restoreSessionCheckpoint()).ok).toBe(true); expect(alive).not.toHaveBeenCalled();
  });

  it('retains a recovered blocked goal and its explanation', async () => {
    await owner.updateGoal({ status: 'blocked', stopReason: 'Need approval', resumeWhen: 'Approved' });
    const recovering = new GoalManager(workspaceRoot, { sessionId: 'new-session', isSessionAlive: async () => false });
    expect((await recovering.prepareSessionRecovery('offline-owner')).ok).toBe(true);
    expect((await owner.getSessionSnapshot()).goal).toMatchObject({ status: 'blocked', stopReason: 'Need approval' });
  });
});
