import { describe, expect, it, vi } from 'vitest';
import type { AutohandAgent } from '../../../src/core/agent.js';
import type { ConversationManager } from '../../../src/core/conversationManager.js';
import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
vi.mock('../../../src/modes/rpc/protocol.js', () => ({ writeNotification: vi.fn(), createTimestamp: () => 'now', generateId: () => 'synthetic-session' }));
describe('persisted RPC session identity', () => {
  it('returns the actual saved session ID so SDK callers can resume and fork it', () => {
    const agent = { setStatusListener: vi.fn(), setOutputListener: vi.fn(),
      getSessionManager: () => ({ getCurrentSession: () => ({ metadata: { sessionId: 'persisted-session' } }) }) };
    const adapter = new RPCAdapter();
    adapter.initialize(agent as unknown as AutohandAgent, { history: () => [] } as unknown as ConversationManager, 'fixture', '/workspace');
    expect(adapter.getState().sessionId).toBe('persisted-session');
  });
});
