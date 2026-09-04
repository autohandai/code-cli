/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goal, metadata } from '../../src/commands/goal.js';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { ActiveAgentRegistry } from '../../src/session/ActiveAgentRegistry.js';
import type { HookEvent } from '../../src/types.js';

describe('/goal command', () => {
  let workspaceRoot: string;
  let queued: string[];
  let hookEvents: Array<{ event: HookEvent; context: Record<string, unknown> }>;
  let ctx: SlashCommandContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-command-'));
    queued = [];
    hookEvents = [];
    ctx = {
      workspaceRoot,
      config: {
        configPath: path.join(workspaceRoot, 'config.json'),
        features: { slashGoal: true },
      },
      sessionManager: {
        getCurrentSession: () => ({ metadata: { sessionId: 'session-current' } }),
      },
      queueInstruction: (instruction) => queued.push(instruction),
      setInteractionMode: vi.fn(),
      hookManager: {
        executeHooks: vi.fn(async (event: HookEvent, context: Record<string, unknown>) => {
          hookEvents.push({ event, context });
          return [];
        }),
      } as unknown as SlashCommandContext['hookManager'],
    } as SlashCommandContext;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('registers slash metadata', () => {
    expect(metadata.command).toBe('/goal');
    expect(metadata.implemented).toBe(true);
    expect(metadata.subcommands?.map((item) => item.name)).toContain('queue');
    expect(metadata.subcommands?.map((item) => item.name)).toContain('writer');
    expect(metadata.subcommands?.map((item) => item.name)).toContain('view');
    expect(metadata.subcommands?.map((item) => item.name)).toContain('edit');
  });

  it('opens the live goals view without creating another goal', async () => {
    const onToggleGoalView = vi.fn();
    ctx.onToggleGoalView = onToggleGoalView;
    await goal(ctx, ['first goal']);

    const result = await goal(ctx, ['view']);

    expect(result).toContain('Opened the live goals view');
    expect(onToggleGoalView).toHaveBeenCalledWith(true);
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.queue).toEqual([]);
  });

  it('edits a queued goal by ID without changing its queue position', async () => {
    await goal(ctx, ['first goal']);
    await goal(ctx, ['queue', 'second goal']);
    const manager = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    const before = await manager.getSessionSnapshot();
    const queuedGoal = before.queue[0];
    if (!queuedGoal) {
      throw new Error('expected a queued goal');
    }

    const result = await goal(ctx, ['edit', queuedGoal.queueId, 'second goal after review']);

    expect(result).toContain('Queued goal updated.');
    expect((await manager.getSessionSnapshot()).queue).toMatchObject([
      { queueId: queuedGoal.queueId, objective: 'second goal after review' },
    ]);
  });

  it('starts the writer when /goal has no active goal or arguments', async () => {
    const result = await goal(ctx, []);

    expect(result).toContain('Goal writer started');
    expect(result).toContain('create a completion contract');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('Activate the built-in goal-writer skill');
    expect(queued[0]).toContain('Rough goal request:');
    expect(hookEvents).toEqual([]);
  });

  it('starts the writer with /goal writer and rough text', async () => {
    const result = await goal(ctx, ['writer', 'fix flaky auth tests']);

    expect(result).toContain('Goal writer started');
    expect(queued[0]).toContain('fix flaky auth tests');
  });

  it('creates a goal, queues continuation guidance, and emits completed hook', async () => {
    const result = await goal(ctx, ['finish release prep']);

    expect(result).toContain('Goal created');
    expect(result).toContain('finish release prep');
    expect(queued[0]).toContain('Active goal');
    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe('finish release prep');
    expect(snapshot.sessionAttachment).toBe('attached');
    expect(hookEvents).toEqual([
      {
        event: 'goal-written:completed',
        context: expect.objectContaining({
          goalObjective: 'finish release prep',
          goalSource: 'slash',
        }),
      },
    ]);
  });

  it('stays behind slash_goal when the feature is disabled', async () => {
    const disabledCtx = {
      ...ctx,
      config: {
        configPath: path.join(workspaceRoot, 'config.json'),
      },
      isFeatureEnabled: () => false,
    } as SlashCommandContext;

    const result = await goal(disabledCtx, ['finish release prep']);

    expect(result).toContain('slash_goal');
    expect(queued).toEqual([]);
  });

  it('queues a second objective instead of refusing while a goal is active', async () => {
    await goal(ctx, ['ship', 'the', 'auth', 'fix']);
    queued.length = 0;

    const message = await goal(ctx, ['then', 'update', 'the', 'changelog']);

    expect(message).not.toContain('A goal already exists');
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe('ship the auth fix');
    expect(snapshot.queue.map((entry) => entry.objective))
      .toEqual(['then update the changelog']);
    // Queueing must not re-nudge the goal that is already running.
    expect(queued).toEqual([]);
  });

  it('creates a concurrent goal instead of abandoning a dead-owner peer goal', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'session-prior' })
      .createGoal({ objective: 'stale prior goal' });
    queued.length = 0;

    const message = await goal(ctx, ['fresh', 'objective']);

    expect(message).toContain('Goal created');
    expect(message).toContain('fresh objective');
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe('fresh objective');
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0]).toMatchObject({
      sessionId: 'session-prior',
      objective: 'stale prior goal',
    });
    expect(queued[0]).toContain('Active goal: fresh objective');
    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');
  });

  it('starts a stranded queued goal from bare /goal without dumping its full objective', async () => {
    const longObjective = [
      'fix the failing Windows installer test and commit the repair',
      'Process completed with exit code 1.',
      'tests/windowsInstaller.spec.ts:208 AssertionError',
      'FULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER',
    ].join('\n');
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'offline peer goal' });
    await priorSession.enqueueGoal({ objective: longObjective, source: 'command' });

    const result = await goal(ctx, []);

    expect(result).toContain('Started queued goal.');
    expect(result).toContain('fix the failing Windows installer test');
    expect(result).not.toContain('FULL_FAILURE_TRANSCRIPT_MUST_NOT_RENDER');
    expect(queued).toEqual([
      expect.stringContaining('Active goal: fix the failing Windows installer test'),
    ]);
    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');

    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe(longObjective);
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.peers).toHaveLength(1);
  });

  it('leaves queued work untouched when another live session owns a goal', async () => {
    const timestamp = new Date().toISOString();
    vi.spyOn(ActiveAgentRegistry.prototype, 'listActive').mockResolvedValue([{
      version: 1,
      pid: process.pid,
      sessionId: 'session-prior',
      workspaceRoot,
      projectName: 'goal-command-test',
      provider: 'openrouter',
      model: 'test-model',
      mode: 'interactive',
      status: 'working',
      startedAt: timestamp,
      updatedAt: timestamp,
      messageCount: 0,
      contextPercent: 0,
      tokensUsed: 0,
    }]);
    const priorSession = new GoalManager(workspaceRoot, { sessionId: 'session-prior' });
    await priorSession.createGoal({ objective: 'live peer goal' });
    await priorSession.enqueueGoal({ objective: 'queued work', source: 'command' });

    const result = await goal(ctx, []);

    expect(result).toContain('Other active sessions (1)');
    expect(result).toContain('Queued goals (1)');
    expect(result).not.toContain('Started queued goal.');
    expect(queued).toEqual([]);
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal).toBeNull();
    expect(snapshot.queue).toHaveLength(1);
  });

  it('keeps active, queued, completed, and peer objectives bounded in status output', async () => {
    const objective = (label: string, tail: string): string => (
      `${label} ${'detailed failure context '.repeat(12)}${tail}`
    );
    const activeObjective = objective('active objective', 'ACTIVE_TRANSCRIPT_TAIL');
    const queuedObjective = objective('queued objective', 'QUEUED_TRANSCRIPT_TAIL');
    const completedObjective = objective('completed objective', 'COMPLETED_TRANSCRIPT_TAIL');
    const peerObjective = objective('offline peer objective', 'PEER_TRANSCRIPT_TAIL');

    const completedSession = new GoalManager(workspaceRoot, { sessionId: 'session-completed' });
    await completedSession.createGoal({ objective: completedObjective });
    await completedSession.updateGoal({ status: 'complete' });
    await new GoalManager(workspaceRoot, { sessionId: 'session-prior' })
      .createGoal({ objective: peerObjective });
    const currentSession = new GoalManager(workspaceRoot, { sessionId: 'session-current' });
    await currentSession.createGoal({ objective: activeObjective });

    const queuedResult = await goal(ctx, ['queue', queuedObjective]);
    const statusResult = await goal(ctx, []);

    expect(queuedResult).toContain('queued objective');
    expect(queuedResult).not.toContain('QUEUED_TRANSCRIPT_TAIL');
    expect(statusResult).toContain('active objective');
    expect(statusResult).toContain('queued objective');
    expect(statusResult).toContain('completed objective');
    expect(statusResult).toContain('offline peer objective');
    expect(statusResult).not.toMatch(/(?:ACTIVE|QUEUED|COMPLETED|PEER)_TRANSCRIPT_TAIL/u);

    const snapshot = await currentSession.getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe(activeObjective);
    expect(snapshot.queue[0]?.objective).toBe(queuedObjective);
    expect(snapshot.completed[0]?.objective).toBe(completedObjective);
    expect(snapshot.peers[0]?.objective).toBe(peerObjective);
  });

  it('puts the session in auto mode when a goal starts', async () => {
    await goal(ctx, ['ship', 'the', 'auth', 'fix']);

    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');
  });

  it('leaves the interaction mode alone when goal auto mode is disabled', async () => {
    ctx.config.agent = { ...(ctx.config.agent ?? {}), goalAutoMode: false };

    await goal(ctx, ['ship', 'the', 'auth', 'fix']);

    expect(ctx.setInteractionMode).not.toHaveBeenCalled();
    // The goal still runs; only the mode switch is opted out of.
    expect(queued.join('\n')).toContain('ship the auth fix');
  });

  it('starts the queued objective automatically when the active goal completes', async () => {
    await goal(ctx, ['ship', 'the', 'auth', 'fix']);
    await goal(ctx, ['then', 'update', 'the', 'changelog']);
    queued.length = 0;

    await goal(ctx, ['complete']);

    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal?.objective).toBe('then update the changelog');
    expect(snapshot.goal?.status).toBe('active');
    expect(snapshot.queue).toHaveLength(0);
    // The agent must be told to carry on, not left idle at the prompt.
    expect(queued.join('\n')).toContain('then update the changelog');
  });

  it('lists an empty queue', async () => {
    const result = await goal(ctx, ['queue']);

    expect(result).toContain('No queued goals');
  });

  it('enqueues a goal without replacing the active goal', async () => {
    await goal(ctx, ['active goal']);

    const result = await goal(ctx, ['queue', 'next goal']);

    expect(result).toContain('Queued goal');
    expect(result).toContain('next goal');
  });

  it('completes the active goal, starts the next queued goal, and queues continuation guidance', async () => {
    await goal(ctx, ['first goal']);
    await goal(ctx, ['queue', 'second goal']);
    queued = [];

    const result = await goal(ctx, ['complete']);

    expect(result).toContain('Goal completed. Started next queued goal.');
    expect(result).toContain('Started queue item:');
    expect(result).toContain('Goal: second goal');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('Active goal: second goal');
    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');
  });

  it('switches to automode when resuming a paused goal', async () => {
    await goal(ctx, ['first goal']);
    await goal(ctx, ['pause']);
    (ctx.setInteractionMode as ReturnType<typeof vi.fn>).mockClear();

    const result = await goal(ctx, ['resume']);

    expect(result).toContain('Goal: first goal');
    expect(ctx.setInteractionMode).toHaveBeenCalledWith('automode');
  });

  it('does not resume a prior-session peer goal without an explicit goal of its own', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'session-prior' })
      .createGoal({ objective: 'continue deliberately' });

    const result = await goal(ctx, ['resume']);

    expect(result).toContain('No goal exists for this session to update');
    expect(queued).toHaveLength(0);
    const snapshot = await new GoalManager(workspaceRoot, {
      sessionId: 'session-current',
    }).getSessionSnapshot();
    expect(snapshot.goal).toBeNull();
    expect(snapshot.peers).toHaveLength(1);
    expect(snapshot.peers[0]).toMatchObject({
      sessionId: 'session-prior',
      objective: 'continue deliberately',
    });
  });

  it('does not change interaction mode when pausing, clearing, or drafting a goal', async () => {
    await goal(ctx, ['first goal']);
    (ctx.setInteractionMode as ReturnType<typeof vi.fn>).mockClear();

    await goal(ctx, ['pause']);
    await goal(ctx, ['clear']);
    await goal(ctx, ['writer', 'a rough idea']);

    expect(ctx.setInteractionMode).not.toHaveBeenCalled();
  });

  it('supports template invocation from bounded .pi-goals directories', async () => {
    await fs.outputFile(path.join(workspaceRoot, '.pi-goals', 'fix-issue.md'), [
      '---',
      'description: Fix an issue',
      'aliases: fix',
      '---',
      'Fix {{issue}}.',
      '',
      'Extra: {{args}}',
    ].join('\n'));

    const result = await goal(ctx, ['fix', '--issue', 'ISSUE-123', '--', 'add tests']);

    expect(result).toContain('Goal created');
    expect(result).toContain('Fix ISSUE-123');
    expect(result).toContain('add tests');
  });
});
