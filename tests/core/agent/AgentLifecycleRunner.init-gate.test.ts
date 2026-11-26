import { describe, expect, it, vi } from 'vitest';
import {
  ensureAgentInitComplete,
  startupInitPhase,
  type AgentLifecycleHost,
} from '../../../src/core/agent/AgentLifecycleRunner.js';

function gateHost(overrides: Partial<AgentLifecycleHost> = {}): AgentLifecycleHost {
  return {
    initReady: Promise.resolve(),
    initDone: true,
    flushMcpStartupSummaryIfPending: vi.fn(),
    sessionManager: { getCurrentSession: () => ({ metadata: { sessionId: 'session-1' } }) },
    hookManager: { executeHooks: vi.fn().mockResolvedValue(undefined) },
    mcpStartupCoordinator: { describePendingConnections: () => null },
    ui: { setWorking: vi.fn() },
    ...overrides,
  };
}

describe('startup init phase', () => {
  it('derives every phase from the host facts', () => {
    expect(startupInitPhase({ initReady: null, initDone: false })).toBe('notStarted');
    expect(startupInitPhase({ initReady: new Promise(() => {}), initDone: false })).toBe('initializing');
    expect(startupInitPhase({ initReady: Promise.resolve(), initDone: true })).toBe('awaitingFirstTurn');
    expect(startupInitPhase({ initReady: null, initDone: true })).toBe('complete');
  });

  it('reports finalizing while the first turn is releasing the gate', async () => {
    let releaseHook = () => {};
    const host = gateHost({
      hookManager: { executeHooks: vi.fn(() => new Promise<void>(resolve => { releaseHook = resolve; })) },
    });
    const completion = ensureAgentInitComplete(host);
    await vi.waitFor(() => expect(host.hookManager.executeHooks).toHaveBeenCalled());
    expect(startupInitPhase(host)).toBe('finalizing');
    releaseHook();
    await completion;
    expect(startupInitPhase(host)).toBe('complete');
  });
});

describe('ensureAgentInitComplete', () => {
  it('fires session-start once when several first-turn callers race', async () => {
    let releaseInit = () => {};
    const host = gateHost({ initReady: new Promise<void>(resolve => { releaseInit = resolve; }), initDone: false });
    const callers = [ensureAgentInitComplete(host), ensureAgentInitComplete(host), ensureAgentInitComplete(host)];
    releaseInit();
    await Promise.all(callers);
    expect(host.hookManager.executeHooks).toHaveBeenCalledTimes(1);
    expect(host.flushMcpStartupSummaryIfPending).toHaveBeenCalledTimes(1);
  });

  it('lets every racing caller observe a startup failure and retries on the next turn', async () => {
    let rejectInit: (error: Error) => void = () => {};
    const initReady = new Promise<void>((_resolve, reject) => { rejectInit = reject; });
    initReady.catch(() => undefined);
    const host = gateHost({ initReady, initDone: false });
    const callers = [ensureAgentInitComplete(host), ensureAgentInitComplete(host)];
    rejectInit(new Error('managers failed'));
    for (const caller of callers) await expect(caller).rejects.toThrow('managers failed');
    await expect(ensureAgentInitComplete(host)).rejects.toThrow('managers failed');
    expect(host.hookManager.executeHooks).not.toHaveBeenCalled();
  });

  it('is a no-op once the first turn has released the gate', async () => {
    const host = gateHost();
    await ensureAgentInitComplete(host);
    await ensureAgentInitComplete(host);
    expect(host.hookManager.executeHooks).toHaveBeenCalledTimes(1);
  });

  it('labels the session-start hook as a resume when the host restored a session', async () => {
    const host = gateHost({ initSessionType: 'resume' });
    await ensureAgentInitComplete(host);
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith('session-start', {
      sessionId: 'session-1',
      sessionType: 'resume',
    });
  });
});
