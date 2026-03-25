/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/OpenAIProvider.js';
import { ApiError } from '../../src/providers/errors.js';

/**
 * Build a mock SSE response body from a `response.completed` payload.
 * Mimics the ChatGPT Codex streaming format.
 */
function buildSSEResponse(completedPayload: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`event: response.created`);
  lines.push(`data: ${JSON.stringify({ id: completedPayload.id, object: 'response' })}`);
  lines.push('');
  lines.push(`event: response.completed`);
  lines.push(`data: ${JSON.stringify(completedPayload)}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Create a Response object that mimics an SSE stream from the ChatGPT Codex backend.
 */
function sseResponse(completedPayload: Record<string, unknown>): Response {
  const body = buildSSEResponse(completedPayload);
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

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

  describe('chatgpt auth mode', () => {
    it('sends chatgpt requests with stream: true to the codex responses backend', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/codex/responses',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer chatgpt-access-token',
            'chatgpt-account-id': 'chatgpt-account-123',
          }),
        }),
      );

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.stream).toBe(true);
      expect(sentBody.store).toBe(false);
      expect(sentBody.tool_choice).toBe('auto');
      expect(sentBody.parallel_tool_calls).toBe(true);
      expect(sentBody.instructions).toEqual(expect.any(String));
      expect(sentBody.instructions.length).toBeGreaterThan(0);
      expect(sentBody.input).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ]);
      // These params are NOT supported by the ChatGPT Codex backend
      expect(sentBody.max_output_tokens).toBeUndefined();
      expect(sentBody.temperature).toBeUndefined();
    });

    it('uses system messages as codex instructions instead of input messages', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-system',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [
          { role: 'system', content: 'Follow the repo instructions.' },
          { role: 'user', content: 'hi' },
        ],
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.instructions).toContain('Follow the repo instructions.');
      expect(sentBody.input).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ]);
    });

    it('refreshes expired chatgpt auth before sending the request', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          accountId: 'chatgpt-account-123',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({
            access_token: 'fresh-access-token',
            refresh_token: 'fresh-refresh-token',
            expires_in: 3600,
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          sseResponse({
            id: 'resp-chatgpt-refresh',
            created_at: 1234567890,
            output_text: 'OK',
            output: [],
          }),
        );

      await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(fetchSpy).toHaveBeenNthCalledWith(
        2,
        'https://chatgpt.com/backend-api/codex/responses',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-access-token',
            'chatgpt-account-id': 'chatgpt-account-123',
          }),
        }),
      );
    });

    it('does NOT send max_output_tokens to the codex backend (unsupported param)', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-no-max',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 321,
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.max_output_tokens).toBeUndefined();
      expect(sentBody.temperature).toBeUndefined();
    });

    it('includes reasoning with include array and defaults for codex requests', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-reasoning',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.reasoning).toEqual({ effort: 'high' });
      expect(sentBody.include).toEqual(['reasoning.encrypted_content']);
      expect(sentBody.tool_choice).toBe('auto');
      expect(sentBody.parallel_tool_calls).toBe(true);
    });

    it('serializes tools and explicit tool choice for codex requests', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-tooling',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{
          name: 'write_file',
          description: 'Write a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
          },
        }],
        toolChoice: {
          type: 'function',
          function: { name: 'write_file' },
        },
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.tools).toEqual([{
        type: 'function',
        name: 'write_file',
        description: 'Write a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
      }]);
      expect(sentBody.tool_choice).toEqual({
        type: 'function',
        name: 'write_file',
      });
    });

    it('serializes assistant tool calls and tool outputs into codex input items', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-input-items',
          created_at: 1234567890,
          output_text: 'OK',
          output: [],
        }),
      );

      await chatgptProvider.complete({
        messages: [
          { role: 'user', content: 'build it' },
          {
            role: 'assistant',
            content: 'Calling write_file',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'write_file',
                arguments: '{"path":"a.txt"}',
              },
            }],
          },
          {
            role: 'tool',
            content: 'done',
            tool_call_id: 'call_1',
          },
        ],
      });

      const sentBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
      expect(sentBody.input).toEqual([
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'build it' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'input_text', text: 'Calling write_file' }],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'write_file',
          arguments: '{"path":"a.txt"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'done',
        },
      ]);
    });

    it('parses codex responses tool calls and tool outputs', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-tools',
          created_at: 1234567890,
          output: [
            {
              type: 'function_call',
              call_id: 'call_123',
              name: 'write_file',
              arguments: '{"path":"a.txt"}',
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Done.' }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
      );

      const result = await chatgptProvider.complete({
        messages: [
          {
            role: 'assistant',
            content: 'Calling tool',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: { name: 'write_file', arguments: '{"path":"a.txt"}' },
            }],
          },
          {
            role: 'tool',
            content: 'File written',
            tool_call_id: 'call_123',
          },
        ],
      });

      expect(result.toolCalls).toEqual([{
        id: 'call_123',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: '{"path":"a.txt"}',
        },
      }]);
      expect(result.content).toBe('Done.');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(result.finishReason).toBe('tool_calls');
    });

    it('maps incomplete max_output_tokens responses to finishReason length', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        sseResponse({
          id: 'resp-chatgpt-length',
          created_at: 1234567890,
          output_text: 'Partial',
          output: [],
          incomplete_details: {
            reason: 'max_output_tokens',
          },
        }),
      );

      const result = await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.finishReason).toBe('length');
      expect(result.content).toBe('Partial');
    });

    it('throws ApiError when SSE stream has no response.completed event', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      // Simulate a malformed stream with no response.completed event
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('event: response.created\ndata: {"id":"x"}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

      await expect(chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toMatchObject({
        code: 'invalid_request',
        message: expect.stringContaining('No response.completed event'),
      });
    });

    it('parses SSE stream with multiple intermediate events before response.completed', async () => {
      const chatgptProvider = new OpenAIProvider({
        authMode: 'chatgpt',
        model: 'gpt-5.4',
        chatgptAuth: {
          accessToken: 'chatgpt-access-token',
          accountId: 'chatgpt-account-123',
        },
      });

      // Build a realistic SSE stream with text deltas before the completed event
      const sseBody = [
        'event: response.created',
        'data: {"id":"resp-multi","object":"response"}',
        '',
        'event: response.output_item.added',
        'data: {"type":"message","role":"assistant"}',
        '',
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"Hello "}',
        '',
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"world!"}',
        '',
        'event: response.completed',
        `data: ${JSON.stringify({
          id: 'resp-multi',
          created_at: 1234567890,
          output_text: 'Hello world!',
          output: [
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello world!' }] },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        })}`,
        '',
      ].join('\n');

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

      const result = await chatgptProvider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.content).toBe('Hello world!');
      expect(result.usage).toEqual({
        promptTokens: 5,
        completionTokens: 3,
        totalTokens: 8,
      });
      expect(result.finishReason).toBe('stop');
    });
  });
});
