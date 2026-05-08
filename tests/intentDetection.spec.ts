/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { classifyResponseCompletion } from '../src/core/agent/ResponseCompletionClassifier.js';

describe('Intent Detection', () => {
  it.each([
    'Let me update the README.md file now.',
    "I'll update the code now.",
    "I'm going to update the tests.",
    'Let me make the changes now.',
    "I'll start to create the component.",
    'Looking at the code, I can see the issue. Let me fix the bug in the authentication module.',
  ])('routes deferred action intent through the response completion classifier', (response) => {
    expect(classifyResponseCompletion({ response })).toMatchObject({
      kind: 'invalid_deferred_action',
      reason: 'announced_action_without_tool',
    });
  });

  it.each([
    'I have updated the file.',
    'The changes have been applied.',
    'Updated README.md with new content.',
    'The file contains a typo.',
    'Here is what I discovered.',
    'Should I update the file?',
    'Would you like me to make changes?',
  ])('keeps completed actions, analysis, and questions as final answers', (response) => {
    expect(classifyResponseCompletion({ response })).toEqual({ kind: 'final_answer' });
  });
});
