import { afterEach, describe, expect, it } from 'vitest';
import {
  extractRateLimitHeaders,
  getAllRateLimits,
  getLastRateLimit,
  isRateLimitHeader,
  recordRateLimitHeaders,
  resetRateLimits,
} from '../src/providers/rateLimitHeaders.js';

afterEach(() => resetRateLimits());

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
