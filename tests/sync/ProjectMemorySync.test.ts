import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectMemorySync, normalizeProjectRepository } from '../../src/sync/ProjectMemorySync.js';
import { MemoryEventLog, mergeMemoryEventLogContents } from '../../src/memory/MemoryEventLog.js';
import { MemoryManager } from '../../src/memory/MemoryManager.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map(root => fs.remove(root)));
});
async function client(accountId = 'team-a', repository = 'git@github.com:Acme/app.git') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-memory-sync-')); roots.push(root);
  const workspace = path.join(root, 'workspace');
  const local = path.join(workspace, '.autohand', 'memory');
  const configPath = path.join(root, 'config.json');
  const config = { auth: { token: `token-${root}` }, api: { accountId, baseUrl: 'https://api.example.test' } };
  await fs.writeJson(configPath, config);
  await fs.ensureDir(local);
  const sync = new ProjectMemorySync({ root, configPath, getRepository: async () => repository });
  return { root, workspace, local, configPath, config, sync };
}
function server(canWrite = true) {
  const logs = new Map<string, string>();
  const calls: { account: string; project: string; method: string; log?: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    const account = new Headers(init.headers).get('X-Autohand-Account-Id')!;
    const project = url.pathname.split('/').at(-1)!;
    const key = `${url.origin}/${account}/${project}`;
    const incoming = init.body ? JSON.parse(String(init.body)).log as string : undefined;
    calls.push({ account, project, method: init.method ?? 'GET', log: incoming });
    if (incoming !== undefined) logs.set(key, mergeMemoryEventLogContents(logs.get(key) ?? '', incoming));
    return Response.json({ success: true, accountId: account, projectId: project, canWrite, log: logs.get(key) ?? '' });
  }));
  return { logs, calls };
}
async function append(directory: string, id: string, content: string) {
  const now = new Date().toISOString();
  await new MemoryEventLog(directory).append({ operation: 'create', level: 'project', entry: { id, content, createdAt: now, updatedAt: now } });
}

