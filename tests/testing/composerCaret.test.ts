/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { hasElapsedWorkingStatus } from '../../src/testing/assertions/composerCaret.js';

describe('elapsed working-status evidence', () => {
  it.each([
    '(0m 00s) · esc to cancel',
    'Completed in 0m 01s',
    '(0m 01s)\n(0m 00s) · esc to cancel',
  ])('does not mistake startup or completion for an elapsed working refresh: %s', output => {
    expect(hasElapsedWorkingStatus(output)).toBe(false);
  });

  it.each([
    '(0m 01s) · esc to cancel',
    '(0m 03s) · esc to cancel',
    '(0m 03s · 0 tokens) · esc to cancel',
    '(1m 00s) · esc to cancel',
    '\x1b[32m(0m 02s)\x1b[0m · esc to cancel',
  ])('recognizes a real working refresh without assuming a scheduler instant: %s', output => {
    expect(hasElapsedWorkingStatus(output)).toBe(true);
  });
});
