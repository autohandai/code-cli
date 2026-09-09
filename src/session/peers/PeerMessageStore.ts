import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile, withFileLock } from '../../utils/atomicFile.js';
import { PeerError, type PeerEnvelope, type PeerEvent, type PeerMessage, type PeerReceipt } from './PeerProtocol.js';
import { resolvePeerLimits, type PeerLimits } from './PeerSettings.js';
import { ensurePrivatePeerDirectory, readPrivatePeerFile } from './PeerStorage.js';

const idSchema = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const dateSchema = z.string().refine(value => Number.isFinite(Date.parse(value)));
const envelopeSchema = z.object({
  version: z.literal(1), messageId: idSchema, from: idSchema, senderInstanceId: idSchema,
  senderRunId: idSchema.optional(), senderAlias: z.string().max(128).optional(), senderProject: z.string().max(256).optional(),
  to: idSchema, recipientInstanceId: idSchema, recipientRunId: idSchema.optional(),
  content: z.string().min(1), topic: z.string().max(256).optional(), replyTo: idSchema.optional(),
  correlationId: idSchema.optional(), automaticDepth: z.number().int().min(0).max(64).optional(),
  createdAt: dateSchema, expiresAt: dateSchema,
});
export const peerMessageSchema = envelopeSchema.extend({ sequence: z.number().int().positive() });
const messageSchema = peerMessageSchema;
export const peerReceiptSchema = z.object({
  messageId: idSchema, from: idSchema.optional(), to: idSchema,
  state: z.enum(['pending', 'accepted', 'consumed', 'replied', 'rejected', 'expired', 'unknown']),
  cursor: z.string(), acceptedAt: dateSchema.optional(), consumedAt: dateSchema.optional(), repliedAt: dateSchema.optional(), outcome: z.string().optional(),
});
const receiptSchema = peerReceiptSchema;
const eventSchema = z.object({
  type: z.enum(['message', 'receipt', 'resource']), cursor: z.string(), createdAt: z.number(),
  messageId: z.string().optional(), from: z.string().optional(), to: z.string().optional(),
  state: z.string().optional(), resource: z.string().optional(), resourceCursor: z.string().optional(), requestId: z.string().optional(), epoch: z.number().optional(),
  receipt: receiptSchema.optional(),
});
const storeSchema = z.object({
  version: z.literal(1), instanceId: idSchema, sequence: z.number().int().nonnegative(), cursor: z.number().int().nonnegative(),
  inbox: z.array(z.object({ key: z.string(), envelope: messageSchema, receipt: receiptSchema, updatedAt: z.number(), contextPrepared: z.boolean().optional(), consumer: z.string().optional() })),
  outbox: z.array(z.object({ envelope: envelopeSchema, receipt: receiptSchema, updatedAt: z.number() })),
  events: z.array(eventSchema),
  contexts: z.array(z.object({ key: z.string(), message: messageSchema, recordedAt: z.number() })).default([]),
});
type StoreState = z.infer<typeof storeSchema>;
type InboxEntry = StoreState['inbox'][number];
export type PeerOutboxEntry = StoreState['outbox'][number];
export type PeerMessageSelection = string | Pick<PeerMessage, 'messageId' | 'from'>;

export interface PeerMessageStoreOptions {
  directory: string;
  instanceId: string;
  now?: () => number;
  limits?: Partial<PeerLimits>;
}

export interface PeerInboxQuery {
  to: string;
  consume?: boolean;
  after?: string;
  from?: string;
  replyTo?: string;
  messageId?: string;
}

export interface PeerInboxResult {
  messages: PeerMessage[];
  events: PeerEvent[];
  cursor: string;
}

function inboxKey(envelope: PeerEnvelope): string {
  return JSON.stringify([envelope.senderInstanceId, envelope.messageId, envelope.to]);
}

function sameEnvelope(left: PeerEnvelope, right: PeerEnvelope): boolean {
  return JSON.stringify(envelopeSchema.parse(left)) === JSON.stringify(envelopeSchema.parse(right));
}

export class PeerMessageStore {
  private directory?: string;
  private readonly now: () => number;
  private readonly limits: PeerLimits;
  private initializePromise?: Promise<void>;

  constructor(private readonly options: PeerMessageStoreOptions) {
    this.now = options.now ?? Date.now;
    this.limits = resolvePeerLimits(options.limits);
  }

