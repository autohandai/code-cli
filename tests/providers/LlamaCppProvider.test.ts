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
    vi.unstubAllGlobals();
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

  it('classifies the reported server context rejection as a context overflow', async () => {
    const rawDetail = JSON.stringify({
      error: {
        code: 400,
        message: 'request (16605 tokens) exceeds the available context size (4096 tokens), try increasing it',
        type: 'exceed_context_size_error',
        n_prompt_tokens: 16605,
        n_ctx: 4096,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(rawDetail, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await provider.complete({ messages: [{ role: 'user', content: 'hello' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'context_overflow', retryable: false, rawDetail });
    expect(error).toHaveProperty('message', expect.stringContaining('4096'));
    expect(error).toHaveProperty('message', expect.stringContaining('/new'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['gemma4:12b', 'hadad/LFM2.5-1.2B:Q4_K_M'])(
    'preserves the requested model when the router has not configured %s',
    async (model) => {
      const rawDetail = JSON.stringify({ error: {
        code: null,
        message: `model ${model} is not configured`,
        param: null,
        type: 'autohand_router_error',
      } });
      const fetchMock = vi.fn().mockResolvedValue(new Response(rawDetail, { status: 400 }));
      vi.stubGlobal('fetch', fetchMock);

      const error = await provider.complete({ model, messages: [{ role: 'user', content: 'hello' }] })
        .catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: 'model_not_found', retryable: false, rawDetail });
      expect(error).toHaveProperty('message', expect.stringContaining('/model'));
      const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(JSON.parse(String(options.body))).toHaveProperty('model', model);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  describe('runtime context discovery', () => {
    it('coalesces startup and first-turn discovery and reuses settled metadata', async () => {
      const response = Promise.withResolvers<Response>();
      const fetchMock = vi.fn(() => response.promise);
      vi.stubGlobal('fetch', fetchMock);
      const startup = provider.getContextWindow();
      const firstTurn = provider.getContextWindow();
      expect(fetchMock).toHaveBeenCalledOnce();
      response.resolve(Response.json({ default_generation_settings: { n_ctx: 4096 } }));
      await expect(Promise.all([startup, firstTurn])).resolves.toEqual([4096, 4096]);
      await expect(provider.getContextWindow()).resolves.toBe(4096);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not repeatedly probe an unsupported metadata endpoint', async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(provider.getContextWindow()).resolves.toBeUndefined();
      await expect(provider.getContextWindow()).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not cache an earlier model result over the current model', async () => {
      const oldResponse = Promise.withResolvers<Response>();
      const fetchMock = vi.fn()
        .mockReturnValueOnce(oldResponse.promise)
        .mockResolvedValueOnce(Response.json({ default_generation_settings: { n_ctx: 8192 } }));
      vi.stubGlobal('fetch', fetchMock);
      const old = provider.getContextWindow();
      provider.setModel('new-model');
      await expect(provider.getContextWindow()).resolves.toBe(8192);
      oldResponse.resolve(Response.json({ default_generation_settings: { n_ctx: 4096 } }));
      await old;
      await expect(provider.getContextWindow()).resolves.toBe(8192);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes expired context metadata and keeps the last known limit on failure', async () => {
      vi.useFakeTimers();
      try {
        const baseline = vi.getTimerCount();
        const fetchMock = vi.fn()
          .mockResolvedValueOnce(Response.json({ default_generation_settings: { n_ctx: 4096 } }))
          .mockRejectedValueOnce(new Error('server restarting'))
          .mockResolvedValueOnce(Response.json({ default_generation_settings: { n_ctx: 8192 } }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(provider.getContextWindow()).resolves.toBe(4096);
        vi.advanceTimersByTime(30001);
        await expect(provider.getContextWindow()).resolves.toBe(4096);
        vi.advanceTimersByTime(30001);
        await expect(provider.getContextWindow()).resolves.toBe(8192);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(baseline);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses the active slot context instead of a model training limit or total context', async () => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json({
        default_generation_settings: { n_ctx: 4096 },
        total_slots: 4,
        n_ctx: 16384,
        meta: { n_ctx_train: 131072 },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(provider.getContextWindow()).resolves.toBe(4096);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8080/props?model=local&autoload=false');
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('queries the selected router model without loading it', async () => {
      provider.setModel('hadad/LFM2.5-1.2B:Q4_K_M');
      const fetchMock = vi.fn().mockResolvedValue(Response.json({
        default_generation_settings: { n_ctx: 8192 },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(provider.getContextWindow()).resolves.toBe(8192);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/props?model=hadad%2FLFM2.5-1.2B%3AQ4_K_M&autoload=false',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it.each([0, -1, '4096', null, 4096.5])('ignores invalid active context %s', async (n_ctx) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
        default_generation_settings: { n_ctx },
        meta: { n_ctx_train: 131072 },
      })));
      await expect(provider.getContextWindow()).resolves.toBeUndefined();
    });

    it('discards unsupported metadata responses without changing the fallback', async () => {
      const cancel = vi.fn();
      const body = new ReadableStream({ cancel });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 404 })));

      await expect(provider.getContextWindow()).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
    });

    it('keeps metadata discovery optional when the server is unavailable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      await expect(provider.getContextWindow()).resolves.toBeUndefined();
    });

    it('does not issue discovery after cancellation', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(provider.getContextWindow(controller.signal)).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels a metadata body that fails while being read', async () => {
      const cancel = vi.fn(async () => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new Error('metadata aborted'); },
        body: { cancel },
      }));
      await expect(provider.getContextWindow()).resolves.toBeUndefined();
      expect(cancel).toHaveBeenCalledOnce();
    });
  });

  describe('metadata response cleanup', () => {
    it('cancels an unsupported model-list body before returning fallbacks', async () => {
      const cancel = vi.fn();
      const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 404 }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(provider.listModels()).resolves.toEqual(['local']);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8080/v1/models',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it.each([200, 503])('cancels an unused health response body for status %s', async (status) => {
      const cancel = vi.fn();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status })));
      await expect(provider.isAvailable()).resolves.toBe(status === 200);
      expect(cancel).toHaveBeenCalledOnce();
    });
  });


  describe('finish reason normalization', () => {
    const mockJson = (body: unknown) => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
    };

    it('maps a vendor max_tokens finish reason to length', async () => {
      mockJson({ id: 'r-1', created: 1, choices: [{ message: { role: 'assistant', content: '', }, finish_reason: 'max_tokens' }] });
      const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(response.finishReason).toBe('length');
    });

    it('keeps tool_calls as tool_calls', async () => {
      mockJson({ id: 'r-1', created: 1, choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
      const response = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(response.finishReason).toBe('tool_calls');
    });
  });
});
