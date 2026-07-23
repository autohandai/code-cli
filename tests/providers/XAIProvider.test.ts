/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { XAIProvider } from '../../src/providers/XAIProvider.js';
import { ApiError } from '../../src/providers/errors.js';

describe('XAIProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces xAI-specific authentication errors', async () => {
    const provider = new XAIProvider({
      apiKey: 'invalid-key',
      model: 'grok-4.20-reasoning',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await provider.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('auth_failed');
      expect((error as Error).message).toMatch(/xAI (OAuth|API key)/i);
      expect((error as Error).message).not.toContain('LLM Gateway');
    }
  });

  it('uses response.incomplete terminal payloads as partial completions', async () => {
    const provider = new XAIProvider({
      apiKey: 'xai-key',
      model: 'grok-4.20-reasoning',
    });

    const sseBody = [
      'event: response.incomplete',
      `data: ${JSON.stringify({
        type: 'response.incomplete',
        response: {
          id: 'resp-incomplete',
          created_at: 1234567890,
          output_text: 'Partial xAI completion',
          output: [],
          incomplete_details: {
            reason: 'max_output_tokens',
          },
        },
      })}`,
      '',
    ].join('\n');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('Partial xAI completion');
    expect(result.finishReason).toBe('length');
  });

  it('surfaces response.failed stream errors instead of a missing completion error', async () => {
    const provider = new XAIProvider({
      apiKey: 'xai-key',
      model: 'grok-4.20-reasoning',
    });

    const sseBody = [
      'event: response.failed',
      `data: ${JSON.stringify({
        type: 'response.failed',
        error: {
          message: 'xAI stream terminated early.',
        },
      })}`,
      '',
    ].join('\n');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({
      code: 'server_error',
      retryable: true,
      message: expect.stringContaining('xAI stream terminated early.'),
    });
  });

  it('throws retryable ApiError when an xAI stream has no terminal event', async () => {
    const provider = new XAIProvider({
      apiKey: 'xai-key',
      model: 'grok-4.20-reasoning',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('event: response.created\ndata: {"id":"x"}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    })).rejects.toMatchObject({
      code: 'server_error',
      retryable: true,
      message: expect.stringContaining('stream ended before a terminal response event'),
    });
  });

  it('is available when oauth credentials are present without an api key', async () => {
    const provider = new XAIProvider({
      authMode: 'oauth',
      model: 'grok-4.5',
      oauthAuth: {
        accessToken: 'oauth-access-token',
        refreshToken: 'oauth-refresh-token',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    await expect(provider.isAvailable()).resolves.toBe(true);
  });

  it('uses the Grok CLI proxy and oauth bearer headers for oauth mode', async () => {
    const provider = new XAIProvider({
      authMode: 'oauth',
      model: 'grok-4.5',
      oauthAuth: {
        accessToken: 'oauth-access-token',
        refreshToken: 'oauth-refresh-token',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    const sseBody = [
      'event: response.completed',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp-oauth',
          created_at: 1234567890,
          output_text: 'Hello from Grok OAuth',
          output: [],
        },
      })}`,
      '',
    ].join('\n');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('Hello from Grok OAuth');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cli-chat-proxy.grok.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-access-token',
          'x-xai-token-auth': 'xai-grok-cli',
          'x-grok-client-identifier': 'autohand-cli',
        }),
      }),
    );

    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it('only sends tool_choice when tools are provided', async () => {
    const provider = new XAIProvider({
      apiKey: 'xai-key',
      model: 'grok-4.5',
    });

    const sseBody = [
      'event: response.completed',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp-tools',
          created_at: 1234567890,
          output_text: 'ok',
          output: [],
        },
      })}`,
      '',
    ].join('\n');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{
        name: 'web_search',
        description: 'search',
        parameters: { type: 'object', properties: {} },
      }],
    });

    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toEqual([{ type: 'web_search' }]);
  });

  it('sends client function tools in Responses API flat shape', async () => {
    const provider = new XAIProvider({
      apiKey: 'xai-key',
      model: 'grok-4.5',
    });

    const sseBody = [
      'event: response.completed',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp-fn',
          created_at: 1234567890,
          output_text: '',
          output: [{
            type: 'function_call',
            call_id: 'call_1',
            name: 'add',
            arguments: '{"a":1,"b":2}',
          }],
        },
      })}`,
      '',
    ].join('\n');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'add 1 and 2' }],
      tools: [{
        name: 'add',
        description: 'Add two numbers',
        parameters: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      }],
    });

    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.tools).toEqual([{
      type: 'function',
      name: 'add',
      description: 'Add two numbers',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' },
        },
        required: ['a', 'b'],
      },
    }]);
    expect(result.toolCalls).toEqual([{
      id: 'call_1',
      type: 'function',
      function: {
        name: 'add',
        arguments: '{"a":1,"b":2}',
      },
    }]);
  });

  it('refreshes expired oauth tokens before completing a request', async () => {
    const provider = new XAIProvider({
      authMode: 'oauth',
      model: 'grok-4.5',
      oauthAuth: {
        accessToken: 'expired-access',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });

    const newAccess = `a.${Buffer.from(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url')}.c`;

    const sseBody = [
      'event: response.completed',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id: 'resp-refreshed',
          created_at: 1234567890,
          output_text: 'Refreshed',
          output: [],
        },
      })}`,
      '',
    ].join('\n');

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: newAccess,
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(sseBody, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );

    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('Refreshed');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://auth.x.ai/oauth2/token');
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: `Bearer ${newAccess}`,
      }),
    }));
  });
});
