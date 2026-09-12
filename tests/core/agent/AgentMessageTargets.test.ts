/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { deliverAgentTargetMessage, listAgentMessageTargets } from '../../../src/core/agent/AgentMessageTargets.js';

function host(overrides: Record<string, unknown> = {}) {
  const runs = [
    { id: 'subagent-1', source: 'delegate', name: 'reviewer', task: 'Review', status: 'running', startedAt: 0, updatedAt: 0, cancellable: true, messageable: true },
  ];
  return {
    agentRunStore: { getSnapshot: () => ({ runs, updatedAt: 0 }), sendMessage: vi.fn().mockResolvedValue(true) },
    teamManager: { getTeam: () => ({ members: [{ name: 'builder', agentName: 'implementer', pid: 1, status: 'idle' }] }), sendMessageTo: vi.fn() },
    peerAwareness: { getPeers: () => [{ sessionId: 'peer12345678', projectName: 'cli', model: 'moa' }] },
    ...overrides,
  } as never;
}

describe('agent message targets', () => {
  it('lists runs, teammates, and peers from the host', () => {
    expect(listAgentMessageTargets(host()).map((target) => `${target.kind}:${target.alias}`))
      .toEqual(['run:reviewer', 'teammate:builder', 'peer:peer-peer1234']);
  });

  it('queues a message for a sub-agent run and reports the receipt', async () => {
    const h = host();
    const delivery = await deliverAgentTargetMessage(h, ':reviewer focus on the tests');
    expect(h.agentRunStore.sendMessage).toHaveBeenCalledWith('subagent-1', 'focus on the tests');
    expect(delivery).toMatchObject({ ok: true, receipt: expect.stringContaining('Message queued for reviewer') });
  });

  it('sends to a teammate through the team manager as the lead', async () => {
    const h = host();
    const delivery = await deliverAgentTargetMessage(h, ':builder ship it');
    expect(h.teamManager.sendMessageTo).toHaveBeenCalledWith('builder', 'lead', 'ship it');
    expect(delivery).toMatchObject({ ok: true, receipt: 'Message sent to teammate builder.' });
  });

  it('explains unreachable targets and empty messages without sending', async () => {
    const h = host();
    expect(await deliverAgentTargetMessage(h, ':peer-peer1234 hi')).toMatchObject({ ok: false, receipt: expect.stringContaining('cannot receive messages') });
    expect(await deliverAgentTargetMessage(h, ':reviewer')).toMatchObject({ ok: false, receipt: 'Add the message after :reviewer.' });
    expect(h.agentRunStore.sendMessage).not.toHaveBeenCalled();
  });

  it('reports a run that refused the message and leaves ordinary prompts alone', async () => {
    const h = host();
    h.agentRunStore.sendMessage.mockResolvedValueOnce(false);
    expect(await deliverAgentTargetMessage(h, ':reviewer hello')).toMatchObject({ ok: false });
    expect(await deliverAgentTargetMessage(h, 'tell :reviewer hello')).toBeNull();
    expect(await deliverAgentTargetMessage({} as never, ':reviewer hello')).toBeNull();
  });
});
