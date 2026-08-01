/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { normalizeLLMUsage } from '../../src/providers/usage.js';

describe('normalizeLLMUsage', () => {
  it('normalizes full OpenAI-compatible usage', () => {
    expect(normalizeLLMUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 20,
    })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 20,
    });
  });

  it('normalizes Responses API input/output usage', () => {
    expect(normalizeLLMUsage({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('keeps a total-only usage object as actual total usage', () => {
    expect(normalizeLLMUsage({ total_tokens: 42 })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 42,
    });
  });

  it('derives total from prompt and completion counts when total is missing', () => {
    expect(normalizeLLMUsage({
      prompt_tokens: 12,
      completion_tokens: 8,
    })).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });

  it('normalizes explicitly reported generic cache read and write tokens', () => {
    expect(normalizeLLMUsage({
      prompt_tokens: 40,
      completion_tokens: 5,
      total_tokens: 45,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 10,
    })).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    });
  });

  it('normalizes Responses API cache metrics from input token details', () => {
    expect(normalizeLLMUsage({
      input_tokens: 40,
      output_tokens: 5,
      total_tokens: 45,
      input_tokens_details: {
        cached_tokens: 30,
        cache_write_tokens: 10,
      },
    }, 'openai-responses')).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    });
  });

  it('normalizes Chat Completions cache metrics from prompt token details', () => {
    expect(normalizeLLMUsage({
      prompt_tokens: 40,
      completion_tokens: 5,
      total_tokens: 45,
      prompt_tokens_details: {
        cached_tokens: 30,
        cache_write_tokens: 10,
      },
    }, 'openai-chat')).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
    });
  });

  it('preserves a reported zero cache count instead of treating it as absent', () => {
    expect(normalizeLLMUsage({
      input_tokens: 40,
      output_tokens: 5,
      total_tokens: 45,
      input_tokens_details: {
        cached_tokens: 0,
      },
    }, 'openai-responses')).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
      cacheReadTokens: 0,
    });
  });

  it('discards an impossible cache breakdown without discarding ordinary usage', () => {
    expect(normalizeLLMUsage({
      input_tokens: 40,
      output_tokens: 5,
      total_tokens: 45,
      input_tokens_details: {
        cached_tokens: 35,
        cache_write_tokens: 10,
      },
    }, 'openai-responses')).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
    });
  });

  it('does not round fractional cache metrics into fabricated token counts', () => {
    expect(normalizeLLMUsage({
      input_tokens: 40,
      output_tokens: 5,
      total_tokens: 45,
      input_tokens_details: {
        cached_tokens: 2.5,
      },
    }, 'openai-responses')).toEqual({
      promptTokens: 40,
      completionTokens: 5,
      totalTokens: 45,
    });
  });

  it('returns undefined for missing, null, empty, or unusable usage', () => {
    expect(normalizeLLMUsage(undefined)).toBeUndefined();
    expect(normalizeLLMUsage(null)).toBeUndefined();
    expect(normalizeLLMUsage({})).toBeUndefined();
    expect(normalizeLLMUsage({ total_tokens: '0' })).toBeUndefined();
  });
});
