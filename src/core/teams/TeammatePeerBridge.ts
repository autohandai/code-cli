import { assertPeerScope } from '../../session/peers/PeerScope.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PeerError, isPeerErrorCode, PEER_CAPABILITIES, type PeerEvent, type PeerMessage, type PeerScope } from '../../session/peers/PeerProtocol.js';
import type { PeerClient } from '../../session/peers/PeerMessaging.js';
import { peerMessageSchema, peerReceiptSchema, type PeerMessageSelection } from '../../session/peers/PeerMessageStore.js';
import { resolvePeerCommunicationSettings } from '../../session/peers/PeerSettings.js';
import { resourceCommandSchema, resourceCommandClaimSchema, resourceOperationSchema, resourcePrincipalSchema, resourceProcessSchema,
  resourceReservationSchema, resourceSnapshotSchema, type ResourceCoordinatorClient } from '../../session/peers/ResourceCoordinator.js';
import type { PeerRunRuntime } from '../agent/PeerCommunicationRuntime.js';

type Send = (method: string, params: Record<string, unknown>) => void;
interface Execution { taskId: string; runId: string; }
const id = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const scope = z.enum(['workspace', 'repository', 'machine']);
const targetSchema = z.object({ taskId: id, runId: id, targetRunId: id, requestId: id });
const requestSchema = targetSchema.extend({ operation: z.string().max(40), args: z.unknown() }).strict();
const selectionSchema = z.array(z.union([id, z.object({ messageId: id, from: id }).strict()])).max(128);
const descriptorSchema = z.object({ peerId: id, instanceId: id, sessionId: id, runId: id.optional(),
  alias: z.string().max(128), project: z.string().max(256), kind: z.enum(['root', 'run']), activity: z.string().max(256),
  availability: z.enum(['available', 'offline', 'presence_only', 'unsupported']), capabilities: z.array(z.enum(PEER_CAPABILITIES)),
  workspaceId: z.string().max(4096).optional(), repositoryId: z.string().max(4096).optional(),
});
const bindingSchema = z.object({ self: descriptorSchema, policy: z.unknown(), principal: resourcePrincipalSchema, automatic: z.boolean() });
const eventSchema = z.object({ type: z.enum(['message', 'receipt', 'resource']), cursor: z.string(), messageId: id.optional(),
  from: id.optional(), to: id.optional(), state: z.string().optional(), resource: z.string().optional(), requestId: id.optional(),
  epoch: z.number().optional(), resourceCursor: z.string().optional(), message: peerMessageSchema.optional(), receipt: peerReceiptSchema.optional(),
});
const messagesSchema = z.object({ messages: z.array(peerMessageSchema), events: z.array(eventSchema), cursor: z.string(), timedOut: z.boolean().optional() });
const listSchema = z.object({ peers: z.array(descriptorSchema), nextCursor: z.string().optional() });
const querySchema = z.object({ after: z.string().optional(), from: id.optional(), replyTo: id.optional(), messageId: id.optional(), waitMs: z.number().int().min(0).max(30_000).optional() }).strict();
const sendSchema = z.object({ to: id, content: z.string().min(1), messageId: id.optional(), topic: z.string().max(256).optional(), replyTo: id.optional(), expiresAt: z.string().optional() }).strict();
const empty = z.object({}).strict();
type Request = z.infer<typeof requestSchema>;

function selections(messages: PeerMessageSelection[]): PeerMessageSelection[] {
  return messages.map(message => typeof message === 'string' ? message : { from: message.from, messageId: message.messageId });
}

export class TeammatePeerHost {
  private readonly runs = new Map<string, { runtime: PeerRunRuntime; unsubscribe: () => void; ended: boolean }>();
  private readonly pending = new Map<string, { targetRunId: string; controller: AbortController; commit?: (error?: string) => void }>();
  private closed = false;
  private closing?: Promise<void>;
  private readonly requests = new Set<Promise<void>>();

  constructor(private readonly execution: Execution, private readonly root: PeerRunRuntime, private readonly send: Send,
    private readonly active: () => boolean) { this.register(root); }

