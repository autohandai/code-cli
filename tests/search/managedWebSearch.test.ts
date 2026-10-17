import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagedWebSearch, managedSearchIdentity } from '../../src/search/managedWebSearch.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('included Autohand web search', () => {
  const identity = { token: 'ahc_search_fixture', accountId: 'selected-account' };
  it('uses account credentials and selected account only on the first-party endpoint', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ available: true, tier: 'lite', provider: 'cloudflare' }))
      .mockResolvedValueOnce(Response.json({ provider: 'cloudflare', query: 'docs', results: [{ title: 'Docs', url: 'https://autohand.ai/docs', snippet: 'Source' }] }));
    vi.stubGlobal('fetch', fetch);
    const client = new ManagedWebSearch(identity);
    expect(await client.available()).toBe(true);
    expect(await client.search('docs', 5)).toHaveLength(1);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(Array(2).fill('https://dev.autohand.ai/api/native/web-search'));
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', redirect: 'error', body: JSON.stringify({ query: 'docs', limit: 5 }), headers: { Authorization: 'Bearer ahc_search_fixture', 'X-Autohand-Account-Id': 'selected-account' } });
  });
  it('resolves account authentication without using a model API key', () => {
    expect(managedSearchIdentity({ auth: { token: 'ahc_login' }, api: { accountId: 'a' } })).toEqual({ token: 'ahc_login', accountId: 'a' });
    expect(managedSearchIdentity({ autohandai: { authMode: 'account', accountToken: 'ahc_device' } })).toEqual({ token: 'ahc_device', accountId: undefined });
    expect(managedSearchIdentity({ autohandai: { authMode: 'api-key', apiKey: 'secret' } })).toBeUndefined();
  });
  it.each([401, 402, 429, 503])('reports a %s response without switching providers', async status => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status })));
    await expect(new ManagedWebSearch(identity).search('docs', 5)).rejects.toThrow(String(status));
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('does not assume eligibility on Free, an unknown response, or a failed capability request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ available: false, tier: 'free', provider: 'cloudflare' }))
      .mockResolvedValueOnce(Response.json({ tier: 'max' })).mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const client = new ManagedWebSearch(identity);
    expect(await client.available()).toBe(false);
    expect(await client.available()).toBe(false);
    expect(await client.available()).toBe(false);
  });
  it('validates query, result count, and response URLs', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ provider: 'cloudflare', query: 'docs', results: [{ title: 'bad', url: 'javascript:alert(1)', snippet: '' }] }));
    vi.stubGlobal('fetch', fetch);
    const client = new ManagedWebSearch(identity);
    await expect(client.search(' ', 5)).rejects.toThrow();
    await expect(client.search('x'.repeat(1025), 5)).rejects.toThrow();
    await expect(client.search('docs', 11)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.search('docs', 5)).rejects.toThrow();
  });
  it('cancels a stalled response body on abort and releases its listener', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    const pull = vi.fn();
    let remove: ReturnType<typeof vi.spyOn> | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options: RequestInit) => {
      remove = vi.spyOn(options.signal!, 'removeEventListener');
      return Promise.resolve(new Response(new ReadableStream({ pull, cancel })));
    }));
    const result = new ManagedWebSearch(identity).search('docs', 5, controller.signal);
    await vi.waitFor(() => expect(pull).toHaveBeenCalled());
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
  });
  it('bounds response size and does not leave application timers behind', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount(), cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600_001)); }, cancel }))));
    await expect(new ManagedWebSearch(identity).search('docs', 5)).rejects.toThrow('size');
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(baseline);
  });
  it('bounds an uncooperative fetch and disposes a response that arrives after cancellation', async () => {
    const controller = new AbortController(), cancel = vi.fn();
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const client = new ManagedWebSearch(identity);
    const result = client.available(controller.signal);
    let settled = '';
    void result.then(() => { settled = 'resolved'; }, error => { settled = error.name; });
    controller.abort();
    await vi.waitFor(() => expect(settled).toBe('AbortError'), { timeout: 100 });
    finish(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
});
