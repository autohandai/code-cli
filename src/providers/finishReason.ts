/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMResponse } from '../types.js';

export type NormalizedFinishReason = NonNullable<LLMResponse['finishReason']>;

const STOP_REASONS = new Set(['stop', 'end_turn', 'stop_sequence']);
const TOOL_REASONS = new Set(['tool_calls', 'tool_use', 'function_call']);
const LENGTH_REASONS = new Set([
  'length',
  'max_tokens',
  'max_output_tokens',
  'token_limit',
  'context_length',
  'context_length_exceeded',
  'context_window_exceeded',
  'model_context_window_exceeded',
  'max_time',
  'pause_turn',
]);
const FILTER_REASONS = new Set([
  'content_filter',
  'refusal',
  'safety',
  'blocked',
  'prohibited_content',
]);

/**
 * Normalize finish reasons emitted by OpenAI-compatible gateways backed by
 * different upstream protocols. Unknown explicit reasons are conservative:
 * they trigger continuation recovery instead of publishing a possibly partial
 * response as complete.
 */
export function normalizeOpenAICompatibleFinishReason(
  value: unknown,
  missingFallback: NormalizedFinishReason = 'stop',
): NormalizedFinishReason {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return missingFallback;
  }

  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
  if (STOP_REASONS.has(normalized)) return 'stop';
  if (TOOL_REASONS.has(normalized)) return 'tool_calls';
  if (LENGTH_REASONS.has(normalized)) return 'length';
  if (FILTER_REASONS.has(normalized)) return 'content_filter';
  return 'length';
}
