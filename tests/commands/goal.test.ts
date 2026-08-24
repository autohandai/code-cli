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
    expect((await new GoalManager(workspaceRoot).getSnapshot()).activeSessionId)
      .toBe('session-current');
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
    const snapshot = await new GoalManager(workspaceRoot).getSnapshot();
    expect(snapshot.goal?.objective).toBe('ship the auth fix');
    expect(snapshot.queue.map((entry) => entry.objective))
      .toEqual(['then update the changelog']);
    // Queueing must not re-nudge the goal that is already running.
    expect(queued).toEqual([]);
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

    const snapshot = await new GoalManager(workspaceRoot).getSnapshot();
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

  it('attaches a prior-session active goal only after explicit resume', async () => {
    await new GoalManager(workspaceRoot, { sessionId: 'session-prior' })
      .createGoal({ objective: 'continue deliberately' });

    const result = await goal(ctx, ['resume']);

    expect(result).toContain('Goal: continue deliberately');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toContain('Active goal: continue deliberately');
    expect((await new GoalManager(workspaceRoot).getSnapshot()).activeSessionId)
      .toBe('session-current');
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
