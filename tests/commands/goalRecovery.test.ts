/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalManager } from '../../src/goals/GoalManager.js';
import { SessionManager } from '../../src/session/SessionManager.js';
import { ActiveAgentRegistry } from '../../src/session/ActiveAgentRegistry.js';
import { goal, runGoalCli } from '../../src/commands/goal.js';
import { showModal } from '../../src/ui/ink/components/Modal.js';

vi.mock('../../src/ui/ink/components/Modal.js', () => ({ showModal: vi.fn() }));

describe('/goal recover', () => {
  let workspaceRoot: string;
  let sessions: SessionManager;
  let ownerId: string;
  let owner: GoalManager;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-goal-recover-command-'));
    sessions = new SessionManager(path.join(workspaceRoot, 'sessions'));
    await sessions.initialize();
    ownerId = (await sessions.createSession(workspaceRoot, 'test-model')).metadata.sessionId;
    owner = new GoalManager(workspaceRoot, { sessionId: ownerId });
    await owner.createGoal({ objective: 'original conversation work' });
    await sessions.createSession(workspaceRoot, 'test-model');
    vi.spyOn(ActiveAgentRegistry.prototype, 'listActive').mockResolvedValue([]);
    vi.mocked(showModal).mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.remove(workspaceRoot);
  });

  function context() {
    return {
      workspaceRoot, sessionManager: sessions,
      config: { configPath: path.join(workspaceRoot, 'config.json'), features: { slashGoal: true } },
      restoreSession: vi.fn(async (sessionId: string) => { await sessions.loadSession(sessionId); }),
      queueInstruction: vi.fn(), setInteractionMode: vi.fn(),
      onBeforeModal: vi.fn(), onAfterModal: vi.fn(),
    };
  }

  it('restores the exact session through the runtime callback and leaves its goal paused', async () => {
    const ctx = context();
    expect(await goal(ctx, ['recover', ownerId])).toContain('Recovered session');
    expect(ctx.restoreSession).toHaveBeenCalledWith(ownerId);
    expect(sessions.getCurrentSession()?.metadata.sessionId).toBe(ownerId);
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('paused');
    expect(ctx.queueInstruction).not.toHaveBeenCalled();
    expect(ctx.setInteractionMode).not.toHaveBeenCalled();
  });

  it('opens an offline-owner picker and cancels without any mutation', async () => {
    vi.mocked(showModal).mockResolvedValue(null);
    const ctx = context();
    expect(await goal(ctx, ['recover'])).toContain('Recovery cancelled');
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ options: [expect.objectContaining({ value: ownerId, label: 'original conversation work' })] }));
    expect(ctx.onBeforeModal).toHaveBeenCalledOnce();
    expect(ctx.onAfterModal).toHaveBeenCalledOnce();
    expect(ctx.restoreSession).not.toHaveBeenCalled();
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('rechecks the selected owner after the picker closes', async () => {
    vi.mocked(showModal).mockImplementation(async () => {
      vi.spyOn(ActiveAgentRegistry.prototype, 'listActive').mockResolvedValue([{
        version: 1, pid: process.pid, sessionId: ownerId, workspaceRoot, projectName: 'test',
        provider: 'openrouter', model: 'test-model', mode: 'interactive', status: 'idle',
        startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        messageCount: 0, contextPercent: 0, tokensUsed: 0,
      }]);
      return { label: 'selected owner', value: ownerId };
    });
    const ctx = context();
    expect(await goal(ctx, ['recover'])).toContain('live session');
    expect(ctx.restoreSession).not.toHaveBeenCalled();
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('keeps the goal safely paused and reports a failed conversation restore', async () => {
    const ctx = context();
    ctx.restoreSession.mockRejectedValue(new Error('conversation unavailable'));
    expect(await goal(ctx, ['recover', ownerId])).toContain('conversation unavailable');
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('paused');
  });

  it('lists actionable offline choices in non-interactive mode without restoring anything', async () => {
    const ctx = context();
    expect(await runGoalCli(workspaceRoot, 'recover', ctx.config)).toContain(`/goal recover ${ownerId}`);
    expect(showModal).not.toHaveBeenCalled();
    expect((await owner.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('restores the composer even if the picker fails', async () => {
    const ctx = context();
    vi.mocked(showModal).mockRejectedValue(new Error('picker unavailable'));
    expect(await goal(ctx, ['recover'])).toContain('picker unavailable');
    expect(ctx.onAfterModal).toHaveBeenCalledOnce();
    expect(ctx.restoreSession).not.toHaveBeenCalled();
  });

  it('refuses goals whose conversation is not registered to this workspace', async () => {
    const ctx = context();
    await new GoalManager(workspaceRoot, { sessionId: 'missing-conversation' }).createGoal({ objective: 'unavailable session' });
    expect(await goal(ctx, ['recover', 'missing-conversation'])).toContain('conversation');
    expect(ctx.restoreSession).not.toHaveBeenCalled();
  });

  it('refuses a saved conversation that belongs to another workspace', async () => {
    const foreignSession = await sessions.createSession(path.join(workspaceRoot, 'another-project'), 'test-model');
    const foreignId = foreignSession.metadata.sessionId;
    const foreignGoal = new GoalManager(workspaceRoot, { sessionId: foreignId });
    await foreignGoal.createGoal({ objective: 'foreign conversation' });
    await sessions.createSession(workspaceRoot, 'test-model');
    const ctx = context();
    expect(await goal(ctx, ['recover', foreignId])).toContain('conversation is unavailable in this workspace');
    expect(ctx.restoreSession).not.toHaveBeenCalled();
    expect((await foreignGoal.getSessionSnapshot()).goal?.status).toBe('active');
  });
});
