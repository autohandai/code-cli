import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AzureClient } from '../../src/providers/AzureClient.js';
import { CerebrasClient } from '../../src/providers/CerebrasClient.js';
import { LLMGatewayClient } from '../../src/providers/LLMGatewayClient.js';
import { MLXProvider } from '../../src/providers/MLXProvider.js';
import { NVIDIAClient } from '../../src/providers/NVIDIAClient.js';
import { OllamaProvider } from '../../src/providers/OllamaProvider.js';
import { OpenRouterClient } from '../../src/providers/OpenRouterClient.js';
import { VertexAIProvider } from '../../src/providers/VertexAIProvider.js';
import type { LLMRequest, LLMResponse } from '../../src/types.js';

vi.mock('../../src/utils/platform.js', () => ({ isMLXSupported: () => true }));
vi.mock('../../src/utils/gcloudAuth.js', () => ({
  getGcloudAccessToken: vi.fn().mockResolvedValue({ token: '', error: 'unavailable' }),
  clearGcloudTokenCache: vi.fn(),
}));

interface CompletionClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

const settings = { apiKey: 'test-key', model: 'test-model' };
const network = { maxRetries: 0, timeout: 10, retryDelay: 1 };
const clients: { name: string; create: () => CompletionClient }[] = [
  { name: 'Azure', create: () => new AzureClient({ ...settings, resourceName: 'test', deploymentName: 'test', authMethod: 'api-key' }, network) },
  { name: 'Cerebras', create: () => new CerebrasClient(settings, network) },
  { name: 'LLM Gateway', create: () => new LLMGatewayClient(settings, network) },
  { name: 'MLX', create: () => new MLXProvider(settings, network) },
  { name: 'NVIDIA', create: () => new NVIDIAClient(settings, network) },
  { name: 'Ollama', create: () => new OllamaProvider(settings, network) },
  { name: 'OpenRouter', create: () => new OpenRouterClient(settings, network) },
  { name: 'Vertex AI', create: () => new VertexAIProvider({ authToken: 'test-token', projectId: 'test-project', model: 'google/test-model' }, network) },
];

function completionResponse(): Response {
  return Response.json({
    id: 'test-response',
    created: 123,
    created_at: '2026-09-06T00:00:00Z',
    choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
    message: { role: 'assistant', content: 'done' },
  });
}

describe.each(clients)('$name request cleanup', ({ create }) => {
  const request: LLMRequest = { messages: [{ role: 'user', content: 'hello' }] };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['success', 'network failure', 'API failure'] as const)(
    'does not accumulate caller listeners or timers after repeated %s',
    async (outcome) => {
      const caller = new AbortController();
      const unrelatedListener = vi.fn();
      caller.signal.addEventListener('abort', unrelatedListener);
      const client = create();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        if (outcome === 'network failure') throw new Error('connection lost');
        if (outcome === 'API failure') {
          return Response.json({ error: { message: 'invalid request' } }, { status: 400 });
        }
        return completionResponse();
      });

      for (let index = 0; index < 12; index++) {
        const completion = client.complete({ ...request, signal: caller.signal });
        if (outcome === 'success') {
          await expect(completion).resolves.toMatchObject({ content: 'done' });
        } else {
          await expect(completion).rejects.toBeInstanceOf(Error);
        }
      }

      expect(getEventListeners(caller.signal, 'abort')).toEqual([unrelatedListener]);
      expect(vi.getTimerCount()).toBe(0);
      caller.abort();
      expect(unrelatedListener).toHaveBeenCalledTimes(1);
    },
  );

  it.each([undefined, new Error('stop this turn'), 'stop this turn', null])('preserves cancellation with reason %s', async (reason) => {
    const caller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing request signal');
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        caller.abort(reason);
      });
    });

    await expect(create().complete({ ...request, signal: caller.signal })).rejects.toThrow(/cancel|abort/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps cancellation active while reading the response body', async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const response = completionResponse();
      vi.spyOn(response, 'json').mockImplementation(async () => {
        caller.abort(new Error('stop reading'));
        init?.signal?.throwIfAborted();
        throw new Error('Body read continued after cancellation');
      });
      return response;
    });

    await expect(create().complete({ ...request, signal: caller.signal })).rejects.toThrow(/cancel|abort/i);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors an already aborted caller without retaining listeners', async () => {
    const caller = new AbortController();
    caller.abort();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      init?.signal?.throwIfAborted();
      throw new Error('An aborted request reached the network');
    });

    await expect(create().complete({ ...request, signal: caller.signal })).rejects.toThrow(/cancel|abort/i);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out without aborting the caller or retaining request resources', async () => {
    const caller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing request signal');
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const completion = expect(create().complete({ ...request, signal: caller.signal })).rejects.toThrow(/time|abort|did not arrive/i);
    await Promise.all([completion, vi.advanceTimersByTimeAsync(300_000)]);
    expect(caller.signal.aborted).toBe(false);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe.each(clients.filter(({ name }) => ['Cerebras', 'LLM Gateway', 'NVIDIA', 'Ollama'].includes(name)))(
  '$name streaming cancellation',
  ({ create }) => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('aborts a response stream after headers have arrived', async () => {
      const caller = new AbortController();
      const ready = Promise.withResolvers<void>();
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error('Missing request signal');
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
          pull() {
            ready.resolve();
          },
        }));
      });

      const completion = expect(create().complete({
        messages: [{ role: 'user', content: 'hello' }],
        signal: caller.signal,
        stream: true,
      })).rejects.toThrow(/cancel|abort/i);
      await ready.promise;
      caller.abort(new Error('stop streaming'));
      await completion;
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
    });
  },
);
