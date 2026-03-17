/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/OpenAIProvider.js';
import { ApiError } from '../../src/providers/errors.js';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider({
      baseUrl: 'http://localhost:9999',
      apiKey: 'test-key',
      model: 'gpt-4o',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('throws ApiError with classifyApiError for non-ok responses', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Invalid API key provided' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toThrow(ApiError);

      try {
        await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('auth_failed');
      }
    });

    it('classifies 404 as model_not_found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'model not found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ code: 'model_not_found' });
    });

    it('classifies 405 as invalid_request with friendly message (GH #19)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Method Not Allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toThrow(ApiError);
    });

    it('classifies 429 as rate_limited', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toMatchObject({ code: 'rate_limited' });
    });

    it('throws network_error ApiError on fetch failure (GH #20)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new TypeError('fetch failed'),
      );

      await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }] }))
        .rejects.toThrow(ApiError);

      try {
        await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('network_error');
      }
    });

    it('throws cancelled ApiError when user signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'cancelled' });
    });
  });
});
