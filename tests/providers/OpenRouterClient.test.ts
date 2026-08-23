/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterClient } from '../../src/providers/OpenRouterClient.js';
import { clearModelCapabilitiesCache } from '../../src/providers/modelCapabilities.js';
import { ApiError } from '../../src/providers/errors.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('OpenRouterClient', () => {
  beforeEach(() => {
    clearModelCapabilitiesCache();
  });

  afterEach(() => {
    clearModelCapabilitiesCache();
    vi.restoreAllMocks();
  });

  function completionResponse(): Response {
    return jsonResponse({
      id: 'resp_shape',
      created: 1,
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    });
  }

  async function capturePayload(
    model: string,
    request: Partial<Parameters<OpenRouterClient['complete']>[0]> = {},
  ): Promise<Record<string, unknown>> {
    const client = new OpenRouterClient({ apiKey: 'test-key', model });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(completionResponse());
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      ...request,
    } as Parameters<OpenRouterClient['complete']>[0]);
    return JSON.parse(fetchSpy.mock.calls.at(-1)?.[1]?.body as string) as Record<string, unknown>;
  }

  describe('outbound payload hygiene', () => {
    it('never sends a blank assistant content field alongside native tool calls', async () => {
      const payload = await capturePayload('anthropic/claude-haiku-4.5', {
        messages: [
          { role: 'user', content: 'inspect the repo' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: { name: 'list_tree', arguments: '{}' },
            }],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'src/' },
        ],
      });

      expect(payload.messages).toEqual([
        { role: 'user', content: 'inspect the repo' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'list_tree', arguments: '{}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'src/' },
      ]);
    });

    it('drops blank turns and replaces blank tool results', async () => {
      const payload = await capturePayload('anthropic/claude-haiku-4.5', {
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '   ' },
          {
            role: 'assistant',
            content: 'looking',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'fff_find', arguments: '{}' },
            }],
          },
          { role: 'tool', tool_call_id: 'call_2', content: '' },
        ],
      });

      expect(payload.messages).toEqual([
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: 'looking',
          tool_calls: [{
            id: 'call_2',
            type: 'function',
            function: { name: 'fff_find', arguments: '{}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_2', content: '(no output)' },
      ]);
    });

    it('drops orphaned tool results left behind by context compaction', async () => {
      const payload = await capturePayload('anthropic/claude-haiku-4.5', {
        messages: [
          { role: 'tool', tool_call_id: 'call_cropped', content: 'stale result' },
          { role: 'user', content: 'continue' },
        ],
      });

      expect(payload.messages).toEqual([{ role: 'user', content: 'continue' }]);
    });

    it('backfills a tool result for every unanswered tool call', async () => {
      const payload = await capturePayload('anthropic/claude-haiku-4.5', {
        messages: [
          { role: 'user', content: 'go' },
          {
            role: 'assistant',
            content: 'calling',
            tool_calls: [
              { id: 'call_a', type: 'function', function: { name: 'list_tree', arguments: '{}' } },
              { id: 'call_b', type: 'function', function: { name: 'fff_find', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_a', content: 'src/' },
          { role: 'user', content: 'and now?' },
        ],
      });

      const messages = payload.messages as { role: string; tool_call_id?: string; content?: string }[];
      expect(messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'tool',
        'tool',
        'user',
      ]);
      expect(messages[3]).toEqual(expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_b',
      }));
      expect(messages[3]?.content).toBeTruthy();
    });

    it('omits temperature for Claude models that reject sampling', async () => {
      const rejects = await capturePayload('anthropic/claude-sonnet-5', { temperature: 0.2 });
      expect(rejects).not.toHaveProperty('temperature');

      const dotted = await capturePayload('anthropic/claude-opus-4.8', { temperature: 0.2 });
      expect(dotted).not.toHaveProperty('temperature');

      const accepts = await capturePayload('anthropic/claude-haiku-4.5', { temperature: 0.2 });
      expect(accepts.temperature).toBe(0.2);
    });

    it('requests extended reasoning through the documented reasoning field', async () => {
      const payload = await capturePayload('anthropic/claude-haiku-4.5', {
        thinkingLevel: 'extended',
      });

      expect(payload).not.toHaveProperty('provider');
      expect(payload.reasoning).toEqual({ effort: 'high' });
    });
  });

  it('surfaces the upstream provider detail behind a generic OpenRouter error', async () => {
    const client = new OpenRouterClient({ apiKey: 'test-key', model: 'anthropic/claude-haiku-4.5' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      error: {
        message: 'Provider returned error',
        code: 400,
        metadata: {
          provider_name: 'Anthropic',
          raw: 'messages.1.content.0.text: text content blocks must be non-empty',
        },
      },
    }, { status: 400 }));

    await expect(client.complete({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({
        code: 'invalid_request',
        rawDetail: expect.stringContaining('text content blocks must be non-empty'),
      });
  });

  it('rewrites retired Claude 5 model IDs before they reach the API', async () => {
    const client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'anthropic/claude-5-sonnet',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      id: 'resp_alias',
      created: 1,
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }));

    await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(firstBody.model).toBe('anthropic/claude-sonnet-5');

    fetchSpy.mockResolvedValueOnce(jsonResponse({
      id: 'resp_alias_2',
      created: 1,
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }));
    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'anthropic/claude-5-opus',
    });
    const secondBody = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
    expect(secondBody.model).toBe('anthropic/claude-opus-5');
  });

  it('sends multipart content when the selected model supports image input', async () => {
    const client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'google/gemini-2.5-flash',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'google/gemini-2.5-flash',
            architecture: {
              input_modalities: ['text', 'image'],
            },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'resp_1',
        created: 123,
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }));

    await client.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this screenshot.' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
              },
            },
          ] as unknown as string,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const chatRequest = fetchSpy.mock.calls[1];
    expect(chatRequest[0]).toBe('https://openrouter.ai/api/v1/chat/completions');

    const body = JSON.parse(chatRequest[1]?.body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this screenshot.' },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
            },
          },
        ],
      },
    ]);
  });

  it('falls back to text-only content when the selected model does not support image input', async () => {
    const client = new OpenRouterClient({
      apiKey: 'test-key',
      model: 'openai/gpt-4',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'openai/gpt-4',
            architecture: {
              input_modalities: ['text'],
            },
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'resp_2',
        created: 123,
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'done',
            },
            finish_reason: 'stop',
          },
        ],
      }));

    await client.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '[Image #1] screenshot.png\n\nWhat is broken here?' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==',
              },
            },
          ] as unknown as string,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const chatRequest = fetchSpy.mock.calls[1];
    const body = JSON.parse(chatRequest[1]?.body as string);

    expect(body.messages).toEqual([
      {
        role: 'user',
        content: '[Image #1] screenshot.png\n\nWhat is broken here?',
      },
    ]);
  });

  it('surfaces OpenRouter-specific authentication errors', async () => {
    const client = new OpenRouterClient({
      apiKey: 'invalid-key',
      model: 'openai/gpt-4',
    }, { maxRetries: 0 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      error: { message: 'Invalid API key' },
    }, { status: 401 }));

    try {
      await client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('auth_failed');
      expect((error as Error).message).toContain('OpenRouter API key');
      expect((error as Error).message).not.toContain('LLM Gateway');
    }
  });

  // GH #477: "openrouter/auto" (and other auto-routed models) surface a
  // generic "Provider returned error" wrapper with no useful body text when
  // the upstream backend OpenRouter routed to fails. OpenRouter documents
  // this as error.metadata.error_type "provider_unavailable" — an upstream
  // invalid/empty response that they classify as retryable. Without reading
  // that field, the shared status-driven classifier only sees a bare 400
  // with an uninformative body and falls back to non-retryable
  // "invalid_request", so the session retry loop never attempts recovery
  // even though the exact same request commonly succeeds on retry.
  it('classifies OpenRouter provider_unavailable errors as retryable instead of a malformed request (GH #477)', async () => {
    const client = new OpenRouterClient({
      apiKey: 'valid-key',
      model: 'openrouter/auto',
    }, { maxRetries: 0 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      error: {
        message: 'Provider returned error',
        metadata: { error_type: 'provider_unavailable' },
      },
    }, { status: 400 }));

    try {
      await client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).retryable).toBe(true);
      expect((error as ApiError).code).not.toBe('invalid_request');
      expect((error as Error).message).not.toContain('malformed');
    }
  });

  it('retries provider_unavailable errors and succeeds when a later attempt goes through', async () => {
    const client = new OpenRouterClient({
      apiKey: 'valid-key',
      model: 'openrouter/auto',
    }, { maxRetries: 1, retryDelay: 0 });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        error: {
          message: 'Provider returned error',
          metadata: { error_type: 'provider_unavailable' },
        },
      }, { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'gen-1',
        created: 0,
        choices: [{ message: { content: 'hi back' }, finish_reason: 'stop' }],
      }));

    const response = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(response.content).toBe('hi back');
  });

  it('leaves unmapped OpenRouter error_type values on the existing status-driven classification', async () => {
    const client = new OpenRouterClient({
      apiKey: 'valid-key',
      model: 'openai/gpt-4',
    }, { maxRetries: 0 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({
      error: {
        message: 'Something else went wrong',
        metadata: { error_type: 'invalid_prompt' },
      },
    }, { status: 400 }));

    try {
      await client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });
      throw new Error('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('invalid_request');
      expect((error as ApiError).retryable).toBe(false);
    }
  });

  // OpenRouter's 402 responses distinguish a genuinely empty account from a
  // request whose max_tokens exceeds what the remaining credits can still
  // cover ("You requested up to 16000 tokens, but can only afford 1355").
  // Sub-agents hit the second case constantly because they omit maxTokens and
  // inherit the 16k default; failing the whole delegation with a scary
  // "check your balance" message wastes credits the account actually has.
  describe('402 affordable-budget downgrade', () => {
    function affordableBudget402(affordable: number): Response {
      return jsonResponse({
        error: {
          message:
            'This request requires more credits, or fewer max_tokens. '
            + `You requested up to 16000 tokens, but can only afford ${affordable}. `
            + 'To increase, visit https://openrouter.ai/settings/credits and upgrade to '
            + 'a paid account which has higher limits.',
          code: 402,
          metadata: {},
        },
      }, { status: 402 });
    }

    function emptyBalance402(): Response {
      return jsonResponse({
        error: {
          message: 'Insufficient credits in your account to run this request.',
          code: 402,
          metadata: {},
        },
      }, { status: 402 });
    }

    it('retries once with the affordable max_tokens and succeeds', async () => {
      const client = new OpenRouterClient({
        apiKey: 'valid-key',
        model: 'openai/gpt-4',
      }, { maxRetries: 0 });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(affordableBudget402(1355))
        .mockResolvedValueOnce(jsonResponse({
          id: 'gen-1',
          created: 0,
          choices: [{ message: { content: 'hi back' }, finish_reason: 'stop' }],
        }));

      const response = await client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(response.content).toBe('hi back');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      const firstBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      const secondBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
      expect(firstBody.max_tokens).toBe(16000);
      expect(secondBody.max_tokens).toBe(1355);
    });

    it('keeps the payment_required failure when the 402 body names no affordable budget', async () => {
      const client = new OpenRouterClient({
        apiKey: 'valid-key',
        model: 'openai/gpt-4',
      }, { maxRetries: 0 });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(emptyBalance402());

      await expect(client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toMatchObject({ code: 'payment_required' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('surfaces the billing error when the downgraded retry also fails', async () => {
      const client = new OpenRouterClient({
        apiKey: 'valid-key',
        model: 'openai/gpt-4',
      }, { maxRetries: 0 });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(affordableBudget402(1355))
        .mockResolvedValueOnce(emptyBalance402());

      await expect(client.complete({
        messages: [{ role: 'user', content: 'hi' }],
      })).rejects.toMatchObject({ code: 'payment_required' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
