import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { AgentPeerRuntime, type AgentPeerRuntimeOptions } from '../../../src/core/agent/AgentPeerRuntime.js';
import type { SessionMessage } from '../../../src/session/types.js';
import { AutohandAgent } from '../../../src/core/agent.js';
import { ResourceCoordinator } from '../../../src/session/peers/ResourceCoordinator.js';

let h: PeerHarness;
const runtimes: AgentPeerRuntime[] = [];
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  await h.close();
});

async function start(overrides: Partial<AgentPeerRuntimeOptions> = {}) {
  const saved: SessionMessage[] = [];
  const live: string[] = [];
  const notify = vi.fn();
  const emitOutput = vi.fn();
  const requestAutoTurn = vi.fn(async () => {});
  const runtime = await AgentPeerRuntime.start({
    home: h.home, workspaceRoot: h.workspaceRoot, sessionId: 'root-runtime',
    policy: { enabled: true, alias: 'receiver' },
    appendContext: async message => { saved.push(message); },
    addContext: content => { live.push(content); },
    notify, emitOutput, requestAutoTurn,
    ...overrides,
  });
  if (runtime) runtimes.push(runtime);
  return { runtime: runtime!, saved, live, notify, emitOutput, requestAutoTurn };
}

describe('root peer lifecycle and recorded context', () => {
  it('pauses automatic arrivals while the root modal is open', async () => {
    const sender = await h.create();
    const { runtime, requestAutoTurn } = await start({ policy: { enabled: true, idleBehavior: 'auto' } });
    const host = Object.assign(Object.create(AutohandAgent.prototype), { peerRuntime: runtime }) as { modalActive: boolean };
    host.modalActive = true;
    await sender.send({ to: runtime.messaging.self.peerId, content: 'preserve the open permission dialog' });
    await new Promise(resolve => setImmediate(resolve));
    expect(requestAutoTurn).not.toHaveBeenCalled();
    host.modalActive = false;
    await vi.waitFor(() => expect(requestAutoTurn).toHaveBeenCalledOnce());
  });

  it('closes the resource observer when startup fails after the messaging endpoint binds', async () => {
    const observer = vi.spyOn(ResourceCoordinator.prototype, 'startEvents').mockRejectedValue(new Error('resource observer unavailable'));
    const close = vi.spyOn(ResourceCoordinator.prototype, 'close');
    try {
      await expect(start()).rejects.toThrow('resource observer unavailable');
      expect(close).toHaveBeenCalledOnce();
    } finally { observer.mockRestore(); close.mockRestore(); }
  });

  it('withdraws messaging even when resource retirement fails during shutdown', async () => {
    const sender = await h.create();
    const { runtime } = await start();
    vi.spyOn(runtime.coordinator, 'endRun').mockRejectedValue(new Error('retirement failed'));
    runtimes.splice(runtimes.indexOf(runtime), 1);
    await expect(runtime.close()).rejects.toThrow();
    try { expect((await sender.list()).peers.some(peer => peer.peerId === runtime.messaging.self.peerId)).toBe(false); }
    finally { await runtime.coordinator.close(); await runtime.messaging.stop(); }
  });

  it('honors cancellation during account preparation before the provider loop becomes active', async () => {
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const refreshAccountPlan = vi.fn(() => held);
    const runInstructionWithPeerActivity = vi.fn(async () => true);
    const agent = Object.assign(Object.create(AutohandAgent.prototype), {
      refreshAccountPlan, runInstructionWithPeerActivity,
      runtimeResourceShutdownController: new AbortController(),
    }) as AutohandAgent;
    const running = agent.runInstruction('automatic preparation', { peerAutomatic: true });
    await vi.waitFor(() => expect(refreshAccountPlan).toHaveBeenCalledOnce());
    agent.cancelCurrentInstruction();
    release();
    expect(await running).toBe(false);
    expect(runInstructionWithPeerActivity).not.toHaveBeenCalled();
  });

  it('serializes automatic and user turn admission before asynchronous account preparation', async () => {
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const started: string[] = [];
    const runInstructionWithPeerActivity = vi.fn(async (text: string) => {
      started.push(text);
      if (text === 'automatic turn') await held;
      return true;
    });
    const agent = Object.assign(Object.create(AutohandAgent.prototype), {
      refreshAccountPlan: vi.fn(async () => {}), runInstructionWithPeerActivity,
      runtimeResourceShutdownController: new AbortController(),
    }) as AutohandAgent;
    const first = agent.runInstruction('automatic turn', { peerAutomatic: true });
    const second = agent.runInstruction('user turn');
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
    try { expect(started).toEqual(['automatic turn']); }
    finally { release(); await Promise.all([first, second]); }
    expect(started).toEqual(['automatic turn', 'user turn']);
  });

  it('delivers remote grants through durable peer events without creating a model turn', async () => {
    const lead = await start({ sessionId: 'resource-lead', policy: { enabled: true, allowResourceControl: true } });
    const worker = await start({ sessionId: 'resource-worker' });
    const resource = 'machine/event-build';
    await lead.runtime.coordinator.coordinate({ operation: 'set_controller', resource, controller: lead.runtime.messaging.self.peerId,
      participants: [worker.runtime.messaging.self.peerId], profile: 'strict' });
    const request = await worker.runtime.coordinator.coordinate({ operation: 'request', resource, reason: 'build event delivery' });
    await vi.waitFor(async () => expect((await worker.runtime.messaging.messages({ consume: false })).events).toContainEqual(expect.objectContaining({
      type: 'resource', resource, requestId: request.requestId, state: 'queued',
    })));
    const cursor = (await worker.runtime.messaging.messages({ consume: false })).cursor;
    const waiting = worker.runtime.messaging.messages({ after: cursor, waitMs: 2000 });
    await lead.runtime.coordinator.coordinate({ operation: 'grant', requestId: request.requestId! });
    expect((await waiting).events).toContainEqual(expect.objectContaining({ type: 'resource', resource, requestId: request.requestId, state: 'reserved' }));
    expect(worker.emitOutput).toHaveBeenCalledWith(expect.objectContaining({ type: 'resource_update', resourceEvent: expect.objectContaining({ state: 'reserved' }) }));
    expect(worker.requestAutoTurn).not.toHaveBeenCalled();
    expect(worker.saved).toEqual([]);
  });

  it('routes child resource events to the exact child inbox while leaving its parent inbox separate', async () => {
    const lead = await start({ sessionId: 'resource-lead', policy: { enabled: true, allowResourceControl: true } });
    const worker = await start({ sessionId: 'resource-worker' });
    const child = worker.runtime.bindRun('event-child', 'event-child');
    const resource = 'machine/child-event-build';
    await lead.runtime.coordinator.coordinate({ operation: 'set_controller', resource, controller: lead.runtime.messaging.self.peerId,
      participants: [worker.runtime.messaging.self.peerId], profile: 'strict' });
    const request = await child.coordinator.coordinate({ operation: 'request', resource, reason: 'child event delivery' });
    await lead.runtime.coordinator.coordinate({ operation: 'grant', requestId: request.requestId! });
    await vi.waitFor(async () => expect((await child.messaging.messages({ consume: false })).events).toContainEqual(expect.objectContaining({
      type: 'resource', resource, requestId: request.requestId, state: 'reserved', to: child.messaging.self.peerId,
    })));
    expect((await worker.runtime.messaging.messages({ consume: false })).events.filter(event => event.requestId === request.requestId)).toEqual([]);
    await child.close();
  });

  it('retires nested peers with their parent and refuses publication from an ended parent', async () => {
    const { runtime } = await start();
    const child = runtime.bindRun('parent-worker', 'parent');
    const nested = await child.bindRun('nested-worker', 'nested');
    expect(nested).toBeDefined();
    await child.close();
    await expect(async () => nested!.messaging.list()).rejects.toMatchObject({ code: 'TARGET_ENDED' });
    expect(() => child.bindRun('after-end', 'stale')).toThrow('TARGET_ENDED');
  });

  it('binds and retires exact child runtimes without adding their inbox to root context', async () => {
    const sender = await h.create();
    const { runtime, saved, live } = await start();
    const child = runtime.bindRun('child-execution', 'worker');
    const receipt = await sender.send({ to: child.messaging.self.peerId, content: 'private worker context' });
    const { messages } = await child.messaging.messages({ consume: false });
    await child.messaging.consumeMessages(messages, accepted => child.messaging.recordContext(accepted));
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'consumed' });
    expect(saved).toEqual([]);
    expect(live).toEqual([]);
    await child.close();
    await expect(sender.send({ to: child.messaging.self.peerId, content: 'ended worker' })).rejects.toMatchObject({ code: 'TARGET_ENDED' });
    expect((await runtime.messaging.list()).peers.some(peer => peer.peerId === child.messaging.self.peerId)).toBe(false);
  });

  it('does not create an endpoint or runtime when communication is disabled', async () => {
    const { runtime } = await start({ policy: {} });
    expect(runtime).toBeUndefined();
    expect(h.peers).toEqual([]);
  });

  it('publishes before discovery, notifies while idle, and records external context at a provider boundary', async () => {
    const sender = await h.create({ alias: 'sender' });
    const { runtime, saved, live, notify, emitOutput, requestAutoTurn } = await start();
    expect((await sender.list()).peers.some(peer => peer.peerId === runtime.messaging.self.peerId)).toBe(true);
    const receipt = await sender.send({ to: runtime.messaging.self.peerId, content: '!do not execute this as a command' });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Message from :sender'));
    expect(emitOutput).toHaveBeenCalledWith(expect.objectContaining({ type: 'peer_update' }));
    expect(saved).toEqual([]);
    expect(requestAutoTurn).not.toHaveBeenCalled();
    runtime.scheduler.beginTurn();
    await runtime.scheduler.safeBoundary();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ role: 'user', _meta: { peerContext: { version: 1 } } });
    expect(live[0]).toContain('external collaboration');
    expect(live[0]).toContain(receipt.messageId);
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'consumed' });
  });

  it('preserves custody and retries when durable transcript recording fails', async () => {
    const sender = await h.create();
    const appendContext = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { runtime, live } = await start({ appendContext });
    const receipt = await sender.send({ to: runtime.messaging.self.peerId, content: 'durable context' });
    runtime.scheduler.beginTurn();
    await expect(runtime.scheduler.safeBoundary()).rejects.toThrow('disk full');
    expect(live).toEqual([]);
    expect(await sender.status(receipt.messageId)).toMatchObject({ state: 'accepted' });
    await runtime.scheduler.safeBoundary();
    expect(live).toHaveLength(1);
    expect(appendContext.mock.calls[0][1]).toBe(appendContext.mock.calls[1][1]);
  });

  it('withdraws the old incarnation on close and never retargets it after a session restart', async () => {
    const sender = await h.create();
    const first = await start();
    const target = first.runtime.messaging.self.peerId;
    await sender.list();
    await first.runtime.close();
    const second = await start();
    expect(second.runtime.messaging.self.peerId).not.toBe(target);
    await expect(sender.send({ to: target, content: 'old draft' })).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    expect((await second.runtime.messaging.messages({ consume: false })).messages).toEqual([]);
  });
});
