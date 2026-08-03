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
});
