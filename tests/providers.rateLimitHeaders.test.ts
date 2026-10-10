import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMGatewayClient } from '../src/providers/LLMGatewayClient.js';
import {
  extractRateLimitHeaders,
  getAllRateLimits,
  getLastRateLimit,
  isRateLimitHeader,
  recordRateLimitHeaders,
  resetRateLimits,
} from '../src/providers/rateLimitHeaders.js';

afterEach(() => {
  resetRateLimits();
  vi.unstubAllGlobals();
});

describe('isRateLimitHeader', () => {
  it('matches every spelling providers actually use', () => {
    expect(isRateLimitHeader('x-ratelimit-remaining-requests')).toBe(true);
    expect(isRateLimitHeader('X-RateLimit-Reset-Tokens')).toBe(true);
    expect(isRateLimitHeader('anthropic-ratelimit-unified-5h-utilization')).toBe(true);
    expect(isRateLimitHeader('some-gateway-rate-limit-left')).toBe(true);
    expect(isRateLimitHeader('Retry-After')).toBe(true);
  });

  it('leaves everything else alone', () => {
    expect(isRateLimitHeader('content-type')).toBe(false);
    expect(isRateLimitHeader('x-request-id')).toBe(false);
  });
});

describe('extractRateLimitHeaders', () => {
  it('keeps the rate-limit headers and lower-cases their names', () => {
    expect(
      extractRateLimitHeaders(
        new Headers({
          'X-RateLimit-Remaining-Requests': '499',
          'anthropic-ratelimit-unified-5h-utilization': '0.42',
          'Retry-After': '17',
          'Content-Type': 'application/json',
        }),
      ),
    ).toEqual({
      'x-ratelimit-remaining-requests': '499',
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
      'retry-after': '17',
    });
  });

  it('reports nothing rather than an empty reading', () => {
    // An empty object drawn as a meter reads as a full account.
    expect(extractRateLimitHeaders(new Headers({ 'content-type': 'x' }))).toBeUndefined();
    expect(extractRateLimitHeaders(undefined)).toBeUndefined();
  });
});

describe('recordRateLimitHeaders', () => {
  it('bounds endpoint history while retaining the newest readings', () => {
    for (let index = 0; index < 256; index += 1) {
      recordRateLimitHeaders(`https://provider-${index}.test`, new Headers({ 'retry-after': '1' }));
    }
    expect(getAllRateLimits().size).toBeLessThan(256);
    expect(getLastRateLimit('https://provider-0.test')).toBeUndefined();
    expect(getLastRateLimit('https://provider-255.test')?.headers).toEqual({ 'retry-after': '1' });
  });

  it.each([false, true])('records successful gateway headers for stream=%s', async (stream) => {
    const baseUrl = 'https://gateway.test/v1';
    const body = stream
      ? 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
      : JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: {
        'content-type': stream ? 'text/event-stream' : 'application/json',
        'x-ratelimit-remaining-requests': '12',
      },
    })));
    const client = new LLMGatewayClient({ apiKey: 'fixture', model: 'fixture', baseUrl });
    await client.complete({ messages: [{ role: 'user', content: 'Hello' }], stream });
    expect(getLastRateLimit(baseUrl)?.headers).toEqual({ 'x-ratelimit-remaining-requests': '12' });
  });

  it('remembers the newest reading per provider', () => {
    recordRateLimitHeaders('https://a.test', new Headers({ 'x-ratelimit-remaining-requests': '499' }), 1000);
    recordRateLimitHeaders('https://b.test', new Headers({ 'x-ratelimit-remaining-requests': '12' }), 1001);
    recordRateLimitHeaders('https://a.test', new Headers({ 'x-ratelimit-remaining-requests': '498' }), 2000);

    expect(getLastRateLimit('https://a.test')).toEqual({
      headers: { 'x-ratelimit-remaining-requests': '498' },
      observedAt: 2000,
    });
    expect(getLastRateLimit('https://b.test')?.headers['x-ratelimit-remaining-requests']).toBe('12');
    expect(getAllRateLimits().size).toBe(2);
  });

  it('does not erase a known reading with a silent response', () => {
    recordRateLimitHeaders('https://a.test', new Headers({ 'x-ratelimit-remaining-requests': '499' }), 1000);
    recordRateLimitHeaders('https://a.test', new Headers({ 'content-type': 'x' }), 2000);
    expect(getLastRateLimit('https://a.test')?.headers['x-ratelimit-remaining-requests']).toBe('499');
  });

  it('has no reading for a provider that never answered', () => {
    expect(getLastRateLimit('https://never.test')).toBeUndefined();
  });
});
