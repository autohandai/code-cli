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
