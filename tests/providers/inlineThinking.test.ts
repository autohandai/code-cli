/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { joinReasoning, splitInlineThinking } from '../../src/providers/inlineThinking.js';

describe('splitInlineThinking', () => {
  it('splits a leading think block from the answer', () => {
    expect(splitInlineThinking('<think>\nDraft it.\n</think>\n\nFinal answer.')).toEqual({
      content: 'Final answer.',
      reasoning: 'Draft it.',
    });
  });

  it('accepts the long tag name and leading whitespace', () => {
    expect(splitInlineThinking('  \n<thinking>weigh</thinking>answer')).toEqual({
      content: 'answer',
      reasoning: 'weigh',
    });
  });

  it('treats an unterminated block as reasoning only', () => {
    expect(splitInlineThinking('<think>cut off by the budget')).toEqual({
      content: '',
      reasoning: 'cut off by the budget',
    });
  });

  it('leaves think tags that appear mid-answer alone', () => {
    const content = 'Use <think> tags like this: <think>example</think>.';
    expect(splitInlineThinking(content)).toEqual({ content });
  });

  it('drops an empty block without reporting reasoning', () => {
    expect(splitInlineThinking('<think></think>Hello')).toEqual({ content: 'Hello' });
  });

  it('returns plain content untouched', () => {
    expect(splitInlineThinking('Hello')).toEqual({ content: 'Hello' });
    expect(splitInlineThinking('')).toEqual({ content: '' });
  });
});

describe('joinReasoning', () => {
  it('joins present parts and drops blanks', () => {
    expect(joinReasoning('a', undefined, ' ', 'b')).toBe('a\n\nb');
    expect(joinReasoning(undefined, '')).toBeUndefined();
  });
});
