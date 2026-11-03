/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ url: string; options: any; body?: string }> = [];
let reply: { status: number; body: string } = { status: 200, body: '{}' };

vi.mock('https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('https')>();
  const request = (url: string, options: any, callback: (res: any) => void) => {
    const req = new EventEmitter() as any;
    req.destroy = () => {};
    req.end = (body?: string) => {
      calls.push({ url: String(url), options, body });
      const res = new EventEmitter() as any;
      res.statusCode = reply.status;
      res.headers = {};
      res.destroy = () => {};
      callback(res);
      res.emit('data', reply.body);
      res.emit('end');
    };
    return req;
  };
  return { ...actual, default: { ...actual, request }, request };
});

const { configureSearch, isSearchConfigured, webSearch, keenableSearch } = await import('../../src/actions/web.js');

afterEach(() => {
  calls.length = 0;
  configureSearch({ provider: 'browser-profile', keenableApiKey: undefined });
});

describe('Keenable search', () => {
  it('posts the query with X-API-Key and maps description, then truncated snippet', async () => {
    reply = {
      status: 200,
      body: JSON.stringify({
        results: [
          { title: 'A', url: 'https://a.example', description: 'desc', snippet: 's' },
          { title: 'B', url: 'https://b.example', snippet: 'x'.repeat(900) },
          { title: 'no url', description: 'dropped' },
        ],
      }),
    };

    const results = await keenableSearch('vitest mocks', 'kn-key', 5);

    expect(calls[0].url).toBe('https://api.keenable.ai/v1/search');
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers['X-API-Key']).toBe('kn-key');
    expect(JSON.parse(calls[0].body!)).toEqual({ query: 'vitest mocks', max_results: 5 });
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'desc' },
      { title: 'B', url: 'https://b.example', snippet: 'x'.repeat(500) },
    ]);
  });

  it('throws on HTTP errors', async () => {
    reply = { status: 401, body: 'unauthorized' };
    await expect(keenableSearch('q', 'bad', 3)).rejects.toThrow('Keenable API error: HTTP 401');
  });

  it('is only configured when selected with a key', async () => {
    configureSearch({ provider: 'keenable', keenableApiKey: undefined });
    const previous = process.env.KEENABLE_API_KEY;
    delete process.env.KEENABLE_API_KEY;
    expect(isSearchConfigured()).toBe(false);
    await expect(webSearch('q')).rejects.toThrow('Keenable Search requires an API key');
    configureSearch({ provider: 'keenable', keenableApiKey: 'kn-key' });
    expect(isSearchConfigured()).toBe(true);
    if (previous !== undefined) process.env.KEENABLE_API_KEY = previous;
  });
});
