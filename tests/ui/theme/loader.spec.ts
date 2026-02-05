/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadTheme,
  initTheme,
  getThemeDefinition,
  loadCustomTheme,
  validateAndMergeTheme,
  resolveThemeColors,
  resolveColorValue,
  listAvailableThemes,
  themeExists,
  detectTerminalBackground,
  ThemeLoadError,
} from '../../../src/ui/theme/loader.js';
import { setTheme, isThemeInitialized, getTheme } from '../../../src/ui/theme/Theme.js';
import { COLOR_TOKENS } from '../../../src/ui/theme/types.js';

// Use a temp directory for custom themes in tests
const TEST_THEMES_DIR = join(tmpdir(), 'autohand-test-themes');

describe('loadTheme()', () => {
  it('loads built-in dark theme', () => {
    const theme = loadTheme('dark');

    expect(theme.name).toBe('dark');
    expect(theme.colors.accent).toBeDefined();
  });

  it('loads built-in light theme', () => {
    const theme = loadTheme('light');

    expect(theme.name).toBe('light');
    expect(theme.colors.accent).toBeDefined();
  });

  it('throws ThemeLoadError for unknown theme', () => {
    expect(() => loadTheme('nonexistent')).toThrow(ThemeLoadError);
  });

  it('returns Theme instance with resolved colors', () => {
    const theme = loadTheme('dark');

    // All colors should be resolved (no variable references)
    for (const token of COLOR_TOKENS) {
      const color = theme.colors[token];
      expect(typeof color).toBe('string');
      // Should be hex color or empty string
      expect(color === '' || color.startsWith('#') || /^\d+$/.test(color)).toBe(true);
    }
  });
});

