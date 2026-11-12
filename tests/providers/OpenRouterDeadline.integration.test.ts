import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/providers/OpenRouterProvider.js';
import { createOpenRouterDeadlineFixture } from '../../src/testing/scenarios/openRouterDeadlineScenario.js';

describe('OpenRouter response deadlines', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each(['headers', 'body', 'error-body', 'sse'] as const)(
    'bounds a stalled %s response and releases its socket', async mode => {
      const fixture = await createOpenRouterDeadlineFixture(mode);
      const provider = new OpenRouterProvider(
        { apiKey: 'fixture-key', model: 'openai/gpt-4o-mini', baseUrl: fixture.baseUrl },
        { timeout: 200, maxRetries: 0 },
      );
      let headersReceived = false;
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
        const response = await realFetch(...args);
        headersReceived = true;
        return response;
      });
      try {
        await expect(provider.complete({
          messages: [{ role: 'user', content: 'Reply OK' }],
          signal: AbortSignal.timeout(1500),
        })).rejects.toMatchObject({ code: 'timeout', retryable: true, message: expect.stringContaining('timed out') });
        if (mode !== 'headers') {
          expect(fixture.committedResponses()).toBe(1);
          expect(headersReceived).toBe(true);
        }
        await expect.poll(fixture.activeCompletions, { timeout: 1000 }).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );

  it('preserves caller cancellation after response headers', async () => {
    const fixture = await createOpenRouterDeadlineFixture('body');
    const controller = new AbortController();
    const provider = new OpenRouterProvider(
      { model: 'openai/gpt-4o-mini', baseUrl: fixture.baseUrl }, { timeout: 3000, maxRetries: 0 },
    );
    try {
      const completion = provider.complete({ messages: [{ role: 'user', content: 'hello' }], signal: controller.signal });
      const result = expect(completion).rejects.toMatchObject({ code: 'cancelled', retryable: false });
      await expect.poll(fixture.committedResponses).toBe(1);
      controller.abort();
      await result;
      await expect.poll(fixture.activeCompletions).toBe(0);
    } finally {
      controller.abort();
      await fixture.close();
    }
  });

  it('returns normal completion and does not retain JavaScript timers', async () => {
    vi.useFakeTimers();
    const baseline = vi.getTimerCount();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    })));
    const provider = new OpenRouterProvider({ model: 'openai/gpt-4o-mini' }, { timeout: 200, maxRetries: 0 });
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hello' }] })).resolves.toMatchObject({ content: 'ok' });
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
