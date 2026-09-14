/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The three providers that built LLMUsage by hand instead of going through
 * normalizeLLMUsage. All three speak the OpenAI shape, so a cached-prompt
 * detail has to survive the trip, and a response reporting no cache detail has
 * to leave both fields absent rather than claiming a measured zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlamaCppProvider } from '../../src/providers/LlamaCppProvider.js';
import { MLXProvider } from '../../src/providers/MLXProvider.js';
import { CerebrasClient } from '../../src/providers/CerebrasClient.js';
import { isMLXSupported } from '../../src/utils/platform.js';

vi.mock('../../src/utils/platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/platform.js')>();
  return { ...actual, isMLXSupported: vi.fn(() => true) };
});

function mockChatCompletion(usage: Record<string, unknown> | undefined): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'resp-1',
      created: 1700000000,
      choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
      ...(usage ? { usage } : {}),
    }),
  });
}

const CACHED = {
  prompt_tokens: 1000,
  completion_tokens: 20,
  total_tokens: 1020,
  prompt_tokens_details: { cached_tokens: 768 },
};

const UNCACHED = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

afterEach(() => {
  vi.clearAllMocks();
});

describe('LlamaCppProvider usage', () => {
  const provider = () => new LlamaCppProvider({ baseUrl: 'http://localhost:8080', model: 'local' });

  it('carries a reported cached prompt detail', async () => {
    mockChatCompletion(CACHED);
    const response = await provider().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.cacheReadTokens).toBe(768);
  });

  it('leaves cache fields absent when nothing is reported', async () => {
    mockChatCompletion(UNCACHED);
    const response = await provider().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.promptTokens).toBe(10);
    expect(response.usage?.cacheReadTokens).toBeUndefined();
    expect(response.usage?.cacheWriteTokens).toBeUndefined();
  });
});

describe('MLXProvider usage', () => {
  const provider = () => new MLXProvider({ baseUrl: 'http://localhost:8080', model: 'mlx-model' });

  it('carries a reported cached prompt detail', async () => {
    vi.mocked(isMLXSupported).mockReturnValue(true);
    mockChatCompletion(CACHED);
    const response = await provider().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.cacheReadTokens).toBe(768);
  });

  it('leaves cache fields absent when nothing is reported', async () => {
    vi.mocked(isMLXSupported).mockReturnValue(true);
    mockChatCompletion(UNCACHED);
    const response = await provider().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.promptTokens).toBe(10);
    expect(response.usage?.cacheReadTokens).toBeUndefined();
    expect(response.usage?.cacheWriteTokens).toBeUndefined();
  });
});

describe('CerebrasClient usage', () => {
  const client = () => new CerebrasClient({ apiKey: 'test-key', model: 'llama3.1-8b' });

  it('carries a reported cached prompt detail', async () => {
    mockChatCompletion(CACHED);
    const response = await client().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.cacheReadTokens).toBe(768);
  });

  it('leaves cache fields absent when nothing is reported', async () => {
    mockChatCompletion(UNCACHED);
    const response = await client().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.promptTokens).toBe(10);
    expect(response.usage?.cacheReadTokens).toBeUndefined();
    expect(response.usage?.cacheWriteTokens).toBeUndefined();
  });

  it('discards an impossible cache breakdown, which a hand-rolled object could not do', async () => {
    mockChatCompletion({
      prompt_tokens: 40,
      completion_tokens: 5,
      total_tokens: 45,
      prompt_tokens_details: { cached_tokens: 900 },
    });
    const response = await client().complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(response.usage?.promptTokens).toBe(40);
    expect(response.usage?.cacheReadTokens).toBeUndefined();
  });
});
