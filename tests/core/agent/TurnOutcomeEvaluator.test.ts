/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { evaluateAssistantTurn } from '../../../src/core/agent/TurnOutcomeEvaluator.js';
import type { AssistantReactPayload, LLMResponse } from '../../../src/types.js';

function completion(overrides: Partial<LLMResponse>): LLMResponse {
  return {
    id: 'completion',
    created: 1,
    content: '',
    raw: {},
    ...overrides,
  };
}

function evaluate(overrides: {
  completion: Partial<LLMResponse>;
  payload: AssistantReactPayload;
}) {
  return evaluateAssistantTurn({
    completion: completion(overrides.completion),
    payload: overrides.payload,
    cleanupModelResponse: (content) => content.trim(),
  });
}

describe('TurnOutcomeEvaluator', () => {
  it('routes tool calls to execution and allows saving the assistant message', () => {
    const result = evaluate({
      completion: { content: '{"toolCalls":[{"tool":"find","args":{"query":"ReactLoopRunner"}}]}' },
      payload: {
        thought: 'I need to inspect the codebase structure.',
        toolCalls: [{ tool: 'find', args: { query: 'ReactLoopRunner' } }],
      },
    });

    expect(result).toEqual({
      type: 'continue_with_tools',
      toolCalls: [{ tool: 'find', args: { query: 'ReactLoopRunner' } }],
      thought: 'I need to inspect the codebase structure.',
      saveAssistantMessage: true,
    });
  });

  it('repairs truly empty no-tool turns before they can be saved', () => {
    const result = evaluate({
      completion: { content: '' },
      payload: {},
    });

    expect(result).toMatchObject({
      type: 'repair',
      reason: 'empty_no_tool_response',
      saveAssistantMessage: false,
    });
  });

  it('repairs JSON-only no-tool turns that clean to no response', () => {
    const result = evaluate({
      completion: { content: '{"toolCalls":[]}' },
      payload: { toolCalls: [] },
    });

    expect(result).toMatchObject({
      type: 'repair',
      reason: 'empty_no_tool_response',
      saveAssistantMessage: false,
    });
  });

  it('repairs truncated turns before tool execution or final rendering', () => {
    const result = evaluate({
      completion: { content: '{"thought":"half done"', finishReason: 'length' },
      payload: { thought: 'half done' },
    });

    expect(result).toEqual({
      type: 'repair',
      reason: 'truncated_response',
      instruction:
        '[System] Your previous response was truncated due to output length limits. Please continue from where you left off. If you were making a tool call, retry it.',
      saveAssistantMessage: false,
    });
  });

  it('repairs deferred action prose with no tool calls', () => {
    const result = evaluate({
      completion: {
        content: 'I should inspect the codebase structure before answering.',
      },
      payload: {
        finalResponse: 'I should inspect the codebase structure before answering.',
      },
    });

    expect(result).toMatchObject({
      type: 'repair',
      reason: 'invalid_deferred_action',
      saveAssistantMessage: false,
    });
  });

  it('finishes only with a usable response and allows saving', () => {
    const result = evaluate({
      completion: { content: 'The repo is a TypeScript CLI with src and tests.' },
      payload: { finalResponse: 'The repo is a TypeScript CLI with src and tests.' },
    });

    expect(result).toEqual({
      type: 'finish',
      response: 'The repo is a TypeScript CLI with src and tests.',
      usedThoughtAsResponse: false,
      saveAssistantMessage: true,
    });
  });
});
