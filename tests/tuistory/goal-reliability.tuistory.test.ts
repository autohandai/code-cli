/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { Session } from 'tuistory';
import fs from 'fs-extra';
import path from 'node:path';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { SessionManager } from '../../src/session/SessionManager.js';
import { ActiveAgentRegistry } from '../../src/session/ActiveAgentRegistry.js';
import { runGoalAccountingScenario } from '../../src/testing/scenarios/goalAccountingScenario.js';
import { runToolGoalContinuationScenario } from '../../src/testing/scenarios/goalsCommandScenario.js';
import { inspectStoppedGoal, resumeStoppedGoal } from '../../src/testing/scenarios/goalProgressScenario.js';
import { cancelGoalRecovery, finishRecoveredGoal, openGoalRecovery, refuseLiveGoalRecovery, selectOriginalGoal } from '../../src/testing/scenarios/goalRecoveryScenario.js';
import {
  createMockOpenRouterSequenceServer,
  createMockAutohandAINativeSequenceServer,
  createTempAutohandHome,
  exitInteractive,
  launchBuiltAutohand,
  waitForExit,
} from './helpers/autohandTuistory.js';

describe('built CLI goal reliability', () => {
  it('cancels recovery safely and restores the selected offline conversation without resuming its goal', async () => {
    const server = await createMockAutohandAINativeSequenceServer([
      { content: 'RECOVERY_CONTEXT_SEEN' },
      { content: 'Finish the recovered goal.', toolCall: { id: 'recovered-completion', name: 'update_goal', args: { status: 'complete' } } },
      { content: 'RECOVERED_GOAL_FINISHED' },
    ]);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, slashGoal: true },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Session | undefined;
    try {
      const sessions = new SessionManager(path.join(state.autohandHome, 'sessions'));
      await sessions.initialize();
      const original = await sessions.createSession(state.workspaceRoot, 'moa');
      await original.append({ role: 'user', content: 'Remember the original recovery plan', timestamp: new Date().toISOString() });
      await original.append({ role: 'assistant', content: 'RECOVERED_CONVERSATION_MARKER', timestamp: new Date().toISOString() });
      await sessions.closeSession();
      const owner = new GoalManager(state.workspaceRoot, { sessionId: original.metadata.sessionId });
      await owner.createGoal({ objective: 'recover original work' });
      const other = await sessions.createSession(state.workspaceRoot, 'moa');
      await sessions.closeSession();
      await new GoalManager(state.workspaceRoot, { sessionId: other.metadata.sessionId }).createGoal({ objective: 'different offline work' });
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      });
      await openGoalRecovery(session);
      await cancelGoalRecovery(session);
      expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
      await openGoalRecovery(session);
      await selectOriginalGoal(session);
      expect(JSON.stringify(server.requests[0])).toContain('RECOVERED_CONVERSATION_MARKER');
      expect((await owner.getSessionSnapshot()).goal?.status).toBe('paused');
      await finishRecoveredGoal(session);
      expect((await owner.getSessionSnapshot()).goal?.status).toBe('complete');
      expect((await owner.getSnapshot()).goals[other.metadata.sessionId]?.status).toBe('active');
      await exitInteractive(session);
    } finally {
      if (session && !session.exitInfo) await exitInteractive(session).catch(() => {});
      session?.close();
      await server.close();
      await state.cleanup();
    }
  });

  it('refuses recovery from another real live terminal session', async () => {
    const server = await createMockAutohandAINativeSequenceServer([{ content: 'SHOULD_NOT_RUN' }]);
    const state = await createTempAutohandHome({ config: {
      provider: 'autohandai',
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'tuistory-autohand-api-key', model: 'moa', baseUrl: server.baseUrl },
      features: { autohand_inference: true, slashGoal: true }, agent: { autoMemory: false },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let ownerTerminal: Session | undefined;
    let recoveringTerminal: Session | undefined;
    try {
      const recoveryConfigPath = path.join(state.autohandHome, 'recovery-config.json');
      await fs.copy(state.configPath, recoveryConfigPath);
      const launchOptions = { autohandHome: state.autohandHome, cwd: state.workspaceRoot };
      ownerTerminal = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], launchOptions);
      await ownerTerminal.waitForText('❯', { timeout: 15_000 });
      const registry = new ActiveAgentRegistry(path.join(state.autohandHome, 'active-agents'));
      const record = await vi.waitFor(async () => {
        const [current] = await registry.listActive();
        if (!current) throw new Error('Expected a live terminal heartbeat');
        return current;
      }, { timeout: 10_000, interval: 100 });
      const owner = new GoalManager(state.workspaceRoot, { sessionId: record.sessionId });
      await owner.createGoal({ objective: 'live owner work' });
      recoveringTerminal = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', recoveryConfigPath], launchOptions);
      await refuseLiveGoalRecovery(recoveringTerminal, record.sessionId);
      expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
      expect(server.requests).toHaveLength(0);
      await exitInteractive(recoveringTerminal);
      await exitInteractive(ownerTerminal);
    } finally {
      for (const terminal of [recoveringTerminal, ownerTerminal]) {
        if (terminal && !terminal.exitInfo) await exitInteractive(terminal).catch(() => {});
        terminal?.close();
      }
      await server.close();
      await state.cleanup();
    }
  });

  it.each(['blocked', 'waiting'] as const)('keeps a %s goal stopped until an explicit interactive resume', async (status) => {
    const server = await createMockOpenRouterSequenceServer([
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status, stop_reason: 'Needs approval', resume_when: 'User approves', checkpoint: { summary: 'Patch prepared' } } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_STOPPED_FOR_APPROVAL' }),
      JSON.stringify({ toolCalls: [{ tool: 'update_goal', args: { status: 'complete' } }] }),
      JSON.stringify({ toolCalls: [], finalResponse: 'GOAL_RESUMED_AND_FINISHED' }),
    ]);
    const state = await createTempAutohandHome({ config: {
      features: { slashGoal: true }, openrouter: { baseUrl: server.baseUrl },
      agent: { autoMemory: false, maxIterations: 4, sessionRetryLimit: 0 },
      network: { maxRetries: 0, retryDelay: 0 },
      ui: { promptSuggestions: false, showCompletionNotification: false, terminalBell: false },
    } });
    let session: Session | undefined;
    try {
      session = await launchBuiltAutohand(['--path', state.workspaceRoot, '--config', state.configPath], {
        autohandHome: state.autohandHome, cwd: state.workspaceRoot,
      });
      await inspectStoppedGoal(session, status);
      const manager = new GoalManager(state.workspaceRoot);
      expect(Object.values((await manager.getSnapshot()).goals)[0]?.status).toBe(status);
      expect(session.readAll()).not.toContain('GOAL_RESUMED_AND_FINISHED');
      await resumeStoppedGoal(session);
      await exitInteractive(session);
      expect(Object.values((await manager.getSnapshot()).goals)[0]).toMatchObject({ status: 'complete', checkpoint: { summary: 'Patch prepared' } });
    } finally {
      if (session && !session.exitInfo) await exitInteractive(session).catch(() => {});
      session?.close();
      await server.close();
      await state.cleanup();
    }
  });

  it('requires and saves reported completion evidence through the built CLI', async () => {
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true } } });
    let session: Session | undefined;
    try {
      const manager = new GoalManager(state.workspaceRoot);
      await manager.createGoal({ objective: 'CLI completion receipt', acceptanceCriteria: ['Tests pass'] });
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'complete',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('completion evidence');
      session.close();
      const evidence = { summary: 'Terminal evidence saved', checks: [{ criterion: 'Tests pass', status: 'passed', evidence: 'real CLI test log' }] };
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', `complete ${JSON.stringify(evidence)}`,
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('Reported completion evidence: Terminal evidence saved');
      expect((await manager.getSessionSnapshot()).completed[0].completionReceipt).toMatchObject({ ...evidence, provenance: 'reported' });
    } finally {
      session?.close();
      await state.cleanup();
    }
  });

  it('refuses damaged storage and explicitly restores its backup through the CLI', async () => {
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true } } });
    const statePath = path.join(state.workspaceRoot, '.autohand', 'goals.local.json');
    let session: Session | undefined;
    try {
      const manager = new GoalManager(state.workspaceRoot);
      await manager.createGoal({ objective: 'saved for explicit recovery' });
      await fs.writeFile(statePath, '{damaged CLI snapshot');
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'attempt while damaged',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('Goal storage');
      expect(await fs.readFile(statePath, 'utf8')).toBe('{damaged CLI snapshot');

      session.close();
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'repair',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('Goal storage restored');
      expect((await manager.getSessionSnapshot()).goal).toMatchObject({
        objective: 'saved for explicit recovery', status: 'paused',
      });
    } finally {
      session?.close();
      await state.cleanup();
    }
  });

  it('persists CLI completion when a queued template is unavailable', async () => {
    const state = await createTempAutohandHome({ config: { features: { slashGoal: true } } });
    let session: Session | undefined;
    try {
      const manager = new GoalManager(state.workspaceRoot);
      await manager.createGoal({ objective: 'finished CLI work' });
      await manager.enqueueGoal({ objective: 'pending CLI template', source: 'cli', template: 'missing-next' });
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'complete',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);

      expect(session.readAll()).toContain('Goal completed. The next queued goal was not started');
      const snapshot = await manager.getSessionSnapshot();
      expect(snapshot.goal?.status).toBe('complete');
      expect(snapshot.completed).toHaveLength(1);
      expect(snapshot.queue).toHaveLength(1);
      session.close();
      await fs.outputFile(path.join(state.workspaceRoot, '.pi-goals', 'missing-next.md'), 'Recovered CLI template');
      session = await launchBuiltAutohand([
        '--path', state.workspaceRoot, '--config', state.configPath, '--goal', 'resume',
      ], { autohandHome: state.autohandHome, cwd: state.workspaceRoot });
      await waitForExit(session);
      expect(session.readAll()).toContain('Started queued goal');
      expect((await manager.getSessionSnapshot()).goal?.objective).toBe('Recovered CLI template');
    } finally {
      session?.close();
      await state.cleanup();
    }
  });

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
