/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENROUTER_ATTRIBUTION_HEADERS, OpenRouterClient } from '../../src/providers/OpenRouterClient.js';
import { clearModelCapabilitiesCache } from '../../src/providers/modelCapabilities.js';

describe('OpenRouter attribution headers', () => {
  beforeEach(() => {
    clearModelCapabilitiesCache();
  });

  afterEach(() => {
    clearModelCapabilitiesCache();
    vi.restoreAllMocks();
  });

  it('names Autohand Code so OpenRouter rankings credit the app', () => {
    expect(OPENROUTER_ATTRIBUTION_HEADERS).toEqual({
      'HTTP-Referer': 'https://autohand.ai',
      'X-Title': 'Autohand Code',
    });
  });

  it('sends only the documented attribution headers on chat requests', async () => {
    const client = new OpenRouterClient({ apiKey: 'test-key', model: 'openrouter/auto' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'resp_headers',
          created: 1,
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] } as Parameters<OpenRouterClient['complete']>[0]);

    const headers = fetchSpy.mock.calls.at(-1)?.[1]?.headers as Record<string, string>;
    expect(headers).toMatchObject(OPENROUTER_ATTRIBUTION_HEADERS);
    expect(headers['HTTP-Referer']).toBe('https://autohand.ai');
    expect(headers['X-Title']).toBe('Autohand Code');
    expect(Object.keys(headers).filter((name) => name.startsWith('X-OpenRouter-'))).toEqual([]);
  });
});
