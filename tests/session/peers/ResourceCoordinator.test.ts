import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResourceCoordinator, type ResourcePrincipal, type ResourceNotice } from '../../../src/session/peers/ResourceCoordinator.js';

let directory: string;
let now: number;
const alive = new Map<string, boolean>();
let processState: 'alive' | 'gone' | 'unknown';
const instances: ResourceCoordinator[] = [];
const controller: ResourcePrincipal = { peerId: 'peer-controller', instanceId: 'controller-instance' };
const worker: ResourcePrincipal = { peerId: 'peer-worker', instanceId: 'worker-instance', runId: 'build-1' };
const second: ResourcePrincipal = { peerId: 'peer-second', instanceId: 'second-instance', runId: 'build-2' };
const resource = 'machine/xcodebuild';
const command = { file: 'xcodebuild', args: ['-scheme', 'Example'], cwd: '/workspace' };
const proof = { pid: 12345, startedAt: 'process-start-token', processGroupId: 12345 };

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-resource-'));
  now = Date.now();
  processState = 'alive';
  alive.clear();
  for (const principal of [controller, worker, second]) alive.set(principal.peerId, true);
});
afterEach(async () => {
  await Promise.allSettled(instances.splice(0).map(instance => instance.close()));
  await rm(directory, { recursive: true, force: true });
});

function coordinator(principal = controller, canControl = principal.peerId === controller.peerId) {
  const instance = new ResourceCoordinator({
    directory, principal, canControl, now: () => now,
    isPrincipalAlive: async candidate => alive.get(candidate.peerId) === true,
    probeProcess: async () => processState,
  });
  instances.push(instance);
  return instance;
}

async function setup() {
  const lead = coordinator();
  const first = coordinator(worker);
  const other = coordinator(second);
  await lead.coordinate({ operation: 'set_controller', resource, controller: controller.peerId, participants: [worker.peerId, second.peerId, controller.peerId], profile: 'strict' });
  return { lead, first, other };
}

async function request(instance: ResourceCoordinator, id = 'request-1') {
  const result = await instance.coordinate({ operation: 'request', resource, reason: 'Build the project', requestId: id });
  if (!result.requestId) throw new Error('A request must return its stable ticket');
  return { ...result, requestId: result.requestId };
}

