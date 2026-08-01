/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMUsage } from '../types.js';

type UsageRecord = Record<string, unknown>;
export type LLMUsageDialect = 'generic' | 'openai-chat' | 'openai-responses';

function asUsageRecord(value: unknown): UsageRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UsageRecord
    : undefined;
}

function readTokenCount(record: UsageRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return value;
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
export function normalizeLLMUsage(
  rawUsage: unknown,
  dialect: LLMUsageDialect = 'generic',
): LLMUsage | undefined {
  if (!rawUsage || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) {
    return undefined;
  }

  const usage = rawUsage as UsageRecord;
  const promptTokens = readTokenCount(usage, ['prompt_tokens', 'input_tokens', 'promptTokens', 'inputTokens']);
  const completionTokens = readTokenCount(usage, ['completion_tokens', 'output_tokens', 'completionTokens', 'outputTokens']);
  const reportedTotal = readTokenCount(usage, ['total_tokens', 'totalTokens']);
  const promptTokenDetails = dialect === 'openai-responses'
    ? asUsageRecord(usage.input_tokens_details) ?? asUsageRecord(usage.inputTokensDetails)
    : asUsageRecord(usage.prompt_tokens_details) ?? asUsageRecord(usage.promptTokensDetails);
  let cacheReadTokens = readTokenCount(usage, ['cached_tokens', 'cache_read_input_tokens', 'cacheReadTokens'])
    ?? (promptTokenDetails ? readTokenCount(promptTokenDetails, ['cached_tokens', 'cache_read_input_tokens']) : undefined);
  let cacheWriteTokens = readTokenCount(usage, ['cache_creation_input_tokens', 'cache_write_input_tokens', 'cacheWriteTokens'])
    ?? (promptTokenDetails ? readTokenCount(promptTokenDetails, ['cache_write_tokens']) : undefined);

  if (
    promptTokens !== undefined
    && (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) > promptTokens
  ) {
    cacheReadTokens = undefined;
    cacheWriteTokens = undefined;
  }

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
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  };
}
