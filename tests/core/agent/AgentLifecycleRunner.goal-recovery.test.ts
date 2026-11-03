import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAgentForRPC, restoreAgentSessionState } from '../../../src/core/agent/AgentLifecycleRunner.js';
import { GoalManager } from '../../../src/goals/GoalManager.js';

describe('goal checkpoint recovery at session startup', () => {
  let root: string;
  let manager: GoalManager;
  let alive: boolean;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-startup-goal-'));
    alive = false;
    manager = new GoalManager(root, { sessionId: 'saved-owner', isSessionAlive: async () => alive });
    await manager.createGoal({ objective: 'Approved unfinished work' });
    await manager.updateGoal({ checkpoint: { summary: 'Saved progress', nextStep: 'Verify the result' } });
    await manager.enqueueGoal({ objective: 'Queued approved work', source: 'command' });
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.remove(root); });
  const savedSession = () => ({ metadata: { sessionId: 'saved-owner', model: 'fixture', projectPath: root }, getMessages: () => [] });
  const restoredHost = () => ({
    runtime: { workspaceRoot: root, config: { mcp: { enabled: false } }, options: {} },
    sessionManager: { loadSession: vi.fn(async () => savedSession()), getCurrentSession: () => savedSession() },
    goalActivityManager: manager, skillsRegistry: { setWorkspace: vi.fn(async () => {}) },
    conversation: { history: () => [], addSystemNote: vi.fn(), addMessage: vi.fn() },
    resetConversationContext: vi.fn(async () => {}),
    injectSessionBootstrap: vi.fn(async () => { expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused'); }),
    injectProjectKnowledge: vi.fn(async () => {}), updateContextUsage: vi.fn(), runInstruction: vi.fn(),
  });

  it('pauses the saved goal before restoring any bootstrap context and preserves ownership and queue', async () => {
    const host = restoredHost();
    await restoreAgentSessionState(host, 'saved-owner');
    const snapshot = await manager.getSnapshot();
    expect(Object.keys(snapshot.goals)).toEqual(['saved-owner']);
    expect(snapshot.goals['saved-owner']).toMatchObject({ status: 'paused', checkpoint: { summary: 'Saved progress' } });
    expect(snapshot.queue).toHaveLength(1);
    expect(host.skillsRegistry.setWorkspace).toHaveBeenCalledWith(root, { createIdentity: false });
    expect(host.runInstruction).not.toHaveBeenCalled();
  });

  it('refuses a live owner before injecting restored context', async () => {
    alive = true; const host = restoredHost();
    await expect(restoreAgentSessionState(host, 'saved-owner')).rejects.toThrow('live session');
    expect(host.injectSessionBootstrap).not.toHaveBeenCalled();
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('active');
  });

  it('pauses an RPC restored goal before advertising the saved session heartbeat', async () => {
    const host = { ...restoredHost(),
      initializeManagers: vi.fn(async () => {}), skillsRegistry: { setWorkspace: vi.fn(async () => {}) },
      activeProvider: 'openrouter', telemetryManager: { startSession: vi.fn(async () => {}) }, hookManager: { executeHooks: vi.fn(async () => []) },
      startActiveAgentHeartbeat: vi.fn(async () => { expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused'); alive = true; }),
    };
    await initializeAgentForRPC(host, undefined, 'saved-owner');
    expect(host.startActiveAgentHeartbeat).toHaveBeenCalledOnce();
    expect(host.injectSessionBootstrap.mock.invocationCallOrder[0]).toBeLessThan(host.startActiveAgentHeartbeat.mock.invocationCallOrder[0]);
    expect(host.skillsRegistry.setWorkspace).toHaveBeenCalledWith(root, { createIdentity: false });
    expect((await manager.getSessionSnapshot()).goal?.status).toBe('paused');
  });
});
