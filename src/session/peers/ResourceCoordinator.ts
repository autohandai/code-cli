import { createHash, randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile, withFileLock } from '../../utils/atomicFile.js';
import { PeerError } from './PeerProtocol.js';
import { ensurePrivatePeerDirectory, readPrivatePeerFile } from './PeerStorage.js';
import { probePeerProcess, type PeerProcessProof, type PeerProcessState } from './PeerProcessIdentity.js';

const identifier = z.string().min(1).max(256).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const resourceKey = z.string().max(256).regex(/^(?:machine\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63}|repository\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/);
const epochSchema = z.number().int().nonnegative().optional();
export const resourceOperationSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('status'), resource: resourceKey }).strict(),
  z.object({ operation: z.literal('request'), resource: resourceKey, reason: z.string().min(1).max(1_024), requestId: identifier.optional() }).strict(),
  z.object({ operation: z.literal('grant'), requestId: identifier, epoch: epochSchema }).strict(),
  z.object({ operation: z.literal('release'), requestId: identifier }).strict(),
  z.object({ operation: z.literal('cancel_request'), requestId: identifier }).strict(),
  z.object({ operation: z.literal('set_controller'), resource: resourceKey, controller: identifier, participants: z.array(identifier).max(256), profile: z.enum(['strict', 'build']), epoch: epochSchema }).strict(),
]);
export type ResourceOperation = z.infer<typeof resourceOperationSchema>;
const principalSchema = z.object({ peerId: identifier, instanceId: identifier, runId: identifier.optional(), enrollmentPeerId: identifier.optional() }).strict();
export type ResourcePrincipal = z.infer<typeof principalSchema>;
const commandSchema = z.object({ file: z.string().min(1).max(4_096), args: z.array(z.string().max(65_536)).max(1_024), cwd: z.string().min(1).max(4_096) });
export type ResourceCommand = z.infer<typeof commandSchema>;
export const resourceCommandClaimSchema = z.object({ resource: resourceKey, command: commandSchema, launchId: identifier, requestId: identifier.optional() }).strict();
const processSchema = z.object({ pid: z.number().int().min(2), startedAt: identifier, processGroupId: z.number().int().min(2) });
const launchSchema = z.object({ launchId: identifier, principal: principalSchema, command: commandSchema, process: processSchema.optional(), createdAt: z.number() });
type ManagedLaunch = z.infer<typeof launchSchema>;
const ticketState = z.enum(['queued', 'reserved', 'starting', 'running', 'released', 'cancelled', 'expired', 'stale', 'ended', 'completed']);
const ticketSchema = z.object({ requestId: identifier, principal: principalSchema, reason: z.string().max(1_024), createdAt: z.number(), epoch: z.number().int().nonnegative(), state: ticketState,
  launchId: identifier.optional(), commandDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
type ResourceTicket = z.infer<typeof ticketSchema>;
const reservationSchema = z.object({
  resource: resourceKey, reservationId: identifier, requestId: identifier, principal: principalSchema,
  epoch: z.number().int().nonnegative(), state: z.enum(['reserved', 'starting', 'running']),
  grantedAt: z.number(), expiresAt: z.number(), command: commandSchema.optional(), process: processSchema.optional(),
});
export type ResourceReservation = z.infer<typeof reservationSchema>;
const noticeSchema = z.object({
  resource: resourceKey, sequence: z.number().int().positive(), epoch: z.number().int().nonnegative(),
  state: z.string().max(40), requestId: identifier.optional(), principal: principalSchema.optional(),
  controller: identifier.nullable(), audience: z.array(identifier), createdAt: z.number(),
});
export type ResourceNotice = z.infer<typeof noticeSchema>;
const stateSchema = z.object({
  version: z.literal(1), resource: resourceKey, epoch: z.number().int().nonnegative(), controller: identifier.nullable(),
  participants: z.array(identifier), enrolled: z.array(identifier), profile: z.enum(['strict', 'build']),
  tickets: z.array(ticketSchema), holder: reservationSchema.nullable(), updatedAt: z.number(),
  eventSequence: z.number().int().nonnegative().default(0), events: z.array(noticeSchema).default([]),
  blockers: z.array(identifier).default([]),
});
type ResourceState = z.infer<typeof stateSchema>;
export interface ResourceSnapshot {
  resource: string;
  epoch: number;
  controller: string | null;
  profile: 'strict' | 'build';
  state: ResourceTicket['state'] | 'unconfigured' | 'available';
  requestId?: string;
  holder: ResourceReservation | null;
  queue: Array<ResourceTicket & { waitMs: number }>;
  blockers?: string[];
}
export const resourceSnapshotSchema = z.object({
  resource: resourceKey, epoch: z.number().int().nonnegative(), controller: identifier.nullable(),
  profile: z.enum(['strict', 'build']), state: z.enum([...ticketState.options, 'unconfigured', 'available']),
  requestId: identifier.optional(), holder: reservationSchema.nullable(),
  queue: z.array(ticketSchema.extend({ waitMs: z.number().nonnegative() })).max(256),
  blockers: z.array(identifier).max(4096).optional(),
});
export { commandSchema as resourceCommandSchema, principalSchema as resourcePrincipalSchema,
  reservationSchema as resourceReservationSchema, processSchema as resourceProcessSchema };
export interface ResourceCoordinatorOptions {
  directory: string;
  principal: ResourcePrincipal;
  canControl: boolean;
  now?: () => number;
  isPrincipalAlive?: (principal: ResourcePrincipal) => Promise<boolean>;
  probeProcess?: (process: PeerProcessProof) => Promise<PeerProcessState>;
  onEvent?: (snapshot: ResourceSnapshot) => void;
  onResourceEvent?: (event: ResourceNotice) => Promise<void>;
  onError?: (error: unknown) => void;
}

export type ResourceCoordinatorClient = Pick<ResourceCoordinator,
  'principal' | 'coordinate' | 'commandRequirements' | 'claimCommand' | 'beforeSpawn' | 'recordSpawn'
  | 'complete' | 'confirmSpawnFailure' | 'waitForGrant' | 'beginLaunch' | 'publishLaunch' | 'finishLaunch'>;

function samePrincipal(left: ResourcePrincipal, right: ResourcePrincipal): boolean {
  return left.peerId === right.peerId && left.instanceId === right.instanceId && left.runId === right.runId;
}

function isEnrolled(principal: ResourcePrincipal, peers: string[]): boolean {
  return peers.includes(principal.peerId) || !!principal.enrollmentPeerId && peers.includes(principal.enrollmentPeerId);
}

function commandDigest(command: ResourceCommand): string { return createHash('sha256').update(JSON.stringify(command)).digest('hex'); }

export class ResourceCoordinator {
  private readonly now: () => number;
  private readonly probeProcess: (process: PeerProcessProof) => Promise<PeerProcessState>;
  private readonly isPrincipalAlive: (principal: ResourcePrincipal) => Promise<boolean>;
  private initializePromise?: Promise<string>;
  private watcher?: FSWatcher;
  private closed = false;
  private readonly waiters = new Set<() => void>();
  private readonly transactions = new Set<Promise<unknown>>();
  private observing?: Promise<void>;
  private noticeDelivery?: Promise<void>;
  private noticesDirty = false;
  private readonly noticeCursors = new Map<string, number>();
  private noticeRetry?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: ResourceCoordinatorOptions) {
    const principal = principalSchema.safeParse(options.principal);
    if (!principal.success) throw new PeerError('INVALID_PARAMS', 'Invalid resource principal.');
    this.now = options.now ?? Date.now;
    this.probeProcess = options.probeProcess ?? probePeerProcess;
    this.isPrincipalAlive = options.isPrincipalAlive ?? (async candidate => samePrincipal(candidate, options.principal) && !this.closed);
  }

  get principal(): ResourcePrincipal { return { ...this.options.principal }; }

  startEvents(): Promise<void> {
    this.assertOpen();
    this.observing ??= (async () => { await this.ensureWatcher(); await this.deliverResourceEvents(); })();
    return this.observing;
  }

  async coordinate(input: ResourceOperation): Promise<ResourceSnapshot> {
    this.assertOpen();
    const parsed = resourceOperationSchema.safeParse(input);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid resource operation, fields or canonical resource key.');
    const operation = parsed.data;
    const resource = 'resource' in operation ? operation.resource : await this.resourceForTicket(operation.requestId);
    const execute = () => this.transaction(resource, async state => {
      await this.reconcile(state);
      if (operation.operation === 'status') return this.snapshot(state);
      if (operation.operation === 'set_controller') {
        this.assertEpoch(state, operation.epoch);
        if (!this.options.canControl) throw new PeerError('CAPABILITY_DENIED', 'Changing resource policy requires delegated control authority.');
        state.epoch++;
        state.controller = operation.controller;
        state.participants = [...new Set(operation.participants)];
        state.enrolled = [...new Set([...state.enrolled, ...state.participants, operation.controller])];
        state.profile = operation.profile;
        const launches = await this.readLaunches();
        const existingLaunch = state.holder ? state.tickets.find(ticket => ticket.requestId === state.holder?.requestId)?.launchId : undefined;
        state.blockers = [...new Set([...state.blockers, ...launches.filter(launch => launch.launchId !== existingLaunch
          && isEnrolled(launch.principal, state.enrolled) && (state.profile === 'strict' || this.isBuildCommand(launch.command))).map(launch => launch.launchId)])];
        if (state.holder?.state === 'reserved') {
          this.ticket(state, state.holder.requestId).state = 'stale';
          state.holder = null;
        }
        for (const ticket of state.tickets) {
          if (ticket.state === 'queued' && !isEnrolled(ticket.principal, [...state.participants, operation.controller])) ticket.state = 'stale';
        }
        return this.snapshot(state);
      }
      if (operation.operation === 'request') {
        this.assertParticipant(state);
        const requestId = operation.requestId ?? randomUUID();
        const existing = state.tickets.find(ticket => ticket.requestId === requestId);
        if (existing) {
          if (!samePrincipal(existing.principal, this.options.principal) || existing.reason !== operation.reason) throw new PeerError('REQUEST_ID_CONFLICT', 'The ticket ID already belongs to a different owner or request.');
          return this.snapshot(state, existing);
        }
        if (state.tickets.length >= 4_096 || state.tickets.filter(ticket => ticket.state === 'queued').length >= 256) throw new PeerError('QUEUE_FULL', 'The resource ticket queue is full.');
        const ticket: ResourceTicket = { requestId, principal: this.principal, reason: operation.reason, createdAt: this.now(), epoch: state.epoch, state: 'queued' };
        state.tickets.push(ticket);
        return this.snapshot(state, ticket);
      }
      const ticket = this.ticket(state, operation.requestId);
      if (operation.operation === 'grant') {
        this.assertEpoch(state, operation.epoch);
        if (!this.options.canControl || state.controller !== this.options.principal.peerId) throw new PeerError('CAPABILITY_DENIED', 'Only the designated, authorized controller can grant this resource.');
        if (!await this.isPrincipalAlive(this.options.principal)) throw new PeerError('CONTROLLER_UNAVAILABLE', 'The controller incarnation is not known to be active.');
        this.assertTicketUsable(ticket);
        if (!await this.isPrincipalAlive(ticket.principal)) throw new PeerError('TARGET_ENDED', 'The requesting incarnation is no longer known to be active.');
        if (!isEnrolled(ticket.principal, [...state.participants, state.controller!])) throw new PeerError('SCOPE_DENIED', 'The requester is no longer enrolled in this policy.');
        if (state.blockers.length) throw new PeerError('RESOURCE_BUSY', 'Previously admitted commands must finish before a new grant. Their process identities are retained in the managed launch ledger.');
        if (state.holder) {
          if (state.holder.requestId === ticket.requestId && state.holder.state === 'reserved') return this.snapshot(state, ticket);
          const ownerAlive = await this.isPrincipalAlive(state.holder.principal);
          throw new PeerError(ownerAlive ? 'RESOURCE_BUSY' : 'RECOVERY_REQUIRED', 'The resource remains occupied until its owned process lifetime is resolved.');
        }
        if (ticket.state !== 'queued') throw new PeerError('RESOURCE_BUSY', 'This ticket has already been used.');
        ticket.state = 'reserved';
        ticket.epoch = state.epoch;
        state.holder = { resource, reservationId: randomUUID(), requestId: ticket.requestId, principal: { ...ticket.principal }, epoch: state.epoch, state: 'reserved', grantedAt: this.now(), expiresAt: this.now() + 30_000 };
        return this.snapshot(state, ticket);
      }
      this.assertOwner(ticket.principal);
      if (['starting', 'running'].includes(ticket.state)) throw new PeerError('RESOURCE_BUSY', 'A launched command remains occupied until its process tree is proven gone.');
      if (operation.operation === 'release') {
        if (ticket.state === 'released' || ticket.state === 'completed') return this.snapshot(state, ticket);
        if (ticket.state !== 'reserved') throw new PeerError('RESOURCE_BUSY', 'Only an unused reservation can be released.');
        ticket.state = 'released';
      } else {
        if (!['completed', 'released', 'ended'].includes(ticket.state)) ticket.state = 'cancelled';
      }
      if (state.holder?.requestId === ticket.requestId) state.holder = null;
      return this.snapshot(state, ticket);
    });
    return operation.operation === 'set_controller' ? this.namespaceTransaction(execute) : execute();
  }

  async beginLaunch(launchId: string, command: ResourceCommand, reservationIds: string[]): Promise<void> {
    if (!identifier.safeParse(launchId).success || !commandSchema.safeParse(command).success || reservationIds.length > 256) throw new PeerError('INVALID_PARAMS', 'Invalid managed launch.');
    await this.namespaceTransaction(async () => {
      for (const requirement of await this.commandRequirements(command)) {
        await this.transaction(requirement.resource, async state => {
          if (!state.holder || state.holder.state !== 'starting' || !reservationIds.includes(state.holder.reservationId)
            || !samePrincipal(state.holder.principal, this.principal)) throw new PeerError('STALE_POLICY', 'Resource policy changed while the command waited. Request a grant under the current policy and retry.');
        });
      }
      const launches = await this.readLaunches();
      const previous = launches.find(launch => launch.launchId === launchId);
      if (previous) {
        this.assertOwner(previous.principal);
        if (commandDigest(previous.command) !== commandDigest(command)) throw new PeerError('REQUEST_ID_CONFLICT', 'The launch ID belongs to a different command.');
        return;
      }
      const retained: ManagedLaunch[] = [];
      for (const launch of launches) if (!launch.process || await this.probeProcess(launch.process) !== 'gone') retained.push(launch);
      if (retained.length >= 4096) throw new PeerError('QUEUE_FULL', 'The managed launch ledger is full. Resolve preserved command ownership before admitting more work.');
      retained.push({ launchId, principal: this.principal, command, createdAt: this.now() });
      await this.writeLaunches(retained);
    });
  }

  async publishLaunch(launchId: string, proof: PeerProcessProof): Promise<void> {
    if (!processSchema.safeParse(proof).success) throw new PeerError('INVALID_PARAMS', 'Invalid managed process identity.');
    await this.namespaceTransaction(async () => {
      const launches = await this.readLaunches();
      const launch = launches.find(candidate => candidate.launchId === launchId);
      if (!launch) throw new PeerError('RECOVERY_REQUIRED', 'The admitted command is missing from the managed launch ledger.');
      this.assertOwner(launch.principal);
      if (launch.process && JSON.stringify(launch.process) !== JSON.stringify(proof)) throw new PeerError('REQUEST_ID_CONFLICT', 'A different process already owns this launch.');
      launch.process = proof;
      await this.writeLaunches(launches);
    });
  }

  async finishLaunch(launchId: string, failedBeforeSpawn = false): Promise<void> {
    await this.namespaceTransaction(async () => {
      const launches = await this.readLaunches();
      const launch = launches.find(candidate => candidate.launchId === launchId);
      if (!launch) return;
      this.assertOwner(launch.principal);
      if (failedBeforeSpawn && launch.process) throw new PeerError('RESOURCE_BUSY', 'A published process cannot be cleared as a failed spawn.');
      if (!failedBeforeSpawn) {
        const observed = launch.process ? await this.probeProcess(launch.process) : 'unknown';
        if (observed !== 'gone') throw new PeerError(observed === 'alive' ? 'RESOURCE_BUSY' : 'RECOVERY_REQUIRED', 'The managed process tree has not been proven gone.');
      }
      await this.writeLaunches(launches.filter(candidate => candidate.launchId !== launchId));
      for (const resource of await this.resources()) await this.transaction(resource, state => this.reconcile(state));
    });
  }

  async beforeSpawn(input: { requestId: string; command: ResourceCommand; epoch?: number }): Promise<ResourceReservation> {
    this.assertOpen();
    const parsed = commandSchema.safeParse(input.command);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid planned command.');
    const resource = await this.resourceForTicket(input.requestId);
    return this.transaction(resource, async state => {
      await this.reconcile(state);
      const ticket = this.ticket(state, input.requestId);
      this.assertOwner(ticket.principal);
      this.assertEpoch(state, input.epoch);
      this.assertTicketUsable(ticket);
      if (ticket.commandDigest && ticket.commandDigest !== commandDigest(parsed.data)) throw new PeerError('REQUEST_ID_CONFLICT', 'This command differs from the command assigned to the resource ticket.');
      if (ticket.epoch !== state.epoch) throw new PeerError('STALE_POLICY', 'The grant belongs to an earlier resource policy.');
      this.assertParticipant(state);
      if (!state.holder || state.holder.requestId !== ticket.requestId || state.holder.state !== 'reserved') throw new PeerError('RESOURCE_BUSY', 'A unique unused reservation is required immediately before spawn.');
      if (!await this.isPrincipalAlive(ticket.principal)) throw new PeerError('TARGET_ENDED', 'The requesting run ended before spawn.');
      state.holder.state = 'starting';
      state.holder.command = parsed.data;
      ticket.state = 'starting';
      return structuredClone(state.holder);
    });
  }

  async recordSpawn(reservationId: string, proof: PeerProcessProof): Promise<ResourceReservation> {
    const parsed = processSchema.safeParse(proof);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid spawned process identity.');
    return this.withReservation(reservationId, async (state, reservation) => {
      this.assertOwner(reservation.principal);
      if (reservation.state === 'running') {
        if (JSON.stringify(reservation.process) !== JSON.stringify(parsed.data)) throw new PeerError('SCOPE_DENIED', 'A running reservation cannot be rebound to another process incarnation.');
        return structuredClone(reservation);
      }
      if (reservation.state !== 'starting') throw new PeerError('RESOURCE_BUSY', 'The command must reserve its spawn transition first.');
      reservation.process = parsed.data;
      reservation.state = 'running';
      this.ticket(state, reservation.requestId).state = 'running';
      return structuredClone(reservation);
    });
  }

  async complete(reservationId: string): Promise<void> {
    await this.withReservation(reservationId, async (state, reservation) => {
      this.assertOwner(reservation.principal);
      if (!reservation.process) throw new PeerError('RECOVERY_REQUIRED', 'A starting reservation has no published process identity.');
      const observed = await this.probeProcess(reservation.process);
      if (observed !== 'gone') throw new PeerError(observed === 'alive' ? 'RESOURCE_BUSY' : 'RECOVERY_REQUIRED', 'The owned process tree has not been proven gone.');
      this.ticket(state, reservation.requestId).state = 'completed';
      state.holder = null;
    });
  }

  async confirmSpawnFailure(reservationId: string): Promise<void> {
    await this.withReservation(reservationId, async (state, reservation) => {
      this.assertOwner(reservation.principal);
      if (reservation.state !== 'starting' || reservation.process) throw new PeerError('RESOURCE_BUSY', 'The executor can clear only a proven failure before a process was created.');
      this.ticket(state, reservation.requestId).state = 'released';
      state.holder = null;
    });
  }

  async endRun(runId?: string): Promise<void> {
    for (const resource of await this.resources()) {
      await this.transaction(resource, async state => {
        for (const ticket of state.tickets) {
          if (ticket.principal.instanceId !== this.options.principal.instanceId || ticket.principal.runId !== runId || !['queued', 'reserved'].includes(ticket.state)) continue;
          ticket.state = 'ended';
          if (state.holder?.requestId === ticket.requestId) state.holder = null;
        }
      });
    }
  }

  async adoptRunning(input: { resource: string; command: ResourceCommand; process: PeerProcessProof }): Promise<ResourceReservation> {
    if (!resourceKey.safeParse(input.resource).success || !commandSchema.safeParse(input.command).success || !processSchema.safeParse(input.process).success) throw new PeerError('INVALID_PARAMS', 'Invalid running command adoption.');
    if (await this.probeProcess(input.process) !== 'alive') throw new PeerError('RECOVERY_REQUIRED', 'Adoption requires verified live process ownership.');
    return this.transaction(input.resource, async state => {
      await this.reconcile(state);
      this.assertParticipant(state);
      if (state.holder) throw new PeerError('RESOURCE_BUSY', 'The resource already has a holder.');
      const requestId = randomUUID();
      state.tickets.push({ requestId, principal: this.principal, reason: 'Adopt an existing managed command', createdAt: this.now(), epoch: state.epoch, state: 'running' });
      state.holder = { resource: input.resource, reservationId: randomUUID(), requestId, principal: this.principal, epoch: state.epoch, state: 'running', grantedAt: this.now(), expiresAt: this.now(), command: structuredClone(input.command), process: { ...input.process } };
      return structuredClone(state.holder);
    });
  }

  async waitForGrant(requestId: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ResourceSnapshot> {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) throw new PeerError('INVALID_PARAMS', 'A finite resource wait deadline is required.');
    const resource = await this.resourceForTicket(requestId);
    await this.ensureWatcher();
    const deadline = Date.now() + options.timeoutMs;
    try {
      for (;;) {
        this.assertOpen();
        if (options.signal?.aborted) throw new DOMException('Resource wait aborted.', 'AbortError');
        let wake = () => {};
        const changed = new Promise<void>(resolve => { wake = resolve; });
        this.waiters.add(wake);
        try {
          const status = await this.transaction(resource, async state => {
            await this.reconcile(state);
            const ticket = this.ticket(state, requestId);
            this.assertOwner(ticket.principal);
            this.assertTicketUsable(ticket);
            return this.snapshot(state, ticket);
          });
          if (status.state === 'reserved') return status;
          if (status.state !== 'queued') throw new PeerError('RESOURCE_BUSY', 'This resource request is no longer queued.');
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new PeerError('RESOURCE_WAIT_TIMEOUT', 'The resource wait deadline elapsed without spawning a process.');
          const timer = setTimeout(wake, remaining);
          options.signal?.addEventListener('abort', wake, { once: true });
          if (options.signal?.aborted || this.closed) wake();
          try { await changed; } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', wake); }
        } finally { this.waiters.delete(wake); }
      }
    } catch (error) {
      if (error instanceof PeerError && error.code === 'RESOURCE_WAIT_TIMEOUT' || error instanceof DOMException && error.name === 'AbortError') await this.coordinate({ operation: 'cancel_request', requestId }).catch(() => {});
      throw error;
    }
  }

  async commandRequirements(command: ResourceCommand): Promise<Array<{ resource: string; requestId?: string; epoch: number }>> {
    const requirements: Array<{ resource: string; requestId?: string; epoch: number }> = [];
    for (const resource of await this.resources()) {
      await this.transaction(resource, async state => {
        await this.reconcile(state);
        if (!state.controller || !isEnrolled(this.options.principal, state.enrolled)) return;
        if (state.profile === 'build' && !this.isBuildCommand(command)) return;
        this.assertParticipant(state);
        const tickets = state.tickets.filter(ticket => samePrincipal(ticket.principal, this.options.principal) && !ticket.launchId && ['queued', 'reserved'].includes(ticket.state));
        if (tickets.length > 1) throw new PeerError('AMBIGUOUS_TARGET', 'Select the exact resource ticket before launching this command.');
        requirements.push({ resource, epoch: state.epoch, ...(tickets[0] ? { requestId: tickets[0].requestId } : {}) });
      });
    }
    return requirements;
  }

  async claimCommand(input: z.infer<typeof resourceCommandClaimSchema>): Promise<ResourceSnapshot> {
    const parsed = resourceCommandClaimSchema.safeParse(input);
    if (!parsed.success) throw new PeerError('INVALID_PARAMS', 'Invalid resource command claim.');
    const { resource, command, launchId, requestId } = parsed.data;
    return this.transaction(resource, async state => {
      await this.reconcile(state);
      this.assertParticipant(state);
      const previous = state.tickets.find(ticket => ticket.launchId === launchId);
      if (previous) {
        this.assertOwner(previous.principal);
        this.assertTicketUsable(previous);
        if (previous.commandDigest !== commandDigest(command) || requestId && previous.requestId !== requestId) throw new PeerError('REQUEST_ID_CONFLICT', 'This launch identity already belongs to another command or resource request.');
        return this.snapshot(state, previous);
      }
      const available = state.tickets.filter(ticket => samePrincipal(ticket.principal, this.options.principal) && !ticket.launchId && ['queued', 'reserved'].includes(ticket.state));
      if (!requestId && available.length > 1) throw new PeerError('AMBIGUOUS_TARGET', 'Select an exact resource ticket before launching.');
      let ticket = requestId ? this.ticket(state, requestId) : available[0];
      if (ticket) {
        this.assertOwner(ticket.principal);
        this.assertTicketUsable(ticket);
        if (ticket.launchId || !['queued', 'reserved'].includes(ticket.state)) throw new PeerError('RESOURCE_BUSY', 'This request is already assigned to a command.');
      } else {
        if (state.tickets.length >= 4096 || state.tickets.filter(ticket => ticket.state === 'queued').length >= 256) throw new PeerError('QUEUE_FULL', 'The resource ticket queue is full.');
        const executable = path.basename(command.file);
        const reason = /^[A-Za-z0-9_.-]{1,64}$/.test(executable) ? `Run ${executable}` : 'Run a managed command';
        ticket = { requestId: randomUUID(), principal: this.principal, reason, createdAt: this.now(), epoch: state.epoch, state: 'queued' };
        state.tickets.push(ticket);
      }
      ticket.launchId = launchId;
      ticket.commandDigest = commandDigest(command);
      return this.snapshot(state, ticket);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.watcher?.close();
    this.watcher = undefined;
    clearTimeout(this.noticeRetry);
    for (const wake of this.waiters) wake();
    await this.observing?.catch(() => {});
    await this.noticeDelivery?.catch(() => {});
    await Promise.allSettled([...this.transactions]);
  }

  private assertOpen(): void { if (this.closed) throw new PeerError('PEER_OFFLINE', 'The resource coordinator has closed.'); }
  private assertEpoch(state: ResourceState, epoch?: number): void { if (epoch !== undefined && epoch !== state.epoch) throw new PeerError('STALE_POLICY', 'The operation belongs to an earlier resource policy epoch.'); }
  private assertOwner(principal: ResourcePrincipal): void { if (!samePrincipal(principal, this.options.principal)) throw new PeerError('SCOPE_DENIED', 'This reservation belongs to another exact process or run incarnation.'); }
  private assertParticipant(state: ResourceState): void {
    if (!state.controller) throw new PeerError('CONTROLLER_UNAVAILABLE', 'No controller policy is configured for this resource.');
    if (!isEnrolled(this.options.principal, [...state.participants, state.controller])) throw new PeerError('SCOPE_DENIED', 'This principal is not enrolled in the resource policy.');
  }
  private assertTicketUsable(ticket: ResourceTicket): void {
    if (ticket.state === 'stale') throw new PeerError('STALE_POLICY', 'The unused ticket was revoked by a policy change.');
    if (ticket.state === 'expired') throw new PeerError('RESERVATION_EXPIRED', 'The unused reservation expired before spawn.');
    if (ticket.state === 'ended' || ticket.state === 'cancelled') throw new PeerError('TARGET_ENDED', 'This exact resource request has ended.');
  }
  private ticket(state: ResourceState, requestId: string): ResourceTicket {
    const ticket = state.tickets.find(candidate => candidate.requestId === requestId);
    if (!ticket) throw new PeerError('UNKNOWN_TARGET', 'This resource ticket does not exist.');
    return ticket;
  }

  private async reconcile(state: ResourceState): Promise<void> {
    if (state.blockers.length) {
      const launches = await this.readLaunches(true);
      const retained: string[] = [];
      for (const id of state.blockers) {
        const launch = launches.find(candidate => candidate.launchId === id);
        if (launch && (!launch.process || await this.probeProcess(launch.process) !== 'gone')) retained.push(id);
      }
      state.blockers = retained;
    }
    const holder = state.holder;
    if (!holder) return;
    if (holder.state === 'reserved' && holder.expiresAt <= this.now()) {
      this.ticket(state, holder.requestId).state = 'expired';
      state.holder = null;
    } else if (holder.state === 'running' && holder.process && await this.probeProcess(holder.process) === 'gone') {
      this.ticket(state, holder.requestId).state = 'completed';
      state.holder = null;
    }
  }

  private snapshot(state: ResourceState, ticket?: ResourceTicket): ResourceSnapshot {
    const holder = structuredClone(state.holder);
    if (holder) delete holder.command;
    return { resource: state.resource, epoch: state.epoch, controller: state.controller, profile: state.profile,
      state: ticket?.state ?? state.holder?.state ?? (state.blockers.length ? 'running' : state.controller ? 'available' : 'unconfigured'),
      ...(state.blockers.length ? { blockers: [...state.blockers] } : {}),
      ...(ticket ? { requestId: ticket.requestId } : {}), holder,
      queue: state.tickets.filter(candidate => candidate.state === 'queued').map(candidate => ({ ...structuredClone(candidate), waitMs: Math.max(0, this.now() - candidate.createdAt) })),
    };
  }

  private initialize(): Promise<string> {
    this.initializePromise ??= ensurePrivatePeerDirectory(this.options.directory);
    return this.initializePromise;
  }

  private namespaceTransaction<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const transaction = this.initialize().then(directory => withFileLock(path.join(directory, 'namespace.lock'), operation, { waitTimeoutMs: 2_000, retryDelayMs: 5 }));
    this.transactions.add(transaction);
    void transaction.then(() => this.transactions.delete(transaction), () => this.transactions.delete(transaction));
    return transaction;
  }

  private async readLaunches(required = false): Promise<ManagedLaunch[]> {
    const raw = await readPrivatePeerFile(path.join(await this.initialize(), 'launches.json'), 4 * 1024 * 1024);
    if (!raw && !required) return [];
    try { return z.array(launchSchema).max(4096).parse(JSON.parse(raw!)); }
    catch { throw new PeerError('RECOVERY_REQUIRED', 'The managed launch ledger is missing or corrupt; preserve it for explicit recovery.'); }
  }

  private async writeLaunches(launches: ManagedLaunch[]): Promise<void> {
    const value = JSON.stringify(launches);
    if (Buffer.byteLength(value) > 4 * 1024 * 1024) throw new PeerError('QUEUE_FULL', 'The managed launch ledger exceeded its storage bound.');
    await atomicWriteFile(path.join(await this.initialize(), 'launches.json'), value);
  }

  private async resources(): Promise<string[]> {
    const directory = await this.initialize();
    const filenames = (await readdir(directory)).filter(filename => /^[a-f0-9]{64}\.json$/.test(filename));
    if (filenames.length > 256) throw new PeerError('QUEUE_FULL', 'Resource namespace capacity exceeded.');
    const resources: string[] = [];
    for (const filename of filenames) {
      const raw = await readPrivatePeerFile(path.join(directory, filename), 4 * 1024 * 1024);
      if (!raw) continue;
      try {
        const state = stateSchema.parse(JSON.parse(raw));
        if (this.filename(state.resource) !== filename) throw new Error();
        resources.push(state.resource);
      } catch { throw new PeerError('RECOVERY_REQUIRED', 'Resource state is corrupt; preserve it for explicit recovery.'); }
    }
    return resources.sort();
  }

  private filename(resource: string): string { return `${createHash('sha256').update(resource).digest('hex')}.json`; }

  private async resourceForTicket(requestId: string): Promise<string> {
    if (!identifier.safeParse(requestId).success) throw new PeerError('INVALID_PARAMS', 'Invalid resource ticket ID.');
    const matches: string[] = [];
    for (const resource of await this.resources()) {
      await this.transaction(resource, async state => { if (state.tickets.some(ticket => ticket.requestId === requestId)) matches.push(resource); });
    }
    if (matches.length > 1) throw new PeerError('REQUEST_ID_CONFLICT', 'The ticket ID is ambiguous across resources.');
    if (!matches[0]) throw new PeerError('UNKNOWN_TARGET', 'The resource ticket was not found.');
    return matches[0];
  }

  private async withReservation<T>(reservationId: string, operation: (state: ResourceState, reservation: ResourceReservation) => Promise<T>): Promise<T> {
    for (const resource of await this.resources()) {
      const result = await this.transaction(resource, async state => {
        if (state.holder?.reservationId !== reservationId) return { found: false as const };
        return { found: true as const, value: await operation(state, state.holder) };
      });
      if (result.found) return result.value;
    }
    throw new PeerError('UNKNOWN_TARGET', 'The active resource reservation was not found.');
  }

  private transaction<T>(resource: string, operation: (state: ResourceState) => Promise<T>): Promise<T> {
    this.assertOpen();
    const transaction = this.runTransaction(resource, operation);
    this.transactions.add(transaction);
    void transaction.then(() => this.transactions.delete(transaction), () => this.transactions.delete(transaction));
    return transaction;
  }

  private async runTransaction<T>(resource: string, operation: (state: ResourceState) => Promise<T>): Promise<T> {
    const directory = await this.initialize();
    const filename = path.join(directory, this.filename(resource));
    let event: ResourceSnapshot | undefined;
    const result = await withFileLock(`${filename}.lock`, async () => {
      const raw = await readPrivatePeerFile(filename, 4 * 1024 * 1024);
      let state: ResourceState;
      try { state = raw ? stateSchema.parse(JSON.parse(raw)) : { version: 1, resource, epoch: 0, controller: null, participants: [], enrolled: [], profile: 'strict', tickets: [], holder: null, updatedAt: this.now(), eventSequence: 0, events: [], blockers: [] }; }
      catch { throw new PeerError('RECOVERY_REQUIRED', 'Resource state is corrupt; automatic reassignment is forbidden.'); }
      if (state.resource !== resource) throw new PeerError('RECOVERY_REQUIRED', 'Resource file identity does not match its canonical key.');
      const before = JSON.stringify(state);
      const beforeEpoch = state.epoch;
      const previousBlockers = state.blockers.length;
      state.tickets = state.tickets.filter(ticket => ['queued', 'reserved', 'starting', 'running'].includes(ticket.state) || ticket.createdAt > this.now() - 86_400_000);
      const ticketStates = new Map(state.tickets.map(ticket => [ticket.requestId, ticket.state]));
      const value = await operation(state);
      if (JSON.stringify(state) !== before) {
        state.updatedAt = this.now();
        const record = (status: string, ticket?: ResourceTicket) => {
          state.events.push({ resource, sequence: ++state.eventSequence, epoch: state.epoch, state: status,
            ...(ticket ? { requestId: ticket.requestId, principal: ticket.principal } : {}),
            controller: state.controller, audience: [...state.enrolled], createdAt: this.now(),
          });
        };
        if (state.epoch !== beforeEpoch) record('policy_changed');
        if (previousBlockers && !state.blockers.length) record('previous_commands_completed');
        for (const ticket of state.tickets) if (ticketStates.get(ticket.requestId) !== ticket.state) record(ticket.state, ticket);
        state.events = state.events.slice(-1024);
        const serialized = JSON.stringify(state);
        if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw new PeerError('QUEUE_FULL', 'Resource metadata capacity exceeded.');
        await atomicWriteFile(filename, serialized);
        event = this.snapshot(state);
      }
      return value;
    }, { waitTimeoutMs: 2_000, retryDelayMs: 5 });
    if (event) {
      for (const wake of this.waiters) wake();
      try { this.options.onEvent?.(event); } catch { /* Observers do not own resource commits. */ }
      this.scheduleResourceEvents();
    }
    return result;
  }

  private async ensureWatcher(): Promise<void> {
    if (this.watcher) return;
    const directory = await this.initialize();
    if (this.watcher || this.closed) return;
    this.watcher = watch(directory, { persistent: false }, (_event, filename) => {
      if (!filename || filename.toString().endsWith('.json')) {
        for (const wake of this.waiters) wake();
        this.scheduleResourceEvents();
      }
    });
    this.watcher.on('error', () => { this.watcher?.close(); this.watcher = undefined; for (const wake of this.waiters) wake(); });
  }

  private scheduleResourceEvents(): void {
    if (!this.options.onResourceEvent || this.closed) return;
    if (this.noticeDelivery) { this.noticesDirty = true; return; }
    void this.deliverResourceEvents().catch(error => {
      try { this.options.onError?.(error); } catch { /* Observer failures retain the journal cursor for retry. */ }
      if (!this.closed && !this.noticeRetry) {
        this.noticeRetry = setTimeout(() => { this.noticeRetry = undefined; this.scheduleResourceEvents(); }, 250);
        this.noticeRetry.unref?.();
      }
    });
  }

  private deliverResourceEvents(): Promise<void> {
    if (!this.options.onResourceEvent || this.closed) return Promise.resolve();
    this.noticesDirty = true;
    if (this.noticeDelivery) return this.noticeDelivery;
    const delivery = (async () => {
      while (this.noticesDirty && !this.closed) {
        this.noticesDirty = false;
        for (const resource of await this.resources()) {
          if (this.closed) return;
          const raw = await readPrivatePeerFile(path.join(this.options.directory, this.filename(resource)), 4 * 1024 * 1024);
          if (!raw) continue;
          const state = stateSchema.parse(JSON.parse(raw));
          if (state.resource !== resource) throw new PeerError('RECOVERY_REQUIRED', 'Resource journal identity mismatch.');
          for (const event of state.events) {
            if (this.closed) return;
            if (event.sequence <= (this.noticeCursors.get(resource) ?? 0)) continue;
            const eligible = event.principal ? samePrincipal(event.principal, this.options.principal)
              || this.options.canControl && event.controller === this.options.principal.peerId
              : isEnrolled(this.options.principal, event.audience);
            if (eligible) await this.options.onResourceEvent!(structuredClone(event));
            this.noticeCursors.set(resource, event.sequence);
          }
        }
      }
    })();
    this.noticeDelivery = delivery;
    void delivery.then(() => { if (this.noticeDelivery === delivery) this.noticeDelivery = undefined; }, () => { if (this.noticeDelivery === delivery) this.noticeDelivery = undefined; });
    return delivery;
  }

  private isBuildCommand(command: ResourceCommand): boolean {
    const executable = path.basename(command.file).toLowerCase();
    if (['xcodebuild', 'make', 'cmake', 'ninja', 'gradle', 'gradlew', 'mvn', 'swift', 'go', 'cargo'].includes(executable)) return true;
    if (['npm', 'pnpm', 'yarn', 'bun', 'npx'].includes(executable)) return command.args.some(argument => /^(?:build|test|check|proof|lint|typecheck|compile)(?::.*)?$/.test(argument));
    if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'cmd.exe'].includes(executable)) {
      const index = command.args.findIndex(argument => /^-(?:[a-z]*c[a-z]*)$/.test(argument) || argument.toLowerCase() === '/c');
      return index >= 0 && !!command.args[index + 1] && this.isBuildCommand({ ...command, file: command.args[index + 1], args: [] });
    }
    if (executable === 'env') {
      const index = command.args.findIndex(argument => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(argument));
      return index >= 0 && this.isBuildCommand({ ...command, file: command.args[index], args: command.args.slice(index + 1) });
    }
    if (!command.args.length && /\s/.test(command.file)) {
      const words = command.file.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
      const file = words.shift();
      if (file && file !== command.file) return this.isBuildCommand({ ...command, file: file.replace(/^(['"])(.*)\1$/, '$2'), args: words.map(word => word.replace(/^(['"])(.*)\1$/, '$2')) });
    }
    return false;
  }
}
