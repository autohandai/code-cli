import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import { AgentPeerRuntime } from '../../../src/core/agent/AgentPeerRuntime.js';
import { ActiveAgentHeartbeat } from '../../../src/session/ActiveAgentRegistry.js';

function heartbeatAgent(config: Record<string, unknown>) {
  const session = { metadata: { sessionId: 'session-1' }, appendContext: vi.fn() };
  return Object.assign(Object.create(AutohandAgent.prototype), {
    activeAgentHeartbeat: null,
    peerRuntime: undefined,
    runtimeResourceShutdownPromise: undefined,
    runtimeResourceShutdownController: new AbortController(),
    sessionManager: { getCurrentSession: () => session },
    peerAwareness: {
      setSessionId: vi.fn(),
      adoptRepoBaseline: vi.fn(async () => {}),
    },
    runtime: { config, options: {}, workspaceRoot: '/workspace' },
  }) as Record<string, any>;
}

describe('active agent heartbeat with peer communication on by default', () => {
  afterEach(() => vi.restoreAllMocks());

  it('starts the heartbeat when the config has no sessions block', async () => {
    const peerStart = vi.spyOn(AgentPeerRuntime, 'start').mockResolvedValue(undefined);
    const heartbeatStart = vi.spyOn(ActiveAgentHeartbeat.prototype, 'start').mockResolvedValue(undefined);
    const agent = heartbeatAgent({});

    await expect(agent.startActiveAgentHeartbeat()).resolves.toBeUndefined();

    expect(peerStart).toHaveBeenCalledOnce();
    expect(peerStart.mock.calls[0]![0].policy).toBeUndefined();
    expect(heartbeatStart).toHaveBeenCalledOnce();
    expect(agent.activeAgentHeartbeat).toBeInstanceOf(ActiveAgentHeartbeat);
  });

  it('skips the peer runtime but still starts the heartbeat when peers are opted out', async () => {
    const peerStart = vi.spyOn(AgentPeerRuntime, 'start').mockResolvedValue(undefined);
    const heartbeatStart = vi.spyOn(ActiveAgentHeartbeat.prototype, 'start').mockResolvedValue(undefined);
    const agent = heartbeatAgent({ sessions: { communication: { enabled: false } } });

    await agent.startActiveAgentHeartbeat();

    expect(peerStart).not.toHaveBeenCalled();
    expect(heartbeatStart).toHaveBeenCalledOnce();
  });
});