  binding(runtime = this.root): z.input<typeof bindingSchema> {
    return { self: runtime.messaging.self, policy: runtime.messaging.policy, principal: runtime.coordinator.principal, automatic: runtime.automatic };
  }

  handle(method: string, params: Record<string, unknown>): boolean {
    if (!method.startsWith('team.peer')) return false;
    if (method === 'team.peerCancel' || method === 'team.peerContextCommit') {
      const target = targetSchema.safeParse(params);
      if (!target.success || !this.matches(target.data)) return true;
      const pending = this.pending.get(target.data.requestId);
      if (pending?.targetRunId !== target.data.targetRunId) return true;
      if (method === 'team.peerCancel') pending?.controller.abort();
      else pending?.commit?.(params.committed === true ? undefined : typeof params.error === 'string' ? params.error.slice(0, 1000) : 'Context recording failed.');
      return true;
    }
    if (method === 'team.peerRequest') {
      const request = this.dispatch(params);
      this.requests.add(request);
      void request.then(() => this.requests.delete(request), () => this.requests.delete(request));
    }
    return true;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const pending of this.pending.values()) pending.controller.abort();
    for (const entry of this.runs.values()) entry.unsubscribe();
    this.closing = (async () => {
      await Promise.allSettled(this.requests);
      await this.root.close();
      this.runs.clear();
    })();
    return this.closing;
  }

  private matches(target: Execution): boolean { return target.taskId === this.execution.taskId && target.runId === this.execution.runId; }

  private register(runtime: PeerRunRuntime): void {
    const runId = runtime.messaging.self.runId;
    if (!runId || this.runs.has(runId)) throw new PeerError('INVALID_PARAMS', 'Invalid or duplicate teammate peer run.');
    const unsubscribe = runtime.messaging.subscribe(event => {
      if (!this.closed && this.active()) this.send('team.peerEvent', { ...this.execution, targetRunId: runId, event });
    });
    this.runs.set(runId, { runtime, unsubscribe, ended: false });
  }

  private async dispatch(params: Record<string, unknown>): Promise<void> {
    const target = targetSchema.safeParse(params);
    if (!target.success) return;
    const respond = (response: Record<string, unknown>) => {
      try { this.send('team.peerResult', { ...target.data, ...response }); } catch { /* Channel closure does not change durable receipts. */ }
    };
    let request: Request;
    try { request = requestSchema.parse(params); } catch { respond({ error: { code: 'INVALID_PARAMS', message: 'Invalid teammate peer request.' } }); return; }
    const entry = this.runs.get(request.targetRunId);
    const cleanup = ['end', 'resource.recordSpawn', 'resource.complete', 'resource.failed', 'resource.publishLaunch', 'resource.finishLaunch'].includes(request.operation);
    if (this.closed || (!this.active() && !cleanup) || !this.matches(request) || !entry || entry.ended) {
      respond({ error: { code: 'TARGET_ENDED', message: 'This channel does not own an active target run.' } }); return;
    }
    if (this.pending.has(request.requestId) || this.pending.size >= 32) {
      respond({ error: { code: 'QUEUE_FULL', message: 'The teammate peer request queue is full or this ID is pending.' } }); return;
    }
    const controller = new AbortController();
    this.pending.set(request.requestId, { controller, targetRunId: request.targetRunId });
    try { respond({ result: await this.execute(entry.runtime, request, controller.signal) }); }
    catch (error) {
      respond({ error: { code: error instanceof PeerError ? error.code : controller.signal.aborted ? 'TARGET_ENDED' : error instanceof z.ZodError ? 'INVALID_PARAMS' : 'INVALID_RPC',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 2000) } });
    } finally { this.pending.delete(request.requestId); }
  }

  private async execute(runtime: PeerRunRuntime, request: Request, signal: AbortSignal): Promise<unknown> {
    const client = runtime.messaging;
    const coordinator = runtime.coordinator;
    const args = request.args;
    switch (request.operation) {
      case 'list': return client.list(z.object({ scope: scope.optional(), query: z.string().max(256).optional(), cursor: z.string().max(2048).optional() }).strict().parse(args));
      case 'resolve': return client.resolve(z.object({ target: id }).strict().parse(args).target);
      case 'send': return client.send(sendSchema.parse(args), { automatic: runtime.automatic });
      case 'messages': return client.messages({ ...querySchema.parse(args), consume: false, signal });
      case 'status': {
        const parsed = z.object({ messageId: id, to: id.optional() }).strict().parse(args);
        return client.status(parsed.messageId, parsed.to);
      }
      case 'record': return client.recordContext(selectionSchema.parse(args));
      case 'consume': return client.consumeMessages(selectionSchema.parse(args), messages => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => finish('Context commit deadline elapsed.'), 30_000);
        const onAbort = () => finish('Context commit cancelled.');
        const pending = this.pending.get(request.requestId)!;
        const finish = (error?: string) => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
          pending.commit = undefined;
          if (error) reject(new Error(error)); else resolve();
        };
        pending.commit = finish;
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) { onAbort(); return; }
        try { this.send('team.peerContext', { ...this.execution, targetRunId: request.targetRunId, requestId: request.requestId, messages }); }
        catch { finish('The child disconnected before context recording.'); }
      }));
      case 'bind': {
        const parsed = z.object({ runId: id, alias: z.string().min(1).max(128) }).strict().parse(args);
        const nested = await runtime.bindRun(parsed.runId, parsed.alias);
        if (!nested) throw new PeerError('CAPABILITY_DENIED', 'This runtime cannot publish nested peers.');
        this.register(nested);
        return this.binding(nested);
      }
      case 'end': {
        empty.parse(args);
        const entry = this.runs.get(request.targetRunId)!;
        entry.ended = true;
        entry.unsubscribe();
        return runtime.close();
      }
      case 'resource.coordinate': return coordinator.coordinate(resourceOperationSchema.parse(args));
      case 'resource.requirements': return coordinator.commandRequirements(resourceCommandSchema.parse(args));
      case 'resource.beginLaunch': {
        const parsed = z.object({ launchId: id, command: resourceCommandSchema, reservationIds: z.array(id).max(256) }).strict().parse(args);
        return coordinator.beginLaunch(parsed.launchId, parsed.command, parsed.reservationIds);
      }
      case 'resource.publishLaunch': {
        const parsed = z.object({ launchId: id, proof: resourceProcessSchema }).strict().parse(args);
        return coordinator.publishLaunch(parsed.launchId, parsed.proof);
      }
      case 'resource.finishLaunch': {
        const parsed = z.object({ launchId: id, failedBeforeSpawn: z.boolean().optional() }).strict().parse(args);
        return coordinator.finishLaunch(parsed.launchId, parsed.failedBeforeSpawn);
      }
      case 'resource.claim': return coordinator.claimCommand(resourceCommandClaimSchema.parse(args));
      case 'resource.beforeSpawn': return coordinator.beforeSpawn(z.object({ requestId: id, command: resourceCommandSchema, epoch: z.number().int().nonnegative().optional() }).strict().parse(args));
      case 'resource.recordSpawn': {
        const parsed = z.object({ reservationId: id, proof: resourceProcessSchema }).strict().parse(args);
        return coordinator.recordSpawn(parsed.reservationId, parsed.proof);
      }
      case 'resource.complete': return coordinator.complete(z.object({ reservationId: id }).strict().parse(args).reservationId);
      case 'resource.failed': return coordinator.confirmSpawnFailure(z.object({ reservationId: id }).strict().parse(args).reservationId);
      case 'resource.wait': {
        const parsed = z.object({ requestId: id, timeoutMs: z.number().int().min(0).max(300_000) }).strict().parse(args);
        return coordinator.waitForGrant(parsed.requestId, { timeoutMs: parsed.timeoutMs, signal });
      }
      default: throw new PeerError('METHOD_NOT_FOUND', 'Unknown teammate peer operation.');
    }
  }
}

