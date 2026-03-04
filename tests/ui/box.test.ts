/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { drawInputBox, drawInputTopBorder, drawInputBottomBorder } from '../../src/ui/box.js';

/** Strip ALL CSI escape sequences (colors, cursor control, erase-in-line, etc.) */
function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

// Known ANSI codes used by drawInputBox
const BG_CODE = '\x1b[48;2;43;43;43m';  // bg #2b2b2b
const FG_CODE = '\x1b[38;2;160;160;160m'; // fg #a0a0a0
const CLEAR_EOL = '\x1b[K';
const RESET = '\x1b[0m';

describe('drawInputBox', () => {
  it('renders left-only content padded to width', () => {
    const result = stripAnsi(drawInputBox('hello', 20));
    expect(result.length).toBe(20);
    expect(result.startsWith('hello')).toBe(true);
  });

  it('renders left and right content with gap', () => {
    const result = stripAnsi(drawInputBox('left', 30, 'right'));
    expect(result.length).toBe(30);
    expect(result.startsWith('left')).toBe(true);
    expect(result.endsWith('right')).toBe(true);
  });

  it('truncates right content when no room', () => {
    const result = stripAnsi(drawInputBox('lefttext', 10, 'rightttx'));
    expect(result.length).toBe(10);
    expect(result.startsWith('lefttext')).toBe(true);
  });

  it('handles empty right gracefully', () => {
    const result = stripAnsi(drawInputBox('status', 40, ''));
    expect(result.length).toBe(40);
    expect(result.startsWith('status')).toBe(true);
  });

  it('pads to visible width when left content contains ANSI sequences', () => {
    const styled = '\u001b[31mhello\u001b[39m';
    const result = stripAnsi(drawInputBox(styled, 20));
    expect(result.length).toBe(20);
    expect(result.startsWith('hello')).toBe(true);
  });

  it('calculates right clipping using visible width when ANSI is present', () => {
    const left = '\u001b[36mleft\u001b[39m';
    const right = '\u001b[33mright-content\u001b[39m';
    const result = stripAnsi(drawInputBox(left, 16, right));
    expect(result.length).toBe(16);
    expect(result.startsWith('left')).toBe(true);
  });

  // --- Background fill tests ---

  it('includes background ANSI code in output', () => {
    const result = drawInputBox('hello', 20);
    expect(result).toContain(BG_CODE);
  });

  it('includes clear-to-EOL escape to extend background to terminal edge', () => {
    const result = drawInputBox('hello', 20);
    expect(result).toContain(CLEAR_EOL);
  });

  it('places clear-to-EOL before the final reset', () => {
    const result = drawInputBox('test', 20);
    const eolIndex = result.lastIndexOf(CLEAR_EOL);
    const resetIndex = result.lastIndexOf(RESET);
    expect(eolIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(eolIndex);
  });

  it('re-applies background after inner full-reset ANSI code', () => {
    // Simulates styled text that contains \x1b[0m (e.g., from nested chalk)
    const styledContent = `\x1b[90mhello${RESET} world`;
    const result = drawInputBox(styledContent, 30);

    // After inner \x1b[0m, background must be re-applied
    const reApplyPattern = /\x1b\[0m\x1b\[48;2;43;43;43m/;
    expect(result).toMatch(reApplyPattern);

    // Visible content is correct
    expect(stripAnsi(result).length).toBe(30);
    expect(stripAnsi(result)).toContain('hello');
    expect(stripAnsi(result)).toContain('world');
  });

  it('replaces inner bg-close codes to preserve background', () => {
    const bgClose = '\x1b[49m';
    const styledContent = `styled${bgClose}text`;
    const result = drawInputBox(styledContent, 20);

    // The bg-close code should be replaced (not present as-is)
    // Instead, the bg-open code should appear in its place
    expect(stripAnsi(result)).toContain('styledtext');
    expect(stripAnsi(result).length).toBe(20);
  });

  it('replaces inner fg-close codes with box foreground', () => {
    const styledContent = '\x1b[31mred text\x1b[39m normal';
    const result = drawInputBox(styledContent, 30);

    // The output should contain the box fg code (replacing \x1b[39m)
    expect(result).toContain(FG_CODE);
    expect(stripAnsi(result).length).toBe(30);
  });

  it('extends background with clear-to-EOL when right param is provided', () => {
    const result = drawInputBox('left', 30, 'right');
    expect(result).toContain(BG_CODE);
    expect(result).toContain(CLEAR_EOL);
    expect(stripAnsi(result).length).toBe(30);
  });
});

describe('drawInputTopBorder', () => {
  it('renders full-width top border', () => {
    const rendered = drawInputTopBorder(20);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(20);
    expect(plain.startsWith('┌')).toBe(true);
    expect(plain.endsWith('┐')).toBe(true);
  });
});

describe('drawInputBottomBorder', () => {
  it('renders full-width bottom border', () => {
    const rendered = drawInputBottomBorder(20);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(20);
    expect(plain.startsWith('└')).toBe(true);
    expect(plain.endsWith('┘')).toBe(true);
  });
});
