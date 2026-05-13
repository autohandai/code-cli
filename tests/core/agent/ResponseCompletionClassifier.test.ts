/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESPONSE_COMPLETION_HOOKS,
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

  it('runs completion hooks in order and stops at the first structural decision', () => {
    const hookCalls: string[] = [];
    const result = classifyResponseCompletion(
      {
        response: 'A custom validator wants this repaired.',
      },
      [
        () => {
          hookCalls.push('first');
          return undefined;
        },
        ({ response }) => {
          hookCalls.push('second');
          return {
            kind: 'invalid_deferred_action',
            reason: 'announced_action_without_tool',
            excerpt: response,
          };
        },
        () => {
          hookCalls.push('third');
          return { kind: 'final_answer' };
        },
      ],
    );

    expect(result).toEqual({
      kind: 'invalid_deferred_action',
      reason: 'announced_action_without_tool',
      excerpt: 'A custom validator wants this repaired.',
    });
    expect(hookCalls).toEqual(['first', 'second']);
  });

  it('keeps the default completion hooks ordered from structural to text-policy validation', () => {
    const result = classifyResponseCompletion(
      {
        response: 'I will inspect the file now.',
        toolCalls: [{ tool: 'read_file', args: { path: 'src/index.ts' } }],
      },
      DEFAULT_RESPONSE_COMPLETION_HOOKS,
    );

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
    [
      'Let me provide the tool list available to you:',
      '- read_file: inspect files',
      '- apply_patch: edit files',
      '- shell: run commands',
    ].join('\n'),
    [
      "I'll provide the tools I have for you:",
      '- git_status and git_diff for repository state',
      '- fff_grep and read_file for source inspection',
      '- apply_patch for focused edits',
    ].join('\n'),
    [
      'I have tools for:',
      '- **Codebase discovery**',
      '  - Find files: `fff_find`',
      '  - Search code/content: `fff_grep`',
      '  - Read files, inspect tree, file stats/checksums',
      '- **Editing**',
      '  - Write/edit files: `write_file`, `apply_patch`, `search_replace`, `append_file`',
    ].join('\n'),
  ])('classifies real final answers as final_answer', (response) => {
    const result = classifyResponseCompletion({ response });

    expect(result).toEqual({ kind: 'final_answer' });
  });

  it.each([
    'Let me explain the runtime architecture: ReactLoopRunner owns turn completion.',
    'I will spread this across two bullets:\n- first point\n- second point',
    'I can answer without reading files: this is a TypeScript CLI.',
  ])('does not match operational action words inside larger words or answer phrasing', (response) => {
    const result = classifyResponseCompletion({ response });

    expect(result).toEqual({ kind: 'final_answer' });
  });

  it('keeps the legacy deferred-response helper backed by the classifier', () => {
    expect(isDeferredFinalResponse('Let me run the tests now.')).toBe(true);
    expect(isDeferredFinalResponse('Let me explain: the tests failed before this change.')).toBe(false);
  });
});
