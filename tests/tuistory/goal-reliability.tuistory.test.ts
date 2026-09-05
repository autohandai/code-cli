/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { runGoalAccountingScenario } from '../../src/testing/scenarios/goalAccountingScenario.js';
import { runToolGoalContinuationScenario } from '../../src/testing/scenarios/goalsCommandScenario.js';
import {
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  waitForExit,
} from './helpers/autohandTuistory.js';

describe('built CLI goal reliability', () => {
  it('starts an approved CLI goal after exhaustion without clearing its predecessor', async () => {
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true } } });
    let session: Session | undefined;
    try {
      const manager = new GoalManager(state.workspaceRoot);
      await manager.createGoal({ objective: 'exhausted CLI objective', tokenBudget: 1 });
      await manager.recordTurnUsage({ tokensUsed: 1 });
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'fresh CLI objective',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);

      expect(session.readAll()).toContain('Goal created');
      const snapshot = await manager.getSessionSnapshot();
      expect(snapshot.goal).toMatchObject({ objective: 'fresh CLI objective', status: 'active' });
      expect(snapshot.completed[0]).toMatchObject({ objective: 'exhausted CLI objective', status: 'budgetLimited' });
    } finally {
      session?.close();
      await state.cleanup();
    }
  });

  it('accepts the enabled --goal flag and persists its objective', async () => {
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true } } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'approved CLI objective',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('Goal created.');
      expect((await new GoalManager(state.workspaceRoot).getSessionSnapshot()).goal?.objective)
        .toBe('approved CLI objective');
    } finally {
      session?.close();
      await state.cleanup();
    }
  });

  it('automatically continues a goal created by a tool in the default interaction mode', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'create_goal', args: { objective: 'finish the tool-created goal' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'TOOL_GOAL_FIRST_TURN' }),
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status: 'complete' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'TOOL_GOAL_CONTINUED' }),
    ]);
    const state = await createTempAutohandHome({ config: {
      features: { slashGoal: true },
      openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      });
      await runToolGoalContinuationScenario(session);
      await exitInteractive(session);
      const snapshot = await new GoalManager(state.workspaceRoot).getSnapshot();
      expect(Object.values(snapshot.goals)[0]).toMatchObject({ status: 'complete', tokensUsed: 108 });
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally {
      session?.close();
      await server.close();
      await state.cleanup();
    }
  });

  it('keeps the finishing turn usage on the completed goal when the queue advances', async () => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [], finalResponse: 'ACCOUNTING_FIRST_TURN' }),
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status: 'complete' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'ACCOUNTING_COMPLETION_TURN' }),
    ]);
    const state = await createTempAutohandHome({ config: {
      features: { slashGoal: true },
      openrouter: { baseUrl: server.baseUrl },
      agent: { goalAutoMode: false, autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      });
      await runGoalAccountingScenario(session);
      await exitInteractive(session);
      const snapshot = await new GoalManager(state.workspaceRoot).getSnapshot();
      expect(snapshot.completed[0]).toMatchObject({ objective: 'first accounting goal', tokensUsed: 162 });
      expect(Object.values(snapshot.goals)).toEqual([
        expect.objectContaining({ objective: 'second accounting goal', tokensUsed: 0 }),
      ]);
      expect(session.exitInfo?.exitCode).toBe(0);
    } finally {
      session?.close();
      await server.close();
      await state.cleanup();
    }
  }, 60_000);
});
