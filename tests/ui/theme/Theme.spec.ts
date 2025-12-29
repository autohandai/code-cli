/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Theme,
  getTheme,
  setTheme,
  isThemeInitialized,
  detectColorMode,
  hexToRgb,
  rgbTo256,
  rgbTo16,
  index256To16,
} from '../../../src/ui/theme/Theme.js';
import type { ResolvedColors, ColorMode } from '../../../src/ui/theme/types.js';
import { COLOR_TOKENS } from '../../../src/ui/theme/types.js';

// Helper to create a complete ResolvedColors object
function createMockColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const base: ResolvedColors = {} as ResolvedColors;
  for (const token of COLOR_TOKENS) {
    base[token] = '#ffffff';
  }
  return { ...base, ...overrides };
}

describe('Theme', () => {
  describe('constructor', () => {
    it('creates Theme instance with valid colors', () => {
      const colors = createMockColors();
      const theme = new Theme('test', colors);

      expect(theme.name).toBe('test');
      expect(theme.colors).toEqual(colors);
    });

    it('accepts custom color mode', () => {
      const colors = createMockColors();
      const theme = new Theme('test', colors, 'truecolor');

      expect(theme.getColorMode()).toBe('truecolor');
    });

    it('auto-detects color mode when not provided', () => {
      const colors = createMockColors();
      const theme = new Theme('test', colors);

      expect(['truecolor', '256', '16', 'none']).toContain(theme.getColorMode());
    });
  });

  describe('fg()', () => {
    it('applies foreground color with truecolor mode', () => {
      const colors = createMockColors({ accent: '#ff0000' });
      const theme = new Theme('test', colors, 'truecolor');

      const result = theme.fg('accent', 'hello');

      expect(result).toContain('\x1b[38;2;255;0;0m');
      expect(result).toContain('hello');
      expect(result).toContain('\x1b[39m');
    });

    it('applies foreground color with 256 mode', () => {
      const colors = createMockColors({ accent: '#ff0000' });
      const theme = new Theme('test', colors, '256');

      const result = theme.fg('accent', 'hello');

      expect(result).toMatch(/\x1b\[38;5;\d+m/);
      expect(result).toContain('hello');
    });

    it('returns plain text when color mode is none', () => {
      const colors = createMockColors({ accent: '#ff0000' });
      const theme = new Theme('test', colors, 'none');

      const result = theme.fg('accent', 'hello');

      expect(result).toBe('hello');
    });

    it('returns plain text for empty color value', () => {
      const colors = createMockColors({ accent: '' });
      const theme = new Theme('test', colors, 'truecolor');

      const result = theme.fg('accent', 'hello');

      expect(result).toBe('hello');
    });

    it('handles 256-color index values', () => {
      const colors = createMockColors({ accent: '196' }); // Red in 256-color
      const theme = new Theme('test', colors, '256');

      const result = theme.fg('accent', 'hello');

      expect(result).toContain('\x1b[38;5;196m');
    });
  });

  describe('bg()', () => {
    it('applies background color with truecolor mode', () => {
      const colors = createMockColors({ userMessageBg: '#0000ff' });
      const theme = new Theme('test', colors, 'truecolor');

      const result = theme.bg('userMessageBg', 'hello');

      expect(result).toContain('\x1b[48;2;0;0;255m');
      expect(result).toContain('hello');
      expect(result).toContain('\x1b[49m');
    });

    it('applies background color with 256 mode', () => {
      const colors = createMockColors({ userMessageBg: '#0000ff' });
      const theme = new Theme('test', colors, '256');

      const result = theme.bg('userMessageBg', 'hello');

      expect(result).toMatch(/\x1b\[48;5;\d+m/);
    });

    it('returns plain text when color mode is none', () => {
      const colors = createMockColors({ userMessageBg: '#0000ff' });
      const theme = new Theme('test', colors, 'none');

      const result = theme.bg('userMessageBg', 'hello');

      expect(result).toBe('hello');
    });
  });

  describe('fgBg()', () => {
    it('applies both foreground and background colors', () => {
      const colors = createMockColors({
        text: '#ffffff',
        userMessageBg: '#000000',
      });
      const theme = new Theme('test', colors, 'truecolor');

      const result = theme.fgBg('text', 'userMessageBg', 'hello');

      expect(result).toContain('\x1b[38;2;255;255;255m');
      expect(result).toContain('\x1b[48;2;0;0;0m');
      expect(result).toContain('hello');
      expect(result).toContain('\x1b[0m');
    });
  });

  describe('text style methods', () => {
    let theme: Theme;

    beforeEach(() => {
      const colors = createMockColors();
      theme = new Theme('test', colors, 'truecolor');
    });

    it('bold() applies bold style', () => {
      const result = theme.bold('hello');
      expect(result).toBe('\x1b[1mhello\x1b[22m');
    });

    it('italic() applies italic style', () => {
      const result = theme.italic('hello');
      expect(result).toBe('\x1b[3mhello\x1b[23m');
    });

    it('underline() applies underline style', () => {
      const result = theme.underline('hello');
      expect(result).toBe('\x1b[4mhello\x1b[24m');
    });

    it('dimStyle() applies dim style', () => {
      const result = theme.dimStyle('hello');
      expect(result).toBe('\x1b[2mhello\x1b[22m');
    });

    it('strikethrough() applies strikethrough style', () => {
      const result = theme.strikethrough('hello');
      expect(result).toBe('\x1b[9mhello\x1b[29m');
    });

    it('reset() resets all styles', () => {
      const result = theme.reset('hello');
      expect(result).toBe('\x1b[0mhello\x1b[0m');
    });
  });

  describe('getColor()', () => {
    it('returns raw color value for token', () => {
      const colors = createMockColors({ accent: '#ff0000' });
      const theme = new Theme('test', colors, 'truecolor');

      expect(theme.getColor('accent')).toBe('#ff0000');
    });

    it('returns empty string for missing token', () => {
      const colors = createMockColors();
      colors.accent = '';
      const theme = new Theme('test', colors, 'truecolor');

      expect(theme.getColor('accent')).toBe('');
    });
  });

  describe('color caching', () => {
    it('caches ANSI codes for performance', () => {
      const colors = createMockColors({ accent: '#ff0000' });
      const theme = new Theme('test', colors, 'truecolor');

      const result1 = theme.fg('accent', 'hello');
      const result2 = theme.fg('accent', 'world');

      // Both should use same ANSI prefix
      const prefix1 = result1.slice(0, result1.indexOf('hello'));
      const prefix2 = result2.slice(0, result2.indexOf('world'));
      expect(prefix1).toBe(prefix2);
    });
  });
});

describe('detectColorMode()', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns none when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1';
    expect(detectColorMode()).toBe('none');
  });

  it('returns truecolor when COLORTERM is truecolor', () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = 'truecolor';
    expect(detectColorMode()).toBe('truecolor');
  });

  it('returns truecolor when COLORTERM is 24bit', () => {
    delete process.env.NO_COLOR;
    process.env.COLORTERM = '24bit';
    expect(detectColorMode()).toBe('truecolor');
  });

  it('returns 256 when TERM contains 256color', () => {
    delete process.env.NO_COLOR;
    delete process.env.COLORTERM;
    process.env.TERM = 'xterm-256color';
    expect(detectColorMode()).toBe('256');
  });

  it('respects FORCE_COLOR=0', () => {
    process.env.FORCE_COLOR = '0';
    expect(detectColorMode()).toBe('none');
  });

  it('respects FORCE_COLOR=3 for truecolor', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '3';
    expect(detectColorMode()).toBe('truecolor');
  });
});