describe('initTheme()', () => {
  beforeEach(() => {
    setTheme(null as any);
  });

  afterEach(() => {
    setTheme(null as any);
  });

  it('initializes global theme with dark theme', () => {
    const theme = initTheme('dark');

    expect(isThemeInitialized()).toBe(true);
    expect(getTheme()).toBe(theme);
    expect(theme.name).toBe('dark');
  });

  it('initializes default theme when no name provided', () => {
    const theme = initTheme();

    expect(isThemeInitialized()).toBe(true);
    expect(theme.name).toBe('dark'); // Default is dark
  });

  it('falls back to dark theme on error', () => {
    // Mock console.warn to suppress warning message
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const theme = initTheme('nonexistent');

    expect(theme.name).toBe('dark');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('getThemeDefinition()', () => {
  it('returns dark theme definition', () => {
    const def = getThemeDefinition('dark');

    expect(def.name).toBe('dark');
    expect(def.vars).toBeDefined();
    expect(def.colors).toBeDefined();
  });

  it('returns light theme definition', () => {
    const def = getThemeDefinition('light');

    expect(def.name).toBe('light');
  });

  it('throws for unknown theme', () => {
    expect(() => getThemeDefinition('nonexistent')).toThrow(ThemeLoadError);
  });
});

describe('validateAndMergeTheme()', () => {
  it('uses provided name', () => {
    const result = validateAndMergeTheme({ colors: {} }, 'custom');

    expect(result.name).toBe('custom');
  });

  it('uses name from partial if provided', () => {
    const result = validateAndMergeTheme({ name: 'my-theme', colors: {} }, 'fallback');

    expect(result.name).toBe('my-theme');
  });

  it('merges with dark theme defaults', () => {
    const result = validateAndMergeTheme({ colors: { accent: '#ff0000' } }, 'test');

    expect(result.colors.accent).toBe('#ff0000');
    // Other colors should come from dark theme
    expect(result.colors.success).toBeDefined();
  });

  it('merges vars with dark theme vars', () => {
    const result = validateAndMergeTheme({ vars: { custom: '#123456' }, colors: {} }, 'test');

    expect(result.vars!.custom).toBe('#123456');
    // Should also have dark theme vars
    expect(result.vars!.cyan).toBeDefined();
  });

  it('throws on invalid color value', () => {
    expect(() =>
      validateAndMergeTheme({ colors: { accent: {} as any } }, 'test')
    ).toThrow(ThemeLoadError);
  });

  it('throws on invalid var value', () => {
    expect(() =>
      validateAndMergeTheme({ vars: { bad: {} as any }, colors: {} }, 'test')
    ).toThrow(ThemeLoadError);
  });

  it('ignores unknown color tokens', () => {
    // Should not throw for unknown tokens
    const result = validateAndMergeTheme(
      { colors: { unknownToken: '#ff0000' } as any },
      'test'
    );

    expect(result.colors.accent).toBeDefined();
  });
});

describe('resolveThemeColors()', () => {
  it('resolves all color tokens', () => {
    const resolved = resolveThemeColors({
      name: 'test',
      vars: { myColor: '#ff0000' },
      colors: {
        accent: 'myColor',
        border: '#00ff00',
        borderAccent: 'myColor',
        borderMuted: '#333333',
        success: '#4caf50',
        error: '#f44336',
        warning: '#ffeb3b',
        muted: '#9e9e9e',
        dim: '#616161',
        text: '#ffffff',
        userMessageBg: '#2b2b2b',
        userMessageText: '#ffffff',
        toolPendingBg: '#3a3a3a',
        toolSuccessBg: '#1b3d1b',
        toolErrorBg: '#3d1b1b',
        toolTitle: '#00bcd4',
        toolOutput: '#bdbdbd',
        diffAdded: '#4caf50',
        diffRemoved: '#f44336',
        diffContext: '#9e9e9e',
        syntaxComment: '#757575',
        syntaxKeyword: '#e91e63',
        syntaxFunction: '#2196f3',
        syntaxVariable: '#00bcd4',
        syntaxString: '#4caf50',
        syntaxNumber: '#ffeb3b',
        syntaxType: '#00bcd4',
        syntaxOperator: '#e0e0e0',
        syntaxPunctuation: '#bdbdbd',
        mdHeading: '#00bcd4',
        mdLink: '#2196f3',
        mdLinkUrl: '#9e9e9e',
        mdCode: '#ff9800',
        mdCodeBlock: '#e0e0e0',
        mdCodeBlockBorder: '#616161',
        mdQuote: '#bdbdbd',
        mdQuoteBorder: '#757575',
        mdHr: '#616161',
        mdListBullet: '#00bcd4',
      },
    });

    expect(resolved.accent).toBe('#ff0000'); // Resolved from var
    expect(resolved.border).toBe('#00ff00'); // Direct hex
    expect(resolved.borderAccent).toBe('#ff0000'); // Resolved from var
  });

  it('throws on missing required token', () => {
    expect(() =>
      resolveThemeColors({
        name: 'test',
        colors: { accent: '#ff0000' } as any, // Missing other required tokens
      })
    ).toThrow(ThemeLoadError);
  });
});

describe('resolveColorValue()', () => {
  it('returns empty string for empty value', () => {
    expect(resolveColorValue('', {}, 'test', new Set())).toBe('');
  });

  it('returns stringified number for 256-color index', () => {
    expect(resolveColorValue(196, {}, 'test', new Set())).toBe('196');
  });

  it('returns hex color directly', () => {
    expect(resolveColorValue('#ff0000', {}, 'test', new Set())).toBe('#ff0000');
  });

  it('resolves variable reference', () => {
    const vars = { myRed: '#ff0000' };
    expect(resolveColorValue('myRed', vars, 'test', new Set())).toBe('#ff0000');
  });

  it('resolves nested variable references', () => {
    const vars = {
      primary: 'secondary',
      secondary: '#ff0000',
    };
    expect(resolveColorValue('primary', vars, 'test', new Set())).toBe('#ff0000');
  });

  it('throws on circular variable reference', () => {
    const vars = {
      a: 'b',
      b: 'a',
    };
    expect(() => resolveColorValue('a', vars, 'test', new Set())).toThrow('Circular');
  });

  it('throws on unknown variable', () => {
    expect(() => resolveColorValue('unknown', {}, 'test', new Set())).toThrow('Unknown variable');
  });

  it('throws on invalid 256-color index', () => {
    expect(() => resolveColorValue(256, {}, 'test', new Set())).toThrow('Invalid 256-color');
    expect(() => resolveColorValue(-1, {}, 'test', new Set())).toThrow('Invalid 256-color');
  });
});

describe('listAvailableThemes()', () => {
  it('includes built-in themes', () => {
    const themes = listAvailableThemes();

    expect(themes).toContain('dark');
    expect(themes).toContain('light');
  });

  it('returns sorted array', () => {
    const themes = listAvailableThemes();
    const sorted = [...themes].sort();

    expect(themes).toEqual(sorted);
  });
});

describe('themeExists()', () => {
  it('returns true for dark theme', () => {
    expect(themeExists('dark')).toBe(true);
  });

  it('returns true for light theme', () => {
    expect(themeExists('light')).toBe(true);
  });

  it('returns false for unknown theme', () => {
    expect(themeExists('nonexistent-theme-xyz')).toBe(false);
  });
});

describe('detectTerminalBackground()', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns "dark" by default', () => {
    delete process.env.COLORFGBG;
    delete process.env.TERMINAL_EMULATOR;

    expect(detectTerminalBackground()).toBe('dark');
  });

  it('detects light background from COLORFGBG', () => {
    process.env.COLORFGBG = '0;15';

    expect(detectTerminalBackground()).toBe('light');
  });

  it('detects dark background from COLORFGBG', () => {
    process.env.COLORFGBG = '15;0';

    expect(detectTerminalBackground()).toBe('dark');
  });
});

describe('ThemeLoadError', () => {
  it('has correct name property', () => {
    const error = new ThemeLoadError('test message', 'my-theme');

    expect(error.name).toBe('ThemeLoadError');
  });

  it('includes theme name', () => {
    const error = new ThemeLoadError('test message', 'my-theme');

    expect(error.themeName).toBe('my-theme');
  });

  it('includes cause if provided', () => {
    const cause = new Error('original');
    const error = new ThemeLoadError('test message', 'my-theme', cause);

    expect(error.cause).toBe(cause);
  });

  it('extends Error', () => {
    const error = new ThemeLoadError('test', 'test');

    expect(error instanceof Error).toBe(true);
  });
});

describe('custom theme loading', () => {
  const customThemePath = join(TEST_THEMES_DIR, 'custom-test.json');

  beforeEach(() => {
    mkdirSync(TEST_THEMES_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_THEMES_DIR)) {
      rmSync(TEST_THEMES_DIR, { recursive: true, force: true });
    }
  });

  it('loads valid custom theme file', () => {
    const customTheme = {
      name: 'custom-test',
      colors: {
        accent: '#ff00ff',
      },
    };
    writeFileSync(customThemePath, JSON.stringify(customTheme));

    const result = loadCustomTheme(customThemePath, 'custom-test');

    expect(result.name).toBe('custom-test');
    expect(result.colors.accent).toBe('#ff00ff');
  });

  it('throws on invalid JSON', () => {
    writeFileSync(customThemePath, 'not valid json');

    expect(() => loadCustomTheme(customThemePath, 'custom-test')).toThrow('Invalid JSON');
  });

  it('merges custom theme with defaults', () => {
    const customTheme = {
      name: 'custom-test',
      colors: {
        accent: '#ff00ff',
      },
    };
    writeFileSync(customThemePath, JSON.stringify(customTheme));

    const result = loadCustomTheme(customThemePath, 'custom-test');

    // Should have custom accent
    expect(result.colors.accent).toBe('#ff00ff');
    // Should have defaults for other colors
    expect(result.colors.success).toBeDefined();
  });

  it('handles custom vars in theme file', () => {
    const customTheme = {
      name: 'custom-test',
      vars: {
        myPurple: '#800080',
      },
      colors: {
        accent: 'myPurple',
      },
    };
    writeFileSync(customThemePath, JSON.stringify(customTheme));

    const result = loadCustomTheme(customThemePath, 'custom-test');

    expect(result.vars!.myPurple).toBe('#800080');
    expect(result.colors.accent).toBe('myPurple');
  });
});
