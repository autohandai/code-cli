/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { shouldUseInkRenderer } from '../../src/ui/inkMode.js';

describe('shouldUseInkRenderer', () => {
  it('defaults to Ink regardless of user config state', () => {
    expect(shouldUseInkRenderer({})).toBe(true);
  });

  it('allows an emergency legacy UI override', () => {
    expect(shouldUseInkRenderer({ AUTOHAND_LEGACY_UI: '1' })).toBe(false);
  });

  it('allows an emergency no-Ink override', () => {
    expect(shouldUseInkRenderer({ AUTOHAND_NO_INK: '1' })).toBe(false);
  });
});
