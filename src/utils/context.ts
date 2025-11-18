/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMMessage } from '../types.js';

const MODEL_CONTEXT: Record<string, number> = {
  'anthropic/claude-3.5-sonnet': 200_000,
  'anthropic/claude-3-opus': 200_000,
  'anthropic/claude-3-haiku': 200_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-4o': 128_000,
  'openai/gpt-4.1': 200_000,
  'google/gemini-pro': 128_000,
  'deepseek/deepseek-r1-0528-qwen3-8b:free': 8_000,
  'deepseek/deepseek-coder': 16_000
};

export function getContextWindow(model: string): number {
  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT[normalized]) {
    return MODEL_CONTEXT[normalized];
  }
  const fuzzy = Object.entries(MODEL_CONTEXT).find(([name]) => normalized.startsWith(name));
  return fuzzy ? fuzzy[1] : 128_000;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((acc, message) => acc + estimateTokens(message.content ?? ''), 0);
}
