import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveAgentRegistry } from '../../../src/session/ActiveAgentRegistry.js';
import { LocalPeerTransport } from '../../../src/session/peers/LocalPeerTransport.js';
import { PEER_ENDPOINT_LIFECYCLE, PeerMessaging } from '../../../src/session/peers/PeerMessaging.js';
import { reachableStates, StateMachine, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

let root: string;
const peers: PeerMessaging[] = [];

beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'ah-peer-lifecycle-')); });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(peers.splice(0).map(peer => peer.stop()));
  await rm(root, { recursive: true, force: true });
});

async function endpoint(): Promise<PeerMessaging> {
  const workspaceRoot = path.join(root, 'project');
  await mkdir(workspaceRoot, { recursive: true });
  const peer = new PeerMessaging({
    home: path.join(root, 'home'), workspaceRoot, sessionId: `session-${peers.length + 1}`, alias: 'worker',
    policy: { enabled: true, scope: 'workspace', idleBehavior: 'notify' },
  });
  peers.push(peer);
  return peer;
}

function registry(): ActiveAgentRegistry {
  return new ActiveAgentRegistry(path.join(root, 'home', 'active-agents'));
}

const offline = { code: 'PEER_OFFLINE', message: 'PEER_OFFLINE: This peer endpoint is not running.' };
const incarnationStopped = { code: 'PEER_OFFLINE', message: 'PEER_OFFLINE: This peer incarnation has stopped.' };

describe('PEER_ENDPOINT_LIFECYCLE transition table', () => {
  const events = ['start', 'started', 'failed', 'stop'] as const;

  it('declares the endpoint lifecycle edges', () => {
    expect(PEER_ENDPOINT_LIFECYCLE.initial).toBe('idle');
    expect(PEER_ENDPOINT_LIFECYCLE.transitions).toEqual({
      idle: { start: 'starting', stop: 'stopped' },
      starting: { started: 'running', failed: 'failed', stop: 'stopped' },
      running: { stop: 'stopped' },
      failed: { stop: 'stopped' },
      stopped: {},
    });
  });

  it('rejects a second start and any revival once stopped', () => {
    const machine = new StateMachine(PEER_ENDPOINT_LIFECYCLE);
    machine.send('start');
    expect(machine.can('start')).toBe(false);
    machine.send('started');
    expect(machine.can('start')).toBe(false);
    expect(machine.can('failed')).toBe(false);
    machine.send('stop');
    for (const event of events) expect(machine.can(event)).toBe(false);
  });

  it('has stopped as its only terminal state and reaches every state', () => {
    expect(terminalStates(PEER_ENDPOINT_LIFECYCLE)).toEqual(['stopped']);
    expect(reachableStates(PEER_ENDPOINT_LIFECYCLE)).toEqual(new Set(Object.keys(PEER_ENDPOINT_LIFECYCLE.transitions)));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(PEER_ENDPOINT_LIFECYCLE, events, { seeds: 50, steps: 40 });
  });
});

describe('PeerMessaging endpoint lifecycle behaviour', () => {
  it('refuses operations before start with the endpoint-offline error', async () => {
    const peer = await endpoint();
    expect(peer.lifecycleState).toBe('idle');
    await expect(peer.resolve('worker')).rejects.toMatchObject(offline);
    expect(() => peer.bindRun({ runId: 'run-1', alias: 'child', capabilities: [] })).toThrow(offline.message);
  });

  it('binds one transport when start is called concurrently', async () => {
    const bind = vi.spyOn(LocalPeerTransport.prototype, 'start');
    const peer = await endpoint();
    await Promise.all([peer.start(), peer.start()]);
    expect(bind).toHaveBeenCalledOnce();
    expect(peer.lifecycleState).toBe('running');
    await expect(peer.list()).resolves.toBeDefined();
  });

  it('never binds the transport when stopped before start', async () => {
    const bind = vi.spyOn(LocalPeerTransport.prototype, 'start');
    const peer = await endpoint();
    await peer.stop();
    await expect(peer.start()).rejects.toMatchObject(incarnationStopped);
    expect(bind).not.toHaveBeenCalled();
    expect(peer.lifecycleState).toBe('stopped');
  });

  it('does not bind the transport when stop arrives while start is still preparing storage', async () => {
    const bind = vi.spyOn(LocalPeerTransport.prototype, 'start');
    const peer = await endpoint();
    const starting = peer.start();
    expect(peer.lifecycleState).toBe('starting');
    await peer.stop();
    await starting;
    expect(bind).not.toHaveBeenCalled();
    expect(peer.lifecycleState).toBe('stopped');
    await expect(peer.resolve('worker')).rejects.toMatchObject(offline);
    await expect(peer.start()).rejects.toMatchObject(incarnationStopped);
  });

  it('closes the transport and starts no heartbeat when stop arrives during the first presence publish', async () => {
    const write = ActiveAgentRegistry.prototype.write;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(ActiveAgentRegistry.prototype, 'write').mockImplementationOnce(async function (this: ActiveAgentRegistry, record) {
      await gate;
      return write.call(this, record);
    });
    const close = vi.spyOn(LocalPeerTransport.prototype, 'close');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const peer = await endpoint();
    const starting = peer.start();
    await vi.waitFor(() => expect(ActiveAgentRegistry.prototype.write).toHaveBeenCalled());
    const stopping = peer.stop();
    release();
    await Promise.all([starting, stopping]);
    expect(close).toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(peer.getAdvertisement()).toBeUndefined();
    expect(await registry().listActive()).toEqual([]);
  });

  it('is not running when the first presence publish fails, and stop still releases it', async () => {
    vi.spyOn(ActiveAgentRegistry.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
    const close = vi.spyOn(LocalPeerTransport.prototype, 'close');
    const peer = await endpoint();
    await expect(peer.start()).rejects.toThrow('disk full');
    expect(peer.lifecycleState).toBe('failed');
    await expect(peer.resolve('worker')).rejects.toMatchObject(offline);
    await expect(peer.start()).rejects.toThrow('disk full');
    await peer.stop();
    expect(close).toHaveBeenCalled();
    expect(peer.lifecycleState).toBe('stopped');
  });

  it('refuses operations after stop with the existing offline messages', async () => {
    const peer = await endpoint();
    await peer.start();
    await Promise.all([peer.stop(), peer.stop()]);
    await expect(peer.resolve('worker')).rejects.toMatchObject(offline);
    await expect(peer.send({ to: 'anyone', content: 'late' })).rejects.toMatchObject(offline);
    await expect(peer.start()).rejects.toMatchObject(incarnationStopped);
  });
});
