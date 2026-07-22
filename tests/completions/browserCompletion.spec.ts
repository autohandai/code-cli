/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  generateBashCompletion,
  generateFishCompletion,
  generateZshCompletion,
} from '../../src/completions/index.js';

describe('browser shell completions', () => {
  it.each([
    ['bash', generateBashCompletion, '--browser', '--no-browser'],
    ['zsh', generateZshCompletion, '--browser', '--no-browser'],
    ['fish', generateFishCompletion, '-l browser', '-l no-browser'],
  ])('exposes only canonical browser spellings in %s', (_shell, generate, enableFlag, disableFlag) => {
    const script = generate();

    expect(script).toContain('/browser');
    expect(script).toContain(enableFlag);
    expect(script).toContain(disableFlag);
    expect(script).not.toContain('/chrome');
    expect(script).not.toContain('--chrome');
    expect(script).not.toContain('--no-chrome');
  });

  it('completes the canonical browser subcommand in Bash', () => {
    expect(generateBashCompletion()).toMatch(/subcommands="[^"]*\bbrowser\b/u);
  });
});