describe('account-scoped project memory synchronization', () => {
  it('uses the real memory manager to publish, refresh and delete team project knowledge', async () => {
    server(); const alice = await client(), bob = await client();
    const a = new MemoryManager(alice.workspace, { userMemoryDir: path.join(alice.root, 'private'), projectMemory: alice.sync });
    const b = new MemoryManager(bob.workspace, { userMemoryDir: path.join(bob.root, 'private'), projectMemory: bob.sync });
    await a.initialize(); await b.initialize();
    const entry = await a.store('Use one canonical account project adapter', 'project');
    await a.store('My personal keyboard preference', 'user');
    const context = await b.getSharedProjectContext();
    expect(context).toContain('Use one canonical account project adapter');
    expect(context).not.toContain('My personal keyboard preference');
    await b.delete(entry.id, 'project');
    expect(await a.getSharedProjectContext()).not.toContain(entry.content);
    expect(await a.getContextMemories()).toContain('My personal keyboard preference');
    await fs.writeJson(alice.configPath, { ...alice.config, auth: {} });
    expect(await a.getSharedProjectContext()).toBe('');
  });

  it('uses the same credential-free repository identity for SSH and HTTPS', () => {
    const expected = 'github.com/acme/app';
    expect(normalizeProjectRepository('git@github.com:Acme/App.git')).toBe(expected);
    expect(normalizeProjectRepository('ssh://git@github.com:22/Acme/App.git')).toBe(expected);
    expect(normalizeProjectRepository('https://user:secret@github.com/Acme/App.git/')).toBe(expected);
    expect(normalizeProjectRepository('/home/user/app')).toBeNull();
    expect(normalizeProjectRepository('file:///home/user/app')).toBeNull();
    expect(normalizeProjectRepository('https://github.com/acme/app?token=secret')).toBeNull();
  });

  it('invalidates reflection scopes immediately when the selected account or credentials change', async () => {
    server(); const a = await client();
    const connecting = a.sync.scope(a.workspace);
    await a.sync.refresh(a.workspace, a.local);
    const connected = a.sync.scope(a.workspace);
    expect(connected).not.toBe(connecting);
    await a.sync.refresh(a.workspace, a.local);
    expect(a.sync.scope(a.workspace)).toBe(connected);
    expect(connected).toMatch(/^[a-f0-9]{64}$/u);
    await fs.writeJson(a.configPath, { ...a.config, api: { ...a.config.api, accountId: 'team-b' } });
    const selected = a.sync.scope(a.workspace);
    expect(selected).not.toBe(connected);
    expect(a.sync.directory(a.workspace)).toBeUndefined();
    await fs.writeJson(a.configPath, { ...a.config, api: { ...a.config.api, accountId: 'team-b' }, auth: { token: 'replacement-token' } });
    expect(a.sync.scope(a.workspace)).not.toBe(selected);
    await fs.writeJson(a.configPath, { ...a.config, auth: {} });
    expect(a.sync.scope(a.workspace)).not.toBe(connected);
    expect(a.sync.scope(path.join(a.workspace, 'other'))).not.toBe(a.sync.scope(a.workspace));
  });

  it('shares project entries between teammates without uploading personal memories', async () => {
    const remote = server();
    const alice = await client(), bob = await client('team-a', 'https://github.com/acme/app.git');
    await append(alice.local, 'architecture', 'Use the shared repository adapter');
    await fs.outputJson(path.join(alice.root, 'memory', 'private.json'), { content: 'Private personal preference' });
    await alice.sync.refresh(alice.workspace, alice.local);
    await bob.sync.refresh(bob.workspace, bob.local);
    const directory = bob.sync.directory(bob.workspace)!;
    expect((await new MemoryEventLog(directory).replay()).map(entry => entry.content)).toEqual(['Use the shared repository adapter']);
    expect(remote.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
    expect(JSON.stringify(remote.calls)).not.toContain('Private personal preference');
    expect(alice.sync.directory(alice.workspace)).not.toBe(directory);
  });

  it('isolates accounts and repositories and hides cached data immediately after logout', async () => {
    server();
    const a = await client(), b = await client('team-b'), other = await client('team-a', 'git@github.com:acme/other.git');
    await append(a.local, 'decision', 'Repository A shared decision');
    await a.sync.refresh(a.workspace, a.local);
    const teamA = a.sync.directory(a.workspace)!;
    await append(teamA, 'team-a-only', 'Team A only shared knowledge');
    await a.sync.publish(a.workspace, a.local, teamA);
    await b.sync.refresh(b.workspace, b.local); await other.sync.refresh(other.workspace, other.local);
    expect(await new MemoryEventLog(b.sync.directory(b.workspace)!).replay()).toEqual([]);
    expect(await new MemoryEventLog(other.sync.directory(other.workspace)!).replay()).toEqual([]);
    await fs.writeJson(a.configPath, { ...a.config, api: { ...a.config.api, accountId: 'team-b' } });
    expect(a.sync.directory(a.workspace)).toBeUndefined();
    await a.sync.refresh(a.workspace, a.local);
    const teamB = a.sync.directory(a.workspace)!;
    expect((await new MemoryEventLog(teamB).replay()).map(entry => entry.id)).toEqual(['decision']);
    expect(teamB).not.toBe(b.sync.directory(b.workspace));
    await fs.writeJson(a.configPath, { ...a.config, auth: {} });
    expect(a.sync.directory(a.workspace)).toBeUndefined();
  });

  it('merges remote tombstones and publishes only the bound account cache', async () => {
    server(); const a = await client(), b = await client();
    await a.sync.refresh(a.workspace, a.local);
    const directory = a.sync.directory(a.workspace)!;
    await append(directory, 'shared-entry', 'Remove this obsolete convention');
    await a.sync.publish(a.workspace, a.local, directory);
    await b.sync.refresh(b.workspace, b.local);
    const bDirectory = b.sync.directory(b.workspace)!;
    await new MemoryEventLog(bDirectory).append({ operation: 'delete', level: 'project', memoryId: 'shared-entry' });
    await b.sync.publish(b.workspace, b.local, bDirectory);
    await a.sync.publish(a.workspace, a.local, directory);
    await a.sync.refresh(a.workspace, a.local);
    expect(await new MemoryEventLog(directory).replay()).toEqual([]);
    await fs.writeJson(a.configPath, { ...a.config, api: { ...a.config.api, accountId: 'team-b' } });
    const request = vi.mocked(fetch); request.mockClear();
    await a.sync.publish(a.workspace, a.local, directory);
    expect(request).not.toHaveBeenCalled();
  });

  it('requires explicit account/auth/enabled sync and refuses readonly writes', async () => {
    server(false); const a = await client();
    await a.sync.refresh(a.workspace, a.local);
    expect(() => a.sync.assertWritable(a.workspace)).toThrow(/read.only/i);
    const request = vi.mocked(fetch); request.mockClear();
    await fs.writeJson(a.configPath, { ...a.config, api: { baseUrl: a.config.api.baseUrl } });
    await a.sync.refresh(a.workspace, a.local); expect(request).not.toHaveBeenCalled();
    await fs.writeJson(a.configPath, { ...a.config, sync: { enabled: false } });
    await a.sync.refresh(a.workspace, a.local); expect(request).not.toHaveBeenCalled();
    await fs.writeJson(a.configPath, { ...a.config, sync: { exclude: ['memory/**'] } });
    await a.sync.refresh(a.workspace, a.local); expect(request).not.toHaveBeenCalled();
  });

  it('keeps last good same-account data offline and rejects a delayed old-account response', async () => {
    server(); const a = await client(); await a.sync.refresh(a.workspace, a.local);
    const directory = a.sync.directory(a.workspace);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow('offline');
    expect(a.sync.directory(a.workspace)).toBe(directory);
    let reply!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { reply = resolve; })));
    const old = a.sync.refresh(a.workspace, a.local);
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    await fs.writeJson(a.configPath, { ...a.config, api: { ...a.config.api, accountId: 'team-b' } });
    reply(Response.json({ success: true, accountId: 'team-a', projectId: '0'.repeat(64), canWrite: true, log: '' }));
    await expect(old).rejects.toThrow(/changed|scope/i);
    expect(a.sync.directory(a.workspace)).toBeUndefined();
  });

  it('rejects foreign scope/personal events and symlinked cache paths', async () => {
    const a = await client();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, accountId: 'other', projectId: '0'.repeat(64), canWrite: true, log: '' })));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow(/scope|account/i);
    expect(a.sync.directory(a.workspace)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json({ success: true, accountId: 'team-a', projectId: url.pathname.split('/').at(-1), canWrite: true,
      log: JSON.stringify({ version: 1, eventId: 'private-user-event', level: 'user', operation: 'create', memoryId: 'private', occurredAt: new Date().toISOString(),
        entry: { id: 'private', content: 'Personal preference', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }) + '\n' })));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow(/project entries only/i);
    server(); const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'project-memory-target-')); roots.push(destination);
    await fs.symlink(destination, path.join(a.root, '.project-memories'));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow(/symlink/i);
    expect(await fs.readdir(destination)).toEqual([]);
  });

  it('does not restore revoked shared data during a later offline refresh', async () => {
    server(); const a = await client(); await a.sync.refresh(a.workspace, a.local);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'membership removed' }, { status: 403 })));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow('403');
    expect(a.sync.directory(a.workspace)).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(a.sync.refresh(a.workspace, a.local)).rejects.toThrow('offline');
    expect(a.sync.directory(a.workspace)).toBeUndefined();
  });

  it('discards a delayed response after the repository origin changes in the same directory', async () => {
    const a = await client();
    let repository = 'git@github.com:acme/app.git';
    const sync = new ProjectMemorySync({ root: a.root, configPath: a.configPath, getRepository: async () => repository });
    let reply!: () => void;
    vi.stubGlobal('fetch', vi.fn((url: URL) => new Promise<Response>(resolve => {
      reply = () => resolve(Response.json({ success: true, accountId: 'team-a', projectId: url.pathname.split('/').at(-1), canWrite: true, log: '' }));
    })));
    const pending = sync.refresh(a.workspace, a.local);
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    repository = 'git@github.com:acme/other.git'; reply();
    await expect(pending).rejects.toThrow(/repository.*changed|scope.*changed/i);
    expect(sync.directory(a.workspace)).toBeUndefined();
  });

  it('honors the API environment override and isolates another API origin', async () => {
    server(); const a = await client(); await a.sync.refresh(a.workspace, a.local);
    const first = a.sync.directory(a.workspace)!;
    await append(first, 'original-api-only', 'Knowledge owned by the original API account');
    await a.sync.publish(a.workspace, a.local, first);
    vi.stubEnv('AUTOHAND_API_URL', 'https://preview-api.example.test');
    expect(a.sync.directory(a.workspace)).toBeUndefined();
    await a.sync.refresh(a.workspace, a.local);
    const second = a.sync.directory(a.workspace)!;
    expect(second).not.toBe(first);
    expect(await new MemoryEventLog(second).replay()).toEqual([]);
    expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain('preview-api.example.test');
  });
});
