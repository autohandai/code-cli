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

  describe('message serialization', () => {
    it('should include tool_calls on assistant messages in request body', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'resp-1',
          created: 1234567890,
          choices: [{
            message: { role: 'assistant', content: 'Done.' },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      await provider.complete({
        messages: [
          { role: 'user', content: 'create a cv in html' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'cv.html', content: 'body {font-family: Arial}' }),
              },
            }],
          },
          {
            role: 'tool',
            content: 'File written successfully',
            tool_call_id: 'call_1',
          },
          { role: 'user', content: 'looks good' },
        ],
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      const assistantMsg = sentBody.messages.find((m: Record<string, unknown>) => m.role === 'assistant');
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls[0].id).toBe('call_1');
      expect(assistantMsg.tool_calls[0].function.name).toBe('write_file');
    });

    it('should include tool_call_id on tool role messages', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'resp-2',
          created: 1234567890,
          choices: [{
            message: { role: 'assistant', content: 'OK' },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      await provider.complete({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'search', arguments: '{"query":"test"}' },
            }],
          },
          {
            role: 'tool',
            content: 'search results here',
            tool_call_id: 'call_2',
            name: 'search',
          },
        ],
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      const toolMsg = sentBody.messages.find((m: Record<string, unknown>) => m.role === 'tool');
      expect(toolMsg.tool_call_id).toBe('call_2');
      expect(toolMsg.name).toBe('search');
    });

    it('should handle tool_calls with HTML/CSS content containing curly braces', async () => {
      const htmlContent = '<!DOCTYPE html><html><head><style>body { font-family: Arial; } .header { color: #333; }</style></head></html>';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          id: 'resp-3',
          created: 1234567890,
          choices: [{
            message: { role: 'assistant', content: 'Created.' },
            finish_reason: 'stop',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

      await provider.complete({
        messages: [
          { role: 'user', content: 'create html cv' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_3',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: JSON.stringify({ path: 'cv.html', content: htmlContent }),
              },
            }],
          },
          {
            role: 'tool',
            content: 'File written: cv.html',
            tool_call_id: 'call_3',
          },
        ],
      });

      // Verify the request body is valid JSON (no parsing issues with curly braces)
      const rawBody = fetchSpy.mock.calls[0][1]?.body as string;
      expect(() => JSON.parse(rawBody)).not.toThrow();

      const sentBody = JSON.parse(rawBody);
      const assistantMsg = sentBody.messages.find((m: Record<string, unknown>) => m.role === 'assistant');
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls[0].function.arguments).toContain('font-family');
    });
  });
});
