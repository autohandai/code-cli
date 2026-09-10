/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { isITerm2, resolveMouseComposerCursor } from '../../src/ui/mouseReporting.js';

describe('mouse composer cursor default', () => {
  it.each([
    [{ TERM_PROGRAM: 'iTerm.app' }, true],
    [{ TERM_PROGRAM: 'tmux', LC_TERMINAL: 'iTerm2' }, true],
    [{ TERM_PROGRAM: 'ghostty' }, false],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, false],
    [{}, false],
  ])('detects iTerm2 from %j', (env, expected) => {
    expect(isITerm2(env)).toBe(expected);
  });

  it('stays on by default outside iTerm2 and off inside it', () => {
    expect(resolveMouseComposerCursor(undefined, { TERM_PROGRAM: 'ghostty' })).toBe(true);
    expect(resolveMouseComposerCursor(undefined, {})).toBe(true);
    expect(resolveMouseComposerCursor(undefined, { TERM_PROGRAM: 'iTerm.app' })).toBe(false);
  });

  it('lets an explicit setting win on every terminal', () => {
    expect(resolveMouseComposerCursor(true, { TERM_PROGRAM: 'iTerm.app' })).toBe(true);
    expect(resolveMouseComposerCursor(false, { TERM_PROGRAM: 'ghostty' })).toBe(false);
  });
});
