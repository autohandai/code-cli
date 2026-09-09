import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile } from '../../utils/atomicFile.js';
import { ActiveAgentRegistry, ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS, type ActiveAgentActivity } from '../ActiveAgentRegistry.js';
import { PeerDirectory, type PeerListQuery, type PeerListResult, type PeerRoute } from './PeerDirectory.js';
import { createTransportIdentity } from './PeerIdentity.js';
import { LocalPeerTransport, type AuthenticatedPeer, type PeerSecurityEvidence } from './LocalPeerTransport.js';
import { PeerMessageStore, type PeerInboxResult, type PeerMessageSelection } from './PeerMessageStore.js';
import { isPeerObject, PeerError, type PeerAdvertisement, type PeerCapability, type PeerDescriptor, type PeerEnvelope, type PeerEvent, type PeerMessage, type PeerReceipt, type PeerScope } from './PeerProtocol.js';
import { assertPeerScope, defaultPeerAlias, peerIdFor, peerScopeIncludes, resolvePeerScope, safePeerLabel, type PeerScopeIdentity } from './PeerScope.js';
import { resolvePeerCommunicationSettings, type PeerCommunicationSettings, type PeerLimits, type ResolvedPeerCommunicationSettings } from './PeerSettings.js';
import { ensurePrivatePeerDirectory, readPrivatePeerFile } from './PeerStorage.js';

export type { PeerListQuery, PeerListResult } from './PeerDirectory.js';
export type { PeerDescriptor, PeerEvent, PeerMessage, PeerReceipt } from './PeerProtocol.js';

export interface PeerMessagingOptions {
  home: string;
  workspaceRoot: string;
  sessionId: string;
  alias?: string;
  policy?: PeerCommunicationSettings;
  limits?: Partial<PeerLimits>;
  coordinationDirectory?: string;
  now?: () => number;
  activity?: () => Pick<ActiveAgentActivity, 'phase'> & Partial<ActiveAgentActivity>;
  heartbeatManagedExternally?: boolean;
}

export interface PeerSendInput {
  to: string;
  content: string;
  messageId?: string;
  topic?: string;
  replyTo?: string;
  expiresAt?: string;
}
export interface PeerSendOptions { automatic?: boolean; }
export interface PeerMessagesQuery {
  consume?: boolean;
  after?: string;
  from?: string;
  replyTo?: string;
  messageId?: string;
  waitMs?: number;
  signal?: AbortSignal;
}
export interface PeerMessagesResult extends PeerInboxResult { timedOut?: boolean; }
export interface PeerRunBinding {
  runId: string;
  alias: string;
  capabilities: PeerCapability[];
  scope?: PeerScope;
  external?: boolean;
}
export interface PeerClient {
  readonly self: PeerDescriptor;
  readonly policy: ResolvedPeerCommunicationSettings;
  list(query?: PeerListQuery): Promise<PeerListResult>;
  cachedPeers(scope?: PeerScope): PeerDescriptor[];
  resolve(target: string): Promise<PeerDescriptor>;
  send(input: PeerSendInput, options?: PeerSendOptions): Promise<PeerReceipt>;
  messages(query?: PeerMessagesQuery): Promise<PeerMessagesResult>;
  status(messageId: string, to?: string): Promise<PeerReceipt>;
  subscribe(listener: (event: PeerEvent) => void): () => void;
  consumeMessages(messageIds: PeerMessageSelection[], recordContext: (messages: PeerMessage[]) => Promise<void>): Promise<void>;
  recordContext(messages: PeerMessageSelection[]): Promise<void>;
}

interface LocalPrincipal { descriptor: PeerDescriptor; scope: PeerScope; ended: boolean; }
const identifier = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const sendSchema = z.object({ to: identifier, content: z.string().min(1), messageId: identifier.optional(), topic: z.string().max(256).optional(), replyTo: identifier.optional(), expiresAt: z.string().optional() }).strict();
const wireSendSchema = sendSchema.extend({ version: z.literal(1), messageId: identifier, createdAt: z.string().optional(), senderRunId: identifier.optional(), correlationId: identifier.optional(), automaticDepth: z.number().int().min(0).max(64).optional() }).strict();

