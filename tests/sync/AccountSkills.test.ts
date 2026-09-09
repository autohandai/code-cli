import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { syncAccountSkills } from '../../src/sync/AccountSkills.js';
import { SkillsRegistry } from '../../src/skills/SkillsRegistry.js';
import type { LoadedConfig } from '../../src/types.js';

const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(dir => fs.remove(dir))); });
const skill = { id: 'skill-1', name: 'account-review', description: 'Account review instructions', instructions: 'Review the tests.', source: 'custom', enabled: true };
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'account-skills-')); dirs.push(root);
  const config = { configPath: path.join(root, 'config.json'), auth: { token: 'test-token' }, api: { accountId: 'account-a', baseUrl: 'https://api.example.test' } } as LoadedConfig;
  await fs.writeJson(config.configPath, config);
  const registry = new SkillsRegistry(path.join(root, 'skills'));
  await registry.initialize();
  return { root, config, registry };
}
describe('automatic account skill synchronization', () => {
  it('keeps downloading account skills when the account cannot accept local uploads', async () => {
    const { root, config, registry } = await setup(), homeDir = path.join(root, 'home');
    await fs.outputFile(path.join(homeDir, '.agents/skills/abc/SKILL.md'), '---\nname: abc\ndescription: Local\n---\nCheck the result.');
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit) => {
      if (String(url).endsWith('/ack')) return Response.json({ success: true });
      if (init.method === 'POST') return Response.json({ error: 'read_only' }, { status: 403 });
      return Response.json({ accountId: 'account-a', revision: 1, skills: [skill] });
    }));
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(registry.hasSkill('account-review')).toBe(true);
  });
  it('bounds the refreshed snapshot after publishing a local skill', async () => {
    const { root, config } = await setup(), homeDir = path.join(root, 'home');
    await fs.outputFile(path.join(homeDir, '.agents/skills/abc/SKILL.md'), '---\nname: abc\ndescription: Local\n---\nCheck the result.');
    let uploaded = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init: RequestInit) => {
      if (init.method === 'POST') { uploaded = true; return Response.json({ skill: { ...skill, name: 'abc', description: 'Local', instructions: 'Check the result.' } }); }
      if (uploaded) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20_000_001)); controller.close(); } }));
      return Response.json({ accountId: 'account-a', revision: 0, skills: [] });
    }));
    await expect(syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir })).rejects.toThrow('size limit');
    expect(await fs.pathExists(path.join(root, '.account-skills/snapshot.json'))).toBe(false);
  });
  it('publishes user agents skills for Dev and keeps cloud edits and local files intact', async () => {
    const { root, config } = await setup();
    const homeDir = path.join(root, 'home');
    const file = path.join(homeDir, '.agents/skills/abc/SKILL.md');
    await fs.outputFile(file, '---\nname: abc\ndescription: My workflow\n---\nCheck the result.\n');
    let snapshot = { accountId: 'account-a', revision: 0, skills: [] as (typeof skill)[] };
    const writes: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('X-Autohand-Account-Id')).toBe('account-a');
      if (String(url).endsWith('/ack')) return Response.json({ success: true });
      if (init.method === 'POST' || init.method === 'PATCH') {
        const body = JSON.parse(String(init.body)); writes.push({ method: init.method, body });
        if (init.method === 'PATCH') expect(body.expectedRevision).toBe(snapshot.revision);
        const next = { ...skill, ...body, id: 'published-abc' };
        snapshot = { ...snapshot, revision: snapshot.revision + 1, skills: [next] };
        return Response.json({ success: true, skill: next }, { status: init.method === 'POST' ? 201 : 200 });
      }
      return Response.json(snapshot);
    }));
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'POST', body: { name: 'abc', description: 'My workflow', instructions: 'Check the result.', source: 'custom', enabled: true } });
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(writes).toHaveLength(1);
    await fs.writeFile(file, '---\nname: abc\ndescription: My workflow\n---\nCheck the tests too.\n');
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ method: 'PATCH', body: { instructions: 'Check the tests too.' } });
    snapshot.skills[0].instructions = 'Changed in Dev.'; snapshot.revision++;
    await fs.writeFile(file, '---\nname: abc\ndescription: My workflow\n---\nA competing local edit.\n');
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(writes).toHaveLength(2);
    expect(snapshot.skills[0].instructions).toBe('Changed in Dev.');
    expect(await fs.readFile(file, 'utf8')).toContain('A competing local edit.');
  });
  it('does not upload when sync is disabled or skills are excluded', async () => {
    const { root, config } = await setup();
    const homeDir = path.join(root, 'home');
    await fs.outputFile(path.join(homeDir, '.agents/skills/abc/SKILL.md'), '---\nname: abc\ndescription: Local\n---\nPrivate guidance.');
    const request = vi.fn(async () => Response.json({ accountId: 'account-a', revision: 0, skills: [] }));
    vi.stubGlobal('fetch', request);
    config.sync = { enabled: false, interval: 300000 };
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(request).not.toHaveBeenCalled();
    config.sync = { enabled: true, interval: 300000, exclude: ['skills/'] };
    await syncAccountSkills(config, 'test-token', 'device-a', { root, homeDir });
    expect(request.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')).toHaveLength(1);
  });
  it('hot-applies additions, disable, enable and removal without deleting local skills', async () => {
    const { root, config, registry } = await setup();
    await registry.saveSkill('local-review', '---\nname: local-review\ndescription: Local instructions\n---\nLeave local files alone.');
    let snapshot = { accountId: 'account-a', revision: 1, skills: [skill] };
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit) => {
      requests.push(String(url)); expect(new Headers(init.headers).get('X-Autohand-Account-Id')).toBe('account-a');
      return Response.json(String(url).endsWith('/ack') ? { success: true } : { success: true, ...snapshot });
    }));
    await syncAccountSkills(config, 'test-token', 'device-a', { root });
    expect(registry.activateSkill('account-review')).toBe(true);
    expect(registry.getActiveSkills().map(s => s.name)).toContain('account-review');
    snapshot = { ...snapshot, revision: 2, skills: [{ ...skill, enabled: false }] };
    await syncAccountSkills(config, 'test-token', 'device-a', { root });
    expect(registry.getSkill('account-review')).toBeNull(); expect(registry.activateSkill('account-review')).toBe(false);
    expect(registry.getActiveSkills().map(s => s.name)).not.toContain('account-review');
    snapshot = { ...snapshot, revision: 3, skills: [skill] }; await syncAccountSkills(config, 'test-token', 'device-a', { root });
    expect(registry.hasSkill('account-review')).toBe(true);
    snapshot = { ...snapshot, revision: 4, skills: [] }; await syncAccountSkills(config, 'test-token', 'device-a', { root });
    expect(registry.hasSkill('account-review')).toBe(false);
    expect(registry.hasSkill('local-review')).toBe(true);
    expect(requests.filter(url => url.endsWith('/ack'))).toHaveLength(4);
  });
  it('rejects invalid or wrong-account snapshots before acknowledging them', async () => {
    const { root, config, registry } = await setup();
    const fetchMock = vi.fn(async () => Response.json({ accountId: 'account-b', revision: 1, skills: [skill] })); vi.stubGlobal('fetch', fetchMock);
    await expect(syncAccountSkills(config, 'test-token', 'device-a', { root })).rejects.toThrow(/account/i);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(registry.hasSkill('account-review')).toBe(false);
    fetchMock.mockImplementation(async () => Response.json({ accountId: 'account-a', revision: 1, skills: [{ ...skill, id: '../escape' }] }));
    await expect(syncAccountSkills(config, 'test-token', 'device-a', { root })).rejects.toThrow();
  });
  it('keeps last good data offline, but stops exposing it after logout or account switch', async () => {
    const { root, config, registry } = await setup();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, accountId: 'account-a', revision: 1, skills: [skill] })));
    await syncAccountSkills(config, 'test-token', 'device-a', { root }); expect(registry.hasSkill('account-review')).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(syncAccountSkills(config, 'test-token', 'device-a', { root })).rejects.toThrow('offline');
    expect(registry.hasSkill('account-review')).toBe(true);
    await fs.writeJson(config.configPath, { ...config, api: { ...config.api, accountId: 'account-b' } });
    expect(registry.hasSkill('account-review')).toBe(false);
    await fs.writeJson(config.configPath, { ...config, auth: {} }); expect(registry.hasSkill('account-review')).toBe(false);
  });
  it('does not follow symlinked cache roots or downgrade a newer revision', async () => {
    const { root, config } = await setup();
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'account-skills-target-')); dirs.push(target);
    await fs.symlink(target, path.join(root, '.account-skills'));
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ accountId: 'account-a', revision: 1, skills: [skill] })));
    await expect(syncAccountSkills(config, 'test-token', 'device-a', { root })).rejects.toThrow(/symlink/i);
    expect(await fs.readdir(target)).toEqual([]);
  });
  it('does not expose a second CLI profiles account in an existing registry', async () => {
    const { root, config, registry } = await setup();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, accountId: 'account-a', revision: 1, skills: [skill] })));
    await syncAccountSkills(config, 'test-token', 'device-a', { root });
    const otherConfig = { ...config, configPath: path.join(root, 'other-profile.json'), api: { ...config.api, accountId: 'account-b' } };
    await fs.writeJson(otherConfig.configPath, otherConfig);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, accountId: 'account-b', revision: 1, skills: [{ ...skill, name: 'other-account-skill' }] })));
    await syncAccountSkills(otherConfig, 'test-token', 'device-b', { root });
    expect(registry.hasSkill('other-account-skill')).toBe(false);
    expect(registry.hasSkill('account-review')).toBe(true);
    const otherRegistry = new SkillsRegistry(path.join(root, 'skills'), 'autohand-user', { accountConfigPath: otherConfig.configPath });
    expect(otherRegistry.hasSkill('other-account-skill')).toBe(true);
    expect(otherRegistry.hasSkill('account-review')).toBe(false);
  });
});