  initialize(): Promise<void> {
    this.initializePromise ??= this.initializeStore();
    return this.initializePromise;
  }

  async accept(input: PeerEnvelope): Promise<PeerReceipt> {
    const envelope = this.validateEnvelope(input);
    return this.transaction(state => {
      const existing = state.inbox.find(entry => entry.key === inboxKey(envelope));
      if (existing) {
        if (!sameEnvelope(existing.envelope, envelope)) throw new PeerError('MESSAGE_ID_CONFLICT', 'The message ID already belongs to different content or identity.');
        return { ...existing.receipt };
      }
      if (envelope.recipientInstanceId !== this.options.instanceId) throw new PeerError('TARGET_ENDED', 'This inbox belongs to a different process incarnation.');
      this.checkAutomaticBudget(state, envelope);
      if (Date.parse(envelope.expiresAt) <= this.now()) throw new PeerError('INVALID_PARAMS', 'Message expired before acceptance.');
      if (state.inbox.filter(entry => entry.envelope.to === envelope.to && entry.receipt.state === 'accepted').length >= this.limits.inboxMessages) throw new PeerError('QUEUE_FULL', 'The recipient inbox is full; previously accepted messages have been retained.');
      const receipt: PeerReceipt = { messageId: envelope.messageId, from: envelope.from, to: envelope.to, state: 'accepted', acceptedAt: new Date(this.now()).toISOString(), cursor: String(state.cursor + 1) };
      state.sequence++;
      state.inbox.push({ key: inboxKey(envelope), envelope: { ...envelope, sequence: state.sequence }, receipt, updatedAt: this.now() });
      this.addEvent(state, { type: 'message', messageId: envelope.messageId, from: envelope.from, to: envelope.to, state: 'accepted', receipt });
      this.checkAdmissionCapacity(state);
      return { ...receipt };
    });
  }

  async enqueueOutbound(input: PeerEnvelope): Promise<PeerOutboxEntry> {
    const envelope = this.validateEnvelope(input);
    return this.transaction(state => {
      const existing = state.outbox.find(entry => entry.envelope.messageId === envelope.messageId && entry.envelope.from === envelope.from && entry.envelope.to === envelope.to);
      if (existing) {
        if (!sameEnvelope(existing.envelope, envelope)) throw new PeerError('MESSAGE_ID_CONFLICT', 'The originating message ID already belongs to another request.');
        return structuredClone(existing);
      }
      const receipt: PeerReceipt = { messageId: envelope.messageId, from: envelope.from, to: envelope.to, state: 'pending', cursor: String(state.cursor + 1) };
      this.checkAutomaticBudget(state, envelope);
      const entry = { envelope, receipt, updatedAt: this.now() };
      state.outbox.push(entry);
      this.addEvent(state, { type: 'receipt', messageId: envelope.messageId, from: envelope.from, to: envelope.to, state: 'pending', receipt });
      this.checkAdmissionCapacity(state);
      return structuredClone(entry);
    });
  }

  async getOutbox(messageId: string, from?: string, to?: string): Promise<PeerOutboxEntry | undefined> {
    return this.transaction(state => {
      const matches = state.outbox.filter(entry => entry.envelope.messageId === messageId && (!from || entry.envelope.from === from) && (!to || entry.envelope.to === to));
      if (matches.length > 1) throw new PeerError('AMBIGUOUS_TARGET', 'Specify the original recipient for this message ID.');
      return matches[0] ? structuredClone(matches[0]) : undefined;
    });
  }

  async pendingOutbox(from?: string, to?: string): Promise<PeerOutboxEntry[]> {
    return this.transaction(state => structuredClone(state.outbox.filter(entry => (!from || entry.envelope.from === from) && (!to || entry.envelope.to === to) && ['pending', 'unknown'].includes(entry.receipt.state))));
  }

