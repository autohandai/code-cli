/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  classifyResponseCompletion,
  isDeferredFinalResponse,
} from '../../../src/core/agent/ResponseCompletionClassifier.js';

describe('ResponseCompletionClassifier', () => {
  it('classifies tool calls structurally before inspecting response text', () => {
    const result = classifyResponseCompletion({
      response: 'I will inspect the file now.',
      toolCalls: [{ tool: 'read_file', args: { path: 'src/index.ts' } }],
    });

    expect(result).toEqual({ kind: 'tool_call' });
  });

  it.each([
    [
      'SITREP with Next: inspect',
      [
        'SITREP:',
        '- Done: confirmed the likely regression.',
        '- Next: inspect src/ui/inputPrompt.ts and src/ui/ink/AgentUI.tsx.',
      ].join('\n'),
    ],
    ['I will need to inspect', 'I will need to inspect the actual implementation before changing anything.'],
    ['I will run', 'I will run the focused composer regression test now.'],
    ['Let me run', 'Let me run the proof command before finalizing.'],
    ['I should check', 'I should check the git status and test output first.'],
    ['Blocked by no tools', 'Status: blocked by this turn s no-tool constraint.'],
    ['Edit after reviewing', 'I will edit the classifier after reviewing the loop contract.'],
    [
      'Promise to answer later',
      'I now have a comprehensive understanding of the repository. Let me provide a clear summary to the user.',
    ],
  ])('classifies %s as invalid deferred action', (_name, response) => {
    const result = classifyResponseCompletion({ response });

    expect(result.kind).toBe('invalid_deferred_action');
  });

  it.each([
    'Let me explain why this exits early: the previous response promised action without a tool call.',
    'Let me summarize: the CLI is TypeScript, Ink, Bun, and Vitest.',
    'I can now answer: the branch is read from .git/HEAD first.',
    'Here is the summary:\n- TypeScript CLI\n- Ink UI\n- Vitest tests',
    'This repo is a TypeScript CLI built with React and Ink.',
  ])('classifies real final answers as final_answer', (response) => {
    const result = classifyResponseCompletion({ response });

    expect(result).toEqual({ kind: 'final_answer' });
  });

  it('keeps the legacy deferred-response helper backed by the classifier', () => {
    expect(isDeferredFinalResponse('Let me run the tests now.')).toBe(true);
    expect(isDeferredFinalResponse('Let me explain: the tests failed before this change.')).toBe(false);
  });
});
