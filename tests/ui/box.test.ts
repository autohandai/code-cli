/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { drawInputBottomBorder, drawInputBox, drawInputTopBorder } from '../../src/ui/box.js';
import { Theme, setTheme } from '../../src/ui/theme/Theme.js';
import type { ResolvedColors } from '../../src/ui/theme/types.js';
import { COLOR_TOKENS } from '../../src/ui/theme/types.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function createMockColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const base: ResolvedColors = {} as ResolvedColors;
  for (const token of COLOR_TOKENS) {
    base[token] = '#ffffff';
  }
  return { ...base, ...overrides };
}

describe('drawInputBox', () => {
  it('renders a framed status line with exact visible width', () => {
    const rendered = drawInputBox('> Plan, search, build anything', 30);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(30);
    expect(plain.startsWith('│')).toBe(true);
    expect(plain.endsWith('│')).toBe(true);
  });

  it('truncates content to fit the available inner width', () => {
    const rendered = drawInputBox('x'.repeat(100), 20);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(20);
  });

  it('preserves frame width with ANSI-styled content', () => {
    const rendered = drawInputBox('\u001b[90m> Plan, search, build anything\u001b[39m', 30);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(30);
    expect(plain.startsWith('│')).toBe(true);
    expect(plain.endsWith('│')).toBe(true);
  });

  it('keeps right border visible when truncating ANSI-styled content', () => {
    const rendered = drawInputBox(`\u001b[90m${'x'.repeat(120)}\u001b[39m`, 24);
    const plain = stripAnsi(rendered);

    expect(plain.length).toBe(24);
    expect(plain[0]).toBe('│');
    expect(plain[23]).toBe('│');
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

describe('themed box rendering', () => {
  beforeEach(() => {
    setTheme(null as unknown as Theme);
  });

  afterEach(() => {
    setTheme(null as unknown as Theme);
  });

  it('uses borderAccent for top/bottom borders when theme is initialized', () => {
    const theme = new Theme('test', createMockColors({ borderAccent: '#112233' }), 'truecolor');
    setTheme(theme);

    const top = drawInputTopBorder(12);
    const bottom = drawInputBottomBorder(12);

    expect(top).toContain('\x1b[38;2;17;34;51m');
    expect(bottom).toContain('\x1b[38;2;17;34;51m');
  });

  it('uses border token for the vertical frame in the input row', () => {
    const theme = new Theme('test', createMockColors({ border: '#445566' }), 'truecolor');
    setTheme(theme);

    const row = drawInputBox('hello', 20);
    const colorCodeCount = (row.match(/\x1b\[38;2;68;85;102m/g) ?? []).length;

    expect(colorCodeCount).toBeGreaterThanOrEqual(2);
  });
});
