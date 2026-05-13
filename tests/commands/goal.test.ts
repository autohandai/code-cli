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

describe('/goal command', () => {
  let workspaceRoot: string;
  let queued: string[];
  let ctx: SlashCommandContext;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-command-'));
    queued = [];
    ctx = {
      workspaceRoot,
      config: {
        configPath: path.join(workspaceRoot, 'config.json'),
        features: { slashGoal: true },
      },
      queueInstruction: (instruction) => queued.push(instruction),
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
  });

  it('creates a goal and queues continuation guidance', async () => {
    const result = await goal(ctx, ['finish release prep']);

    expect(result).toContain('Goal created');
    expect(result).toContain('finish release prep');
    expect(queued[0]).toContain('Active goal');
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
