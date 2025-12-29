/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ThemeDefinition, ThemeColors, ColorValue, ResolvedColors, ColorToken } from './types.js';
import { COLOR_TOKENS, isHexColor, is256ColorIndex } from './types.js';
import { Theme, setTheme, detectColorMode } from './Theme.js';
import { builtInThemes, darkTheme, getDefaultThemeName } from './themes.js';

/**
 * Custom themes directory.
 */
export const CUSTOM_THEMES_DIR = join(homedir(), '.autohand', 'themes');

/**
 * Errors that can occur during theme loading.
 */
export class ThemeLoadError extends Error {
  constructor(
    message: string,
    public readonly themeName: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ThemeLoadError';
  }
}

/**
 * Load and initialize a theme by name.
 * Searches built-in themes first, then custom themes directory.
 */
export function loadTheme(themeName: string): Theme {
  const definition = getThemeDefinition(themeName);
  const resolvedColors = resolveThemeColors(definition);
  return new Theme(definition.name, resolvedColors, detectColorMode());
}

/**
 * Initialize the global theme from config.
 * Falls back to dark theme if specified theme is not found.
 */
export function initTheme(themeName?: string): Theme {
  const name = themeName || getDefaultThemeName();

  try {
    const theme = loadTheme(name);
    setTheme(theme);
    return theme;
  } catch (error) {
    // Fall back to dark theme on error
    console.warn(`Failed to load theme "${name}", falling back to dark theme:`, error instanceof Error ? error.message : error);
    const theme = loadTheme('dark');
    setTheme(theme);
    return theme;
  }
}

/**
 * Get theme definition by name.
 * Checks built-in themes first, then custom themes.
 */
export function getThemeDefinition(themeName: string): ThemeDefinition {
  // Check built-in themes
  if (themeName in builtInThemes) {
    return builtInThemes[themeName];
  }

  // Check custom themes
  const customThemePath = join(CUSTOM_THEMES_DIR, `${themeName}.json`);
  if (existsSync(customThemePath)) {
    return loadCustomTheme(customThemePath, themeName);
  }

  throw new ThemeLoadError(`Theme "${themeName}" not found`, themeName);
}

/**
 * Load a custom theme from a JSON file.
 */
