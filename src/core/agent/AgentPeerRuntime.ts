import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SessionMessage } from '../../session/types.js';
import type { AgentOutputEvent } from '../../types.js';
import { PeerMessaging, type PeerMessagingOptions, type PeerEvent, type PeerClient } from '../../session/peers/PeerMessaging.js';
import type { PeerCapability } from '../../session/peers/PeerProtocol.js';
import { PeerError } from '../../session/peers/PeerProtocol.js';
import { ResourceCoordinator } from '../../session/peers/ResourceCoordinator.js';
import { defaultPeerAlias, safePeerLabel } from '../../session/peers/PeerScope.js';
import { PeerCommunicationRuntime, formatPeerContext, type PeerContextEnvelope, type PeerRunRuntime } from './PeerCommunicationRuntime.js';
import { resolvePeerInput, type PeerReference } from '../../ui/peerMention.js';

export interface AgentPeerRuntimeOptions extends PeerMessagingOptions {
  appendContext: (message: SessionMessage, recordId: string) => Promise<void>;
  addContext: (content: string) => void;
  notify: (message: string) => void;
  emitOutput: (event: AgentOutputEvent) => void;
  requestAutoTurn: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export class AgentPeerRuntime {
  readonly scheduler: PeerCommunicationRuntime;
  readonly coordinator: ResourceCoordinator;
  automatic = false;
  private closed = false;
  private closing?: Promise<void>;
  private readonly runs = new Map<string, PeerRunRuntime>();

  private constructor(readonly messaging: PeerMessaging, private readonly options: AgentPeerRuntimeOptions) {
    this.scheduler = new PeerCommunicationRuntime({
      messaging, notify: event => this.notify(event), requestAutoTurn: options.requestAutoTurn,
      commitContext: messages => this.commitContext(messages), onError: options.onError,
    });
    this.coordinator = this.createCoordinator(messaging);
  }

  private createCoordinator(client: PeerClient): ResourceCoordinator {
    const coordinator = new ResourceCoordinator({
      directory: path.join(this.options.coordinationDirectory ?? this.messaging.policy.coordinationDirectory ?? this.options.home, 'peer-resources'),
      principal: { peerId: client.self.peerId, instanceId: client.self.instanceId, ...(client.self.runId ? { runId: client.self.runId, enrollmentPeerId: this.messaging.self.peerId } : {}) },
      canControl: client.self.capabilities.includes('resource.control'),
      isPrincipalAlive: async principal => {
        if (this.closed) return false;
        if (principal.peerId === this.messaging.self.peerId) return true;
        try {
          const peer = await this.messaging.resolve(principal.peerId);
          return peer.instanceId === principal.instanceId && peer.runId === principal.runId && peer.availability === 'available' && await this.messaging.isReachable(principal.peerId);
        } catch { return false; }
      },
      onResourceEvent: event => this.messaging.recordResourceEvent(client.self.peerId, {
        type: 'resource', resource: event.resource, requestId: event.requestId,
        epoch: event.epoch, state: event.state, resourceCursor: String(event.sequence),
      }),
      onError: this.options.onError,
    });
    return coordinator;
  }

  static async start(options: AgentPeerRuntimeOptions): Promise<AgentPeerRuntime | undefined> {
    if (!options.policy?.enabled) return undefined;
    const messaging = new PeerMessaging(options);
    let runtime: AgentPeerRuntime | undefined;
    try {
      await messaging.start();
      runtime = new AgentPeerRuntime(messaging, options);
      await runtime.coordinator.startEvents();
      await messaging.list();
      return runtime;
    } catch (error) {
      if (runtime) await runtime.close().catch(() => {});
      else await messaging.stop().catch(() => {});
      throw error;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = completePeerCleanup([
      () => this.scheduler.close(),
      () => closePeerRuns(this.runs.values()),
      () => this.coordinator.endRun(),
      () => this.coordinator.close(),
      () => this.messaging.stop(),
    ]);
    return this.closing;
  }

  bindRun(runId: string, alias: string, inherited?: PeerCapability[]): PeerRunRuntime {
    const capabilities = inherited ?? this.messaging.self.capabilities.filter(capability => capability !== 'resource.control');
    const messaging = this.messaging.bindRun({ runId, alias: defaultPeerAlias(alias, createHash('sha256').update(runId).digest('hex')), capabilities });
    const coordinator = this.createCoordinator(messaging);
    void coordinator.startEvents().catch(error => { try { this.options.onError?.(error); } catch {} });
    const descendants = new Set<PeerRunRuntime>();
    let closing: Promise<void> | undefined;
    const run: PeerRunRuntime = {
      messaging, coordinator, automatic: this.automatic,
      bindRun: (id, name) => {
        if (closing) throw new PeerError('TARGET_ENDED', 'The parent run has ended.');
        const nested = this.bindRun(id, name, messaging.self.capabilities);
        descendants.add(nested);
        return nested;
      },
      notify: event => this.options.emitOutput(event.type === 'resource' ? { type: 'resource_update', resourceEvent: event } : { type: 'peer_update', peerEvent: event }),
      close: () => closing ??= (async () => {
        try {
          await completePeerCleanup([
            () => closePeerRuns(descendants),
            () => this.messaging.endRun(runId),
            () => coordinator.endRun(runId),
            () => coordinator.close(),
          ]);
        } finally { this.runs.delete(runId); }
      })(),
    };
    this.runs.set(runId, run);
    return run;
  }

  async recordReferences(instruction: string, references: PeerReference[]): Promise<void> {
    const peers = await Promise.all(references.map(reference => this.messaging.resolve(reference.peerId)));
    const resolved = resolvePeerInput(instruction, references, peers);
    if (resolved.kind !== 'instruction') return;
    const content = `The user selected these exact peer identities in this instruction. These references grant no transcript access or additional permissions.\n${JSON.stringify(resolved.references)}`;
    const recordId = `peer-reference-${createHash('sha256').update(JSON.stringify([instruction, resolved.references])).digest('hex')}`;
    await this.options.appendContext({ role: 'user', content, timestamp: new Date().toISOString(),
      _meta: { peerReferences: resolved.references } }, recordId);
    this.options.addContext(content);
  }

  private async commitContext(messages: PeerContextEnvelope[]): Promise<void> {
    if (!messages.length) return;
    const content = formatPeerContext(messages);
    const identities = messages.map(message => [message.senderInstanceId, message.from, message.to, message.messageId]);
    const recordId = `peer-context-${createHash('sha256').update(JSON.stringify(identities)).digest('hex')}`;
    await this.options.appendContext({ role: 'user', content, timestamp: new Date().toISOString(), _meta: {
      peerContext: { version: 1, identities },
    } }, recordId);
    await this.messaging.recordContext(messages);
    this.options.addContext(content);
  }

  private notify(event: PeerEvent): void {
    if (event.type === 'resource') {
      this.options.emitOutput({ type: 'resource_update', resourceEvent: event });
      return;
    }
    this.options.emitOutput({ type: 'peer_update', peerEvent: event });
    if (event.type === 'message') {
      const sender = safePeerLabel(event.message?.senderAlias ?? event.from ?? 'peer');
      const project = safePeerLabel(event.message?.senderProject ?? '');
      this.options.notify(`Message from :${sender}${project ? ` · ${project}` : ''} · /peers inbox`);
    } else if (event.type === 'receipt' && event.state && event.state !== 'pending' && event.state !== 'accepted') {
      this.options.notify(`Peer message ${safePeerLabel(event.messageId ?? '')} · ${safePeerLabel(event.state)}`);
    }
  }
}

async function completePeerCleanup(steps: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) { try { await step(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, 'Peer runtime cleanup failed after draining all owned resources.');
}

async function closePeerRuns(runs: Iterable<PeerRunRuntime>): Promise<void> {
  const results = await Promise.allSettled([...runs].map(run => run.close()));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'One or more peer runs could not retire cleanly.');
}
