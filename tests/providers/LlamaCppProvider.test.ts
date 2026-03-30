/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMRequest, ProviderSettings } from '../../src/types';
import { LlamaCppProvider } from '../../src/providers/LlamaCppProvider';
import { ApiError } from '../../src/providers/errors';

describe('LlamaCppProvider', () => {
  let provider: LlamaCppProvider;
  let config: ProviderSettings;

  beforeEach(() => {
    config = {
      baseUrl: 'http://localhost:8080',
      model: 'local'
    };
    provider = new LlamaCppProvider(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to local when config model is empty', async () => {
    const fallbackProvider = new LlamaCppProvider({ baseUrl: 'http://localhost:8080', model: '' });
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fallbackProvider.listModels()).resolves.toEqual(['local']);
  });

  it('sends local as the chat completions model by default', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'llamacpp-123',
        created: 1700000000,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello'
            },
            finish_reason: 'stop'
          }
        ]
      })
    });

    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Hello, who are you?' }]
    };

    await provider.complete(request);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:8080/v1/chat/completions',
      expect.objectContaining({
        method: 'POST'
      })
    );

    const fetchMock = fetch as unknown as { mock: { calls: Array<[string, RequestInit | undefined]> } };
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: 'local'
    });
  });

  it('shows a llama.cpp tool-support hint when tool-enabled requests are rejected', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => 'This model does not support tools'
    });

    const err = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [{
        name: 'echo',
        description: 'Echo input',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' }
          }
        }
      }]
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain('--jinja -fa');
    expect((err as ApiError).message).toContain('--chat-template chatml');
  });

  it('includes the llama.cpp error body when requests fail', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":"unexpected field"}'
    });

    const err = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }]
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain('unexpected field');
    expect((err as ApiError).httpStatus).toBe(400);
  });
});
