import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { ActiveAgentRegistry } from '../../../src/session/ActiveAgentRegistry.js';
import { LocalPeerTransport } from '../../../src/session/peers/LocalPeerTransport.js';
import { createTransportIdentity } from '../../../src/session/peers/PeerIdentity.js';
import type { PeerMessaging } from '../../../src/session/peers/PeerMessaging.js';

let h: PeerHarness;
const probes: LocalPeerTransport[] = [];
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => {
  await Promise.allSettled(probes.splice(0).map(probe => probe.close()));
  await h.close();
});

async function authenticatedProbe(target: PeerMessaging) {
  const registry = new ActiveAgentRegistry(path.join(h.home, 'active-agents'));
  const identity = createTransportIdentity();
  const probe = new LocalPeerTransport({
    directory: path.join(h.home, 'probe-runtime'), identity,
    lookupIdentity: async instanceId => (await registry.listActive()).find(record => record.communication?.instanceId === instanceId)?.communication,
    onRequest: async () => null,
  });
  probes.push(probe);
  const advertisement = await probe.start();
  const [template] = await registry.listActive();
  await registry.write({ ...template, sessionId: 'probe-session', communication: advertisement });
  const targetAdvertisement = target.getAdvertisement();
  if (!targetAdvertisement) throw new Error('Missing endpoint');
  return probe.connect(targetAdvertisement);
}

describe('authenticated remote method authorization', () => {
  it('refuses remote inbox and transcript reads even for an authenticated local session', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    await sender.send({ to: receiver.self.peerId, content: 'private inbox' });
    const probe = await authenticatedProbe(receiver);
    await expect(probe.request('peer.read', { to: receiver.self.peerId })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(probe.request('session.messages', { sessionId: receiver.self.sessionId })).rejects.toMatchObject({ code: 'METHOD_NOT_FOUND' });
    expect((await receiver.messages({ consume: false })).messages[0].content).toBe('private inbox');
  });

  it('refuses receipt queries and subscriptions for another sender’s message', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'private receipt' });
    const probe = await authenticatedProbe(receiver);
    await expect(probe.request('peer.status', { messageId: receipt.messageId, to: receiver.self.peerId })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(probe.request('peer.subscribe', { messageId: receipt.messageId, from: sender.self.peerId })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('rejects model-controlled sender identities and unaffiliated child run IDs', async () => {
    const receiver = await h.create();
    const probe = await authenticatedProbe(receiver);
    const input = { version: 1, messageId: 'forged', to: receiver.self.peerId, content: 'spoofed', expiresAt: new Date(Date.now() + 60_000).toISOString() };
    for (const forged of [{ from: receiver.self.peerId }, { senderRunId: 'not-a-bound-run' }, { senderInstanceId: receiver.self.instanceId }]) {
      await expect(probe.request('peer.send', { ...input, ...forged })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    }
    expect((await receiver.messages()).messages).toEqual([]);
  });

  it('keeps coordination control independently authorized from routine messaging', async () => {
    const receiver = await h.create();
    const probe = await authenticatedProbe(receiver);
    await expect(probe.request('resource.set_controller', { resource: 'machine/build', controller: receiver.self.peerId, participants: [], profile: 'strict' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('requires an acknowledgement-bearing peer.send request instead of silently accepting notifications', async () => {
    const receiver = await h.create();
    const probe = await authenticatedProbe(receiver);
    await probe.notify('peer.send', { version: 1, messageId: 'notification-only', to: receiver.self.peerId, content: 'must not accept', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await new Promise(resolve => setImmediate(resolve));
    expect((await receiver.messages()).messages).toEqual([]);
  });
});