interface PendingRequest {
  targetRunId: string;
  finish: (result: unknown, error?: Error) => void;
  commit?: (messages: PeerMessage[]) => Promise<void>;
}

export class TeammatePeerClient {
  readonly root: PeerRunRuntime;
  private closed = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<(event: PeerEvent) => void>>();

  constructor(private readonly execution: Execution, binding: unknown, private readonly send: Send) { this.root = this.runtime(binding); }

  handle(method: string, params: Record<string, unknown>): boolean {
    if (!method.startsWith('team.peer')) return false;
    if (params.taskId !== this.execution.taskId || params.runId !== this.execution.runId || this.closed) return true;
    if (method === 'team.peerEvent' && typeof params.targetRunId === 'string') {
      const event = eventSchema.safeParse(params.event);
      if (event.success) for (const listener of this.listeners.get(params.targetRunId) ?? []) {
        try { listener(event.data); } catch { /* A UI observer cannot revoke receipt custody. */ }
      }
      return true;
    }
    const pending = typeof params.requestId === 'string' ? this.pending.get(params.requestId) : undefined;
    if (!pending || pending.targetRunId !== params.targetRunId) return true;
    if (method === 'team.peerResult') {
      const error = z.object({ code: z.string(), message: z.string() }).safeParse(params.error);
      if (error.success) {
        pending.finish(undefined, new PeerError(isPeerErrorCode(error.data.code) ? error.data.code : 'INVALID_RPC', error.data.message));
      } else if (params.error !== undefined) pending.finish(undefined, new PeerError('INVALID_RPC', 'Invalid parent error response.'));
      else pending.finish(params.result);
    } else if (method === 'team.peerContext' && pending.commit) {
      const respond = (committed: boolean, error?: string) => this.send('team.peerContextCommit', {
        ...this.execution, targetRunId: pending.targetRunId, requestId: params.requestId, committed, ...(error ? { error } : {}),
      });
      const parsed = z.array(peerMessageSchema).max(128).safeParse(params.messages);
      if (!parsed.success) respond(false, 'Invalid context envelope.');
      else void pending.commit(parsed.data).then(() => respond(true), error => respond(false, error instanceof Error ? error.message : 'Context recording failed.')).catch(() => this.disconnect());
    }
    return true;
  }

  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [requestId, request] of this.pending) {
      try { this.send('team.peerCancel', { ...this.execution, requestId, targetRunId: request.targetRunId }); } catch { /* The parent also closes on EOF. */ }
      request.finish(undefined, new PeerError('PEER_OFFLINE', 'The parent peer channel closed.'));
    }
    this.listeners.clear();
  }

  private request<T>(targetRunId: string, operation: string, args: unknown, schema: z.ZodType<T>, signal?: AbortSignal,
    timeoutMs = 35_000, commit?: PendingRequest['commit']): Promise<T> {
    if (this.closed) return Promise.reject(new PeerError('PEER_OFFLINE', 'The parent peer channel closed.'));
    if (signal?.aborted) return Promise.reject(new DOMException('Peer request aborted.', 'AbortError'));
    if (this.pending.size >= 32) return Promise.reject(new PeerError('QUEUE_FULL', 'The child peer request queue is full.'));
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const target = { ...this.execution, targetRunId, requestId };
      const cancel = (error: Error) => { try { this.send('team.peerCancel', target); } catch { /* The local deadline still settles on channel failure. */ } finish(undefined, error); };
      const onAbort = () => cancel(new DOMException('Peer request aborted.', 'AbortError'));
      const timeout = setTimeout(() => cancel(new PeerError('DELIVERY_UNKNOWN', 'The parent did not answer before the deadline.')), timeoutMs);
      const finish = (result: unknown, error?: Error) => {
        if (!this.pending.delete(requestId)) return;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else {
          const parsed = schema.safeParse(result);
          if (parsed.success) resolve(parsed.data);
          else reject(new PeerError('INVALID_RPC', 'The parent returned an invalid peer result.'));
        }
      };
      this.pending.set(requestId, { targetRunId, finish, commit });
      signal?.addEventListener('abort', onAbort, { once: true });
      try { this.send('team.peerRequest', { ...target, operation, args }); } catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private runtime(raw: unknown): PeerRunRuntime {
    const binding = bindingSchema.parse(raw);
    const runId = binding.self.runId;
    if (!runId || binding.principal.peerId !== binding.self.peerId || binding.principal.runId !== runId
      || binding.principal.instanceId !== binding.self.instanceId) throw new PeerError('INVALID_RPC', 'The parent returned inconsistent run identity.');
    const peers = new Map<PeerScope, z.infer<typeof descriptorSchema>[]>();
    const policy = resolvePeerCommunicationSettings({ sessions: { communication: binding.policy } });
    const call = <T>(operation: string, args: unknown, schema: z.ZodType<T>, signal?: AbortSignal, timeoutMs?: number) => this.request(runId, operation, args, schema, signal, timeoutMs);
    const messaging: PeerClient = {
      get self() { return structuredClone(binding.self); }, policy,
      cachedPeers: (scope = 'workspace') => { assertPeerScope(scope, policy.scope); return structuredClone(peers.get(scope) ?? []); },
      list: async (query = {}) => { const result = await call('list', query, listSchema); peers.set(query.scope ?? 'workspace', result.peers); return result; },
      resolve: target => call('resolve', { target }, descriptorSchema),
      send: input => call('send', input, peerReceiptSchema),
      messages: async (query = {}) => {
        const { signal, consume, ...args } = query;
        const result = await call('messages', args, messagesSchema, signal);
        if (consume !== false && result.messages.length) await messaging.consumeMessages(result.messages, accepted => messaging.recordContext(accepted));
        return result;
      },
      status: (messageId, to) => call('status', { messageId, to }, peerReceiptSchema),
      subscribe: listener => {
        let listeners = this.listeners.get(runId);
        if (!listeners) { listeners = new Set(); this.listeners.set(runId, listeners); }
        listeners.add(listener);
        return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(runId); };
      },
      recordContext: messages => call('record', selections(messages), z.undefined()),
      consumeMessages: (messages, commit) => this.request(runId, 'consume', selections(messages), z.undefined(), undefined, 35_000, commit),
    };
    const coordinator: ResourceCoordinatorClient = {
      principal: binding.principal,
      coordinate: operation => call('resource.coordinate', operation, resourceSnapshotSchema),
      commandRequirements: command => call('resource.requirements', command, z.array(z.object({ resource: z.string(), requestId: id.optional(), epoch: z.number().int() }))),
      beginLaunch: (launchId, command, reservationIds) => call('resource.beginLaunch', { launchId, command, reservationIds }, z.void()),
      publishLaunch: (launchId, proof) => call('resource.publishLaunch', { launchId, proof }, z.void()),
      finishLaunch: (launchId, failedBeforeSpawn) => call('resource.finishLaunch', { launchId, failedBeforeSpawn }, z.void()),
      claimCommand: input => call('resource.claim', input, resourceSnapshotSchema),
      beforeSpawn: input => call('resource.beforeSpawn', input, resourceReservationSchema),
      recordSpawn: (reservationId, proof) => call('resource.recordSpawn', { reservationId, proof }, resourceReservationSchema),
      complete: reservationId => call('resource.complete', { reservationId }, z.undefined()),
      confirmSpawnFailure: reservationId => call('resource.failed', { reservationId }, z.undefined()),
      waitForGrant: (requestId, options) => call('resource.wait', { requestId, timeoutMs: options.timeoutMs }, resourceSnapshotSchema, options.signal, Math.min(options.timeoutMs, 300_000) + 5000),
    };
    let closing: Promise<void> | undefined;
    return { messaging, coordinator, automatic: binding.automatic, notify: () => {},
      bindRun: async (runId, alias) => this.runtime(await call('bind', { runId, alias }, bindingSchema)),
      close: () => closing ??= call('end', {}, z.undefined()),
    };
  }
}