  async recordReceipt(from: string, messageId: string, to: string, receipt: PeerReceipt): Promise<PeerReceipt> {
    return this.transaction(state => {
      const entry = state.outbox.find(candidate => candidate.envelope.from === from && candidate.envelope.to === to && candidate.envelope.messageId === messageId);
      if (!entry) throw new PeerError('UNKNOWN_TARGET', 'The original outbox message is unavailable.');
      const parsed = receiptSchema.safeParse(receipt);
      if (!parsed.success || receipt.to !== to || receipt.messageId !== messageId) throw new PeerError('INVALID_RPC', 'Receipt identity does not match the original message.');
      const incoming = { ...parsed.data, from };
      const ranks = { pending: 0, unknown: 0, accepted: 1, consumed: 2, replied: 3, rejected: 4, expired: 4 };
      if (['replied', 'rejected', 'expired'].includes(entry.receipt.state) && incoming.state !== entry.receipt.state) return { ...entry.receipt };
      if (entry.receipt.state === 'consumed' && ['rejected', 'expired'].includes(incoming.state)) return { ...entry.receipt };
      if (entry.receipt.state === 'accepted' && incoming.state === 'rejected') return { ...entry.receipt };
      if (ranks[incoming.state] < ranks[entry.receipt.state]) return { ...entry.receipt };
      const comparable = { ...incoming, cursor: entry.receipt.cursor };
      if (JSON.stringify(receiptSchema.parse(comparable)) === JSON.stringify(receiptSchema.parse(entry.receipt))) return { ...entry.receipt };
      entry.receipt = { ...entry.receipt, ...incoming, cursor: String(state.cursor + 1) };
      entry.updatedAt = this.now();
      this.addEvent(state, { type: 'receipt', messageId, from, to, state: entry.receipt.state, receipt: entry.receipt });
      return { ...entry.receipt };
    });
  }

  async receipt(from: string, messageId: string, to: string): Promise<PeerReceipt> {
    return this.transaction(state => {
      const entry = state.inbox.find(candidate => candidate.envelope.from === from && candidate.envelope.to === to && candidate.envelope.messageId === messageId);
      if (!entry) throw new PeerError(state.inbox.some(candidate => candidate.envelope.messageId === messageId) ? 'SCOPE_DENIED' : 'UNKNOWN_TARGET', 'No authorized receipt exists for this sender and target.');
      return { ...entry.receipt };
    });
  }

  async readInbox(query: PeerInboxQuery): Promise<PeerInboxResult> {
    const result = await this.transaction(state => {
      const after = this.parseCursor(query.after, state.cursor);
      const events = state.events.filter(event => Number(event.cursor) > after && (event.to === query.to || event.from === query.to)
        && (!query.messageId || event.messageId === query.messageId)
        && (!query.from || event.from === query.from))
        .map(({ createdAt: _createdAt, ...event }) => event);
      const messages = state.inbox.filter(entry => entry.envelope.to === query.to
        && (query.messageId && query.consume === false || entry.receipt.state === 'accepted' && !entry.receipt.outcome && !entry.consumer)
        && (!query.from || entry.envelope.from === query.from) && (!query.replyTo || entry.envelope.replyTo === query.replyTo) && (!query.messageId || entry.envelope.messageId === query.messageId))
        .map(entry => ({ ...entry.envelope }));
      return { messages, events, cursor: String(state.cursor) };
    });
    if (query.consume && result.messages.length > 0) {
      await this.consume(query.to, result.messages, async () => {});
      return { ...result, cursor: await this.cursor() };
    }
    return result;
  }

  async consume(to: string, messageIds: PeerMessageSelection[], recordContext: (messages: PeerMessage[]) => Promise<void>): Promise<void> {
    if (messageIds.length === 0) return;
    const consumer = randomUUID();
    const prepared = await this.transaction(state => {
      const entries = this.selectInbox(state, to, messageIds);
      const ready = entries.filter(entry => entry.receipt.state === 'accepted' && !entry.receipt.outcome);
      if (ready.some(entry => entry.consumer)) throw new PeerError('RESOURCE_BUSY', 'Another recorded context is consuming these inbox messages.');
      for (const entry of ready) { entry.contextPrepared = true; entry.consumer = consumer; }
      return ready.map(entry => ({ ...entry.envelope }));
    });
    if (prepared.length === 0) return;
    try {
      await recordContext(prepared);
      await this.transaction(state => {
        for (const entry of state.inbox.filter(candidate => candidate.consumer === consumer)) {
          this.markConsumed(state, entry);
        }
      });
    } catch (error) {
      await this.transaction(state => {
        for (const entry of state.inbox.filter(candidate => candidate.consumer === consumer)) delete entry.consumer;
      }).catch(() => {});
      throw error;
    }
  }