export function loadCustomTheme(filePath: string, themeName: string): ThemeDefinition {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Partial<ThemeDefinition>;

    // Validate and merge with defaults
    return validateAndMergeTheme(parsed, themeName);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ThemeLoadError(`Invalid JSON in theme file: ${filePath}`, themeName, error);
    }
    if (error instanceof ThemeLoadError) {
      throw error;
    }
    throw new ThemeLoadError(
      `Failed to load theme file: ${filePath}`,
      themeName,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * Validate a custom theme and merge with default theme.
 */
export function validateAndMergeTheme(partial: Partial<ThemeDefinition>, themeName: string): ThemeDefinition {
  // Ensure name is set
  const name = partial.name || themeName;

  // Validate vars if present
  if (partial.vars) {
    for (const [key, value] of Object.entries(partial.vars)) {
      if (!isValidColorValue(value)) {
        throw new ThemeLoadError(`Invalid color value for variable "${key}": ${value}`, name);
      }
    }
  }

  // Validate colors if present
  if (partial.colors) {
    for (const [key, value] of Object.entries(partial.colors)) {
      if (!COLOR_TOKENS.includes(key as ColorToken)) {
        // Allow unknown keys (just ignore them)
        continue;
      }
      if (!isValidColorValue(value)) {
        throw new ThemeLoadError(`Invalid color value for token "${key}": ${value}`, name);
      }
    }
  }

  // Merge with dark theme as base
  return {
    name,
    vars: { ...darkTheme.vars, ...partial.vars },
    colors: { ...darkTheme.colors, ...partial.colors } as ThemeColors,
  };
}

/**
 * Check if a value is valid for use in a theme.
 */
function isValidColorValue(value: unknown): boolean {
  if (value === '') return true; // Terminal default
  if (typeof value === 'string') {
    if (isHexColor(value)) return true;
    if (value.length > 0) return true; // Variable reference
  }
  if (is256ColorIndex(value)) return true;
  return false;
}

/**
 * Resolve all color values in a theme definition.
 * Handles variable references and validates final values.
 */
export function resolveThemeColors(definition: ThemeDefinition): ResolvedColors {
  const vars = definition.vars || {};
  const colors = definition.colors;
  const resolved: Partial<ResolvedColors> = {};

  // Resolve each color token
  for (const token of COLOR_TOKENS) {
    const value = colors[token];
    if (value === undefined) {
      throw new ThemeLoadError(`Missing required color token: ${token}`, definition.name);
    }
    resolved[token] = resolveColorValue(value, vars, definition.name, new Set());
  }

  return resolved as ResolvedColors;
}

/**
 * Resolve a single color value, following variable references.
 */
export function resolveColorValue(
  value: ColorValue,
  vars: Record<string, ColorValue>,
  themeName: string,
  visited: Set<string>
): string {
  // Empty string = terminal default
  if (value === '') return '';

  // Number = 256-color index
  if (typeof value === 'number') {
    if (!is256ColorIndex(value)) {
      throw new ThemeLoadError(`Invalid 256-color index: ${value}`, themeName);
    }
    return String(value);
  }

  // Hex color = use directly
  if (isHexColor(value)) {
    return value;
  }

  // Must be a variable reference
  if (typeof value === 'string') {
    // Check for circular reference
    if (visited.has(value)) {
      throw new ThemeLoadError(`Circular variable reference detected: ${value}`, themeName);
    }

    // Look up variable
    const varValue = vars[value];
    if (varValue === undefined) {
      throw new ThemeLoadError(`Unknown variable reference: ${value}`, themeName);
    }

    // Recursively resolve
    visited.add(value);
    return resolveColorValue(varValue, vars, themeName, visited);
  }

  throw new ThemeLoadError(`Invalid color value: ${value}`, themeName);
}

/**
 * List all available themes (built-in + custom).
 */
export function listAvailableThemes(): string[] {
  const themes = new Set<string>(Object.keys(builtInThemes));

  // Add custom themes
  if (existsSync(CUSTOM_THEMES_DIR)) {
    try {
      const files = readdirSync(CUSTOM_THEMES_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          themes.add(file.slice(0, -5)); // Remove .json extension
        }
      }
    } catch {
      // Ignore errors reading custom themes dir
    }
  }

  return Array.from(themes).sort();
}

/**
 * Check if a theme exists.
 */
export function themeExists(themeName: string): boolean {
  if (themeName in builtInThemes) return true;
  const customPath = join(CUSTOM_THEMES_DIR, `${themeName}.json`);
  return existsSync(customPath);
}

/**
 * Detect terminal background (dark or light).
 * Returns 'dark' as default if detection fails.
 */
export function detectTerminalBackground(): 'dark' | 'light' {
  // Check COLORFGBG environment variable (used by some terminals)
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(';');
    if (parts.length >= 2) {
      const bg = parseInt(parts[parts.length - 1], 10);
      // Light backgrounds typically use indices 7, 15, or high values
      if (bg === 7 || bg === 15 || bg > 8) {
        return 'light';
      }
    }
  }

  // Check terminal-specific environment variables
  if (process.env.TERMINAL_EMULATOR?.includes('JetBrains')) {
    // JetBrains IDEs often have light themes
    return 'light';
  }

  // Default to dark (most common)
  return 'dark';
}

/**
 * Auto-detect and initialize theme based on terminal background.
 * If themeName is provided, use it. Otherwise, auto-detect based on terminal.
 */
export function autoInitTheme(themeName?: string): Theme {
  if (themeName) {
    return initTheme(themeName);
  }
  const background = detectTerminalBackground();
  return initTheme(background);
}
