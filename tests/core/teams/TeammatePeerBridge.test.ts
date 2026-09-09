import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { AgentPeerRuntime } from '../../../src/core/agent/AgentPeerRuntime.js';
import { MessageRouter } from '../../../src/core/teams/MessageRouter.js';
import { TeammatePeerClient, TeammatePeerHost } from '../../../src/core/teams/TeammatePeerBridge.js';

let h: PeerHarness;
let root: AgentPeerRuntime;
const cleanup: Array<() => void | Promise<void>> = [];
beforeEach(async () => {
  h = await createPeerHarness();
  root = (await AgentPeerRuntime.start({ home: h.home, workspaceRoot: h.workspaceRoot, sessionId: 'stdio-root',
    policy: { enabled: true, allowResourceControl: true }, appendContext: async () => {}, addContext: () => {},
    notify: () => {}, emitOutput: () => {}, requestAutoTurn: async () => {},
  }))!;
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  await root.close();
  await h.close();
});

function channel() {
  const outgoing = new PassThrough();
  const incoming = new PassThrough();
  const router = new MessageRouter();
  const execution = { taskId: 'task', runId: 'teammate-run' };
  const runtime = root.bindRun(execution.runId, 'worker');
  const host = new TeammatePeerHost(execution, runtime, (method, params) => { router.send(incoming, { method, params }); }, () => true);
  const client = new TeammatePeerClient(execution, host.binding(), (method, params) => { router.send(outgoing, { method, params }); });
  cleanup.push(router.onMessage(outgoing, message => { host.handle(message.method, message.params); }));
  cleanup.push(router.onMessage(incoming, message => { client.handle(message.method, message.params); }));
  cleanup.push(() => { client.disconnect(); outgoing.destroy(); incoming.destroy(); });
  cleanup.push(() => host.close());
  return { runtime, host, client, outgoing, incoming, execution };
}

describe('authenticated parent-owned teammate peer adapter', () => {
  it('drains cancelled channel requests before retiring the runtime', async () => {
    const { runtime, host, client } = channel();
    let release = () => {};
    const finishing = new Promise<void>(resolve => { release = resolve; });
    let cancelled = false;
    vi.spyOn(runtime.messaging, 'messages').mockImplementation(async query => {
      await new Promise<void>(resolve => query?.signal?.addEventListener('abort', () => { cancelled = true; resolve(); }, { once: true }));
      await finishing;
      throw new DOMException('Cancelled request', 'AbortError');
    });
    const retire = vi.spyOn(runtime, 'close').mockResolvedValue();
    const waiting = client.root.messaging.messages({ waitMs: 1000 });
    void waiting.catch(() => {});
    await vi.waitFor(() => expect(runtime.messaging.messages).toHaveBeenCalled());
    const closing = host.close();
    try {
      await vi.waitFor(() => expect(cancelled).toBe(true));
      expect(retire).not.toHaveBeenCalled();
    } finally { release(); await closing; await waiting.catch(() => {}); retire.mockRestore(); }
  });

  it('routes messages through the child identity and records context before consumption', async () => {
    const { client } = channel();
    const peer = await h.create();
    const events = vi.fn();
    client.root.messaging.subscribe(events);
    const receipt = await peer.send({ to: client.root.messaging.self.peerId, content: 'worker-private' });
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'message' }));
    const { messages } = await client.root.messaging.messages({ consume: false });
    expect(messages).toHaveLength(1);
    await expect(client.root.messaging.consumeMessages(messages, async () => { throw new Error('journal failed'); })).rejects.toThrow('journal failed');
    expect(await peer.status(receipt.messageId)).toMatchObject({ state: 'accepted' });
    await client.root.messaging.consumeMessages(messages, async accepted => {
      expect(await peer.status(receipt.messageId)).toMatchObject({ state: 'accepted' });
      await client.root.messaging.recordContext(accepted);
    });
    expect(await peer.status(receipt.messageId)).toMatchObject({ state: 'consumed' });
    await client.root.messaging.send({ to: peer.self.peerId, content: 'worker response', replyTo: receipt.messageId });
    expect((await peer.messages()).messages[0]).toMatchObject({ from: client.root.messaging.self.peerId, replyTo: receipt.messageId });
    expect((await root.messaging.messages({ consume: false })).messages).toEqual([]);
    expect(JSON.stringify(client.root.messaging.self)).not.toMatch(/endpoint|privateKey|publicKey/);
  });

  it('inherits resource enrollment, narrows authority, and retires nested exact runs', async () => {
    const { client } = channel();
    const nested = await client.root.bindRun('nested-stdio-run', 'nested');
    expect(nested).toBeDefined();
    const resource = 'machine/test-build';
    await root.coordinator.coordinate({ operation: 'set_controller', resource, controller: root.messaging.self.peerId, participants: [root.messaging.self.peerId], profile: 'strict' });
    expect(await nested!.coordinator.commandRequirements({ file: 'bun', args: ['test'], cwd: h.workspaceRoot })).toEqual([expect.objectContaining({ resource })]);
    await expect(nested!.coordinator.coordinate({ operation: 'set_controller', resource, controller: nested!.messaging.self.peerId, participants: [], profile: 'strict' })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
    const requested = await nested!.coordinator.coordinate({ operation: 'request', resource, reason: 'test', requestId: 'nested-ticket' });
    expect(await nested!.coordinator.claimCommand({ resource, command: { file: 'bun', args: ['test'], cwd: h.workspaceRoot }, launchId: 'stdio-command', requestId: requested.requestId })).toMatchObject({ requestId: requested.requestId });
    const grant = nested!.coordinator.waitForGrant(requested.requestId!, { timeoutMs: 1000 });
    await root.coordinator.coordinate({ operation: 'grant', requestId: requested.requestId! });
    expect(await grant).toMatchObject({ state: 'reserved' });
    await client.root.close();
    await expect(nested!.messaging.list()).rejects.toMatchObject({ code: 'TARGET_ENDED' });
  });

  it('rejects forged senders and unrelated attempts and cancels waits on disconnect', async () => {
    const { client, host, execution, incoming } = channel();
    const response = vi.fn();
    const stop = new MessageRouter().onMessage(incoming, response);
    cleanup.push(stop);
    host.handle('team.peerRequest', { ...execution, requestId: 'forged', targetRunId: execution.runId, operation: 'send', args: { to: root.messaging.self.peerId, content: 'forgery', from: root.messaging.self.peerId } });
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ requestId: 'forged', error: expect.objectContaining({ code: 'INVALID_PARAMS' }) }) })));
    host.handle('team.peerRequest', { ...execution, runId: 'different-attempt', requestId: 'wrong-attempt', targetRunId: execution.runId, operation: 'list', args: {} });
    await vi.waitFor(() => expect(response).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ requestId: 'wrong-attempt', error: expect.objectContaining({ code: 'TARGET_ENDED' }) }) })));
    const waiting = client.root.messaging.messages({ waitMs: 30_000, consume: false });
    const rejection = expect(waiting).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    client.disconnect();
    await rejection;
    await host.close();
    expect((await root.messaging.messages({ consume: false })).messages).toEqual([]);
  });
});
