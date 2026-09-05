/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { Session } from 'tuistory';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { runGoalAccountingScenario } from '../../src/testing/scenarios/goalAccountingScenario.js';
import {
  createMockOpenRouterSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
} from './helpers/autohandTuistory.js';

describe('built CLI goal reliability', () => {
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
