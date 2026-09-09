import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutohandAgent } from '../../../src/core/agent.js';
import type { ConversationManager } from '../../../src/core/conversationManager.js';
import type { AgentOutputEvent } from '../../../src/types.js';
import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { writeNotification } from '../../../src/modes/rpc/protocol.js';

vi.mock('../../../src/modes/rpc/protocol.js', () => ({ writeNotification: vi.fn(), createTimestamp: () => '2026-09-09T00:00:00.000Z', generateId: () => 'rpc-peer-test' }));
afterEach(() => vi.clearAllMocks());

describe('RPC peer and resource output', () => {
  it('forwards structured events while idle without fabricating an assistant message', async () => {
    let listener: ((event: AgentOutputEvent) => void) | undefined;
    const agent = {
      setStatusListener: () => {}, setOutputListener: (value: typeof listener) => { listener = value; },
      getImageManager: () => undefined, getHookManager: () => undefined,
      getFileManager: () => undefined,
      cancelCurrentInstruction: () => {}, shutdownRuntimeResources: async () => {},
    };
    const adapter = new RPCAdapter();
    adapter.initialize(agent as unknown as AutohandAgent, {} as ConversationManager, 'fixture-model', '/workspace', { configPath: '', sessions: { communication: { enabled: true } } });
    const peerEvent = { type: 'message', messageId: 'message-1', from: 'peer-a', to: 'peer-b', state: 'accepted', cursor: '1' };
    const resourceEvent = { type: 'resource', resource: 'machine/build', requestId: 'request-1', epoch: 3, state: 'reserved', cursor: '2' };
    listener?.({ type: 'peer_update', peerEvent });
    listener?.({ type: 'resource_update', resourceEvent });
    expect(writeNotification).toHaveBeenCalledWith('autohand.peerUpdate', expect.objectContaining({ event: peerEvent }));
    expect(writeNotification).toHaveBeenCalledWith('autohand.resourceUpdate', expect.objectContaining({ event: resourceEvent }));
    expect(vi.mocked(writeNotification).mock.calls.some(([method]) => method === 'autohand.messageUpdate')).toBe(false);
    await adapter.shutdown('disconnected');
    vi.mocked(writeNotification).mockClear();
    listener?.({ type: 'peer_update', peerEvent });
    expect(writeNotification).not.toHaveBeenCalled();
  });
});
