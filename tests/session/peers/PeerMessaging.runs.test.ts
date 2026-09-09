import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

const capabilities = ['message.send', 'message.receive', 'message.wait', 'resource.request'] as const;

describe('root-brokered exact run mailboxes', () => {
  it('routes between workers in different roots and stamps the actual run identity', async () => {
    const first = await h.create();
    const second = await h.create();
    const writer = first.bindRun({ runId: 'writer-attempt-1', alias: 'writer', capabilities: [...capabilities] });
    const builder = second.bindRun({ runId: 'builder-attempt-1', alias: 'builder', capabilities: [...capabilities] });
    expect((await writer.list()).peers.map(peer => peer.peerId)).toContain(builder.self.peerId);
    await writer.send({ to: builder.self.peerId, content: 'build this patch' });
    expect((await builder.messages()).messages[0]).toMatchObject({ from: writer.self.peerId, senderRunId: 'writer-attempt-1', to: builder.self.peerId });
    expect((await first.messages()).messages).toEqual([]);
    expect((await second.messages()).messages).toEqual([]);
  });

  it('routes sibling messages through their root without leaking them into a later run', async () => {
    const root = await h.create();
    const writer = root.bindRun({ runId: 'writer', alias: 'writer', capabilities: [...capabilities] });
    const oldBuilder = root.bindRun({ runId: 'build-1', alias: 'builder', capabilities: [...capabilities] });
    await writer.send({ to: oldBuilder.self.peerId, content: 'old build input' });
    await root.endRun('build-1');
    const nextBuilder = root.bindRun({ runId: 'build-2', alias: 'builder', capabilities: [...capabilities] });
    expect((await nextBuilder.messages()).messages).toEqual([]);
    await expect(writer.send({ to: oldBuilder.self.peerId, content: 'too late' })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
    await expect(oldBuilder.send({ to: writer.self.peerId, content: 'zombie sender' })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
  });

  it('retains accepted custody with TARGET_ENDED when the child ends before consuming', async () => {
    const sender = await h.create();
    const root = await h.create();
    const child = root.bindRun({ runId: 'ending', alias: 'ending', capabilities: [...capabilities] });
    const receipt = await sender.send({ to: child.self.peerId, content: 'arrived before completion' });
    await root.endRun('ending');
    expect(await sender.status(receipt.messageId)).toMatchObject({ acceptedAt: receipt.acceptedAt, outcome: 'TARGET_ENDED' });
  });

  it('intersects delegated capabilities with the owning root policy', async () => {
    const root = await h.create();
    const other = await h.create();
    const reader = root.bindRun({ runId: 'reader', alias: 'reader', capabilities: ['message.receive'] });
    await expect(reader.send({ to: other.self.peerId, content: 'not authorized' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(reader.messages({ waitMs: 10 })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    await expect(reader.list({ scope: 'machine' })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('keeps external and presence-only runs visible without advertising a writable inbox', async () => {
    const root = await h.create();
    const observer = await h.create();
    const external = root.bindRun({ runId: 'external-squad', alias: 'squad', capabilities: [], external: true });
    const entry = (await observer.list()).peers.find(peer => peer.peerId === external.self.peerId);
    expect(entry).toMatchObject({ availability: 'presence_only', capabilities: [] });
    await expect(observer.send({ to: external.self.peerId, content: 'not writable' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('bounds published children and forbids a duplicate run incarnation', async () => {
    const root = await h.create({ limits: { publishedRuns: 2 } });
    root.bindRun({ runId: 'a', alias: 'a', capabilities: [...capabilities] });
    root.bindRun({ runId: 'b', alias: 'b', capabilities: [...capabilities] });
    expect(() => root.bindRun({ runId: 'a', alias: 'again', capabilities: [...capabilities] })).toThrow(/run/i);
    expect(() => root.bindRun({ runId: 'c', alias: 'c', capabilities: [...capabilities] })).toThrow(/capacity|limit/i);
  });
});
