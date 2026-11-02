import { afterEach, describe, expect, it, vi } from 'vitest';
import { NVIDIAClient } from '../../src/providers/NVIDIAClient.js';
import { AzureClient } from '../../src/providers/AzureClient.js';
import { CerebrasClient } from '../../src/providers/CerebrasClient.js';
import { MLXProvider } from '../../src/providers/MLXProvider.js';
import { OllamaProvider } from '../../src/providers/OllamaProvider.js';
import { LLMGatewayClient } from '../../src/providers/LLMGatewayClient.js';
import { OpenRouterClient } from '../../src/providers/OpenRouterClient.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

const network = { maxRetries: 1, retryDelay: 10 };
const settings = { model: 'fixture', apiKey: 'fixture', baseUrl: 'https://fixture.invalid/v1' };
const clients: Array<[string, () => Pick<LLMProvider, 'complete'>]> = [
  ['nvidia', () => new NVIDIAClient(settings, network)],
  ['azure', () => new AzureClient({ ...settings, authMethod: 'api-key' }, network)],
  ['cerebras', () => new CerebrasClient(settings, network)],
  ['mlx', () => new MLXProvider(settings, network)],
  ['ollama', () => new OllamaProvider(settings, network)],
  ['gateway', () => new LLMGatewayClient(settings, network)],
  ['openrouter', () => new OpenRouterClient(settings, network)],
];

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe.each(clients)('%s Retry-After', (_name, create) => {
  it.each([429, 503])('never retries HTTP %i before the stated delay, including delays above one minute', async status => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: 'Temporarily busy' } }, { status, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(Response.json({
        id: 'retry', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], message: { content: 'ok' }, done: true,
      }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = create().complete({ messages: [{ role: 'user', content: 'hello' }] });
    await vi.advanceTimersByTimeAsync(119999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ content: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels the wait without sending a second request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ error: { message: 'Busy' } }, {
      status: 503, headers: { 'Retry-After': '120' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = create().complete({ messages: [{ role: 'user', content: 'hello' }], signal: controller.signal });
    let settled = false;
    const rejected = expect(pending).rejects.toThrow(/abort|cancel/i).finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