export class PeerMessaging implements PeerClient {
  readonly policy: ResolvedPeerCommunicationSettings;
  private readonly identity = createTransportIdentity();
  private readonly now: () => number;
  private readonly root: LocalPrincipal;
  private readonly runs = new Map<string, LocalPrincipal>();
  private readonly registry: ActiveAgentRegistry;
  private readonly directory: PeerDirectory;
  private readonly transport: LocalPeerTransport;
  private readonly store: PeerMessageStore;
  private readonly stateDirectory: string;
  private scopeIdentity: PeerScopeIdentity;
  private advertisement?: PeerAdvertisement;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private started = false;
  private stopped = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private publishChain: Promise<void> = Promise.resolve();
  private eventChain: Promise<void> = Promise.resolve();
  private eventCursor = '0';
  private readonly listeners = new Set<{ principal: string; callback: (event: PeerEvent) => void }>();
  private readonly waiters = new Set<() => void>();
  private readonly sends = new Map<string, Promise<unknown>>();
  private readonly rates = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly options: PeerMessagingOptions) {
    this.policy = resolvePeerCommunicationSettings({ sessions: { communication: { ...options.policy, ...(options.alias ? { alias: options.alias } : {}), limits: { ...options.policy?.limits, ...options.limits } } } });
    this.now = options.now ?? Date.now;
    this.scopeIdentity = { workspaceId: path.resolve(options.workspaceRoot) };
    const project = safePeerLabel(path.basename(options.workspaceRoot));
    const capabilities: PeerCapability[] = this.policy.enabled ? ['message.send', 'message.receive', 'message.wait', 'resource.request', ...(this.policy.allowResourceControl ? ['resource.control' as const] : [])] : [];
    this.root = { scope: this.policy.scope, ended: false, descriptor: {
      peerId: peerIdFor(this.identity.instanceId), instanceId: this.identity.instanceId, sessionId: options.sessionId,
      alias: this.policy.alias ?? defaultPeerAlias(project, this.identity.instanceId), project, kind: 'root', activity: 'idle',
      availability: this.policy.enabled ? 'available' : 'presence_only', capabilities,
    } };
    const namespace = path.resolve(options.coordinationDirectory ?? this.policy.coordinationDirectory ?? options.home);
    this.registry = new ActiveAgentRegistry(path.join(namespace, 'active-agents'), { now: () => new Date(this.now()) });
    this.stateDirectory = path.join(options.home, 'peer-messages', this.identity.instanceId);
    this.store = new PeerMessageStore({ directory: this.stateDirectory, instanceId: this.identity.instanceId, now: this.now, limits: this.policy.limits });
    this.directory = new PeerDirectory({ registry: this.registry, self: () => this.self, scope: () => this.scopeIdentity,
      policyScope: this.policy.scope, pageSize: this.policy.limits.directoryPageSize,
      localPeers: () => [this.self, ...[...this.runs.values()].filter(run => !run.ended).map(run => run.descriptor)],
      queryChildren: async ad => (await this.transport.connect(ad)).request('peer.directory', { version: 1 }),
    });
    this.transport = new LocalPeerTransport({ directory: path.join(namespace, 'peer-runtime'), identity: this.identity,
      lookupIdentity: instanceId => this.directory.advertisement(instanceId),
      onRequest: (method, params, peer) => this.handleRequest(method, params, peer),
      capabilities, limits: this.policy.limits,
    });
  }

  get self(): PeerDescriptor {
    return { ...structuredClone(this.root.descriptor), ...this.scopeIdentity, activity: safePeerLabel(this.options.activity?.().phase ?? 'idle') };
  }

  start(): Promise<void> {
    if (this.stopped) return Promise.reject(new PeerError('PEER_OFFLINE', 'This peer incarnation has stopped.'));
    this.startPromise ??= this.initialize();
    return this.startPromise;
  }

  stop(): Promise<void> {
    this.stopped = true;
    for (const wake of this.waiters) wake();
    this.stopPromise ??= this.shutdown();
    return this.stopPromise;
  }

  getAdvertisement(): PeerAdvertisement | undefined { return this.advertisement ? structuredClone(this.advertisement) : undefined; }
  getSecurityEvidence(): PeerSecurityEvidence | undefined { return this.transport.securityEvidence; }
  cachedPeers(scope: PeerScope = 'workspace'): PeerDescriptor[] { assertPeerScope(scope, this.policy.scope); return this.directory.cached(scope).filter(peer => peer.peerId !== this.self.peerId); }
  list(query: PeerListQuery = {}): Promise<PeerListResult> { return this.listFor(this.root, query); }
  async resolve(target: string): Promise<PeerDescriptor> { this.assertActive(this.root); return (await this.directory.resolve(target)).descriptor; }
  async isReachable(target: string): Promise<boolean> {
    try {
      const route = await this.directory.resolve(target);
      if (route.descriptor.instanceId === this.identity.instanceId) return !this.localPrincipal(target).ended;
      if (!route.advertisement) return false;
      await (await this.transport.connect(route.advertisement)).request('peer.directory', { version: 1 });
      return true;
    } catch { return false; }
  }
  send(input: PeerSendInput, options?: PeerSendOptions): Promise<PeerReceipt> { return this.sendFor(this.root, input, options); }
  messages(query?: PeerMessagesQuery): Promise<PeerMessagesResult> { return this.messagesFor(this.root, query); }
  status(messageId: string, to?: string): Promise<PeerReceipt> { return this.statusFor(this.root, messageId, to); }
  subscribe(callback: (event: PeerEvent) => void): () => void { return this.subscribeFor(this.root, callback); }
  async recordResourceEvent(to: string, event: Omit<PeerEvent, 'cursor' | 'to'>): Promise<void> {
    const principal = to === this.self.peerId ? this.root : [...this.runs.values()].find(run => run.descriptor.peerId === to);
    if (!principal || principal.ended || this.stopped) return;
    await this.store.appendResourceEvent({ ...event, type: 'resource', to });
    await this.flushEvents();
  }
  consumeMessages(messageIds: PeerMessageSelection[], recordContext: (messages: PeerMessage[]) => Promise<void>): Promise<void> {
    return this.consumeFor(this.root, messageIds, recordContext);
  }
  recordContext(messages: PeerMessageSelection[]): Promise<void> {
    this.assertActive(this.root, 'message.receive');
    return this.store.recordContext(this.self.peerId, messages);
  }

  bindRun(binding: PeerRunBinding): PeerClient {
    this.assertActive(this.root);
    if (!identifier.safeParse(binding.runId).success || this.runs.has(binding.runId) || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(binding.alias)) throw new PeerError('INVALID_PARAMS', 'The run identity or alias is invalid, or the run has already been bound in this incarnation.');
    if ([...this.runs.values()].filter(run => !run.ended).length >= this.policy.limits.publishedRuns || this.runs.size >= 4_096) throw new PeerError('QUEUE_FULL', 'Published run capacity limit reached.');
    const scope = binding.scope ?? this.policy.scope;
    assertPeerScope(scope, this.policy.scope);
    const capabilities = binding.external ? [] : this.root.descriptor.capabilities.filter(cap => binding.capabilities.includes(cap));
    const principal: LocalPrincipal = { scope, ended: false, descriptor: { ...this.root.descriptor,
      peerId: peerIdFor(this.identity.instanceId, binding.runId), runId: binding.runId, alias: safePeerLabel(binding.alias), kind: 'run', capabilities,
      availability: capabilities.includes('message.receive') ? 'available' : 'presence_only',
    } };
    this.runs.set(binding.runId, principal);
    this.directory.remember(this.directory.localRoute(principal.descriptor, this.advertisement));
    return {
      get self() { return structuredClone(principal.descriptor); },
      policy: { ...this.policy, scope }, cachedPeers: (requested = 'workspace') => { assertPeerScope(requested, scope); return this.directory.cached(requested).filter(peer => peer.peerId !== principal.descriptor.peerId); },
      list: query => this.listFor(principal, query),
      resolve: async target => { this.assertActive(principal); return (await this.directory.resolve(target, principal.descriptor.peerId, scope)).descriptor; },
      send: (input, options) => this.sendFor(principal, input, options), messages: query => this.messagesFor(principal, query),
      status: (messageId, to) => this.statusFor(principal, messageId, to), subscribe: listener => this.subscribeFor(principal, listener),
      consumeMessages: (ids, commit) => this.consumeFor(principal, ids, commit),
      recordContext: messages => { this.assertActive(principal, 'message.receive'); return this.store.recordContext(principal.descriptor.peerId, messages); },
    };
  }

  async endRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.ended) return;
    run.ended = true;
    await this.store.endRecipient(run.descriptor.peerId);
    await this.flushEvents();
    for (const wake of this.waiters) wake();
  }

  async recoverUnread({ instanceId }: { instanceId: string }): Promise<{ recoveryRequired: true; messages: PeerMessage[] }> {
    this.assertActive(this.root);
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(instanceId)) throw new PeerError('INVALID_PARAMS', 'Invalid recovery incarnation.');
    const directory = path.join(this.options.home, 'peer-messages', instanceId);
    const raw = await readPrivatePeerFile(path.join(directory, 'identity.json'), 8_192);
    let identity: unknown;
    try { identity = raw ? JSON.parse(raw) : undefined; } catch { throw new PeerError('RECOVERY_REQUIRED', 'Recovery identity is corrupt.'); }
    if (!isPeerObject(identity) || identity.instanceId !== instanceId || identity.sessionId !== this.options.sessionId) throw new PeerError('SCOPE_DENIED', 'Recovery belongs to a different saved session.');
    const store = instanceId === this.identity.instanceId ? this.store : new PeerMessageStore({ directory, instanceId, limits: this.policy.limits, now: this.now });
    return { recoveryRequired: true, messages: await store.recoverUnread() };
  }

  async diagnostics() { return { ...await this.store.diagnostics(), ...this.transport.diagnostics(), subscribers: this.listeners.size, waits: this.waiters.size }; }

  private async initialize(): Promise<void> {
    if (!this.policy.enabled) return;
    this.scopeIdentity = await resolvePeerScope(this.options.workspaceRoot);
    await ensurePrivatePeerDirectory(this.options.home);
    await this.store.initialize();
    await atomicWriteFile(path.join(this.stateDirectory, 'identity.json'), JSON.stringify({ version: 1, instanceId: this.identity.instanceId, sessionId: this.options.sessionId }));
    const advertisement = await this.transport.start();
    if (this.stopped) { await this.transport.close(); return; }
    this.advertisement = { ...advertisement, peerId: this.self.peerId, alias: this.self.alias, scope: this.policy.scope, ...this.scopeIdentity };
    this.started = true;
    await this.publishPresence();
    if (!this.stopped && !this.options.heartbeatManagedExternally) {
      this.heartbeat = setInterval(() => { void this.publishPresence().catch(() => {}); }, ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS);
      this.heartbeat.unref?.();
    }
  }

  private async shutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.startPromise?.catch(() => {});
    await this.publishChain.catch(() => {});
    if (this.advertisement) await this.registry.remove(this.options.sessionId, this.identity.instanceId);
    await this.transport.close();
    await Promise.allSettled([...this.sends.values(), this.eventChain]);
    this.advertisement = undefined;
    this.listeners.clear();
  }

  private publishPresence(): Promise<void> {
    const publish = this.publishChain.then(async () => {
      if (this.stopped || !this.advertisement) return;
      const activity = this.options.activity?.();
      const time = new Date(this.now()).toISOString();
      await this.registry.write({ version: 1, pid: process.pid, sessionId: this.options.sessionId,
        workspaceRoot: this.scopeIdentity.workspaceId, projectName: this.self.project, provider: 'peer', model: '', mode: 'interactive',
        status: !activity || activity.phase === 'idle' ? 'idle' : 'working', startedAt: time, updatedAt: time,
        messageCount: 0, contextPercent: 0, tokensUsed: 0, communication: this.advertisement,
        ...(activity ? { activity: { ...activity, pathsWritten: activity.pathsWritten ?? [] } } : {}),
      });
    });
    this.publishChain = publish.catch(() => {});
    return publish;
  }

  private listFor(principal: LocalPrincipal, query: PeerListQuery = {}): Promise<PeerListResult> {
    this.assertActive(principal);
    return this.directory.list(query, principal.descriptor.peerId, principal.scope);
  }

  private assertActive(principal: LocalPrincipal, capability?: PeerCapability): void {
    if (!this.policy.enabled) throw new PeerError('COMMUNICATION_DISABLED', 'Enable sessions.communication to use local peer messaging.');
    if (this.stopped || !this.started) throw new PeerError('PEER_OFFLINE', 'This peer endpoint is not running.');
    if (principal.ended) throw new PeerError('TARGET_ENDED', 'This exact run has ended.');
    if (capability && !principal.descriptor.capabilities.includes(capability)) throw new PeerError('CAPABILITY_DENIED', `The bound principal lacks ${capability}.`);
  }

  private subscribeFor(principal: LocalPrincipal, callback: (event: PeerEvent) => void): () => void {
    const listener = { principal: principal.descriptor.peerId, callback };
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private sendFor(principal: LocalPrincipal, input: PeerSendInput, options: PeerSendOptions = {}): Promise<PeerReceipt> {
    const routeKey = JSON.stringify([principal.descriptor.peerId, input.to]);
    const previous = this.sends.get(routeKey) ?? Promise.resolve();
    const sending = previous.catch(() => {}).then(() => this.submit(principal, input, options));
    this.sends.set(routeKey, sending);
    void sending.finally(() => { if (this.sends.get(routeKey) === sending) this.sends.delete(routeKey); }).catch(() => {});
    return sending;
  }

  private async submit(principal: LocalPrincipal, input: PeerSendInput, options: PeerSendOptions): Promise<PeerReceipt> {
    this.assertActive(principal, 'message.send');
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid peer message fields; sender identity is runtime-owned.');
    if (Buffer.byteLength(input.content) > this.policy.limits.messageBytes) throw new PeerError('MESSAGE_TOO_LARGE', `Content exceeds ${this.policy.limits.messageBytes} UTF-8 bytes.`);
    if (options.automatic && this.policy.idleBehavior !== 'auto') throw new PeerError('CAPABILITY_DENIED', 'Automatic communication requires the configured auto policy.');
    if (options.automatic && !input.replyTo) throw new PeerError('INVALID_REPLY', 'An automatic response must retain the received message ID in replyTo.');
    const route = await this.directory.resolve(input.to, principal.descriptor.peerId, principal.scope, true);
    if (!route.descriptor.capabilities.includes('message.receive')) throw new PeerError('CAPABILITY_DENIED', 'This peer has no writable inbox.');
    const messageId = input.messageId ?? randomUUID();
    const previous = await this.store.getOutbox(messageId, principal.descriptor.peerId, route.descriptor.peerId);
    const reply = input.replyTo ? await this.store.incoming(route.descriptor.peerId, input.replyTo, principal.descriptor.peerId) : undefined;
    if (input.replyTo && !reply) throw new PeerError('INVALID_REPLY', 'Reply correlation must identify a message received from this exact target.');
    const depth = options.automatic ? (reply?.automaticDepth ?? 0) + 1 : 0;
    if (depth > this.policy.limits.automaticReplies) throw new PeerError('AUTOMATIC_REPLY_LIMIT', 'Automatic reply limit reached; wait for deliberate user continuation.');
    const envelope: PeerEnvelope = {
      version: 1, messageId, from: principal.descriptor.peerId, senderInstanceId: this.identity.instanceId,
      ...(principal.descriptor.runId ? { senderRunId: principal.descriptor.runId } : {}), senderAlias: principal.descriptor.alias, senderProject: principal.descriptor.project,
      to: route.descriptor.peerId, recipientInstanceId: route.descriptor.instanceId,
      ...(route.descriptor.runId ? { recipientRunId: route.descriptor.runId } : {}),
      content: input.content, ...(input.topic !== undefined ? { topic: input.topic } : {}), ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      correlationId: reply?.correlationId ?? reply?.messageId ?? messageId, automaticDepth: depth,
      createdAt: previous?.envelope.createdAt ?? new Date(this.now()).toISOString(),
      expiresAt: input.expiresAt ?? previous?.envelope.expiresAt ?? new Date(this.now() + this.policy.limits.expiryMs).toISOString(),
    };
    const entry = await this.store.enqueueOutbound(envelope);
    await this.flushEvents();
    if (!['pending', 'unknown'].includes(entry.receipt.state)) return entry.receipt;
    for (const pending of await this.store.pendingOutbox(envelope.from, envelope.to)) {
      this.assertActive(principal, 'message.send');
      await this.transmit(pending.envelope, route);
      if (pending.envelope.messageId === messageId) break;
    }
    return (await this.store.getOutbox(messageId, envelope.from, envelope.to))!.receipt;
  }

  private async transmit(envelope: PeerEnvelope, route: PeerRoute): Promise<void> {
    try {
      let receipt: unknown;
      if (route.descriptor.instanceId === this.identity.instanceId) {
        const sender = envelope.senderRunId ? this.runs.get(envelope.senderRunId) : this.root;
        if (!sender) throw new PeerError('TARGET_ENDED', 'The sending run has ended.');
        receipt = await this.acceptEnvelope(envelope, sender.descriptor, this.scopeIdentity, sender.scope);
      } else {
        if (!route.advertisement) throw new PeerError('PEER_OFFLINE', 'The exact endpoint is no longer available.');
        const connection = await this.transport.connect(route.advertisement);
        receipt = await connection.request('peer.send', {
          version: 1, messageId: envelope.messageId, to: envelope.to, content: envelope.content,
          createdAt: envelope.createdAt, expiresAt: envelope.expiresAt, ...(envelope.senderRunId ? { senderRunId: envelope.senderRunId } : {}),
          ...(envelope.topic !== undefined ? { topic: envelope.topic } : {}), ...(envelope.replyTo ? { replyTo: envelope.replyTo } : {}),
          correlationId: envelope.correlationId, automaticDepth: envelope.automaticDepth,
        });
      }
      if (!isPeerObject(receipt)) throw new PeerError('INVALID_RPC', 'The peer returned an invalid receipt.');
      await this.store.recordReceipt(envelope.from, envelope.messageId, envelope.to, receipt as unknown as PeerReceipt);
      await this.flushEvents();
      if (envelope.replyTo) {
        await this.store.markReplied(envelope.to, envelope.replyTo, envelope.from);
        await this.flushEvents();
      }
    } catch (error) {
      const code = error instanceof PeerError ? error.code : 'PEER_OFFLINE';
      if (!['PEER_OFFLINE', 'DELIVERY_UNKNOWN', 'INVALID_RPC', 'RECOVERY_REQUIRED'].includes(code)) {
        await this.store.recordReceipt(envelope.from, envelope.messageId, envelope.to, { from: envelope.from, to: envelope.to, messageId: envelope.messageId, state: 'rejected', cursor: '0', outcome: code }).catch(() => {});
        await this.flushEvents();
      }
      throw error instanceof PeerError ? error : new PeerError('PEER_OFFLINE', 'The exact peer endpoint could not be reached; pending intent is retained.');
    }
  }

  private async acceptEnvelope(envelope: PeerEnvelope, sender: PeerDescriptor, senderScope: PeerScopeIdentity, senderPolicy: PeerScope): Promise<PeerReceipt> {
    const principal = this.localPrincipal(envelope.to);
    this.assertActive(principal, 'message.receive');
    if (!sender.capabilities.includes('message.send')) throw new PeerError('CAPABILITY_DENIED', 'The authenticated sender cannot send messages.');
    if (!peerScopeIncludes(principal.scope, this.scopeIdentity, senderScope) || !peerScopeIncludes(senderPolicy, senderScope, this.scopeIdentity)) throw new PeerError('SCOPE_DENIED', 'The run policies do not authorize this delivery scope.');
    if (envelope.replyTo) {
      const original = await this.store.getOutbox(envelope.replyTo, envelope.to, sender.peerId);
      if (!original) throw new PeerError('INVALID_REPLY', 'This reply does not belong to the authenticated conversation.');
      if (envelope.correlationId !== original.envelope.correlationId || (envelope.automaticDepth ?? 0) > 0 && envelope.automaticDepth !== (original.envelope.automaticDepth ?? 0) + 1) throw new PeerError('INVALID_REPLY', 'Reply chain metadata does not match the original message.');
    }
    const previous = await this.store.incoming(sender.peerId, envelope.messageId, envelope.to);
    if (!previous) this.admitRate(sender.peerId);
    const receipt = await this.store.accept(envelope);
    await this.flushEvents();
    return receipt;
  }

  private localPrincipal(peerId: string): LocalPrincipal {
    if (peerId === this.root.descriptor.peerId) return this.root;
    const principal = [...this.runs.values()].find(run => run.descriptor.peerId === peerId);
    if (!principal) throw new PeerError('TARGET_ENDED', 'This exact recipient is not bound to the endpoint.');
    return principal;
  }

  private admitRate(peerId: string): void {
    const now = this.now();
    const bucket = this.rates.get(peerId) ?? { tokens: this.policy.limits.rateBurst, at: now };
    bucket.tokens = Math.min(this.policy.limits.rateBurst, bucket.tokens + Math.max(0, now - bucket.at) * this.policy.limits.ratePerSecond / 1_000);
    bucket.at = now;
    if (bucket.tokens < 1) throw new PeerError('RATE_LIMITED', 'The sender burst is exhausted; retry after replenishment.');
    bucket.tokens--;
    this.rates.delete(peerId);
    this.rates.set(peerId, bucket);
    while (this.rates.size > 4_096) this.rates.delete(this.rates.keys().next().value!);
  }

  private async statusFor(principal: LocalPrincipal, messageId: string, to?: string): Promise<PeerReceipt> {
    this.assertActive(principal);
    const entry = await this.store.getOutbox(messageId, principal.descriptor.peerId, to);
    if (!entry) throw new PeerError('UNKNOWN_TARGET', 'No outgoing message belongs to this principal and ID.');
    try {
      const envelope = entry.envelope;
      const route = await this.directory.resolve(envelope.to, principal.descriptor.peerId, principal.scope);
      const receipt = route.descriptor.instanceId === this.identity.instanceId ? await this.store.receipt(envelope.from, messageId, envelope.to)
        : await (await this.transport.connect(route.advertisement!)).request('peer.status', { messageId, to: envelope.to, ...(principal.descriptor.runId ? { senderRunId: principal.descriptor.runId } : {}) });
      await this.store.recordReceipt(envelope.from, messageId, envelope.to, receipt as PeerReceipt);
      await this.flushEvents();
    } catch (error) {
      if (!(error instanceof PeerError) || !['PEER_OFFLINE', 'TARGET_ENDED', 'UNKNOWN_TARGET', 'DELIVERY_UNKNOWN'].includes(error.code)) throw error;
    }
    return (await this.store.getOutbox(messageId, principal.descriptor.peerId, to))!.receipt;
  }

  private async messagesFor(principal: LocalPrincipal, query: PeerMessagesQuery = {}): Promise<PeerMessagesResult> {
    this.assertActive(principal, query.waitMs ? 'message.wait' : 'message.receive');
    if (query.waitMs !== undefined && (!Number.isInteger(query.waitMs) || query.waitMs < 0 || query.waitMs > 30_000)) throw new PeerError('INVALID_PARAMS', 'Peer waits must be between zero and 30000 milliseconds.');
    if (query.signal?.aborted) throw new DOMException('Peer wait aborted.', 'AbortError');
    const deadline = Date.now() + (query.waitMs ?? 0);
    for (;;) {
      this.assertActive(principal, 'message.receive');
      if (query.signal?.aborted) throw new DOMException('Peer wait aborted.', 'AbortError');
      let wake = () => {};
      const changed = new Promise<void>(resolve => { wake = resolve; });
      this.waiters.add(wake);
      try {
        const result = await this.store.readInbox({ ...query, to: principal.descriptor.peerId, consume: false });
        await this.flushEvents();
        const matchingEvent = result.events.some(event => event.type !== 'message' && (!query.replyTo || event.messageId === query.replyTo));
        if (result.messages.length || matchingEvent || !query.waitMs) {
          if (query.consume !== false && result.messages.length) await this.consumeFor(principal, result.messages, async () => {});
          return { ...result, cursor: await this.store.cursor() };
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) return { ...result, timedOut: true };
        const timer = setTimeout(wake, remaining);
        query.signal?.addEventListener('abort', wake, { once: true });
        if (this.stopped || principal.ended || query.signal?.aborted) wake();
        try { await changed; } finally { clearTimeout(timer); query.signal?.removeEventListener('abort', wake); }
      } finally { this.waiters.delete(wake); }
    }
  }

  private async consumeFor(principal: LocalPrincipal, messageIds: PeerMessageSelection[], commit: (messages: PeerMessage[]) => Promise<void>): Promise<void> {
    this.assertActive(principal, 'message.receive');
    await this.store.consume(principal.descriptor.peerId, messageIds, commit);
    await this.flushEvents();
  }

  private flushEvents(): Promise<void> {
    const flush = this.eventChain.then(async () => {
      const { events, cursor } = await this.store.readEvents(this.eventCursor);
      this.eventCursor = cursor;
      for (const event of events) {
        for (const listener of this.listeners) {
          if (event.to !== listener.principal && event.from !== listener.principal) continue;
          try { listener.callback(structuredClone(event)); } catch { /* UI failure cannot roll back durable custody. */ }
        }
        for (const wake of this.waiters) wake();
      }
    });
    this.eventChain = flush.catch(() => {});
    return flush.then(() => this.forwardReceipts());
  }

  private readonly forwarded = new Map<string, string>();
  private async forwardReceipts(): Promise<void> {
    const { events } = await this.store.readEvents('0');
    const latest = new Map<string, PeerEvent>();
    for (const event of events) {
      if (event.type === 'receipt' && event.receipt && event.from && event.to && (event.to === this.self.peerId || [...this.runs.values()].some(run => run.descriptor.peerId === event.to))) latest.set(JSON.stringify([event.from, event.messageId, event.to]), event);
    }
    for (const [key, event] of latest) {
      if (this.forwarded.get(key) === event.cursor) continue;
      const envelope = await this.store.incoming(event.from!, event.messageId!, event.to!);
      if (!envelope) continue;
      if (envelope.senderInstanceId === this.identity.instanceId) {
        await this.store.recordReceipt(envelope.from, envelope.messageId, envelope.to, event.receipt!);
        this.forwarded.set(key, event.cursor);
        continue;
      }
      try {
        const ad = await this.directory.advertisement(envelope.senderInstanceId);
        if (!ad) continue;
        await (await this.transport.connect(ad)).request('peer.receipt', { receipt: event.receipt });
        this.forwarded.set(key, event.cursor);
      } catch { /* The persisted receipt remains available through peer.status. */ }
    }
    while (this.forwarded.size > 4_096) this.forwarded.delete(this.forwarded.keys().next().value!);
  }

  private async handleRequest(method: string, params: Record<string, unknown>, authenticated: AuthenticatedPeer): Promise<unknown> {
    this.assertActive(this.root);
    if (method === 'peer.read') throw new PeerError('SCOPE_DENIED', 'Remote inbox access is forbidden.');
    if (method.startsWith('resource.')) throw new PeerError('CAPABILITY_DENIED', 'Resource control requires a separately authorized bound coordinator.');
    if (!['peer.directory', 'peer.send', 'peer.status', 'peer.subscribe', 'peer.receipt'].includes(method)) throw new PeerError('METHOD_NOT_FOUND', 'This method is not part of the peer protocol.');
    const route = await this.directory.authenticatedRoute(authenticated.instanceId, authenticated.publicKey);
    if (method === 'peer.directory') return { peers: [...this.runs.values()].filter(run => !run.ended && peerScopeIncludes(run.scope, this.scopeIdentity, route.scope)).map(run => structuredClone(run.descriptor)) };
    if (method === 'peer.receipt') {
      const receipt = params.receipt;
      if (!isPeerObject(receipt) || typeof receipt.from !== 'string' || typeof receipt.to !== 'string' || typeof receipt.messageId !== 'string') throw new PeerError('INVALID_PARAMS', 'Malformed delivery receipt.');
      const original = await this.store.getOutbox(receipt.messageId, receipt.from, receipt.to);
      if (!original || original.envelope.recipientInstanceId !== authenticated.instanceId) throw new PeerError('SCOPE_DENIED', 'The authenticated peer does not own this receipt.');
      await this.store.recordReceipt(receipt.from, receipt.messageId, receipt.to, receipt as unknown as PeerReceipt);
      await this.flushEvents();
      return { recorded: true };
    }
    const sender = await this.remoteSender(route, params.senderRunId);
    if (method === 'peer.status' || method === 'peer.subscribe') {
      if (params.from !== undefined && params.from !== sender.peerId || typeof params.messageId !== 'string' || typeof params.to !== 'string') throw new PeerError('SCOPE_DENIED', 'Receipt access is limited to the authenticated sender and original target.');
      const receipt = await this.store.receipt(sender.peerId, params.messageId, params.to);
      return method === 'peer.status' ? receipt : { subscribed: true, receipt };
    }
    const parsed = wireSendSchema.safeParse(params);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Sender identity and envelope routing are owned by the authenticated root.');
    const input = parsed.data;
    const recipient = this.localPrincipal(input.to);
    const envelope: PeerEnvelope = {
      version: 1, messageId: input.messageId, from: sender.peerId, senderInstanceId: authenticated.instanceId,
      ...(sender.runId ? { senderRunId: sender.runId } : {}), senderAlias: sender.alias, senderProject: sender.project,
      to: recipient.descriptor.peerId, recipientInstanceId: this.identity.instanceId,
      ...(recipient.descriptor.runId ? { recipientRunId: recipient.descriptor.runId } : {}),
      content: input.content, createdAt: input.createdAt ?? new Date(this.now()).toISOString(), expiresAt: input.expiresAt ?? new Date(this.now() + this.policy.limits.expiryMs).toISOString(),
      ...(input.topic !== undefined ? { topic: input.topic } : {}), ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      correlationId: input.correlationId ?? input.messageId, automaticDepth: input.automaticDepth ?? 0,
    };
    return this.acceptEnvelope(envelope, sender, route.scope, route.policyScope);
  }

  private async remoteSender(route: PeerRoute, runId: unknown): Promise<PeerDescriptor> {
    if (runId === undefined) return route.descriptor;
    if (typeof runId !== 'string' || !route.advertisement) throw new PeerError('INVALID_PARAMS', 'The sender run must belong to its authenticated root.');
    const result = await (await this.transport.connect(route.advertisement)).request('peer.directory', { version: 1 });
    if (!isPeerObject(result) || !Array.isArray(result.peers)) throw new PeerError('INVALID_PARAMS', 'The sending root did not publish this run.');
    const match: unknown = result.peers.find(value => isPeerObject(value) && value.runId === runId && value.peerId === peerIdFor(route.descriptor.instanceId, runId) && value.instanceId === route.descriptor.instanceId);
    if (!isPeerObject(match) || typeof match.alias !== 'string' || !Array.isArray(match.capabilities)) throw new PeerError('INVALID_PARAMS', 'The sender run is not currently bound to its authenticated root.');
    return { ...route.descriptor, peerId: peerIdFor(route.descriptor.instanceId, runId), runId, kind: 'run', alias: safePeerLabel(match.alias), capabilities: route.descriptor.capabilities.filter(cap => (match.capabilities as unknown[]).includes(cap)) };
  }
}
