import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

describe('durable peer delivery', () => {
  it('returns accepted only after durable custody and distinguishes viewing from consumption', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'Build when ready', messageId: 'custody-1' });
    expect(receipt).toMatchObject({ messageId: 'custody-1', to: receiver.self.peerId, state: 'accepted' });
    const preview = await receiver.messages({ consume: false });
    expect(preview.messages).toHaveLength(1);
    expect(preview.messages[0]).toMatchObject({ messageId: 'custody-1', from: sender.self.peerId, content: 'Build when ready' });
    expect(await sender.status('custody-1')).toMatchObject({ state: 'accepted' });
    await receiver.messages();
    expect(await sender.status('custody-1')).toMatchObject({ state: 'consumed', consumedAt: expect.any(String) });
    expect((await receiver.messages()).messages).toEqual([]);
  });

  it('deduplicates retries while rejecting a reused ID with a different body', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const input = { to: receiver.self.peerId, content: 'one message', messageId: 'retry-1' };
    const first = await sender.send(input);
    const retry = await sender.send(input);
    expect(retry).toEqual(first);
    await expect(sender.send({ ...input, content: 'different' })).rejects.toMatchObject({ code: 'MESSAGE_ID_CONFLICT' });
    expect((await receiver.messages()).messages).toHaveLength(1);
  });

  it('distinguishes a new user submission from a stable tool retry', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const first = await sender.send({ to: receiver.self.peerId, content: 'same text' });
    const second = await sender.send({ to: receiver.self.peerId, content: 'same text' });
    expect(second.messageId).not.toBe(first.messageId);
    expect((await receiver.messages()).messages).toHaveLength(2);
  });

  it('deduplicates by authenticated sender and recipient, never by a global message ID', async () => {
    const first = await h.create();
    const second = await h.create();
    const receiver = await h.create();
    await first.send({ to: receiver.self.peerId, content: 'first', messageId: 'same-id' });
    await second.send({ to: receiver.self.peerId, content: 'second', messageId: 'same-id' });
    expect((await receiver.messages()).messages.map(message => message.content)).toEqual(['first', 'second']);
  });

  it('preserves per-route send order under concurrent submissions and supplies inbox sequence numbers', async () => {
    const sender = await h.create({ limits: { rateBurst: 100 } });
    const receiver = await h.create({ limits: { rateBurst: 100 } });
    await Promise.all(Array.from({ length: 20 }, (_, index) => sender.send({
      to: receiver.self.peerId, content: String(index), messageId: `ordered-${index}`,
    })));
    const { messages } = await receiver.messages();
    expect(messages.map(message => Number(message.content))).toEqual(Array.from({ length: 20 }, (_, index) => index));
    expect(messages.map(message => message.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('correlates replies with the exact original message and updates the sender receipt', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const original = await sender.send({ to: receiver.self.peerId, content: 'May I build?' });
    await receiver.messages();
    await receiver.send({ to: sender.self.peerId, content: 'Yes, after my current build.', replyTo: original.messageId });
    expect(await sender.status(original.messageId)).toMatchObject({ state: 'replied' });
    expect((await sender.messages()).messages[0]).toMatchObject({ replyTo: original.messageId });
  });

  it('rejects invented or unauthorized reply correlation', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const outsider = await h.create();
    const original = await sender.send({ to: receiver.self.peerId, content: 'private question' });
    await expect(outsider.send({ to: sender.self.peerId, content: 'forged reply', replyTo: original.messageId })).rejects.toMatchObject({ code: 'INVALID_REPLY' });
    await expect(receiver.send({ to: sender.self.peerId, content: 'invented', replyTo: 'missing' })).rejects.toMatchObject({ code: 'INVALID_REPLY' });
  });

  it('recovers receipt changes by durable cursor without treating receipts as incoming instructions', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const receipt = await sender.send({ to: receiver.self.peerId, content: 'check status' });
    const initial = await sender.messages();
    await receiver.messages();
    const later = await sender.messages({ after: initial.cursor });
    expect(later.messages).toEqual([]);
    expect(later.events).toContainEqual(expect.objectContaining({ type: 'receipt', messageId: receipt.messageId, state: 'consumed' }));
    expect((await sender.messages({ after: later.cursor })).events).toEqual([]);
  });

  it('does not execute or retarget unread messages after an incarnation restart', async () => {
    const sender = await h.create();
    const receiver = await h.create({ sessionId: 'recoverable' });
    await sender.send({ to: receiver.self.peerId, content: '!never-run-this', messageId: 'recover-1' });
    const originalInstance = receiver.self.instanceId;
    await receiver.stop();
    const restarted = await h.create({ sessionId: 'recoverable' });
    expect((await restarted.messages()).messages).toEqual([]);
    const recovery = await restarted.recoverUnread({ instanceId: originalInstance });
    expect(recovery).toMatchObject({ recoveryRequired: true, messages: [expect.objectContaining({ messageId: 'recover-1', to: receiver.self.peerId })] });
    expect((await restarted.messages()).messages).toEqual([]);
  });

  it('stores sender pending state before transport failure and reports an honest unresolved outcome', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    await sender.list();
    await receiver.stop();
    await expect(sender.send({ to: receiver.self.peerId, content: 'keep my intent', messageId: 'offline-1' })).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    const status = await sender.status('offline-1');
    expect(['pending', 'unknown', 'rejected']).toContain(status.state);
    expect(status.state).not.toBe('accepted');
  });

  it('writes private state files and leaves message bodies out of discovery', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    await sender.send({ to: receiver.self.peerId, content: 'sensitive collaboration text' });
    const registry = path.join(h.home, 'active-agents');
    const records = await Promise.all((await readdir(registry)).filter(file => file.endsWith('.json')).map(file => readFile(path.join(registry, file), 'utf8')));
    expect(records.join('')).not.toContain('sensitive collaboration text');
    const recovery = await receiver.recoverUnread({ instanceId: receiver.self.instanceId });
    expect(recovery.messages[0].content).toBe('sensitive collaboration text');
  });
});

