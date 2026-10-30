import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderFactory } from '../../src/providers/ProviderFactory.js';

afterEach(() => vi.unstubAllGlobals());

describe('custom provider quota isolation', () => {
  it.each(['Tatch', 'Autohand AI'])('uses only the custom endpoint and retries its own 429 with display name %s', async (displayName) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { type: 'rate_limited', scope: 'window_5h', message: 'Provider busy' } }, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { role: 'assistant', content: 'Tatch response' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', fetch);
    const provider = ProviderFactory.create({
      provider: 'custom:tatch', auth: { token: 'autohand-account-token' },
      autohandai: { plan: 'cloud', model: 'fantail', authMode: 'account' },
      customProviders: { tatch: { id: 'tatch', displayName, apiFormat: 'openai-compatible', baseUrl: 'https://tatch.example/v1', apiKey: 'tatch-key', model: 'tatch-model' } },
      network: { maxRetries: 1, retryDelay: 1 },
    });
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hello' }] })).resolves.toMatchObject({ content: 'Tatch response' });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe('https://tatch.example/v1/chat/completions');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer tatch-key');
      expect(headers.get('X-Autohand-Account-Id')).toBeNull();
      expect(headers.get('x-autohand-client-request-id')).toBeNull();
    }
  });
});
