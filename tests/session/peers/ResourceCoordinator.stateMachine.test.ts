import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  RESOURCE_TICKET_LIFECYCLE, ResourceCoordinator, type ResourcePrincipal, type ResourceTicketEvent,
} from '../../../src/session/peers/ResourceCoordinator.js';
import { reachableStates, StateMachine, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

let directory: string;
let now: number;
let processState: 'alive' | 'gone' | 'unknown';
const instances: ResourceCoordinator[] = [];
const controller: ResourcePrincipal = { peerId: 'peer-controller', instanceId: 'controller-instance' };
const worker: ResourcePrincipal = { peerId: 'peer-worker', instanceId: 'worker-instance', runId: 'build-1' };
const resource = 'machine/xcodebuild';
const command = { file: 'xcodebuild', args: ['-scheme', 'Example'], cwd: '/workspace' };
const proof = { pid: 12345, startedAt: 'process-start-token', processGroupId: 12345 };

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'ah-resource-sm-'));
  now = Date.now();
  processState = 'alive';
});
afterEach(async () => {
  await Promise.allSettled(instances.splice(0).map(instance => instance.close()));
  await rm(directory, { recursive: true, force: true });
});

function coordinator(principal: ResourcePrincipal) {
  const instance = new ResourceCoordinator({
    directory, principal, canControl: principal.peerId === controller.peerId, now: () => now,
    isPrincipalAlive: async () => true,
    probeProcess: async () => processState,
  });
  instances.push(instance);
  return instance;
}

async function setup() {
  const lead = coordinator(controller);
  const first = coordinator(worker);
  await lead.coordinate({ operation: 'set_controller', resource, controller: controller.peerId, participants: [worker.peerId, controller.peerId], profile: 'strict' });
  return { lead, first };
}

async function grantedTicket(lead: ResourceCoordinator, first: ResourceCoordinator, requestId = 'request-1') {
  await first.coordinate({ operation: 'request', resource, reason: 'Build the project', requestId });
  await lead.coordinate({ operation: 'grant', requestId });
  return requestId;
}

interface StoredTicket { requestId: string; state: string }
interface StoredState { tickets: StoredTicket[]; holder: { requestId: string; state: string; expiresAt: number } | null; events: Array<{ state: string; requestId?: string }> }

const stateFile = () => path.join(directory, `${createHash('sha256').update(resource).digest('hex')}.json`);
async function readState(): Promise<StoredState> { return JSON.parse(await readFile(stateFile(), 'utf8')) as StoredState; }
async function rewriteState(mutate: (state: StoredState) => void): Promise<void> {
  const state = await readState();
  mutate(state);
  await writeFile(stateFile(), JSON.stringify(state));
  await chmod(stateFile(), 0o600);
}

describe('RESOURCE_TICKET_LIFECYCLE transition table', () => {
  const events: readonly ResourceTicketEvent[] = ['grant', 'start', 'spawn', 'spawn_failed', 'complete', 'release', 'expire', 'revoke', 'cancel', 'end'];

  it('declares the ticket lifecycle edges', () => {
    expect(RESOURCE_TICKET_LIFECYCLE.initial).toBe('queued');
    expect(RESOURCE_TICKET_LIFECYCLE.transitions).toEqual({
      queued: { grant: 'reserved', revoke: 'stale', cancel: 'cancelled', end: 'ended' },
      reserved: { start: 'starting', release: 'released', expire: 'expired', revoke: 'stale', cancel: 'cancelled', end: 'ended' },
      starting: { spawn: 'running', spawn_failed: 'released' },
      running: { complete: 'completed' },
      released: {}, cancelled: {}, expired: {}, stale: {}, ended: {}, completed: {},
    });
  });

  it('never lets a launched ticket be cancelled, released, revoked or ended', () => {
    for (const initial of ['starting', 'running'] as const) {
      const machine = new StateMachine(RESOURCE_TICKET_LIFECYCLE, { initial });
      for (const event of ['cancel', 'release', 'revoke', 'end', 'expire', 'grant'] as const) expect(machine.can(event)).toBe(false);
    }
  });

  it('treats every finished ticket as terminal and reaches every state', () => {
    expect(terminalStates(RESOURCE_TICKET_LIFECYCLE).sort()).toEqual(['cancelled', 'completed', 'ended', 'expired', 'released', 'stale']);
    expect(reachableStates(RESOURCE_TICKET_LIFECYCLE)).toEqual(new Set(Object.keys(RESOURCE_TICKET_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(RESOURCE_TICKET_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('ResourceCoordinator ticket lifecycle regressions', () => {
  it('does not rewrite an expired ticket to cancelled or journal a second terminal notice', async () => {
    const { lead, first } = await setup();
    const requestId = await grantedTicket(lead, first);
    now += 30_001;
    await lead.coordinate({ operation: 'status', resource });
    await expect(first.coordinate({ operation: 'cancel_request', requestId })).resolves.toMatchObject({ requestId, state: 'expired' });
    const { tickets, events } = await readState();
    expect(tickets.find(ticket => ticket.requestId === requestId)?.state).toBe('expired');
    expect(events.filter(event => event.requestId === requestId).map(event => event.state)).toEqual(['queued', 'reserved', 'expired']);
  });

  it('does not rewrite a policy-revoked ticket to cancelled', async () => {
    const { lead, first } = await setup();
    const requestId = await grantedTicket(lead, first);
    await lead.coordinate({ operation: 'set_controller', resource, controller: controller.peerId, participants: [worker.peerId], profile: 'strict' });
    await expect(first.coordinate({ operation: 'cancel_request', requestId })).resolves.toMatchObject({ state: 'stale' });
    await expect(first.beforeSpawn({ requestId, command })).rejects.toMatchObject({ code: 'STALE_POLICY' });
  });

  it('keeps a cancelled ticket cancelled when an older record still lists it as the expired holder', async () => {
    const { lead, first } = await setup();
    const requestId = await grantedTicket(lead, first);
    await rewriteState(state => { state.tickets[0]!.state = 'cancelled'; });
    now += 30_001;
    const status = await lead.coordinate({ operation: 'status', resource });
    expect(status.holder).toBeNull();
    expect((await readState()).tickets.find(ticket => ticket.requestId === requestId)?.state).toBe('cancelled');
  });

  it('loads an older record whose holder ticket was pruned without bricking the resource', async () => {
    const { lead, first } = await setup();
    await grantedTicket(lead, first);
    await rewriteState(state => { state.tickets = []; });
    now += 30_001;
    await expect(lead.coordinate({ operation: 'status', resource })).resolves.toMatchObject({ holder: null, state: 'available' });
    await first.coordinate({ operation: 'request', resource, reason: 'Build again', requestId: 'request-2' });
    await expect(lead.coordinate({ operation: 'grant', requestId: 'request-2' })).resolves.toMatchObject({ state: 'reserved' });
  });

  it('clears a finished running holder from an older record without its ticket', async () => {
    const { lead, first } = await setup();
    const requestId = await grantedTicket(lead, first);
    const reservation = await first.beforeSpawn({ requestId, command });
    await first.recordSpawn(reservation.reservationId, proof);
    await rewriteState(state => { state.tickets = []; });
    processState = 'gone';
    await expect(lead.coordinate({ operation: 'status', resource })).resolves.toMatchObject({ holder: null });
  });
});
