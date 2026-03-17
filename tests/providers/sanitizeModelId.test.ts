/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { sanitizeModelId } from '../../src/providers/errors.js';

describe('sanitizeModelId', () => {
  it('returns clean model IDs unchanged', () => {
    expect(sanitizeModelId('anthropic/claude-3.5-sonnet')).toBe('anthropic/claude-3.5-sonnet');
  });

  it('strips bracketed paste start marker [200~', () => {
    expect(sanitizeModelId('[200~anthropic/claude-sonnet-4.6')).toBe('anthropic/claude-sonnet-4.6');
  });

  it('strips bracketed paste end marker [201~', () => {
    expect(sanitizeModelId('anthropic/claude-sonnet-4.6[201~')).toBe('anthropic/claude-sonnet-4.6');
  });

  it('strips both bracketed paste markers (GH #29)', () => {
    expect(sanitizeModelId('[200~anthropic/claude-sonnet-4.6[201~')).toBe('anthropic/claude-sonnet-4.6');
  });

  it('strips ESC prefix variants of bracketed paste markers', () => {
    expect(sanitizeModelId('\x1b[200~anthropic/claude-3.5-sonnet\x1b[201~')).toBe('anthropic/claude-3.5-sonnet');
  });

  it('trims whitespace', () => {
    expect(sanitizeModelId('  anthropic/claude-3.5-sonnet  ')).toBe('anthropic/claude-3.5-sonnet');
  });

  it('strips control characters', () => {
    expect(sanitizeModelId('anthropic/claude-3.5-sonnet\r\n')).toBe('anthropic/claude-3.5-sonnet');
  });

  it('handles empty string', () => {
    expect(sanitizeModelId('')).toBe('');
  });

  it('handles model ID that is only paste markers', () => {
    expect(sanitizeModelId('[200~[201~')).toBe('');
  });
});
