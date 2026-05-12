/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMUsage } from '../types.js';

type UsageRecord = Record<string, unknown>;

function readTokenCount(record: UsageRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

/**
 * Normalize provider token usage without converting missing values to zero.
 *
 * `total_tokens`/`totalTokens` is authoritative when present. If a provider
 * omits total but supplies actual input and output counts, derive total from
 * those actual fields. Empty or unusable usage payloads return undefined.
 */
export function normalizeLLMUsage(rawUsage: unknown): LLMUsage | undefined {
  if (!rawUsage || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) {
    return undefined;
  }

  const usage = rawUsage as UsageRecord;
  const promptTokens = readTokenCount(usage, ['prompt_tokens', 'input_tokens', 'promptTokens', 'inputTokens']);
  const completionTokens = readTokenCount(usage, ['completion_tokens', 'output_tokens', 'completionTokens', 'outputTokens']);
  const reportedTotal = readTokenCount(usage, ['total_tokens', 'totalTokens']);

  const hasAnyActualCount =
    promptTokens !== undefined ||
    completionTokens !== undefined ||
    reportedTotal !== undefined;
  if (!hasAnyActualCount) {
    return undefined;
  }

  const totalTokens = reportedTotal ?? ((promptTokens ?? 0) + (completionTokens ?? 0));
  return {
    promptTokens: promptTokens ?? 0,
    completionTokens: completionTokens ?? 0,
    totalTokens,
  };
}
