/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { buildFileMentionSuggestions } from '../src/ui/mentionFilter.js';

describe('buildFileMentionSuggestions', () => {
  it('returns recent files when seed is empty', () => {
    const files = [
      'src/index.ts',
      'src/ui/inputPrompt.ts',
      'README.md',
      'src/ui/commandPalette.tsx',
      'docs/guide.md',
      'package.json'
    ];

    expect(buildFileMentionSuggestions(files, '')).toEqual(files);
  });

  it('prioritizes exact filename matches first', () => {
    const files = [
      'docs/inputprompt.md',
      'src/ui/inputPrompt.ts',
      'scripts/input-runner.ts'
    ];

    const suggestions = buildFileMentionSuggestions(files, 'inputprompt.ts');
    expect(suggestions[0]).toBe('src/ui/inputPrompt.ts');
  });

  it('orders filename contains before path-only matches', () => {
    const files = [
      'config/runner.config.ts',
      'src/tasks/run/runner.ts',
      'docs/runner/index.md',
      'examples/runner-demo/index.ts',
      'scripts/setup.ts',
      'packages/tools/src/index.ts'
    ];

    const suggestions = buildFileMentionSuggestions(files, 'runner');

    expect(suggestions.slice(0, 2)).toEqual([
      'config/runner.config.ts',
      'src/tasks/run/runner.ts'
    ]);
    expect(suggestions[2]).toBe('docs/runner/index.md');
  });

  it('prefers path prefixes when seed includes a slash', () => {
    const files = [
      'src/index.ts',
      'src/ui/inputPrompt.ts',
      'scripts/src-helper.ts',
      'packages/src-tools/index.ts'
    ];

    const suggestions = buildFileMentionSuggestions(files, 'src/');

    expect(suggestions.slice(0, 2)).toEqual([
      'src/index.ts',
      'src/ui/inputPrompt.ts'
    ]);
  });
});
