import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureSearchFromAccount, isSearchConfigured, webSearch } from '../../src/actions/web.js';

const fixture = vi.hoisted(() => ({ home: '', spawn: vi.fn() }));
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), homedir: () => fixture.home }));
vi.mock('fs', async original => {
  const fs = await original<typeof import('fs')>();
  return { ...fs, existsSync: (file: string) => /(?:Google Chrome|google-chrome|chrome\.exe)$/.test(String(file)) || fs.existsSync(file) };
});
vi.mock('child_process', async original => ({ ...await original<typeof import('child_process')>(), spawn: fixture.spawn }));

let root: string;
beforeEach(async () => {
  fixture.home = await mkdtemp(path.join(tmpdir(), 'autohand-profile-lock-'));
  root = process.platform === 'darwin' ? path.join(fixture.home, 'Library/Application Support/Google/Chrome')
    : process.platform === 'win32' ? path.join(fixture.home, 'Google/Chrome/User Data') : path.join(fixture.home, '.config/google-chrome');
  vi.stubEnv('LOCALAPPDATA', fixture.home);
  await mkdir(path.join(root, 'Default'), { recursive: true });
  fixture.spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(), pid: 123 });
    queueMicrotask(() => {
      child.stdout.write('<div class="g"><a href="https://example.org/"><h3>Profile result</h3></a></div>');
      child.emit('close', 0);
    });
    return child;
  });
  await configureSearchFromAccount({ search: { provider: 'browser-profile' } });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(fixture.home, { recursive: true, force: true }); });

describe('Chrome profile SingletonLock', () => {
  it('does not offer a locked profile without a fallback, including Chromium dangling symlink locks', async () => {
    await symlink('host-12345', path.join(root, 'SingletonLock'));
    expect(isSearchConfigured()).toBe(false);
    await expect(webSearch('docs')).rejects.toThrow("Chrome is open on your profile, so browser search can't run. Pick a provider with /search.");
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
  it('uses included Free search instead of launching the locked profile', async () => {
    await symlink('host-12345', path.join(root, 'SingletonLock'));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ available: true, tier: 'free', provider: 'cloudflare', usage: { limit: 10, remaining: 10, resetAt: '2026-10-27T00:00:00.000Z' } }))
      .mockResolvedValueOnce(Response.json({ provider: 'cloudflare', query: 'docs', results: [{ title: 'Managed result', url: 'https://example.org/', snippet: 'Source' }] }));
    vi.stubGlobal('fetch', fetch);
    await configureSearchFromAccount({ auth: { token: 'ahc_verified_free' }, search: { provider: 'browser-profile' } });
    expect(isSearchConfigured()).toBe(true);
    expect(await webSearch('docs')).toHaveProperty('0.title', 'Managed result');
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
  it('uses the connected Chrome bridge before the managed fallback', async () => {
    await symlink('host-12345', path.join(root, 'SingletonLock'));
    const invoke = vi.fn().mockImplementation(async name => name === 'browser_execute_js' ? JSON.stringify([{ title: 'Bridge result', url: 'https://example.org/', snippet: '' }]) : 'ok');
    expect(await webSearch('docs', { browserToolInvoker: invoke })).toHaveProperty('0.title', 'Bridge result');
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
  it('keeps the hosted tool available at the cap and never launches a locked profile to bypass it', async () => {
    await symlink('host-12345', path.join(root, 'SingletonLock'));
    const message = "You've used your 10 free web searches today. Upgrade to Pro for more: https://dev.autohand.ai/search/upgrade?source=cli. Resets in 2h 5m.";
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ available: true, tier: 'free', provider: 'cloudflare', usage: { limit: 10, remaining: 0, resetAt: '2026-10-27T00:00:00.000Z' } }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'web_search_cap_hit', message } }, { status: 429 })));
    await configureSearchFromAccount({ auth: { token: 'ahc_verified_free' }, search: { provider: 'browser-profile' } });
    await expect(webSearch('docs')).rejects.toThrow(message);
    expect(isSearchConfigured()).toBe(true);
    expect(fixture.spawn).not.toHaveBeenCalled();
  });
  it('still launches the browser profile when Chrome is closed', async () => {
    expect(isSearchConfigured()).toBe(true);
    expect(await webSearch('docs')).toHaveProperty('0.title', 'Profile result');
    expect(fixture.spawn).toHaveBeenCalledOnce();
  });
});
