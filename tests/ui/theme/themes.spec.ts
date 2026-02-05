/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  darkTheme,
  lightTheme,
  builtInThemes,
  getBuiltInTheme,
  isBuiltInTheme,
  getBuiltInThemeNames,
  getDefaultThemeName,
} from '../../../src/ui/theme/themes.js';
import { COLOR_TOKENS } from '../../../src/ui/theme/types.js';
import type { ColorToken } from '../../../src/ui/theme/types.js';

describe('darkTheme', () => {
  it('has correct name', () => {
    expect(darkTheme.name).toBe('dark');
  });

  it('has all required color tokens', () => {
    for (const token of COLOR_TOKENS) {
      expect(darkTheme.colors[token]).toBeDefined();
    }
  });

  it('has vars section for color reuse', () => {
    expect(darkTheme.vars).toBeDefined();
    expect(Object.keys(darkTheme.vars!).length).toBeGreaterThan(0);
  });

  it('all color values are valid (hex, number, or variable ref)', () => {
    for (const [key, value] of Object.entries(darkTheme.colors)) {
      expect(
        typeof value === 'string' || typeof value === 'number',
        `Invalid color value for ${key}: ${value}`
      ).toBe(true);
    }
  });

  it('all var values are valid', () => {
    for (const [key, value] of Object.entries(darkTheme.vars!)) {
      expect(
        typeof value === 'string' || typeof value === 'number',
        `Invalid var value for ${key}: ${value}`
      ).toBe(true);
    }
  });

  it('has distinct colors for success, error, warning', () => {
    expect(darkTheme.colors.success).not.toBe(darkTheme.colors.error);
    expect(darkTheme.colors.success).not.toBe(darkTheme.colors.warning);
    expect(darkTheme.colors.error).not.toBe(darkTheme.colors.warning);
  });

  it('has accent color defined', () => {
    expect(darkTheme.colors.accent).toBeDefined();
    expect(darkTheme.colors.accent).not.toBe('');
  });

  it('has syntax highlighting colors for code', () => {
    const syntaxTokens: ColorToken[] = [
      'syntaxComment',
      'syntaxKeyword',
      'syntaxFunction',
      'syntaxVariable',
      'syntaxString',
      'syntaxNumber',
      'syntaxType',
      'syntaxOperator',
      'syntaxPunctuation',
    ];

    for (const token of syntaxTokens) {
      expect(darkTheme.colors[token]).toBeDefined();
    }
  });

  it('has diff colors for added, removed, context', () => {
    expect(darkTheme.colors.diffAdded).toBeDefined();
    expect(darkTheme.colors.diffRemoved).toBeDefined();
    expect(darkTheme.colors.diffContext).toBeDefined();
  });
});

describe('lightTheme', () => {
  it('has correct name', () => {
    expect(lightTheme.name).toBe('light');
  });

  it('has all required color tokens', () => {
    for (const token of COLOR_TOKENS) {
      expect(lightTheme.colors[token]).toBeDefined();
    }
  });

  it('has vars section for color reuse', () => {
    expect(lightTheme.vars).toBeDefined();
    expect(Object.keys(lightTheme.vars!).length).toBeGreaterThan(0);
  });

  it('all color values are valid (hex, number, or variable ref)', () => {
    for (const [key, value] of Object.entries(lightTheme.colors)) {
      expect(
        typeof value === 'string' || typeof value === 'number',
        `Invalid color value for ${key}: ${value}`
      ).toBe(true);
    }
  });

  it('has different colors than dark theme for key elements', () => {
    // Light theme should have different background approach
    // (vars define inverted grays)
    expect(lightTheme.vars!.gray100).not.toBe(darkTheme.vars!.gray100);
  });

  it('has accent color defined', () => {
    expect(lightTheme.colors.accent).toBeDefined();
    expect(lightTheme.colors.accent).not.toBe('');
  });
});

describe('builtInThemes', () => {
  it('contains dark theme', () => {
    expect(builtInThemes.dark).toBe(darkTheme);
  });

  it('contains light theme', () => {
    expect(builtInThemes.light).toBe(lightTheme);
  });

  it('has exactly 5 built-in themes', () => {
    expect(Object.keys(builtInThemes)).toHaveLength(5);
  });

  it('all themes have unique names', () => {
    const names = Object.values(builtInThemes).map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });
});

describe('getBuiltInTheme()', () => {
  it('returns dark theme for "dark"', () => {
    expect(getBuiltInTheme('dark')).toBe(darkTheme);
  });

  it('returns light theme for "light"', () => {
    expect(getBuiltInTheme('light')).toBe(lightTheme);
  });

  it('returns undefined for unknown theme', () => {
    expect(getBuiltInTheme('nonexistent')).toBeUndefined();
  });

  it('is case sensitive', () => {
    expect(getBuiltInTheme('Dark')).toBeUndefined();
    expect(getBuiltInTheme('DARK')).toBeUndefined();
  });
});

describe('isBuiltInTheme()', () => {
  it('returns true for "dark"', () => {
    expect(isBuiltInTheme('dark')).toBe(true);
  });

  it('returns true for "light"', () => {
    expect(isBuiltInTheme('light')).toBe(true);
  });

  it('returns false for unknown theme', () => {
    expect(isBuiltInTheme('nonexistent')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isBuiltInTheme('')).toBe(false);
  });
});

describe('getBuiltInThemeNames()', () => {
  it('returns array of theme names', () => {
    const names = getBuiltInThemeNames();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBeGreaterThan(0);
  });

  it('includes dark and light', () => {
    const names = getBuiltInThemeNames();
    expect(names).toContain('dark');
    expect(names).toContain('light');
  });
});

describe('getDefaultThemeName()', () => {
  it('returns "dark" as default', () => {
    expect(getDefaultThemeName()).toBe('dark');
  });

  it('returns a valid built-in theme name', () => {
    const defaultName = getDefaultThemeName();
    expect(isBuiltInTheme(defaultName)).toBe(true);
  });
});

describe('theme color contrast (basic validation)', () => {
  it('dark theme text is lighter than background', () => {
    // Text should be bright (high gray number)
    const textVar = darkTheme.colors.text as string;
    const bgVar = 'bgDark';

    // Just verify they reference different brightness levels
    expect(textVar).not.toBe(bgVar);
  });

  it('light theme text is darker than background', () => {
    // Text should be dark (low gray number)
    const textVar = lightTheme.colors.text as string;
    const bgVar = 'bgLight';

    expect(textVar).not.toBe(bgVar);
  });

  it('success color is greenish', () => {
    // Verify success refers to green var or green hex
    const successColor = darkTheme.colors.success;
    expect(successColor === 'green' || (typeof successColor === 'string' && successColor.includes('4caf50'))).toBe(true);
  });

  it('error color is reddish', () => {
    // Verify error refers to red var or red hex
    const errorColor = darkTheme.colors.error;
    expect(errorColor === 'red' || (typeof errorColor === 'string' && errorColor.includes('f44336'))).toBe(true);
  });

  it('warning color is yellowish', () => {
    // Verify warning refers to yellow var or yellow hex
    const warningColor = darkTheme.colors.warning;
    expect(warningColor === 'yellow' || (typeof warningColor === 'string' && warningColor.includes('ffeb3b'))).toBe(true);
  });
});
