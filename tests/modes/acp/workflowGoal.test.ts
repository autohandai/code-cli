import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GoalManager } from '../../../src/goals/GoalManager.js';
import { continueWorkflowGoal } from '../../../src/modes/acp/workflowGoal.js';

let root: string;
let manager: GoalManager;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'workflow-goal-'));
  manager = new GoalManager(root, { sessionId: 'workflow', isSessionAlive: async () => true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('continues after an ordinary answer until the durable goal is complete', async () => {
  const { goal } = await manager.createGoal({ objective: 'Finish the fixture' });
  const run = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
    expect(await manager.updateGoal({ status: 'complete', expectedGoalId: goal!.goalId })).toMatchObject({ ok: true });
  });
  await continueWorkflowGoal({ manager, goalId: goal!.goalId, signal: new AbortController().signal, runTurn: async turn => { expect(turn).toBeLessThan(3); await run(); } });
  expect(run).toHaveBeenCalledTimes(2);
});

it('accepts the exact archived completion after the queue starts another goal', async () => {
  const { goal } = await manager.createGoal({ objective: 'Owned task' });
  await manager.enqueueGoal({ objective: 'Next task', source: 'command' });
  await continueWorkflowGoal({ manager, goalId: goal!.goalId, signal: new AbortController().signal, runTurn: async turn => {
    expect(turn).toBe(0);
    expect(await manager.updateGoal({ status: 'complete', expectedGoalId: goal!.goalId })).toMatchObject({ ok: true });
  } });
  expect((await manager.getSessionSnapshot()).goal).toMatchObject({ objective: 'Next task', status: 'active' });
});

it('rejects a blocked goal without running another turn', async () => {
  const { goal } = await manager.createGoal({ objective: 'Owned task' });
  expect(await manager.updateGoal({ status: 'blocked', stopReason: 'Missing fixture dependency', resumeWhen: 'Dependency is supplied' })).toMatchObject({ ok: true });
  const runTurn = vi.fn(async () => { throw new Error('Unexpected turn'); });
  await expect(continueWorkflowGoal({ manager, goalId: goal!.goalId, signal: new AbortController().signal, runTurn })).rejects.toThrow('blocked');
  expect(runTurn).not.toHaveBeenCalled();
});

it('pauses only the owned active goal on cancellation', async () => {
  const { goal } = await manager.createGoal({ objective: 'Owned task' });
  const peer = new GoalManager(root, { sessionId: 'peer', isSessionAlive: async () => true });
  await peer.createGoal({ objective: 'Peer task' });
  const controller = new AbortController();
  await expect(continueWorkflowGoal({ manager, goalId: goal!.goalId, signal: controller.signal, runTurn: async () => { controller.abort(); } })).rejects.toThrow();
  expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused');
  expect((await peer.getSessionSnapshot()).goal?.status).toBe('active');
});

it('does not pause a replacement goal after a failed turn', async () => {
  const { goal } = await manager.createGoal({ objective: 'Owned task' });
  await expect(continueWorkflowGoal({ manager, goalId: goal!.goalId, signal: new AbortController().signal, runTurn: async () => {
    await manager.createGoal({ objective: 'Replacement' }, { replace: true });
    throw new Error('Provider failed');
  } })).rejects.toThrow('Provider failed');
  expect((await manager.getSessionSnapshot()).goal).toMatchObject({ objective: 'Replacement', status: 'active' });
});

it('enables goal tools only inside the workflow scope and excludes overrides from saves', async () => {
  const { withWorkflowGoalConfig } = await import('../../../src/modes/acp/workflowGoal.js');
  const { restoreRunConfigOverlay } = await import('../../../src/runConfigOverlay.js');
  const config = { features: { slashGoal: false }, agent: { goalAutoMode: true } };
  await withWorkflowGoalConfig(config, async () => {
    expect(config.features.slashGoal).toBe(true);
    expect(config.agent.goalAutoMode).toBe(false);
    const saved = structuredClone(config);
    restoreRunConfigOverlay(saved, Reflect.get(config, 'runOverlay'));
    expect(saved.features.slashGoal).toBe(false);
    expect(saved.agent.goalAutoMode).toBe(true);
  });
  expect(config.features.slashGoal).toBe(false);
  expect(config.agent.goalAutoMode).toBe(true);
});

it('reuses durable completion for the same execution and never creates a duplicate goal', async () => {
  const { executeWorkflowGoal } = await import('../../../src/modes/acp/workflowGoal.js');
  const runTurn = vi.fn(async () => {
    expect(await manager.updateGoal({ status: 'complete' })).toMatchObject({ ok: true });
  });
  const options = { workspaceRoot: root, sessionId: 'workflow', executionId: 'run:node', instruction: 'Owned objective', signal: new AbortController().signal, runTurn };
  await executeWorkflowGoal(options);
  const first = (await manager.getSessionSnapshot()).goal;
  await executeWorkflowGoal({ ...options, instruction: "Refreshed host context around the same saved workflow step" });
  expect(runTurn).toHaveBeenCalledTimes(1);
  expect((await manager.getSessionSnapshot()).goal?.goalId).toBe(first?.goalId);
});

it('does not pause a goal that completed between inspection and cleanup mutation', async () => {
  const { goal } = await manager.createGoal({ objective: 'Concurrent completion' });
  expect(await manager.updateGoal({ status: 'complete' })).toMatchObject({ ok: true });
  expect(await manager.updateGoal({ status: 'paused', expectedGoalId: goal!.goalId, expectedStatus: 'active' })).toMatchObject({ ok: false });
  expect((await manager.getSessionSnapshot()).goal?.status).toBe('complete');
});

it('resumes the owned active goal with its original objective after host context changes', async () => {
  const { executeWorkflowGoal } = await import('../../../src/modes/acp/workflowGoal.js');
  const { goal } = await manager.createGoal({ objective: 'Workflow execution run:node:\nOriginal saved objective' });
  const runTurn = vi.fn(async (instruction: string) => {
    expect(instruction).toContain('Original saved objective');
    expect(instruction).not.toContain('Changed host wrapper');
    expect(await manager.updateGoal({ status: 'complete', expectedGoalId: goal!.goalId })).toMatchObject({ ok: true });
  });
  await executeWorkflowGoal({ workspaceRoot: root, sessionId: 'workflow', executionId: 'run:node', instruction: 'Changed host wrapper', signal: new AbortController().signal, runTurn });
  expect(runTurn).toHaveBeenCalledOnce();
  expect((await manager.getSessionSnapshot()).goal?.goalId).toBe(goal!.goalId);
});