  async recordContext(to: string, selections: PeerMessageSelection[]): Promise<void> {
    await this.transaction(state => {
      for (const entry of this.selectInbox(state, to, selections)) {
        if (!state.contexts.some(context => context.key === entry.key)) {
          state.contexts.push({ key: entry.key, message: { ...entry.envelope }, recordedAt: this.now() });
        }
      }
    });
  }

  async recordedContext(to: string): Promise<PeerMessage[]> {
    return this.transaction(state => state.contexts.filter(context => context.message.to === to).map(context => ({ ...context.message })));
  }

  async reconcileConsumption(recordedMessageIds: ReadonlySet<string>): Promise<void> {
    await this.transaction(state => {
      for (const entry of state.inbox) {
        const exact = state.contexts.some(context => context.key === entry.key) || recordedMessageIds.has(entry.key);
        const unambiguous = recordedMessageIds.has(entry.envelope.messageId) && state.inbox.filter(candidate => candidate.envelope.messageId === entry.envelope.messageId).length === 1;
        if (entry.contextPrepared && (exact || unambiguous) && entry.receipt.state === 'accepted') this.markConsumed(state, entry);
      }
    });
  }

  async markReplied(from: string, messageId: string, to: string): Promise<void> {
    await this.transaction(state => {
      const entry = state.inbox.find(candidate => candidate.envelope.from === from && candidate.envelope.messageId === messageId && candidate.envelope.to === to);
      if (!entry) throw new PeerError('INVALID_REPLY', 'No authorized incoming message exists for this reply.');
      if (entry.receipt.state === 'replied') return;
      entry.receipt = { ...entry.receipt, state: 'replied', repliedAt: new Date(this.now()).toISOString(), cursor: String(state.cursor + 1) };
      entry.updatedAt = this.now();
      this.addEvent(state, { type: 'receipt', messageId, from, to, state: 'replied', receipt: entry.receipt });
    });
  }

  async findMessage(messageId: string, principal: string): Promise<PeerEnvelope | undefined> {
    return this.transaction(state => {
      const envelopes = [...state.inbox, ...state.outbox].map(entry => entry.envelope)
        .filter(envelope => envelope.messageId === messageId && (envelope.from === principal || envelope.to === principal));
      const distinct = new Map(envelopes.map(envelope => [inboxKey(envelope), envelope]));
      if (distinct.size > 1) throw new PeerError('AMBIGUOUS_TARGET', 'This message ID belongs to more than one authorized conversation.');
      const envelope = [...distinct.values()][0];
      return envelope ? { ...envelope } : undefined;
    });
  }

  async endRecipient(to: string): Promise<void> {
    await this.transaction(state => {
      for (const entry of state.inbox) {
        if (entry.envelope.to !== to || entry.receipt.state !== 'accepted' || entry.receipt.outcome) continue;
        entry.receipt = { ...entry.receipt, outcome: 'TARGET_ENDED', cursor: String(state.cursor + 1) };
        entry.updatedAt = this.now();
        this.addEvent(state, { type: 'receipt', messageId: entry.envelope.messageId, from: entry.envelope.from, to, state: 'accepted', receipt: entry.receipt });
      }
    });
  }

  async recoverUnread(): Promise<PeerMessage[]> {
    return this.transaction(state => state.inbox.filter(entry => entry.receipt.state === 'accepted').map(entry => ({ ...entry.envelope })));
  }

  async incoming(from: string, messageId: string, to: string): Promise<PeerMessage | undefined> {
    return this.transaction(state => {
      const entry = state.inbox.find(candidate => candidate.envelope.from === from && candidate.envelope.messageId === messageId && candidate.envelope.to === to);
      return entry ? { ...entry.envelope } : undefined;
    });
  }

  async readEvents(after: string): Promise<{ events: PeerEvent[]; cursor: string }> {
    return this.transaction(state => {
      const cursor = this.parseCursor(after, state.cursor);
      const events = state.events.filter(event => Number(event.cursor) > cursor).map(({ createdAt: _createdAt, ...event }): PeerEvent => {
        const message = event.type === 'message' ? state.inbox.find(entry => entry.envelope.from === event.from && entry.envelope.to === event.to && entry.envelope.messageId === event.messageId)?.envelope : undefined;
        return { ...event, ...(message ? { message: { ...message } } : {}) };
      });
      return { events, cursor: String(state.cursor) };
    });
  }

