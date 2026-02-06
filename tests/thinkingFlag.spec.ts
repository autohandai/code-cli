/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { parseThinkingLevel } from '../src/utils/thinkingLevel.js';

describe('parseThinkingLevel', () => {
  it('returns "normal" when value is undefined (flag not passed)', () => {
    expect(parseThinkingLevel(undefined)).toBe('normal');
  });

  it('returns "extended" when value is true (--thinking passed without value)', () => {
    expect(parseThinkingLevel(true)).toBe('extended');
  });

  it('returns "extended" when value is the string "true"', () => {
    expect(parseThinkingLevel('true')).toBe('extended');
  });

  it('returns "none" when value is false', () => {
    expect(parseThinkingLevel(false)).toBe('none');
  });

  it('returns "none" when value is the string "false"', () => {
    expect(parseThinkingLevel('false')).toBe('none');
  });

  it('passes through "extended" as-is', () => {
    expect(parseThinkingLevel('extended')).toBe('extended');
  });

  it('passes through "normal" as-is', () => {
    expect(parseThinkingLevel('normal')).toBe('normal');
  });

  it('passes through "none" as-is', () => {
    expect(parseThinkingLevel('none')).toBe('none');
  });
});
