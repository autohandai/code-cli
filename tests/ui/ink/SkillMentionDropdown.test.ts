/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  matchSkillMention,
  buildSkillSuggestions,
} from '../../../src/ui/ink/SkillMentionDropdown.js';
import type { SkillMentionInfo } from '../../../src/ui/mentionFilter.js';

const skills: SkillMentionInfo[] = [
  { name: 'react-expert', description: 'React 19 expert', isActive: true, source: 'builtin' },
  { name: 'typescript', description: 'TypeScript best practices', isActive: false, source: 'builtin' },
  { name: 'rust', description: 'Rust systems programming', isActive: false, source: 'user' },
];

describe('matchSkillMention', () => {
  it('returns null when text has no $', () => {
    expect(matchSkillMention('hello world', 11)).toBeNull();
  });

  it('matches a $ at the start of input', () => {
    expect(matchSkillMention('$rea', 4)).toEqual({ seed: 'rea', startIndex: 0 });
  });

  it('matches $ after whitespace', () => {
    expect(matchSkillMention('use $rea', 8)).toEqual({ seed: 'rea', startIndex: 4 });
  });

  it('returns empty seed for bare $', () => {
    expect(matchSkillMention('$', 1)).toEqual({ seed: '', startIndex: 0 });
  });

  it('respects cursor position (does not match past cursor)', () => {
    expect(matchSkillMention('$react full text', 3)).toEqual({ seed: 're', startIndex: 0 });
  });

  it('does not match $ embedded in a word', () => {
    expect(matchSkillMention('foo$bar', 7)).toBeNull();
  });
});

describe('buildSkillSuggestions', () => {
  it('returns empty list for empty seed', () => {
    expect(buildSkillSuggestions('', skills)).toEqual([]);
  });

  it('returns matches with $ prefix on the name', () => {
    const result = buildSkillSuggestions('rea', skills);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: '$react-expert',
      description: 'React 19 expert',
      isActive: true,
    });
  });

  it('matches multiple skills by description tokens', () => {
    const result = buildSkillSuggestions('typescript', skills);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('$typescript');
  });

  it('respects the limit parameter', () => {
    const result = buildSkillSuggestions('r', skills, 1);
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('returns empty when no matches', () => {
    expect(buildSkillSuggestions('nonexistent-xyz', skills)).toEqual([]);
  });
});
