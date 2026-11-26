import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canUpdateReceipt, PEER_RECEIPT_LIFECYCLE, PeerMessageStore } from '../../../src/session/peers/PeerMessageStore.js';
import type { PeerEnvelope, PeerReceiptState } from '../../../src/session/peers/PeerProtocol.js';
import { reachableStates, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

let directory: string;
let now: number;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'ah-receipt-sm-')); now = Date.now(); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

const STATES: readonly PeerReceiptState[] = ['pending', 'unknown', 'accepted', 'consumed', 'replied', 'rejected', 'expired'];

/** Characterises the merge semantics `recordReceipt` had before the lifecycle table existed. */
const MERGE_ALLOWED: Record<PeerReceiptState, readonly PeerReceiptState[]> = {
  pending: ['unknown', 'accepted', 'consumed', 'replied', 'rejected', 'expired'],
  unknown: ['pending', 'accepted', 'consumed', 'replied', 'rejected', 'expired'],
  accepted: ['consumed', 'replied', 'expired'],
  consumed: ['replied'],
  replied: [],
  rejected: [],
  expired: [],
};

function envelope(overrides: Partial<PeerEnvelope> = {}): PeerEnvelope {
  return {
    version: 1, messageId: 'message-1', from: 'peer-sender', senderInstanceId: 'sender-instance',
    to: 'peer-recipient', recipientInstanceId: 'recipient-instance', content: 'durable content',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
    ...overrides,
  };
}

async function store(): Promise<PeerMessageStore> {
  const result = new PeerMessageStore({ directory, instanceId: 'recipient-instance', now: () => now });
  await result.initialize();
  return result;
}

async function outboxAt(first: PeerMessageStore, state: PeerReceiptState): Promise<void> {
  await first.enqueueOutbound(envelope());
  if (state !== 'pending') await first.recordReceipt('peer-sender', 'message-1', 'peer-recipient', { messageId: 'message-1', to: 'peer-recipient', state, cursor: '0' });
  expect((await first.getOutbox('message-1'))?.receipt.state).toBe(state);
}

describe('PEER_RECEIPT_LIFECYCLE transition table', () => {
  it('is exactly the merge semantics recordReceipt has always applied', () => {
    const declared = Object.fromEntries(STATES.map(state => [state, Object.keys(PEER_RECEIPT_LIFECYCLE.transitions[state])]));
    expect(declared).toEqual(MERGE_ALLOWED);
    for (const from of STATES) {
      for (const to of STATES) expect(canUpdateReceipt(from, to), `${from} -> ${to}`).toBe(from === to || MERGE_ALLOWED[from].includes(to));
    }
  });

  it('names each event after the state it enters', () => {
    for (const edges of Object.values(PEER_RECEIPT_LIFECYCLE.transitions)) {
      for (const [event, to] of Object.entries(edges)) expect(to).toBe(event);
    }
  });

  it('ends in replied, rejected or expired and reaches every state from pending', () => {
    expect(terminalStates(PEER_RECEIPT_LIFECYCLE)).toEqual(['replied', 'rejected', 'expired']);
    expect(reachableStates(PEER_RECEIPT_LIFECYCLE)).toEqual(new Set(STATES));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(PEER_RECEIPT_LIFECYCLE, STATES, { seeds: 50, steps: 30 });
  });
});

describe('recordReceipt merge semantics (7x7 characterisation)', () => {
  const pairs = STATES.flatMap(from => STATES.filter(to => to !== from).map(to => [from, to] as const));

  it.each(pairs)('%s <- %s', async (from, to) => {
    const first = await store();
    await outboxAt(first, from);
    const cursor = await first.cursor();
    const merged = await first.recordReceipt('peer-sender', 'message-1', 'peer-recipient', { messageId: 'message-1', to: 'peer-recipient', state: to, cursor: '0' });
    const allowed = MERGE_ALLOWED[from].includes(to);
    expect(merged.state).toBe(allowed ? to : from);
    expect((await first.getOutbox('message-1'))?.receipt.state).toBe(allowed ? to : from);
    expect(Number(await first.cursor())).toBe(Number(cursor) + (allowed ? 1 : 0));
  });

  it.each(STATES)('applies a same-state field update in %s and ignores an identical replay', async state => {
    const first = await store();
    await outboxAt(first, state);
    const receipt = { messageId: 'message-1', to: 'peer-recipient', state, cursor: '0', outcome: 'NOTE' };
    expect(await first.recordReceipt('peer-sender', 'message-1', 'peer-recipient', receipt)).toMatchObject({ state, outcome: 'NOTE' });
    const cursor = await first.cursor();
    await first.recordReceipt('peer-sender', 'message-1', 'peer-recipient', receipt);
    expect(await first.cursor()).toBe(cursor);
  });
});

describe('local inbox receipt transitions', () => {
  it('does not regress a reply that lands while the message is being consumed', async () => {
    const first = await store();
    await first.accept(envelope());
    await first.consume('peer-recipient', ['message-1'], async () => {
      await first.markReplied('peer-sender', 'message-1', 'peer-recipient');
    });
    expect(await first.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'replied' });
    expect((await first.readInbox({ to: 'peer-recipient', consume: false })).messages).toEqual([]);
  });

  it('keeps an expired inbox receipt terminal when a late reply is sent, matching what the sender accepts', async () => {
    const first = await store();
    await first.accept(envelope());
    now += 600_001;
    expect(await first.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'expired' });
    await first.markReplied('peer-sender', 'message-1', 'peer-recipient');
    expect(await first.receipt('peer-sender', 'message-1', 'peer-recipient')).toMatchObject({ state: 'expired' });
  });

  it('moves accepted and consumed messages to replied once', async () => {
    const first = await store();
    await first.accept(envelope());
    await first.accept(envelope({ messageId: 'message-2' }));
    await first.consume('peer-recipient', ['message-2'], async () => {});
    for (const messageId of ['message-1', 'message-2']) {
      await first.markReplied('peer-sender', messageId, 'peer-recipient');
      const cursor = await first.cursor();
      await first.markReplied('peer-sender', messageId, 'peer-recipient');
      expect(await first.cursor()).toBe(cursor);
      expect(await first.receipt('peer-sender', messageId, 'peer-recipient')).toMatchObject({ state: 'replied' });
    }
  });

  it('loads a persisted store holding every receipt state, including combinations the table would not produce', async () => {
    const first = await store();
    await first.accept(envelope());
    const file = path.join(directory, 'messages.json');
    const persisted = JSON.parse(await readFile(file, 'utf8')) as { inbox: Array<{ receipt: { state: string }; consumer?: string }> };
    const template = persisted.inbox[0]!;
    persisted.inbox = STATES.map((state, index) => ({
      ...structuredClone(template),
      key: JSON.stringify(['sender-instance', `message-${index}`, 'peer-recipient']),
      envelope: { ...structuredClone((template as unknown as { envelope: PeerEnvelope }).envelope), messageId: `message-${index}` },
      receipt: { ...template.receipt, messageId: `message-${index}`, state },
      consumer: 'stale-consumer',
    }));
    await writeFile(file, JSON.stringify(persisted));
    const reopened = await store();
    await expect(reopened.recoverUnread()).resolves.toHaveLength(1);
    await expect(reopened.markReplied('peer-sender', 'message-5', 'peer-recipient')).resolves.toBeUndefined();
    expect(await reopened.receipt('peer-sender', 'message-5', 'peer-recipient')).toMatchObject({ state: 'rejected' });
  });
});
