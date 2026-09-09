import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PeerProcessDriver } from '../../../src/testing/drivers/peer-process-driver.js';

let root: string;
let home: string;
let workspaceRoot: string;
const processes: PeerProcessDriver[] = [];
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ah-peer-process-'));
  home = path.join(root, 'home');
  workspaceRoot = path.join(root, 'workspace');
  await mkdir(workspaceRoot);
});
afterEach(async () => {
  await Promise.allSettled(processes.splice(0).map(peer => peer.close()));
  await rm(root, { recursive: true, force: true });
});

async function launch(alias: string) {
  const peer = new PeerProcessDriver();
  processes.push(peer);
  await peer.launch({ home, workspaceRoot, alias });
  return peer;
}

describe('independent-process peer integration', () => {
  it('delivers and deduplicates over real local IPC with durable consumed receipts', async () => {
    const sender = await launch('sender');
    const receiver = await launch('receiver');
    const input = { to: receiver.self.peerId, content: 'real process message 🦊', messageId: 'multi-process-1' };
    expect(await sender.request('send', input)).toMatchObject({ state: 'accepted' });
    expect(await sender.request('send', input)).toMatchObject({ state: 'accepted' });
    expect(await receiver.request('messages')).toMatchObject({ messages: [expect.objectContaining({ messageId: input.messageId, content: input.content })] });
    expect(await sender.request('status', { messageId: input.messageId })).toMatchObject({ state: 'consumed' });
  });

  it('never routes an old instance message to a restarted process using the same alias', async () => {
    const sender = await launch('sender');
    const receiver = await launch('same-session');
    await sender.request('list');
    receiver.crash();
    const replacement = await launch('same-session');
    await expect(sender.request('send', { to: receiver.self.peerId, content: 'stale target' })).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    expect(await replacement.request('messages')).toMatchObject({ messages: [] });
  });

  it('preserves capacity across competing process requests and controller grants', async () => {
    const controller = await launch('controller');
    const first = await launch('first');
    const second = await launch('second');
    const resource = 'machine/process-build';
    await controller.request('resource', { operation: 'set_controller', resource, controller: controller.self.peerId, participants: [first.self.peerId, second.self.peerId], profile: 'strict' });
    await Promise.all([
      first.request('resource', { operation: 'request', resource, reason: 'first', requestId: 'first-request' }),
      second.request('resource', { operation: 'request', resource, reason: 'second', requestId: 'second-request' }),
    ]);
    const results = await Promise.allSettled([
      controller.request('resource', { operation: 'grant', requestId: 'first-request' }),
      controller.request('resource', { operation: 'grant', requestId: 'second-request' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const state = await first.request<{ holder: { state: string }; queue: unknown[] }>('resource', { operation: 'status', resource });
    expect(state.holder.state).toBe('reserved');
    expect(state.queue).toHaveLength(1);
  });
});