  async appendResourceEvent(event: Omit<PeerEvent, 'cursor'>): Promise<PeerEvent> {
    return this.transaction(state => {
      if (event.type !== 'resource') throw new PeerError('INVALID_PARAMS', 'A resource event is required.');
      const previous = event.resourceCursor && state.events.find(candidate => candidate.type === 'resource'
        && candidate.resource === event.resource && candidate.resourceCursor === event.resourceCursor && candidate.to === event.to);
      if (previous) {
        const existing: PeerEvent & { createdAt?: number } = { ...previous };
        delete existing.createdAt;
        return existing;
      }
      return this.addEvent(state, event);
    });
  }

  async prune(): Promise<void> {
    await this.transaction(state => {
      const before = this.now() - this.limits.retentionMs;
      state.inbox = state.inbox.filter(entry => entry.updatedAt > before || entry.receipt.state === 'accepted' && !entry.receipt.outcome);
      state.outbox = state.outbox.filter(entry => entry.updatedAt > before || ['pending', 'unknown', 'accepted'].includes(entry.receipt.state));
      state.events = state.events.filter(event => event.createdAt > before);
      state.contexts = state.contexts.filter(context => context.recordedAt > before || state.inbox.some(entry => entry.key === context.key && entry.receipt.state === 'accepted'));
    });
  }

  async cursor(): Promise<string> { return this.transaction(state => String(state.cursor)); }
  async diagnostics(): Promise<{ inbox: number; outbox: number; queuedInbox: number; events: number; bytes: number }> {
    return this.transaction(state => ({ inbox: state.inbox.length, outbox: state.outbox.length, queuedInbox: state.inbox.filter(entry => entry.receipt.state === 'accepted' && !entry.receipt.outcome).length, events: state.events.length, bytes: Buffer.byteLength(JSON.stringify(state)) }));
  }

  private async initializeStore(): Promise<void> {
    this.directory = await ensurePrivatePeerDirectory(this.options.directory);
    await withFileLock(path.join(this.directory, 'store.lock'), async () => {
      const state = await this.loadState();
      if (state === undefined) await this.writeState(this.emptyState());
    }, { waitTimeoutMs: 2_000 });
  }

  private async transaction<T>(operation: (state: StoreState) => T): Promise<T> {
    await this.initialize();
    const directory = this.directory!;
    return withFileLock(path.join(directory, 'store.lock'), async () => {
      const state = await this.loadState();
      if (!state) throw new PeerError('RECOVERY_REQUIRED', 'The initialized inbox state disappeared.');
      const previous = JSON.stringify(state);
      this.expireInbox(state);
      const result = operation(state);
      if (JSON.stringify(state) !== previous) await this.writeState(state);
      return result;
    }, { waitTimeoutMs: 2_000, retryDelayMs: 5 });
  }

  private emptyState(): StoreState {
    return { version: 1, instanceId: this.options.instanceId, sequence: 0, cursor: 0, inbox: [], outbox: [], events: [], contexts: [] };
  }

  private async loadState(): Promise<StoreState | undefined> {
    const raw = await readPrivatePeerFile(path.join(this.directory!, 'messages.json'), this.limits.storageBytes);
    if (raw === undefined) return undefined;
    try {
      const state = storeSchema.parse(JSON.parse(raw));
      if (state.instanceId !== this.options.instanceId) throw new Error('Wrong inbox incarnation.');
      return state;
    } catch { throw new PeerError('RECOVERY_REQUIRED', 'Durable peer state is corrupt or belongs to another incarnation; preserve it for recovery.'); }
  }

