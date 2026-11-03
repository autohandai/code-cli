import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { RPCAdapter } from '../../src/modes/rpc/adapter.js';
import { AutohandAcpAdapter } from '../../src/modes/acp/adapter.js';
import { writeNotification } from '../../src/modes/rpc/protocol.js';
import type { SkillAttachmentReceipt } from '../../src/skills/SkillRuntime.js';

vi.mock('../../src/core/agent.js', () => ({ AutohandAgent: class {} }));
vi.mock('../../src/modes/rpc/protocol.js', () => ({ writeNotification: vi.fn(), createTimestamp: () => '2026-11-03T00:00:00.000Z', generateId: () => 'fixture' }));
afterEach(() => vi.clearAllMocks());

const receipt: SkillAttachmentReceipt = { version: 1, taskId: 'native-task', sessionId: 'native-session', requestId: 'actual-request',
  reference: { authority: 'local:personal:agents', packageId: 'review', revision: `sha256:${'a'.repeat(64)}`, resource: 'SKILL.md' },
  resources: [{ path: 'SKILL.md', sha256: 'b'.repeat(64), bytes: 30 }], scope: 'member:alice', contentDigest: 'c'.repeat(64),
  reason: 'explicit', state: 'submitted', capability: 'provider-request', policyEpoch: 2, recordedAt: 1_793_664_000_000 };

describe('native skill receipt output transport', () => {
  it('forwards the exact native RPC receipt through a dedicated notification', () => {
    const adapter = new RPCAdapter();
    const handle = Reflect.get(adapter, 'handleAgentOutput');
    expect(typeof handle).toBe('function');
    handle.call(adapter, { type: 'skill_attachment', receipt });
    expect(writeNotification).toHaveBeenCalledExactlyOnceWith('autohand.skillAttachment', { receipt, timestamp: '2026-11-03T00:00:00.000Z' });
    expect(vi.mocked(writeNotification).mock.calls[0][1]?.receipt).toBe(receipt);
  });

  it('forwards an ACP extension notification without fabricating a tool call or message', async () => {
    const extNotification = vi.fn().mockResolvedValue(undefined);
    const sessionUpdate = vi.fn().mockResolvedValue(undefined);
    const adapter = new AutohandAcpAdapter({ extNotification, sessionUpdate } as unknown as AgentSideConnection);
    const sessions = Reflect.get(adapter, 'sessions');
    expect(sessions).toBeInstanceOf(Map);
    sessions.set('session-1', {});
    const handle = Reflect.get(adapter, 'handleAgentOutput');
    await handle.call(adapter, 'session-1', { type: 'skill_attachment', receipt });
    expect(extNotification).toHaveBeenCalledExactlyOnceWith('_autohand/skillAttachment', expect.objectContaining({ sessionId: 'session-1', receipt }));
    expect(extNotification.mock.calls[0][1].receipt).toBe(receipt);
    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('does not emit attachment evidence when the native receipt is absent', async () => {
    const extNotification = vi.fn().mockResolvedValue(undefined);
    const adapter = new AutohandAcpAdapter({ extNotification } as unknown as AgentSideConnection);
    await Reflect.get(adapter, 'handleAgentOutput').call(adapter, 'missing-session', { type: 'skill_attachment' });
    Reflect.get(new RPCAdapter(), 'handleAgentOutput').call(new RPCAdapter(), { type: 'skill_attachment' });
    expect(extNotification).not.toHaveBeenCalled();
    expect(writeNotification).not.toHaveBeenCalled();
  });
});