describe('delivery capacity, expiry and subscriptions', () => {
  it.each([
    ['ASCII', 'x'.repeat(8_000), true],
    ['ASCII overflow', 'x'.repeat(8_001), false],
    ['UTF-8 boundary', '🦊'.repeat(2_000), true],
    ['UTF-8 overflow', '🦊'.repeat(2_001), false],
    ['empty', '', false],
  ])('validates %s by UTF-8 bytes', async (_label, content, valid) => {
    const sender = await h.create();
    const receiver = await h.create();
    const send = sender.send({ to: receiver.self.peerId, content });
    if (valid) await expect(send).resolves.toMatchObject({ state: 'accepted' });
    else await expect(send).rejects.toMatchObject({ code: content ? 'MESSAGE_TOO_LARGE' : 'INVALID_PARAMS' });
  });

  it('rejects overflow without dropping any previously accepted message', async () => {
    const sender = await h.create({ limits: { rateBurst: 100 } });
    const receiver = await h.create({ limits: { rateBurst: 100 } });
    for (let index = 0; index < 32; index++) await sender.send({ to: receiver.self.peerId, content: String(index) });
    await expect(sender.send({ to: receiver.self.peerId, content: 'overflow' })).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    const first = await receiver.messages();
    expect(first.messages).toHaveLength(32);
    expect(first.messages[0].content).toBe('0');
    await expect(sender.send({ to: receiver.self.peerId, content: 'room after consumption' })).resolves.toMatchObject({ state: 'accepted' });
  });

  it('enforces aggregate storage without evicting unresolved records', async () => {
    const sender = await h.create();
    const receiver = await h.create({ limits: { storageBytes: 12_000 } });
    await sender.send({ to: receiver.self.peerId, content: 'x'.repeat(8_000) });
    await expect(sender.send({ to: receiver.self.peerId, content: 'y'.repeat(8_000) })).rejects.toMatchObject({ code: 'QUEUE_FULL' });
    expect((await receiver.messages()).messages[0].content).toBe('x'.repeat(8_000));
  });

  it('applies per-sender rate limits with a bounded burst and replenishment', async () => {
    let now = Date.now();
    const sender = await h.create({ now: () => now });
    const receiver = await h.create({ now: () => now, limits: { rateBurst: 2, ratePerSecond: 1 } });
    await sender.send({ to: receiver.self.peerId, content: 'one' });
    await sender.send({ to: receiver.self.peerId, content: 'two' });
    await expect(sender.send({ to: receiver.self.peerId, content: 'limited' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    now += 1_001;
    await expect(sender.send({ to: receiver.self.peerId, content: 'replenished' })).resolves.toMatchObject({ state: 'accepted' });
  });

  it('expires unread custody while retaining the original acceptance timestamp', async () => {
    let now = Date.now();
    const sender = await h.create({ now: () => now });
    const receiver = await h.create({ now: () => now });
    const accepted = await sender.send({ to: receiver.self.peerId, content: 'short lived', expiresAt: new Date(now + 1_000).toISOString() });
    now += 1_001;
    expect((await receiver.messages()).messages).toEqual([]);
    expect(await sender.status(accepted.messageId)).toMatchObject({ state: 'expired', acceptedAt: accepted.acceptedAt });
  });

  it.each([-1, 3_600_001, Number.NaN])('rejects an invalid expiry offset %s', async offset => {
    const now = Date.now();
    const sender = await h.create({ now: () => now });
    const receiver = await h.create({ now: () => now });
    const expiresAt = Number.isNaN(offset) ? 'not-a-date' : new Date(now + offset).toISOString();
    await expect(sender.send({ to: receiver.self.peerId, content: 'bad expiry', expiresAt })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('wakes an event-driven wait promptly and supports filters without consuming unrelated messages', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const other = await h.create();
    await other.send({ to: receiver.self.peerId, content: 'unrelated' });
    const waiting = receiver.messages({ from: sender.self.peerId, waitMs: 1_000 });
    await sender.send({ to: receiver.self.peerId, content: 'matching' });
    expect((await waiting).messages.map(message => message.content)).toEqual(['matching']);
    expect((await receiver.messages()).messages.map(message => message.content)).toEqual(['unrelated']);
  });

  it('returns a normal timeout, bounds wait duration and aborts without consuming custody', async () => {
    const receiver = await h.create();
    expect(await receiver.messages({ waitMs: 5 })).toMatchObject({ timedOut: true, messages: [] });
    await expect(receiver.messages({ waitMs: 30_001 })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    const controller = new AbortController();
    const waiting = receiver.messages({ waitMs: 30_000, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('settles pending waits on shutdown and makes repeated cleanup safe', async () => {
    const receiver = await h.create();
    const waiting = receiver.messages({ waitMs: 30_000 });
    const observed = expect(waiting).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    await Promise.all([receiver.stop(), receiver.stop()]);
    await observed;
  });

  it('isolates a failing UI subscriber and never lets it undo acceptance', async () => {
    const sender = await h.create();
    const receiver = await h.create();
    const listener = vi.fn(() => { throw new Error('renderer unavailable'); });
    const unsubscribe = receiver.subscribe(listener);
    await expect(sender.send({ to: receiver.self.peerId, content: 'durable anyway' })).resolves.toMatchObject({ state: 'accepted' });
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    expect((await receiver.messages()).messages[0].content).toBe('durable anyway');
  });
});