  private async writeState(state: StoreState): Promise<void> {
    const serialized = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(serialized) > this.limits.storageBytes) throw new PeerError('QUEUE_FULL', 'Peer storage is full; existing custody has been retained.');
    await atomicWriteFile(path.join(this.directory!, 'messages.json'), serialized);
  }

  private checkAdmissionCapacity(state: StoreState): void {
    const unresolved = state.inbox.filter(entry => entry.receipt.state === 'accepted').length + state.outbox.filter(entry => ['pending', 'unknown', 'accepted'].includes(entry.receipt.state)).length;
    if (Buffer.byteLength(JSON.stringify(state)) + unresolved * 2_048 > this.limits.storageBytes) throw new PeerError('QUEUE_FULL', 'Peer storage is full, including space reserved for durable receipt transitions.');
  }

  private checkAutomaticBudget(state: StoreState, envelope: PeerEnvelope): void {
    if (!envelope.automaticDepth) return;
    const identities = new Set([...state.inbox, ...state.outbox]
      .filter(entry => entry.envelope.automaticDepth && entry.envelope.correlationId === envelope.correlationId)
      .map(entry => JSON.stringify([entry.envelope.from, entry.envelope.to, entry.envelope.messageId])));
    identities.add(JSON.stringify([envelope.from, envelope.to, envelope.messageId]));
    if (identities.size > this.limits.automaticReplies) throw new PeerError('AUTOMATIC_REPLY_LIMIT', 'This conversation reached its automatic message budget; continue deliberately from the user composer.');
  }

  private validateEnvelope(value: PeerEnvelope): PeerEnvelope {
    const parsed = envelopeSchema.safeParse(value);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid peer message envelope.');
    if (Buffer.byteLength(parsed.data.content) > this.limits.messageBytes) throw new PeerError('MESSAGE_TOO_LARGE', `Peer content exceeds ${this.limits.messageBytes} UTF-8 bytes.`);
    const lifetime = Date.parse(parsed.data.expiresAt) - Date.parse(parsed.data.createdAt);
    if (lifetime <= 0 || lifetime > this.limits.maxExpiryMs || Date.parse(parsed.data.expiresAt) > this.now() + this.limits.maxExpiryMs) throw new PeerError('INVALID_PARAMS', 'Message expiry is outside the allowed lifetime.');
    return parsed.data;
  }

  private addEvent(state: StoreState, event: Omit<PeerEvent, 'cursor'>): PeerEvent {
    state.cursor++;
    const persisted = { ...event, cursor: String(state.cursor), createdAt: this.now() };
    state.events.push(persisted);
    return { ...event, cursor: persisted.cursor };
  }

  private markConsumed(state: StoreState, entry: InboxEntry): void {
    delete entry.consumer;
    entry.contextPrepared = false;
    entry.receipt = { ...entry.receipt, state: 'consumed', consumedAt: new Date(this.now()).toISOString(), cursor: String(state.cursor + 1) };
    entry.updatedAt = this.now();
    this.addEvent(state, { type: 'receipt', messageId: entry.envelope.messageId, from: entry.envelope.from, to: entry.envelope.to, state: 'consumed', receipt: entry.receipt });
  }

  private selectInbox(state: StoreState, to: string, selections: PeerMessageSelection[]): InboxEntry[] {
    const selected = new Map<string, InboxEntry>();
    for (const selection of selections) {
      const messageId = typeof selection === 'string' ? selection : selection.messageId;
      const matches = state.inbox.filter(entry => entry.envelope.to === to && entry.envelope.messageId === messageId
        && (typeof selection === 'string' || entry.envelope.from === selection.from));
      if (!matches.length) throw new PeerError('SCOPE_DENIED', 'Messages do not all belong to this inbox.');
      if (matches.length > 1) throw new PeerError('AMBIGUOUS_TARGET', 'Specify the exact sender for this message ID.');
      selected.set(matches[0].key, matches[0]);
    }
    return [...selected.values()];
  }

  private expireInbox(state: StoreState): void {
    for (const entry of state.inbox) {
      if (entry.receipt.state !== 'accepted' || Date.parse(entry.envelope.expiresAt) > this.now() || entry.consumer) continue;
      entry.receipt = { ...entry.receipt, state: 'expired', cursor: String(state.cursor + 1) };
      entry.updatedAt = this.now();
      this.addEvent(state, { type: 'receipt', messageId: entry.envelope.messageId, from: entry.envelope.from, to: entry.envelope.to, state: 'expired', receipt: entry.receipt });
    }
  }

  private parseCursor(cursor: string | undefined, latest: number): number {
    if (cursor === undefined) return 0;
    if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor)) || Number(cursor) > latest) throw new PeerError('INVALID_PARAMS', 'Invalid peer event cursor.');
    return Number(cursor);
  }
}
