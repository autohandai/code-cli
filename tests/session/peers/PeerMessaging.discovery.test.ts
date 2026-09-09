import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createPeerHarness, type PeerHarness } from '../../../src/testing/scenarios/peerCommunicationHarness.js';
import { ActiveAgentRegistry } from '../../../src/session/ActiveAgentRegistry.js';

let h: PeerHarness;
beforeEach(async () => { h = await createPeerHarness(); });
afterEach(async () => { await h.close(); });

describe('peer discovery and exact identities', () => {
  it('keeps each picker scope cached independently and prevents delegated cache widening', async () => {
    const outside = path.join(h.root, 'outside');
    await mkdir(outside);
    const policy = { enabled: true, scope: 'machine' as const };
    const sender = await h.create({ policy });
    const receiver = await h.create({ policy, workspaceRoot: outside });
    await sender.list({ scope: 'machine' });
    await sender.list({ scope: 'workspace' });
    expect(sender.cachedPeers('machine')).toContainEqual(expect.objectContaining({ peerId: receiver.self.peerId }));
    expect(sender.cachedPeers()).toEqual([]);
    const child = sender.bindRun({ runId: 'local-child', alias: 'local-child', capabilities: ['message.send'], scope: 'workspace' });
    expect(() => child.cachedPeers('machine')).toThrow(/scope/i);
  });
  it('does not widen the cached picker scope when resolving an exact machine target', async () => {
    const outside = path.join(h.root, 'outside');
    await mkdir(outside);
    const policy = { enabled: true, scope: 'machine' as const };
    const sender = await h.create({ policy });
    const receiver = await h.create({ policy, workspaceRoot: outside });
    await sender.list({ scope: 'workspace' });
    await sender.resolve(receiver.self.peerId);
    expect(sender.cachedPeers()).toEqual([]);
  });

  it('keeps simultaneous instances of a resumed session separate, including cleanup', async () => {
    const first = await h.create({ sessionId: 'shared' });
    const second = await h.create({ sessionId: 'shared' });
    expect(first.self.instanceId).not.toBe(second.self.instanceId);
    expect(first.self.peerId).not.toBe(second.self.peerId);
    expect((await first.list()).peers.map(peer => peer.peerId)).toEqual([second.self.peerId]);
    await first.stop();
    const observer = await h.create();
    expect((await observer.list()).peers.map(peer => peer.peerId)).toEqual([second.self.peerId]);
  });

  it('never retargets a previous opaque identity to a restarted session or reused alias', async () => {
    const sender = await h.create();
    const original = await h.create({ sessionId: 'resumed', alias: 'builder' });
    const oldId = original.self.peerId;
    await original.stop();
    const replacement = await h.create({ sessionId: 'resumed', alias: 'builder' });
    await expect(sender.send({ to: oldId, content: 'old task' })).rejects.toMatchObject({ code: 'PEER_OFFLINE' });
    expect((await replacement.messages()).messages).toEqual([]);
  });

  it('canonicalizes workspace symlinks', async () => {
    const alias = path.join(h.root, 'project-alias');
    await symlink(h.workspaceRoot, alias, 'dir');
    const first = await h.create();
    const second = await h.create({ workspaceRoot: alias });
    expect((await first.list()).peers.map(peer => peer.peerId)).toContain(second.self.peerId);
    expect(second.self.workspaceId).toBe(await realpath(h.workspaceRoot));
  });

  it('groups linked worktrees by the common Git directory but keeps clones separate', async () => {
    execFileSync('git', ['init', '-q'], { cwd: h.workspaceRoot });
    execFileSync('git', ['-c', 'user.name=Peer Test', '-c', 'user.email=peer@example.test', 'commit', '--allow-empty', '-qm', 'Fixture'], { cwd: h.workspaceRoot });
    const linked = path.join(h.root, 'linked');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'linked', linked], { cwd: h.workspaceRoot });
    const clone = path.join(h.root, 'clone');
    execFileSync('git', ['clone', '-q', h.workspaceRoot, clone]);
    const policy = { enabled: true, scope: 'repository' as const, idleBehavior: 'notify' as const };
    const first = await h.create({ policy });
    const related = await h.create({ workspaceRoot: linked, policy });
    await h.create({ workspaceRoot: clone, policy });
    expect((await first.list({ scope: 'workspace' })).peers).toEqual([]);
    expect((await first.list({ scope: 'repository' })).peers.map(peer => peer.peerId)).toEqual([related.self.peerId]);
  });

  it('keeps separate homes isolated unless a shared namespace was explicitly configured', async () => {
    const first = await h.create();
    await h.create({ home: path.join(h.root, 'other-home') });
    expect((await first.list()).peers).toEqual([]);
    const namespace = path.join(h.root, 'shared-namespace');
    const third = await h.create({ home: path.join(h.root, 'third-home'), coordinationDirectory: namespace });
    const fourth = await h.create({ home: path.join(h.root, 'fourth-home'), coordinationDirectory: namespace });
    expect((await third.list()).peers.map(peer => peer.peerId)).toEqual([fourth.self.peerId]);
  });

  it('restricts scope at both sender and recipient', async () => {
    const elsewhere = path.join(h.root, 'elsewhere');
    await mkdir(elsewhere);
    const workspace = await h.create();
    const machine = await h.create({ workspaceRoot: elsewhere, policy: { enabled: true, scope: 'machine', idleBehavior: 'notify' } });
    await expect(workspace.list({ scope: 'machine' })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(machine.send({ to: workspace.self.peerId, content: 'outside scope' })).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('redacts cross-project context and never exposes transport credentials in model listings', async () => {
    const elsewhere = path.join(h.root, 'other-project');
    await mkdir(elsewhere);
    const policy = { enabled: true, scope: 'machine' as const, idleBehavior: 'notify' as const };
    const first = await h.create({ policy });
    await h.create({ workspaceRoot: elsewhere, policy, activity: () => ({ phase: 'running_command', instruction: 'private instruction', command: 'echo secret-token', pathsWritten: ['/private/file'] }) });
    const serialized = JSON.stringify(await first.list({ scope: 'machine' }));
    for (const secret of ['secret-token', 'private instruction', '/private/file', 'endpoint', 'publicKey', 'privateKey']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('other-project');
  });

  it('returns bounded, non-overlapping pages and filters aliases and project names', async () => {
    const viewer = await h.create({ limits: { directoryPageSize: 2 } });
    for (const alias of ['alpha', 'beta', 'gamma']) await h.create({ alias });
    const first = await viewer.list();
    const second = await viewer.list({ cursor: first.nextCursor });
    expect(first.peers).toHaveLength(2);
    expect(second.peers).toHaveLength(1);
    expect(new Set([...first.peers, ...second.peers].map(peer => peer.peerId)).size).toBe(3);
    expect((await viewer.list({ query: 'gamma' })).peers.map(peer => peer.alias)).toEqual(['gamma']);
    await expect(viewer.list({ cursor: '../../invalid' })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
  });

  it('requires unique alias resolution and does not use PIDs or paths as recipients', async () => {
    const sender = await h.create();
    await h.create({ alias: 'builder' });
    await h.create({ alias: 'builder' });
    await expect(sender.resolve('builder')).rejects.toMatchObject({ code: 'AMBIGUOUS_TARGET' });
    for (const target of [String(process.pid), '/tmp/peer.sock', '*']) {
      await expect(sender.send({ to: target, content: 'test' })).rejects.toMatchObject({ code: 'UNKNOWN_TARGET' });
    }
  });

  it('refreshes explicit discovery without waiting for the heartbeat', async () => {
    const first = await h.create();
    expect((await first.list()).peers).toEqual([]);
    const second = await h.create();
    expect((await first.list()).peers.map(peer => peer.peerId)).toContain(second.self.peerId);
    await second.stop();
    expect((await first.list()).peers).toEqual([]);
  });

  it('does not start an endpoint or publish communication capability when disabled', async () => {
    const peer = await h.create({ policy: { enabled: false, scope: 'workspace', idleBehavior: 'notify' } });
    expect(peer.getAdvertisement()).toBeUndefined();
    await expect(peer.send({ to: 'peer-target', content: 'hello' })).rejects.toMatchObject({ code: 'COMMUNICATION_DISABLED' });
  });
});

describe('compatible, private presence publication', () => {
  it('publishes additive v1 records atomically with no message bodies or private keys', async () => {
    const peer = await h.create();
    const directory = path.join(h.home, 'active-agents');
    const [filename] = (await readdir(directory)).filter(name => name.endsWith('.json'));
    expect(filename).toContain(peer.self.instanceId);
    const record = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    expect(record).toMatchObject({ version: 1, sessionId: peer.self.sessionId, communication: { protocol: 1, instanceId: peer.self.instanceId } });
    expect(JSON.stringify(record)).not.toMatch(/privateKey|BEGIN PRIVATE|inbox|outbox/);
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(directory, filename))).mode & 0o777).toBe(0o600);
    }
  });

  it('preserves a valid legacy record whose optional communication extension is malformed', async () => {
    const peer = await h.create();
    const registry = new ActiveAgentRegistry(path.join(h.home, 'active-agents'));
    const [template] = await registry.listActive();
    const filename = path.join(h.home, 'active-agents', 'legacy.json');
    await writeFile(filename, JSON.stringify({ ...template, sessionId: 'legacy', communication: { protocol: 'bad', endpoint: 42 } }), { mode: 0o600 });
    const listed = await registry.listActive();
    expect(listed.find(record => record.sessionId === 'legacy')).toMatchObject({ sessionId: 'legacy' });
    expect((await peer.list()).peers.find(entry => entry.sessionId === 'legacy')).toMatchObject({ availability: 'presence_only' });
    expect(await readFile(filename, 'utf8')).toContain('legacy');
  });

  it('never removes or reads through a symlink registry entry', async () => {
    await h.create();
    const victim = path.join(h.root, 'unrelated.json');
    await writeFile(victim, 'private');
    const link = path.join(h.home, 'active-agents', 'foreign.json');
    await symlink(victim, link);
    const registry = new ActiveAgentRegistry(path.join(h.home, 'active-agents'));
    await registry.listActive();
    expect(await readFile(victim, 'utf8')).toBe('private');
    expect(await realpath(link)).toBe(await realpath(victim));
  });

  it('preserves all owned records during concurrent writes and scans', async () => {
    const first = await h.create({ sessionId: 'shared' });
    const second = await h.create({ sessionId: 'shared' });
    const registry = new ActiveAgentRegistry(path.join(h.home, 'active-agents'));
    const records = await registry.listActive();
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      await registry.write({ ...records[index % records.length], updatedAt: new Date().toISOString() });
      expect(await registry.listActive()).toHaveLength(2);
    }));
    await first.stop();
    expect((await registry.listActive()).map(record => record.communication?.instanceId)).toEqual([second.self.instanceId]);
  });
});