describe('hexToRgb()', () => {
  it('parses 6-digit hex color', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('parses 3-digit hex color (shorthand)', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#0f0')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#00f')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('handles hex without # prefix', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('invalid')).toBeNull();
    expect(hexToRgb('#gg0000')).toBeNull();
    expect(hexToRgb('#ff00')).toBeNull();
  });

  it('handles case insensitivity', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#aAbBcC')).toEqual({ r: 170, g: 187, b: 204 });
  });
});

describe('rgbTo256()', () => {
  it('converts pure colors to 256-color index', () => {
    expect(rgbTo256(255, 0, 0)).toBe(196); // Red
    expect(rgbTo256(0, 255, 0)).toBe(46); // Green
    expect(rgbTo256(0, 0, 255)).toBe(21); // Blue
  });

  it('converts grayscale colors', () => {
    expect(rgbTo256(0, 0, 0)).toBe(16); // Black
    expect(rgbTo256(255, 255, 255)).toBe(231); // White
    expect(rgbTo256(128, 128, 128)).toBe(244); // Mid gray
  });

  it('converts mixed colors', () => {
    const result = rgbTo256(128, 64, 192);
    expect(result).toBeGreaterThanOrEqual(16);
    expect(result).toBeLessThanOrEqual(231);
  });
});

describe('rgbTo16()', () => {
  it('converts to basic 16 colors', () => {
    expect(rgbTo16(0, 0, 0)).toBe(0); // Black
    expect(rgbTo16(255, 0, 0)).toBe(1); // Red (not bright because avg brightness < 128)
    expect(rgbTo16(255, 255, 255)).toBe(15); // Bright white
  });

  it('handles mid-range colors', () => {
    const result = rgbTo16(128, 128, 128);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(15);
  });
});

describe('index256To16()', () => {
  it('passes through basic 16 colors', () => {
    for (let i = 0; i < 16; i++) {
      expect(index256To16(i)).toBe(i);
    }
  });

  it('converts 256-color cube to 16 colors', () => {
    expect(index256To16(196)).toBeGreaterThanOrEqual(0); // Red from cube
    expect(index256To16(196)).toBeLessThanOrEqual(15);
  });

  it('converts grayscale to black or white', () => {
    expect(index256To16(232)).toBe(0); // Darkest gray -> black
    expect(index256To16(255)).toBe(15); // Lightest gray -> white
  });
});

describe('global theme management', () => {
  beforeEach(() => {
    // Reset global theme state
    setTheme(null as unknown as Theme);
  });

  afterEach(() => {
    setTheme(null as unknown as Theme);
  });

  it('isThemeInitialized() returns false when no theme set', () => {
    expect(isThemeInitialized()).toBe(false);
  });

  it('isThemeInitialized() returns true after setTheme()', () => {
    const colors = createMockColors();
    const theme = new Theme('test', colors);
    setTheme(theme);

    expect(isThemeInitialized()).toBe(true);
  });

  it('getTheme() throws when theme not initialized', () => {
    expect(() => getTheme()).toThrow('Theme not initialized');
  });

  it('getTheme() returns theme after initialization', () => {
    const colors = createMockColors();
    const theme = new Theme('test', colors);
    setTheme(theme);

    expect(getTheme()).toBe(theme);
  });
});
