import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureSearchFromAccount, getSearchConfig, isSearchConfigured, webSearch } from '../../src/actions/web.js';
import { SETTINGS_REGISTRY, settings } from '../../src/commands/settings.js';

vi.mock('../../src/config.js', async original => ({ ...await original<typeof import('../../src/config.js')>(), saveConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs', async original => ({ ...await original<typeof import('fs')>(), existsSync: () => false }));
afterEach(() => { vi.unstubAllGlobals(); });
describe('account-aware search configuration', () => {
  it('selects included search only after the account API confirms availability', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ provider: 'cloudflare', available: true, tier: 'lite' }))
      .mockResolvedValueOnce(Response.json({ provider: 'cloudflare', query: 'docs', results: [] }));
    vi.stubGlobal('fetch', fetch);
    await configureSearchFromAccount({ auth: { token: 'ahc_paid' } });
    expect(getSearchConfig().provider).toBe('autohand');
    expect(JSON.stringify(getSearchConfig())).not.toContain('ahc_paid');
    expect(isSearchConfigured()).toBe(true);
    await webSearch('docs');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('honors explicit providers and clears managed credentials on account changes', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ provider: 'cloudflare', available: true, tier: 'max' }));
    vi.stubGlobal('fetch', fetch);
    await configureSearchFromAccount({ auth: { token: 'ahc_old' }, search: { provider: 'autohand' } });
    await configureSearchFromAccount({ search: { provider: 'exa', exaApiKey: 'own-key' } }, 'brave');
    expect(getSearchConfig().provider).toBe('brave');
    expect(fetch).not.toHaveBeenCalled();
    await expect(webSearch('docs', { provider: 'autohand' })).rejects.toThrow('Sign in');
  });
  it('keeps Free on local providers and reports missing browser setup without a Google fallback', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ provider: 'cloudflare', available: false, tier: 'free' }));
    vi.stubGlobal('fetch', fetch);
    await configureSearchFromAccount({ auth: { token: 'ahc_free' } });
    expect(getSearchConfig().provider).toBe('browser-profile');
    await expect(webSearch('docs')).rejects.toThrow('Connect Chromium');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('lists the same providers and default in settings as runtime', () => {
    expect(SETTINGS_REGISTRY.find(setting => setting.key === 'search.provider')).toMatchObject({
      defaultValue: 'browser-profile', enumValues: expect.arrayContaining(['autohand', 'browser-profile', 'exa', 'brave', 'parallel', 'google', 'duckduckgo']),
    });
    expect(SETTINGS_REGISTRY.some(setting => setting.key === 'search.exaApiKey')).toBe(true);
  });
  it('does not let an older capability request overwrite the newly selected account', async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const old = configureSearchFromAccount({ auth: { token: 'ahc_old' } });
    await configureSearchFromAccount({ search: { provider: 'exa', exaApiKey: 'new-key' } });
    finish(Response.json({ provider: 'cloudflare', available: true, tier: 'max' }));
    await old;
    expect(getSearchConfig().provider).toBe('exa');
    await expect(webSearch('docs', { provider: 'autohand' })).rejects.toThrow('Sign in');
  });

  it('applies /settings search changes to the running provider immediately', async () => {
    await configureSearchFromAccount({ search: { provider: 'google' } });
    const config = { configPath: '/tmp/search-fixture.json', search: { provider: 'google' as const } };
    await settings({ config }, ['search.provider', 'exa']);
    expect(getSearchConfig().provider).toBe('exa');
    await settings({ config }, ['search.exaApiKey', 'live-exa-key']);
    expect(getSearchConfig().exaApiKey).toBe('live-exa-key');
    expect(isSearchConfigured()).toBe(true);
  });
});
