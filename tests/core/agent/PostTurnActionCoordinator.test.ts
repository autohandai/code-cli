/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executePendingPostTurnAction,
  resolveActiveGoalContinuation,
  unpackQueuedAgentInstruction,
  type ActiveGoalContinuationHost,
  type PostTurnActionHost,
  type PostTurnEnvironment,
} from '../../../src/core/agent/PostTurnActionCoordinator.js';
import { GoalManager } from '../../../src/goals/GoalManager.js';

const interactiveEnvironment: PostTurnEnvironment = {
  stdinIsTTY: true,
  stdoutIsTTY: true,
  isCI: false,
  isNonInteractive: false,
};

describe('post-turn research publication', () => {
  let workspaceRoot: string;
  let requestResearchPublication: ReturnType<typeof vi.fn>;
  let host: PostTurnActionHost;
  const action = {
    kind: 'publish-research' as const,
    runId: 'run-1',
    reportPath: '.autohand/research/topic.md',
  };

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-post-turn-action-'));
    await fs.outputJson(path.join(workspaceRoot, '.autohand', 'research', 'status.json'), {
      id: action.runId,
      topic: 'Agent testing',
      reportPath: action.reportPath,
      status: 'completed',
      queuedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blockers: [],
    });
    requestResearchPublication = vi.fn(async () => 'Publication complete.');
    host = {
      runtime: {
        workspaceRoot,
        options: { yes: true },
        isCommandMode: false,
        isRpcMode: false,
      },
      shouldExit: false,
      interactiveAutomodeEnabled: false,
      requestResearchPublication,
    };
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('carries a structured action alongside the reserved instruction', () => {
    const structuredInstruction = unpackQueuedAgentInstruction({
      text: 'Run the research',
      postTurnAction: action,
    });
    expect(structuredInstruction).toEqual({
      text: 'Run the research',
      postTurnAction: action,
      sequence: expect.any(Number),
    });

    const ordinaryInstruction = unpackQueuedAgentInstruction('ordinary request');
    expect(ordinaryInstruction).toEqual({
      text: 'ordinary request',
      sequence: expect.any(Number),
    });
    expect(ordinaryInstruction.sequence).toBeGreaterThan(structuredInstruction.sequence);
  });

  it('offers once only after a successful completed run with the matching reserved path', async () => {
    const result = await executePendingPostTurnAction(
      host,
      action,
      true,
      interactiveEnvironment,
    );

    expect(result).toBe('Publication complete.');
    expect(requestResearchPublication).toHaveBeenCalledOnce();
    expect(requestResearchPublication).toHaveBeenCalledWith(action.reportPath);
  });

  it.each([
    ['failed turn', false, interactiveEnvironment],
    ['CI', true, { ...interactiveEnvironment, isCI: true }],
    ['piped input', true, { ...interactiveEnvironment, stdinIsTTY: false }],
    ['non-interactive mode', true, { ...interactiveEnvironment, isNonInteractive: true }],
  ])('does not offer after %s even when global yes mode is enabled', async (_label, succeeded, environment) => {
    const result = await executePendingPostTurnAction(host, action, succeeded, environment);

    expect(result).toBeNull();
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });

  it('skips the blocking publish prompt while interactive automode is active, but still tells the user how to publish later', async () => {
    host.interactiveAutomodeEnabled = true;

    const result = await executePendingPostTurnAction(
      host,
      action,
      true,
      interactiveEnvironment,
    );

    expect(result).toContain('Research saved');
    expect(result).toContain(`/publish-research ${action.reportPath}`);
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });

  it('skips the blocking publish prompt while the automode manager reports active, with the same recovery hint', async () => {
    host.automodeManager = { isActive: () => true };

    const result = await executePendingPostTurnAction(
      host,
      action,
      true,
      interactiveEnvironment,
    );

    expect(result).toContain('Research saved');
    expect(result).toContain(`/publish-research ${action.reportPath}`);
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });

  it('does not offer when the typed action disagrees with persisted run state', async () => {
    const result = await executePendingPostTurnAction(
      host,
      { ...action, reportPath: '.autohand/research/other.md' },
      true,
      interactiveEnvironment,
    );

    expect(result).toBeNull();
    expect(requestResearchPublication).not.toHaveBeenCalled();
  });
});

describe('post-turn active goal continuation', () => {
  let workspaceRoot: string;
  let host: ActiveGoalContinuationHost;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-continuation-'));
    await new GoalManager(workspaceRoot, { sessionId: 'session-current' })
      .createGoal({ objective: 'Finish the browser game' });
    host = {
      runtime: { workspaceRoot },
      sessionId: 'session-current',
      shouldExit: false,
      interactiveAutomodeEnabled: true,
    };
  });

  afterEach(async () => {
    await fs.remove(workspaceRoot);
  });

  it('continues a successful auto-mode turn while the goal remains active', async () => {
    const continuation = await resolveActiveGoalContinuation(host, true);

    expect(continuation).toContain('Active goal: Finish the browser game');
    expect(continuation).toContain('until it is complete, blocked, paused, cleared, or budget-limited');
  });

  it.each([
    ['the turn failed', false, true, false],
    ['auto mode is disabled', true, false, false],
    ['the session is exiting', true, true, true],
  ])('does not continue when %s', async (_label, turnSucceeded, autoMode, shouldExit) => {
    host.interactiveAutomodeEnabled = autoMode;
    host.shouldExit = shouldExit;

    await expect(resolveActiveGoalContinuation(host, turnSucceeded)).resolves.toBeNull();
  });

  it('stops scheduling after the goal reaches a terminal state', async () => {
    await new GoalManager(workspaceRoot).updateGoal({ status: 'complete' });

    await expect(resolveActiveGoalContinuation(host, true)).resolves.toBeNull();
  });

  it('does not continue an active goal attached to a prior session', async () => {
    host.sessionId = 'session-new';

    await expect(resolveActiveGoalContinuation(host, true)).resolves.toBeNull();
  });
});
