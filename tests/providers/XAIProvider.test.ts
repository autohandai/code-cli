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
      expect((error as Error).message).toContain('xAI API key');
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
});
