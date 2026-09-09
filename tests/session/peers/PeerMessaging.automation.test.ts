import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { SessionThreadBudget } from '../../../src/core/agents/SessionThreadBudget.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

describe('bounded automatic collaboration', () => {
  it('requires an automatic response to retain a received message correlation', async () => {
    const policy = { enabled: true, idleBehavior: 'auto' as const };
    const sender = await h.create({ policy });
    const receiver = await h.create({ policy });
    await expect(sender.send({ to: receiver.self.peerId, content: 'reset the chain' }, { automatic: true })).rejects.toMatchObject({ code: 'INVALID_REPLY' });
  });

  it('caps an automatic reply chain at eight without blocking a deliberate new user message', async () => {
    const policy = { enabled: true, scope: 'workspace' as const, idleBehavior: 'auto' as const };
    const first = await h.create({ policy });
    const second = await h.create({ policy });
    let previous = await first.send({ to: second.self.peerId, content: 'initial user message' });
    for (let index = 0; index < 8; index++) {
      const sender = index % 2 === 0 ? second : first;
      const receiver = index % 2 === 0 ? first : second;
      await sender.messages();
      previous = await sender.send({ to: receiver.self.peerId, content: `automatic ${index}`, replyTo: previous.messageId }, { automatic: true });
    }
    await second.messages();
    await expect(second.send({ to: first.self.peerId, content: 'echo loop', replyTo: previous.messageId }, { automatic: true })).rejects.toMatchObject({ code: 'AUTOMATIC_REPLY_LIMIT' });
    await expect(second.send({ to: first.self.peerId, content: 'explicit user continuation' })).resolves.toMatchObject({ state: 'accepted' });
  });

  it('does not authorize automatic messages under the default notify policy', async () => {
    const first = await h.create();
    const second = await h.create();
    await expect(first.send({ to: second.self.peerId, content: 'unrequested automation' }, { automatic: true })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('keeps a live waiting worker charged to the session thread budget', async () => {
    const root = await h.create();
    const child = root.bindRun({ runId: 'waiting-worker', alias: 'waiting', capabilities: ['message.receive', 'message.wait'] });
    const budget = new SessionThreadBudget(() => 2);
    const lease = budget.tryAcquire('waiting-worker');
    const controller = new AbortController();
    const waiting = child.messages({ waitMs: 30_000, signal: controller.signal });
    expect(() => budget.tryAcquire('another-worker')).toThrow(/capacity|thread|limit/i);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    lease.release();
    expect(() => budget.tryAcquire('another-worker')).not.toThrow();
  });
});
