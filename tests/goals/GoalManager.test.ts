/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';

const execFileAsync = promisify(execFile);

describe('GoalManager', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goals-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('persists active goals under the project .autohand directory', async () => {
    const manager = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const created = await manager.createGoal({ objective: 'ship durable goals' });

    expect(created.ok).toBe(true);
    expect(created.goal?.objective).toBe('ship durable goals');

    const reloaded = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const snapshot = await reloaded.getSnapshot();

    expect(snapshot.goals['session-current']?.goalId).toBe(created.goal?.goalId);
    expect(snapshot.goals['session-current']?.status).toBe('active');
    expect(await fs.pathExists(path.join(workspaceRoot, '.autohand', 'goals.local.json'))).toBe(true);
  });

  it('preserves both goals when separate sessions create them simultaneously', async () => {
    const first = new GoalManager(workspaceRoot, { sessionId: 'session-first' });
    const second = new GoalManager(workspaceRoot, { sessionId: 'session-second' });

    const results = await Promise.all([
      first.createGoal({ objective: 'first concurrent goal' }),
      second.createGoal({ objective: 'second concurrent goal' }),
    ]);

    expect(results.map((result) => result.ok)).toEqual([true, true]);
    const reloaded = await new GoalManager(workspaceRoot).getSnapshot();
    expect(Object.values(reloaded.goals).map((goal) => goal.objective).sort()).toEqual([
      'first concurrent goal',
      'second concurrent goal',
    ]);
  });

  it('creates one goal and queues the other when the same session starts both simultaneously', async () => {
    const manager = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const results = await Promise.all([
      manager.createOrQueueGoal({ objective: 'first goal', source: 'tool' }),
      manager.createOrQueueGoal({ objective: 'second goal', source: 'rpc' }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const snapshot = await manager.getSessionSnapshot();
    expect([snapshot.goal?.objective, ...snapshot.queue.map((item) => item.objective)].sort())
      .toEqual(['first goal', 'second goal']);
  });

  it('preserves every usage increment when turns are recorded simultaneously', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'count every turn' });

    await Promise.all([11, 23, 37].map((tokensUsed) => manager.recordTurnUsage({ tokensUsed })));

    expect((await manager.getSessionSnapshot()).goal?.tokensUsed).toBe(71);
  });

  it('preserves queue entries written by separate CLI processes', async () => {
    const moduleUrl = new URL('../../src/goals/GoalManager.ts', import.meta.url).href;
    const script = [
      `import { GoalManager } from ${JSON.stringify(moduleUrl)};`,
      'const manager = new GoalManager(process.argv[1], { sessionId: process.argv[2] });',
      'for (let i = 0; i < 4; i++) {',
      '  const result = await manager.enqueueGoal({ objective: process.argv[2] + "-" + i, source: "cli" });',
      '  if (!result.ok) throw new Error(result.message);',
      '}',
    ].join('\n');
    await Promise.all(['first', 'second'].map((sessionId) => execFileAsync(process.execPath, [
      '--import', 'tsx', '--input-type=module', '--eval', script, workspaceRoot, sessionId,
    ], { timeout: 15_000 })));

    const snapshot = await new GoalManager(workspaceRoot).getSessionSnapshot();
    expect(snapshot.queue.map((item) => item.objective).sort()).toEqual([
      'first-0', 'first-1', 'first-2', 'first-3',
      'second-0', 'second-1', 'second-2', 'second-3',
    ]);
  });

  it('migrates a v1 active goal into its owning session', async () => {
    const statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    await fs.outputJson(statePath, {
      version: 1,
      goal: {
        goalId: 'legacy-goal',
        objective: 'finish legacy work',
        status: 'active',
        tokensUsed: 12,
        timeUsedSeconds: 4,
        createdAt: 100,
        updatedAt: 200,
      },
      queue: [],
      completed: [],
      updatedAt: 200,
      activeSessionId: 'session-prior',
    });

    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-prior',
    }).getSessionSnapshot();

    expect(snapshot).toMatchObject({
      version: 2,
      sessionAttachment: 'attached',
      goal: {
        goalId: 'legacy-goal',
        objective: 'finish legacy work',
        tokensUsed: 12,
      },
    });
  });

  it('acknowledges an unscoped legacy goal without exposing its objective to a fresh session', async () => {
    const statePath = path.join(workspaceRoot, '.autohand', 'goals.local.json');
    await fs.outputJson(statePath, {
      version: 1,
      goal: {
        goalId: 'legacy-unscoped-goal',
        objective: 'private prior-session objective',
        status: 'active',
        tokensUsed: 12,
        timeUsedSeconds: 4,
        createdAt: 100,
        updatedAt: 200,
      },
      queue: [],
      completed: [],
      updatedAt: 200,
    });

    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();

    expect(snapshot).toMatchObject({
      goal: null,
      peers: [],
      sessionAttachment: 'none',
    });
    expect(snapshot.message).toContain('not attached to the current session');
    expect(JSON.stringify(snapshot)).not.toContain('private prior-session objective');
  });

  it('keeps a prior-session goal isolated until the current session creates its own', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'finish the prior report' });
    const before = await priorSession.getSnapshot();

    const currentSession = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const detached = await currentSession.getSessionSnapshot();

    expect(detached).toMatchObject({
      goal: null,
      queue: [],
      completed: [],
      sessionAttachment: 'none',
    });
    expect(detached.peers).toHaveLength(1);
    expect(detached.peers[0]).toMatchObject({
      sessionId: 'session-prior',
      objective: 'finish the prior report',
      status: 'active',
    });
    expect(detached.message).toContain('Other sessions are running goals');

    await currentSession.recordTurnUsage({ tokensUsed: 500 });
    expect(await priorSession.getSnapshot()).toEqual(before);

    const created = await currentSession.createGoal({ objective: 'my own goal' });
    expect(created.ok).toBe(true);
    expect((await currentSession.getSessionSnapshot()).goal?.objective).toBe('my own goal');
    expect((await priorSession.getSessionSnapshot()).goal?.objective).toBe('finish the prior report');
  });

  it('queues multi-item goal blocks in FIFO order', async () => {
    const manager = new GoalManager(workspaceRoot);
    const result = await manager.enqueueGoalBlock('[1] first goal\n[2] second goal', 'command');

    expect(result.ok).toBe(true);
    expect(result.queued).toHaveLength(2);

    const snapshot = await manager.getSnapshot();
    expect(snapshot.queue.map((item) => item.objective)).toEqual(['first goal', 'second goal']);
  });

  it('edits a queued objective in place without changing queue order', async () => {
    const manager = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const first = await manager.enqueueGoal({ objective: 'first goal', source: 'command' });
    await manager.enqueueGoal({ objective: 'second goal', source: 'command' });
    const queueId = first.queued?.[0]?.queueId;

    expect(queueId).toBeDefined();
    const edited = await manager.editGoalObjective(queueId!, 'first goal after review');

    expect(edited.ok).toBe(true);
    expect(edited.message).toBe('Queued goal updated.');
    expect(edited.queue.map((item) => item.objective)).toEqual([
      'first goal after review',
      'second goal',
    ]);
  });

  it('rejects editing another session\'s active goal', async () => {
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    const created = await priorSession.createGoal({ objective: 'prior session goal' });
    const currentSession = new GoalManager(workspaceRoot, { sessionId: 'session-current' });

    const edited = await currentSession.editGoalObjective(
      created.goal!.goalId,
      'silently changed from another terminal',
    );

    expect(edited.ok).toBe(false);
    expect(edited.message).toContain('current session or queue');
    expect((await priorSession.getSessionSnapshot()).goal?.objective).toBe('prior session goal');
  });

  it('publishes the current session snapshot after goal mutations', async () => {
    const manager = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const snapshots: string[][] = [];
    const unsubscribe = manager.subscribe((snapshot) => {
      snapshots.push([
        snapshot.goal?.objective ?? '',
        ...snapshot.queue.map((item) => item.objective),
      ]);
    });

    await manager.createGoal({ objective: 'active goal' });
    await manager.enqueueGoal({ objective: 'queued goal', source: 'command' });

    await vi.waitFor(() => {
      expect(snapshots).toContainEqual(['active goal', 'queued goal']);
    });
    unsubscribe();
  });

  it('reports a lazily resolved session as attached', async () => {
    const session = { id: undefined as string | undefined };
    const manager = new GoalManager(workspaceRoot, {
      getSessionId: () => session.id,
    });
    session.id = 'session-current';

    await manager.createGoal({ objective: 'goal observed after session startup' });

    expect(await manager.getSessionSnapshot()).toMatchObject({
      sessionAttachment: 'attached',
      goal: { objective: 'goal observed after session startup' },
    });
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

  it.each(['paused', 'complete'] as const)('counts ten active seconds once when a goal becomes %s', async (status) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'measure active time' });

    clock.mockReturnValue(1_010_000);
    const updated = await manager.updateGoal({ status });

    expect(updated.goal?.timeUsedSeconds).toBe(10);
  });

  it('preserves elapsed time when editing the active objective', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const manager = new GoalManager(workspaceRoot);
    const created = await manager.createGoal({ objective: 'original objective' });
    if (!created.goal) throw new Error('Expected a created goal');

    clock.mockReturnValue(1_010_000);
    await manager.editGoalObjective(created.goal.goalId, 'refined objective');
    clock.mockReturnValue(1_015_000);

    expect((await manager.getSessionSnapshot()).goal?.timeUsedSeconds).toBe(15);
  });

  it('does not discard fractional seconds between frequent usage updates', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'measure short turns' });

    for (const now of [1_000_400, 1_000_800, 1_001_200]) {
      clock.mockReturnValue(now);
      await manager.recordTurnUsage({ tokensUsed: 1 });
    }

    expect((await manager.getSessionSnapshot()).goal?.timeUsedSeconds).toBeCloseTo(1.2);
  });

  it('does not charge a goal created after a turn started without one', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'newly created goal' });

    await manager.recordTurnUsage({ goalId: null, tokensUsed: 123 });

    expect((await manager.getSessionSnapshot()).goal?.tokensUsed).toBe(0);
  });

  it.each(['paused', 'complete'] as const)('records the final usage without reactivating a %s goal', async (status) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const manager = new GoalManager(workspaceRoot, { sessionId: 'owner' });
    const created = await manager.createGoal({ objective: 'finish owned work' });
    if (!created.goal) throw new Error('Expected a created goal');
    clock.mockReturnValue(1_010_000);
    await manager.updateGoal({ status });
    clock.mockReturnValue(1_020_000);

    await manager.recordTurnUsage({ goalId: created.goal.goalId, tokensUsed: 123 });

    const snapshot = await manager.getSessionSnapshot();
    expect(snapshot.goal).toMatchObject({ status, tokensUsed: 123, timeUsedSeconds: 10 });
    if (status === 'complete') expect(snapshot.completed[0]?.tokensUsed).toBe(123);
  });

  it('cannot charge another session completed goal by supplying its ID', async () => {
    const owner = new GoalManager(workspaceRoot, { sessionId: 'owner' });
    const created = await owner.createGoal({ objective: 'owned goal' });
    if (!created.goal) throw new Error('Expected a created goal');
    await owner.updateGoal({ status: 'complete' });

    await new GoalManager(workspaceRoot, { sessionId: 'other' })
      .recordTurnUsage({ goalId: created.goal.goalId, tokensUsed: 123 });

    expect((await owner.getSessionSnapshot()).completed[0]?.tokensUsed).toBe(0);
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

  it('automatically starts the next queued goal when the active goal completes', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'first goal' });
    await manager.enqueueGoal({ objective: 'second goal', source: 'tool' });
    await manager.enqueueGoal({ objective: 'third goal', source: 'tool' });

    const completed = await manager.updateGoal({ status: 'complete' });

    expect(completed.ok).toBe(true);
    expect(completed.message).toContain('Goal completed. Started next queued goal.');
    expect(completed.completed?.objective).toBe('first goal');
    expect(completed.started?.objective).toBe('second goal');
    expect(completed.goal?.objective).toBe('second goal');
    expect(completed.goal?.status).toBe('active');
    expect(completed.queue.map((item) => item.objective)).toEqual(['third goal']);
  });

  it('keeps a completed-goal summary for the current session', async () => {
    const manager = new GoalManager(workspaceRoot);
    await manager.createGoal({ objective: 'first goal' });
    await manager.enqueueGoal({ objective: 'second goal', source: 'tool' });

    await manager.updateGoal({ status: 'complete' });
    const final = await manager.updateGoal({ status: 'complete' });

    expect(final.ok).toBe(true);
    expect(final.completedRun?.map((item) => item.objective)).toEqual(['first goal', 'second goal']);
    expect(final.message).toContain('All queued goals are complete.');

    const snapshot = await manager.getSnapshot();
    const formatted = manager.formatSnapshot(snapshot);
    expect(formatted).toContain('Completed goals this session (2):');
    expect(formatted).toContain('first goal');
    expect(formatted).toContain('second goal');
  });

  it('runs goals concurrently across sessions without abandoning or queueing behind peers', async () => {
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'stale prior goal' });
    await priorSession.enqueueGoal({ objective: 'queued behind stale goal', source: 'tool' });

    const currentSession = new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
      isSessionAlive: async (sessionId) => sessionId !== 'session-prior',
    });

    const created = await currentSession.createOrQueueGoal({ objective: 'fresh goal', source: 'tool' });

    expect(created.ok).toBe(true);
    expect(created.message).toContain('Goal created');
    expect(created.goal?.objective).toBe('fresh goal');
    expect(created.goal?.status).toBe('active');
    expect(created.abandoned).toBeUndefined();
    // The workspace queue is shared; the prior session's queued item stays put.
    expect(created.queue.map((item) => item.objective)).toEqual(['queued behind stale goal']);

    const snapshot = await currentSession.getSnapshot();
    expect(snapshot.goals['session-current']?.objective).toBe('fresh goal');
    expect(snapshot.goals['session-prior']?.objective).toBe('stale prior goal');
    expect(snapshot.completed).toEqual([]);
  });

  it('surfaces other sessions as peers with liveness instead of queueing behind them', async () => {
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'live prior goal' });

    const currentSession = new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
      isSessionAlive: async () => true,
    });

    const created = await currentSession.createOrQueueGoal({ objective: 'queued goal', source: 'tool' });

    expect(created.ok).toBe(true);
    expect(created.message).toContain('Goal created');
    expect(created.goal?.objective).toBe('queued goal');
    expect(created.queue).toEqual([]);
    expect(created.abandoned).toBeUndefined();

    const sessionSnapshot = await currentSession.getSessionSnapshot();
    expect(sessionSnapshot.peers).toHaveLength(1);
    expect(sessionSnapshot.peers[0]).toMatchObject({
      sessionId: 'session-prior',
      objective: 'live prior goal',
      ownerAlive: true,
    });
  });

  it('never abandons a goal owned by the current session', async () => {
    const manager = new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
      isSessionAlive: async () => false,
    });
    await manager.createGoal({ objective: 'my own goal' });

    const created = await manager.createOrQueueGoal({ objective: 'second goal', source: 'tool' });

    expect(created.ok).toBe(true);
    expect(created.message).toContain('Queued goal.');
    expect(created.goal?.objective).toBe('my own goal');
    expect(created.abandoned).toBeUndefined();
  });

  it('starts a queued goal for the current session without touching peer goals', async () => {
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'stale active goal' });
    await priorSession.enqueueGoal({ objective: 'next queued goal', source: 'tool' });

    const currentSession = new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
      isSessionAlive: async (sessionId) => sessionId !== 'session-prior',
    });

    const started = await currentSession.startQueuedGoal();

    expect(started.ok).toBe(true);
    expect(started.goal?.objective).toBe('next queued goal');
    expect(started.goal?.status).toBe('active');
    expect(started.abandoned).toBeUndefined();
    expect((await currentSession.getSnapshot()).queue).toEqual([]);
    expect((await priorSession.getSessionSnapshot()).goal?.objective).toBe('stale active goal');
  });

  it('reports owner liveness for peer goals on session snapshots', async () => {
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'stale goal' });

    const currentSession = new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
      isSessionAlive: async () => false,
    });

    const snapshot = await currentSession.getSessionSnapshot();

    expect(snapshot.sessionAttachment).toBe('none');
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0]).toMatchObject({
      sessionId: 'session-prior',
      objective: 'stale goal',
      ownerAlive: false,
    });
    expect(snapshot.message).toContain('Other sessions are running goals');
  });
});
