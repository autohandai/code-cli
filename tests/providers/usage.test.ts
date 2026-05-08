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

  it('returns undefined for missing, null, empty, or unusable usage', () => {
    expect(normalizeLLMUsage(undefined)).toBeUndefined();
    expect(normalizeLLMUsage(null)).toBeUndefined();
    expect(normalizeLLMUsage({})).toBeUndefined();
    expect(normalizeLLMUsage({ total_tokens: '0' })).toBeUndefined();
  });
});
