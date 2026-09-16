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
    ['Action after an explanation', 'Let me explain the result. I will run the tests now.'],
    ['Action after quoted evidence', 'The saved example is `I will inspect the file`. I will run the tests now.'],
    ['Next step with a code argument', 'Next: inspect `src/index.ts`.'],
    ['Action verb formatted as code', 'I will `run` the tests now.'],
    ['Action phrase formatted as code', 'I will `run the test suite` now.'],
    ['Next step formatted as code', 'Next: `inspect src/index.ts`.'],
    ['Next step with quoted first-person intent', 'Next: `I will inspect src/index.ts`.'],
    ['Action with an example abbreviation', 'I will e.g. run the tests now.'],
    ['Action with a clarification abbreviation', 'I will, i.e. I need to, run the tests now.'],
    ['Explicit action in a status line', 'Status: I will inspect the remaining file now.'],
    ['Imperative action in a status line', 'Status: inspect the remaining configuration now.'],
    ['Imperative action in a blocked line', 'Blocked: inspect the remaining configuration first.'],
    ['Promise followed by empty code', 'I will provide the implementation for you:\n```ts\n\n```'],
    [
      'Promise to answer later',
      'I now have a comprehensive understanding of the repository. Let me provide a clear summary to the user.',
    ],
    [
      'Reflection that ends on an unexecuted read',
      [
        "I need to stop and reflect on what I've gathered so far before proceeding.",
        '',
        'I was trying to read the actual implementation files but the tool calls were blocked.',
        'I need to read `src/commands/agents.ts` and `src/core/agents/AgentDelegator.ts` implementation',
        'before I can plan the "kill/stop" feature.',
        '',
        'Let me try reading those files now.',
      ].join('\n'),
    ],
    [
      'SITREP that explicitly remains in progress',
      [
        'SITREP:',
        '- Done: inspected the first phase.',
        '- Status: in-progress',
        '- Next: awaiting the remaining implementation work.',
      ].join('\n'),
    ],
    [
      'partial phase with remaining work',
      'Phase 1 of 3 is done. Remaining: phases 2 and 3 still need implementation and verification.',
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
      '- find_grep and read_file for source inspection',
      '- apply_patch for focused edits',
    ].join('\n'),
    [
      'I have tools for:',
      '- **Codebase discovery**',
      '  - Find files: `fff_find`',
      '  - Search code/content: `find_grep`',
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

  it.each([
    ['completed search app', '✓ Act I — Search App: complete and verified.\nStatus: search and review flows passed verification.'],
    ['completed persistence', '✓ localStorage persistence implemented in app.js.\nStatus: read and write persistence verified.'],
    ['saved memory text', 'Done. The Demo Off memory now contains:\n> I will remove the demo data when Demo Off is requested.'],
    ['inline memory text', 'Done. Saved `I will remove the demo data when Demo Off is requested` in both memory scopes.'],
    ['code example', 'The test now covers this response:\n```text\nI will run the tests now.\n```\nVerification passed.'],
    ['tilde code example', 'The test now covers this response:\n~~~text\nI will run the tests now.\n~~~\nVerification passed.'],
    ['quoted tool limitation', 'The old failure message was:\n> Tools unavailable\nThe connection is now restored.'],
    ['application behavior', 'Done. The search app is ready.\nNext: the results update automatically when you type.'],
    ['separate answer sentences', 'I will leave it there. The search implementation is complete.'],
    ['completed status with nothing remaining', 'Status: completed. Remaining: none.'],
    ['delivered code answer', 'I will provide the implementation for you:\n```ts\nexport const hello = 1;\n```'],
    ['delivered quote answer', 'I will provide the exact message for you:\n> I will inspect the remaining file now.'],
  ])('accepts %s without treating reported content as an action promise', (_name, response) => {
    expect(classifyResponseCompletion({ response })).toEqual({ kind: 'final_answer' });
  });

  it('reports the triggering statement instead of an unrelated completed-work prefix', () => {
    const response = `${'The implemented search and persistence checks passed. '.repeat(6)}\nI will inspect the remaining file now.`;

    expect(classifyResponseCompletion({ response })).toMatchObject({
      kind: 'invalid_deferred_action',
      excerpt: 'i will inspect the remaining file now',
    });
  });

  it('keeps the legacy deferred-response helper backed by the classifier', () => {
    expect(isDeferredFinalResponse('Let me run the tests now.')).toBe(true);
    expect(isDeferredFinalResponse('Let me explain: the tests failed before this change.')).toBe(false);
  });
});
