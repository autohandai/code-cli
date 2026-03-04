/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { drawInputBox, drawInputTopBorder, drawInputBottomBorder } from '../../src/ui/box.js';

/** Strip ALL CSI escape sequences (colors, cursor control, erase-in-line, etc.) */
function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** Extract content between the │ side borders */
function innerContent(value: string): string {
  const plain = stripAnsi(value);
  return plain.slice(1, -1); // strip leading │ and trailing │
}

const CLEAR_EOL = '\x1b[K';
const RESET = '\x1b[0m';
const BG_PATTERN = /\x1b\[48;2;\d+;\d+;\d+m/;
const FG_PATTERN = /\x1b\[38;2;\d+;\d+;\d+m/;

describe('drawInputBox', () => {
  it('renders left-only content padded to width with │ borders', () => {
    const result = stripAnsi(drawInputBox('hello', 20));
    expect(result.length).toBe(20);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('hello');
  });

  it('renders left and right content with gap', () => {
    const result = stripAnsi(drawInputBox('left', 30, 'right'));
    expect(result.length).toBe(30);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    const inner = innerContent(drawInputBox('left', 30, 'right'));
    expect(inner.startsWith('left')).toBe(true);
    expect(inner.endsWith('right')).toBe(true);
  });

  it('truncates right content when no room', () => {
    const result = stripAnsi(drawInputBox('lefttext', 10, 'rightttx'));
    expect(result.length).toBe(10);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(innerContent(drawInputBox('lefttext', 10, 'rightttx')).startsWith('lefttext')).toBe(true);
  });

  it('handles empty right gracefully', () => {
    const result = stripAnsi(drawInputBox('status', 40, ''));
    expect(result.length).toBe(40);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('status');
  });

  it('pads to visible width when left content contains ANSI sequences', () => {
    const styled = '\u001b[31mhello\u001b[39m';
    const result = stripAnsi(drawInputBox(styled, 20));
    expect(result.length).toBe(20);
    expect(result[0]).toBe('│');
    expect(result).toContain('hello');
  });

  it('calculates right clipping using visible width when ANSI is present', () => {
    const left = '\u001b[36mleft\u001b[39m';
    const right = '\u001b[33mright-content\u001b[39m';
    const result = stripAnsi(drawInputBox(left, 16, right));
    expect(result.length).toBe(16);
    expect(result[0]).toBe('│');
    expect(result[result.length - 1]).toBe('│');
    expect(result).toContain('left');
  });

  // --- Background fill tests ---

  it('includes background ANSI code in output', () => {
    const result = drawInputBox('hello', 20);
    expect(result).toMatch(BG_PATTERN);
  });

  it('ends with RESET + CLEAR_TO_EOL so bg stops at the right border', () => {
    const result = drawInputBox('test', 20);
    // RESET clears attributes, then CLEAR_TO_EOL fills rest of line with default bg
    expect(result.endsWith(RESET + CLEAR_EOL)).toBe(true);
  });

  it('re-applies background after inner full-reset ANSI code', () => {
    const styledContent = `\x1b[90mhello${RESET} world`;
    const result = drawInputBox(styledContent, 30);

    const reApplyPattern = /\x1b\[0m\x1b\[48;2;\d+;\d+;\d+m/;
    expect(result).toMatch(reApplyPattern);

    expect(stripAnsi(result).length).toBe(30);
    expect(stripAnsi(result)).toContain('hello');
    expect(stripAnsi(result)).toContain('world');
  });

  it('replaces inner bg-close codes to preserve background', () => {
    const bgClose = '\x1b[49m';
    const styledContent = `styled${bgClose}text`;
    const result = drawInputBox(styledContent, 20);

    expect(stripAnsi(result)).toContain('styledtext');
    expect(stripAnsi(result).length).toBe(20);
  });

  it('replaces inner fg-close codes with box foreground', () => {
    const styledContent = '\x1b[31mred text\x1b[39m normal';
    const result = drawInputBox(styledContent, 30);

    expect(result).toMatch(FG_PATTERN);
    expect(stripAnsi(result).length).toBe(30);
  });

  it('ends with RESET + CLEAR_TO_EOL when right param is provided', () => {
    const result = drawInputBox('left', 30, 'right');
    expect(result).toMatch(BG_PATTERN);
    expect(result.endsWith(RESET + CLEAR_EOL)).toBe(true);
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

  it('ends with RESET + CLEAR_TO_EOL to prevent bg bleed', () => {
    const rendered = drawInputTopBorder(20);
    expect(rendered).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
    expect(rendered.endsWith(RESET + CLEAR_EOL)).toBe(true);
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

  it('ends with RESET + CLEAR_TO_EOL to prevent bg bleed', () => {
    const rendered = drawInputBottomBorder(20);
    expect(rendered).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
    expect(rendered.endsWith(RESET + CLEAR_EOL)).toBe(true);
  });
});

describe('theme-aware rendering', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses theme colors for box background when theme is initialized', async () => {
    const { setTheme, Theme } = await import('../../src/ui/theme/index.js');
    const customColors: Record<string, string> = {
      userMessageBg: '#112233',
      userMessageText: '#aabbcc',
      borderAccent: '#ff0000',
      warning: '#ffaa00',
      dim: '#cccccc',
    };
    setTheme(new Theme('test', customColors as never));

    const { drawInputBox: themedBox } = await import('../../src/ui/box.js');
    const result = themedBox('hello', 20);

    expect(result).toContain('\x1b[48;2;17;34;51m');
  });

  it('uses theme colors for border foreground when theme is initialized', async () => {
    const { setTheme, Theme } = await import('../../src/ui/theme/index.js');
    const customColors: Record<string, string> = {
      userMessageBg: '#112233',
      userMessageText: '#aabbcc',
      borderAccent: '#ff0000',
      warning: '#ffaa00',
      dim: '#cccccc',
    };
    setTheme(new Theme('test', customColors as never));

    const { drawInputTopBorder: themedBorder } = await import('../../src/ui/box.js');
    const result = themedBorder(20);

    expect(result).toContain('\x1b[38;2;255;0;0m');
  });
});
