/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { normalizeOpenAICompatibleFinishReason } from '../../src/providers/finishReason.js';

describe('normalizeOpenAICompatibleFinishReason', () => {
  it.each([
    ['stop', 'stop'],
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['tool_calls', 'tool_calls'],
    ['tool_use', 'tool_calls'],
    ['function_call', 'tool_calls'],
    ['length', 'length'],
    ['max_tokens', 'length'],
    ['max_output_tokens', 'length'],
    ['model_context_window_exceeded', 'length'],
    ['pause_turn', 'length'],
    ['content_filter', 'content_filter'],
    ['refusal', 'content_filter'],
  ] as const)('maps %s to %s', (raw, expected) => {
    expect(normalizeOpenAICompatibleFinishReason(raw)).toBe(expected);
  });

  it('treats an unknown non-empty termination reason as incomplete', () => {
    expect(normalizeOpenAICompatibleFinishReason('upstream_interrupted')).toBe('length');
  });

  it('uses the caller fallback only when no reason was reported', () => {
    expect(normalizeOpenAICompatibleFinishReason(undefined, 'stop')).toBe('stop');
    expect(normalizeOpenAICompatibleFinishReason(null, 'length')).toBe('length');
  });
});
