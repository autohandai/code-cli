/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import type { AgentRuntime } from '../../src/types.js';

describe('goal tools', () => {
  let workspaceRoot: string;
  let executor: ActionExecutor;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-tools-'));
    executor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: {
          configPath: path.join(workspaceRoot, 'config.json'),
          features: { slashGoal: true },
        },
        options: {},
      } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: (relativePath: string) => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  it('creates and reads goals through agent tools', async () => {
    const created = await executor.execute({
      type: 'create_goal',
      objective: 'finish tool wiring',
      token_budget: 1000,
    });

    expect(created).toContain('Goal created');

    const snapshot = await executor.execute({ type: 'get_goal' });
    expect(snapshot).toContain('finish tool wiring');
    expect(snapshot).toContain('tokenBudget');
  });

  it('queues and starts goals through agent tools', async () => {
    await executor.execute({ type: 'enqueue_goal', objective: 'queued via tool' });

    const started = await executor.execute({ type: 'start_queued_goal' });

    expect(started).toContain('Started queued goal');
    expect(started).toContain('queued via tool');
  });

  it('blocks goal tools when slash_goal is disabled', async () => {
    const disabledExecutor = new ActionExecutor({
      runtime: {
        workspaceRoot,
        config: {
          configPath: path.join(workspaceRoot, 'config.json'),
        },
        options: {},
      } as AgentRuntime,
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: (relativePath: string) => path.resolve(workspaceRoot, relativePath),
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
    });

    const result = await disabledExecutor.execute({
      type: 'create_goal',
      objective: 'should stay disabled',
    });

    expect(result).toContain('slash_goal');
  });
});