describe('resource policy and authority', () => {
  it('adopts an already admitted build on enrollment and waits for its whole process lifetime', async () => {
    const first = coordinator(worker);
    await first.beginLaunch('existing-build', command, []);
    await first.publishLaunch('existing-build', proof);
    const { lead, other } = await setup();
    expect(await lead.coordinate({ operation: 'status', resource })).toMatchObject({ blockers: ['existing-build'], state: 'running' });
    const next = await request(other);
    await expect(lead.coordinate({ operation: 'grant', requestId: next.requestId })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    await expect(first.finishLaunch('existing-build')).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    processState = 'gone';
    await first.finishLaunch('existing-build');
    expect(await lead.coordinate({ operation: 'grant', requestId: next.requestId })).toMatchObject({ state: 'reserved' });
  });

  it('keeps an unpublished spawn occupied across policy changes until the executor proves spawn failure', async () => {
    const first = coordinator(worker);
    await first.beginLaunch('unpublished-build', command, []);
    const { lead, other } = await setup();
    const next = await request(other);
    processState = 'gone';
    await expect(lead.coordinate({ operation: 'grant', requestId: next.requestId })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    await first.finishLaunch('unpublished-build', true);
    expect(await lead.coordinate({ operation: 'grant', requestId: next.requestId })).toMatchObject({ state: 'reserved' });
  });

  it('rejects final spawn admission when a new policy requires an additional reservation', async () => {
    const first = coordinator(worker);
    expect(await first.commandRequirements(command)).toEqual([]);
    await setup();
    await expect(first.beginLaunch('racing-build', command, [])).rejects.toMatchObject({ code: 'STALE_POLICY' });
  });

  it('retries an unacknowledged remote journal event with its original sequence', async () => {
    const { lead, first } = await setup();
    const received: number[] = [];
    let rejectGrant = true;
    const onError = vi.fn();
    const onResourceEvent = vi.fn(async (event: ResourceNotice) => {
      if (event.state !== 'reserved') return;
      if (rejectGrant) { rejectGrant = false; throw new Error('mailbox sync failed'); }
      received.push(event.sequence);
    });
    const observer = new ResourceCoordinator({ directory, principal: worker, canControl: false, onResourceEvent, onError });
    instances.push(observer);
    await observer.startEvents();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    const attempts = onResourceEvent.mock.calls.filter(([event]) => event.state === 'reserved').map(([event]) => event.sequence);
    expect(attempts).toEqual([received[0], received[0]]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight journal delivery before closing and then stops delivering', async () => {
    const { lead, first } = await setup();
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const onResourceEvent = vi.fn(async (event: ResourceNotice) => { if (event.state === 'queued') { entered(); await gate; } });
    const observer = new ResourceCoordinator({ directory, principal: worker, canControl: false, onResourceEvent });
    instances.push(observer);
    await observer.startEvents();
    const ticket = await request(first);
    await started;
    let closed = false;
    const closing = observer.close().then(() => { closed = true; });
    try { await Promise.resolve(); expect(closed).toBe(false); } finally { release(); await closing; }
    const delivered = onResourceEvent.mock.calls.length;
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    expect(onResourceEvent).toHaveBeenCalledTimes(delivered);
  });

  it('waits for an in-flight resource transaction before shutdown completes', async () => {
    const { first } = await setup();
    const ticket = await request(first, 'shutdown-ticket');
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const closingController = new ResourceCoordinator({ directory, principal: controller, canControl: true,
      isPrincipalAlive: async () => { entered(); await blocked; return true; },
    });
    instances.push(closingController);
    const grant = closingController.coordinate({ operation: 'grant', requestId: ticket.requestId });
    await started;
    let closed = false;
    const closing = closingController.close().then(() => { closed = true; });
    try {
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally { release(); await Promise.all([grant, closing]); }
    expect(closed).toBe(true);
    await expect(closingController.coordinate({ operation: 'status', resource })).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
  });

  it.each([
    { file: 'bun run build', args: [] },
    { file: '/bin/sh', args: ['-c', 'bun run build'] },
    { file: '/bin/zsh', args: ['-lc', 'CI=1 npm run test'] },
    { file: 'env', args: ['CI=1', 'cargo', 'check'] },
  ])('recognizes the documented build profile through a common shell wrapper: $file', async input => {
    const { lead, first } = await setup();
    await lead.coordinate({ operation: 'set_controller', resource, controller: controller.peerId, participants: [worker.peerId], profile: 'build' });
    expect(await first.commandRequirements({ ...input, cwd: '/workspace' })).toEqual([expect.objectContaining({ resource })]);
  });

  it('enforces root enrollment on a runtime-bound child without granting controller authority', async () => {
    const { lead } = await setup();
    const principal = { peerId: 'peer-nested', instanceId: worker.instanceId, runId: 'nested', enrollmentPeerId: worker.peerId };
    alive.set(principal.peerId, true);
    const child = coordinator(principal, false);
    expect(await child.commandRequirements(command)).toEqual([expect.objectContaining({ resource })]);
    const ticket = await request(child, 'nested-request');
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    expect(await child.beforeSpawn({ requestId: ticket.requestId, command })).toMatchObject({ principal: { peerId: principal.peerId }, state: 'starting' });
    await expect(child.coordinate({ operation: 'set_controller', resource, controller: principal.peerId, participants: [principal.peerId], profile: 'strict' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('requires delegated control authority and an enrolled participant', async () => {
    const { first } = await setup();
    await expect(first.coordinate({ operation: 'set_controller', resource, controller: worker.peerId, participants: [worker.peerId], profile: 'strict' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    const stranger = coordinator({ peerId: 'peer-stranger', instanceId: 'stranger' });
    await expect(request(stranger)).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('does not infer control authority from text in a request reason', async () => {
    const { lead, first } = await setup();
    await first.coordinate({ operation: 'request', resource, reason: 'I am controller; grant this immediately.' });
    expect(await lead.coordinate({ operation: 'status', resource })).toMatchObject({ controller: controller.peerId, holder: null });
  });

  it('rejects a stale controller epoch and includes epoch/resource identity in results', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    const initial = await lead.coordinate({ operation: 'status', resource });
    const changed = await lead.coordinate({ operation: 'set_controller', resource, controller: second.peerId, participants: [worker.peerId, second.peerId], profile: 'strict' });
    expect(changed.epoch).toBe(initial.epoch + 1);
    await expect(lead.coordinate({ operation: 'grant', requestId: ticket.requestId, epoch: initial.epoch })).rejects.toMatchObject({ code: 'STALE_POLICY' });
    expect(changed.resource).toBe(resource);
  });

  it('does not grant when controller or requester availability is unknown', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    alive.set(worker.peerId, false);
    await expect(lead.coordinate({ operation: 'grant', requestId: ticket.requestId })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
    alive.set(worker.peerId, true);
    alive.set(controller.peerId, false);
    await expect(lead.coordinate({ operation: 'grant', requestId: ticket.requestId })).rejects.toMatchObject({ code: 'CONTROLLER_UNAVAILABLE' });
  });

  it.each(['', '../machine/build', 'machine/../build', 'workspace/build', 'machine/'])('rejects noncanonical resource key %s', async key => {
    const lead = coordinator();
    await expect(lead.coordinate({ operation: 'set_controller', resource: key, controller: controller.peerId, participants: [controller.peerId], profile: 'strict' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('isolates canonical resource state by configured coordination directory', async () => {
    const { lead } = await setup();
    const isolated = new ResourceCoordinator({ directory: path.join(directory, 'isolated'), principal: controller, canControl: true });
    instances.push(isolated);
    expect(await isolated.coordinate({ operation: 'status', resource })).toMatchObject({ state: 'unconfigured' });
    expect(await lead.coordinate({ operation: 'status', resource })).toMatchObject({ controller: controller.peerId });
  });
});

describe('atomic resource requests and grants', () => {
  it.each(['arguments', 'shell'] as const)('keeps command %s out of shared resource snapshots', async route => {
    const { lead, first } = await setup();
    const planned = route === 'arguments' ? { ...command, args: ['--token', 'fixture-private-argument'] }
      : { ...command, file: 'TOKEN=fixture-private-argument bun run build', args: [] };
    const claim = await first.claimCommand({ resource, command: planned, launchId: 'private-command' });
    expect(JSON.stringify(await lead.coordinate({ operation: 'status', resource }))).not.toContain('fixture-private-argument');
    await lead.coordinate({ operation: 'grant', requestId: claim.requestId! });
    await first.beforeSpawn({ requestId: claim.requestId!, command: planned });
    expect(JSON.stringify(await lead.coordinate({ operation: 'status', resource }))).not.toContain('fixture-private-argument');
  });

  it('claims a command ticket atomically, preserves an explicit manual ticket, and rejects rebinding', async () => {
    const { first, other } = await setup();
    const manual = await request(first, 'manual-build');
    const claimed = await first.claimCommand({ resource, command, launchId: 'launch-1' });
    expect(claimed.requestId).toBe(manual.requestId);
    expect(await first.claimCommand({ resource, command, launchId: 'launch-1' })).toEqual(claimed);
    const second = await first.claimCommand({ resource, command, launchId: 'launch-2' });
    expect(second.requestId).not.toBe(claimed.requestId);
    await expect(first.claimCommand({ resource, command: { ...command, args: ['different'] }, launchId: 'launch-1' })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
    await expect(other.claimCommand({ resource, command, launchId: 'cross-owner', requestId: manual.requestId })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('creates idempotent tickets and rejects cross-owner ticket reuse', async () => {
    const { first, other } = await setup();
    const firstTicket = await request(first);
    expect(await request(first)).toEqual(firstTicket);
    await expect(request(other)).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
    await expect(first.coordinate({ operation: 'request', resource, reason: 'different reason', requestId: firstTicket.requestId })).rejects.toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
  });

  it('allows only one reservation when independent coordinator objects race to grant', async () => {
    const { lead, first, other } = await setup();
    const firstTicket = await request(first, 'first');
    const secondTicket = await request(other, 'second');
    const secondController = coordinator();
    const results = await Promise.allSettled([
      lead.coordinate({ operation: 'grant', requestId: firstTicket.requestId }),
      secondController.coordinate({ operation: 'grant', requestId: secondTicket.requestId }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const status = await lead.coordinate({ operation: 'status', resource });
    expect(status.holder?.state).toBe('reserved');
    expect(status.queue).toHaveLength(1);
  });

  it('keeps queued requests visible in FIFO order with wait age', async () => {
    const { lead, first, other } = await setup();
    await request(first, 'older');
    now += 5_000;
    await request(other, 'newer');
    const status = await lead.coordinate({ operation: 'status', resource });
    expect(status.queue.map(ticket => ticket.requestId)).toEqual(['older', 'newer']);
    expect(status.queue[0].waitMs).toBe(5_000);
    expect(status.queue[1].waitMs).toBe(0);
  });

  it('permits explicit controller priority without killing the current build', async () => {
    const { lead, first, other } = await setup();
    const current = await request(first, 'current');
    await lead.coordinate({ operation: 'grant', requestId: current.requestId });
    const reservation = await first.beforeSpawn({ requestId: current.requestId, command });
    await first.recordSpawn(reservation.reservationId, proof);
    const waiting = await request(other, 'waiting');
    await expect(lead.coordinate({ operation: 'grant', requestId: waiting.requestId })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toMatchObject({ requestId: current.requestId, state: 'running', process: proof });
  });

  it('expires only an unused reservation after thirty seconds', async () => {
    const { lead, first, other } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    now += 30_001;
    const next = await request(other, 'next');
    expect(await lead.coordinate({ operation: 'grant', requestId: next.requestId })).toMatchObject({ state: 'reserved' });
    await expect(first.beforeSpawn({ requestId: ticket.requestId, command })).rejects.toMatchObject({ code: 'RESERVATION_EXPIRED' });
  });

  it('releases only the caller’s unused reservation and makes repeated release idempotent', async () => {
    const { lead, first, other } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    await expect(other.coordinate({ operation: 'release', requestId: ticket.requestId })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await first.coordinate({ operation: 'release', requestId: ticket.requestId });
    await expect(first.coordinate({ operation: 'release', requestId: ticket.requestId })).resolves.toMatchObject({ state: 'released' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
  });

  it('invalidates reserved capacity on policy change without releasing starting or running capacity', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    await lead.coordinate({ operation: 'set_controller', resource, controller: controller.peerId, participants: [worker.peerId], profile: 'build' });
    await expect(first.beforeSpawn({ requestId: ticket.requestId, command })).rejects.toMatchObject({ code: 'STALE_POLICY' });
    const next = await request(first, 'starting');
    await lead.coordinate({ operation: 'grant', requestId: next.requestId });
    const reservation = await first.beforeSpawn({ requestId: next.requestId, command });
    await lead.coordinate({ operation: 'set_controller', resource, controller: second.peerId, participants: [second.peerId], profile: 'strict' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toMatchObject({ reservationId: reservation.reservationId, state: 'starting' });
  });
});

describe('process lifetime and conservative recovery', () => {
  it('binds exactly one planned command at the final spawn transition', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    const reservation = await first.beforeSpawn({ requestId: ticket.requestId, command });
    expect(reservation).toMatchObject({ state: 'starting', command });
    await expect(first.beforeSpawn({ requestId: ticket.requestId, command: { ...command, args: ['different'] } })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
  });

  it('holds starting occupancy indefinitely across a crash before process publication', async () => {
    const { lead, first, other } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    await first.beforeSpawn({ requestId: ticket.requestId, command });
    await first.close();
    alive.set(worker.peerId, false);
    now += 24 * 60 * 60 * 1_000;
    const next = await request(other, 'after-crash');
    await expect(lead.coordinate({ operation: 'grant', requestId: next.requestId })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder?.state).toBe('starting');
  });

  it('does not release a running build on heartbeat loss, run cancellation, timeout or controller replacement', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    const reservation = await first.beforeSpawn({ requestId: ticket.requestId, command });
    await first.recordSpawn(reservation.reservationId, proof);
    alive.set(worker.peerId, false);
    now += 1_000_000;
    await first.endRun(worker.runId!);
    await lead.coordinate({ operation: 'set_controller', resource, controller: second.peerId, participants: [second.peerId], profile: 'strict' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder?.state).toBe('running');
    await expect(first.coordinate({ operation: 'release', requestId: ticket.requestId })).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
  });

  it('releases only after the recorded process tree is proven gone', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    const reservation = await first.beforeSpawn({ requestId: ticket.requestId, command });
    await first.recordSpawn(reservation.reservationId, proof);
    await expect(first.complete(reservation.reservationId)).rejects.toMatchObject({ code: 'RESOURCE_BUSY' });
    processState = 'unknown';
    await expect(first.complete(reservation.reservationId)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    processState = 'gone';
    await first.complete(reservation.reservationId);
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
  });

  it('preserves ownership across a coordinator restart and rejects a mismatched process incarnation', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    const reservation = await first.beforeSpawn({ requestId: ticket.requestId, command });
    await first.recordSpawn(reservation.reservationId, proof);
    await first.close();
    const restarted = coordinator({ ...worker, instanceId: 'replacement' });
    await expect(restarted.recordSpawn(reservation.reservationId, { ...proof, startedAt: 'reused-pid' })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder?.process).toEqual(proof);
  });

  it('cancels queued and unused reservations when their exact run ends', async () => {
    const { lead, first, other } = await setup();
    const queued = await request(first, 'queued');
    const reserved = await request(other, 'reserved');
    await lead.coordinate({ operation: 'grant', requestId: reserved.requestId });
    await first.endRun(worker.runId!);
    await other.endRun(second.runId!);
    const status = await lead.coordinate({ operation: 'status', resource });
    expect(status.queue).toEqual([]);
    expect(status.holder).toBeNull();
    await expect(lead.coordinate({ operation: 'grant', requestId: queued.requestId })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
  });

  it('adopts an already running managed process only with verified ownership evidence', async () => {
    const { lead, first } = await setup();
    const adopted = await first.adoptRunning({ resource, command, process: proof });
    expect(adopted).toMatchObject({ state: 'running', process: proof });
    processState = 'unknown';
    await expect(lead.adoptRunning({ resource: 'machine/other', command, process: proof })).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
  });
});

describe('parked resource waits', () => {
  it('wakes on a grant without holding the metadata lock', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    const waiting = first.waitForGrant(ticket.requestId, { timeoutMs: 1_000 });
    expect((await lead.coordinate({ operation: 'status', resource })).queue).toHaveLength(1);
    await lead.coordinate({ operation: 'grant', requestId: ticket.requestId });
    expect(await waiting).toMatchObject({ requestId: ticket.requestId, state: 'reserved' });
  });

  it('returns a typed hard deadline and cancels the queued request without spawning', async () => {
    const { lead, first } = await setup();
    const ticket = await request(first);
    await expect(first.waitForGrant(ticket.requestId, { timeoutMs: 5 })).rejects.toMatchObject({ code: 'RESOURCE_WAIT_TIMEOUT' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder).toBeNull();
  });

  it('aborts promptly and preserves another run’s reservation', async () => {
    const { lead, first, other } = await setup();
    const holder = await request(other, 'holder');
    await lead.coordinate({ operation: 'grant', requestId: holder.requestId });
    const ticket = await request(first, 'waiting');
    const controller = new AbortController();
    const waiting = first.waitForGrant(ticket.requestId, { timeoutMs: 30_000, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect((await lead.coordinate({ operation: 'status', resource })).holder?.requestId).toBe(holder.requestId);
  });
});
