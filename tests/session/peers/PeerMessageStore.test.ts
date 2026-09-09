import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PeerMessageStore } from '../../../src/session/peers/PeerMessageStore.js';
import type { PeerEnvelope } from '../../../src/session/peers/PeerProtocol.js';

let directory: string;
let now: number;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'ah-inbox-')); now = Date.now(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function envelope(overrides: Partial<PeerEnvelope> = {}): PeerEnvelope {
  return {
    version: 1, messageId: 'message-1', from: 'peer-sender', senderInstanceId: 'sender-instance',
    to: 'peer-recipient', recipientInstanceId: 'recipient-instance', content: 'durable content',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
    ...overrides,
  };
}

async function store() {
  const result = new PeerMessageStore({ directory, instanceId: 'recipient-instance', now: () => now });
  await result.initialize();
  return result;
}

describe('durable inbox/outbox and context journal', () => {
  it('deduplicates a replayed resource journal event independently for each recipient', async () => {
    const first = await store();
    const event = { type: 'resource' as const, resource: 'machine/build', resourceCursor: '7', requestId: 'ticket', state: 'reserved', epoch: 1, to: 'peer-recipient' };
    const original = await first.appendResourceEvent(event);
    const reopened = await store();
    expect(await reopened.appendResourceEvent(event)).toEqual(original);
    await reopened.appendResourceEvent({ ...event, to: 'peer-child' });
    expect((await reopened.readInbox({ to: 'peer-recipient' })).events).toHaveLength(1);
    expect((await reopened.readInbox({ to: 'peer-child' })).events).toHaveLength(1);
  });

  it('consumes a filtered sender without consuming another sender using the same message ID', async () => {
    const first = await store();
    await first.accept(envelope());
    await first.accept(envelope({ senderInstanceId: 'other-instance', from: 'peer-other', content: 'separate message' }));
    await first.readInbox({ to: 'peer-recipient', from: 'peer-sender', consume: true });
    expect(await first.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'consumed' });
    expect(await first.receipt('peer-other', 'message-1', 'peer-recipient')).toMatchObject({ state: 'accepted' });
  });

  it('requires an exact sender when an explicit consumption ID is ambiguous', async () => {
    const first = await store();
    await first.accept(envelope());
    await first.accept(envelope({ senderInstanceId: 'other-instance', from: 'peer-other' }));
    await expect(first.consume('peer-recipient', ['message-1'], async () => {})).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET' });
  });

  it('keeps an idempotent durable worker context journal separate for each recipient', async () => {
    const first = await store();
    await first.accept(envelope());
    const { messages } = await first.readInbox({ to: 'peer-recipient' });
    await first.recordContext('peer-recipient', messages);
    await first.recordContext('peer-recipient', messages);
    const reopened = await store();
    expect(await reopened.recordedContext('peer-recipient')).toEqual(messages);
    expect(await reopened.recordedContext('another-recipient')).toEqual([]);
    await expect(first.recordContext('another-recipient', messages)).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('restores accepted custody and identical retry receipts from disk', async () => {
    const first = await store();
    const accepted = await first.accept(envelope());
    const reopened = await store();
    expect(await reopened.accept(envelope())).toEqual(accepted);
    expect((await reopened.readInbox({ to: 'peer-recipient', consume: false })).messages).toHaveLength(1);
  });

  it('restores pending sender intent before any transport acceptance exists', async () => {
    const first = await store();
    await first.enqueueOutbound(envelope());
    const reopened = await store();
    expect(await reopened.getOutbox('message-1')).toMatchObject({ envelope: { content: 'durable content' }, receipt: { state: 'pending' } });
  });

  it('serializes independent writers without losing messages or assigning duplicate sequence numbers', async () => {
    const first = await store();
    const second = await store();
    await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? first : second).accept(envelope({ messageId: `parallel-${index}` }))));
    const { messages } = await first.readInbox({ to: 'peer-recipient', consume: false });
    expect(messages).toHaveLength(24);
    expect(new Set(messages.map(message => message.sequence)).size).toBe(24);
  });

  it('records consumption only after the context commit and retains custody if recording fails', async () => {
    const first = await store();
    await first.accept(envelope());
    await expect(first.consume('peer-recipient', ['message-1'], async () => { throw new Error('conversation write failed'); })).rejects.toThrow('conversation write failed');
    expect(await first.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'accepted' });
    expect((await first.readInbox({ to: 'peer-recipient', consume: false })).messages).toHaveLength(1);
  });

  it('reconciles a crash between conversation persistence and receipt publication by message ID', async () => {
    const first = await store();
    await first.accept(envelope());
    const recorded = new Set<string>();
    await expect(first.consume('peer-recipient', ['message-1'], async messages => {
      for (const message of messages) recorded.add(message.messageId);
      throw new Error('crash after conversation commit');
    })).rejects.toThrow('crash after conversation commit');
    const reopened = await store();
    await reopened.reconcileConsumption(recorded);
    expect(await reopened.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'consumed' });
    expect((await reopened.readInbox({ to: 'peer-recipient', consume: false })).messages).toEqual([]);
  });

  it('rejects consumption of another recipient’s inbox', async () => {
    const first = await store();
    await first.accept(envelope());
    await expect(first.consume('peer-other', ['message-1'], async () => {})).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('prunes only records beyond retention and preserves unresolved outbound intent', async () => {
    const first = await store();
    await first.accept(envelope());
    await first.consume('peer-recipient', ['message-1'], async () => {});
    await first.enqueueOutbound(envelope({ messageId: 'unresolved' }));
    now += 86_400_001;
    await first.prune();
    expect(await first.getOutbox('unresolved')).toMatchObject({ receipt: { state: 'pending' } });
    expect((await first.readInbox({ to: 'peer-recipient', consume: false })).messages).toEqual([]);
  });

  it('detects corrupt durable state and blocks acceptance instead of resetting the inbox', async () => {
    const first = await store();
    await first.accept(envelope());
    const stateFile = (await readdir(directory)).find(name => name.endsWith('.json'));
    if (!stateFile) throw new Error('Expected durable state file');
    await writeFile(path.join(directory, stateFile), '{"partially-written":');
    await expect(store()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(await readFile(path.join(directory, stateFile), 'utf8')).toBe('{"partially-written":');
  });

  it('writes durable files with private access and atomic replacement', async () => {
    const first = await store();
    await first.accept(envelope());
    for (const name of await readdir(directory)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(directory, name);
      expect(JSON.parse(await readFile(file, 'utf8'))).toBeTypeOf('object');
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });
});
