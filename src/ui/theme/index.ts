/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Autohand Theme System
 *
 * Provides comprehensive theming support for terminal UI with:
 * - 40+ color tokens for different UI elements
 * - Built-in dark and light themes
 * - Custom theme support via ~/.autohand/themes/*.json
 * - React context for Ink components
 * - Truecolor, 256-color, and 16-color terminal support
 *
 * @example Basic usage (chalk-based):
 * ```typescript
 * import { getTheme, initTheme } from './ui/theme';
 *
 * // Initialize theme (usually done once at startup)
 * initTheme('dark');
 *
 * // Use in code
 * const theme = getTheme();
 * console.log(theme.fg('accent', 'Hello!'));
 * console.log(theme.fg('success', 'Success!'));
 * console.log(theme.fg('error', 'Error!'));
 * ```
 *
 * @example Ink components:
 * ```tsx
 * import { ThemeProvider, useTheme } from './ui/theme';
 *
 * const App = () => (
 *   <ThemeProvider themeName="dark">
 *     <MyComponent />
 *   </ThemeProvider>
 * );
 *
 * const MyComponent = () => {
 *   const { colors } = useTheme();
 *   return <Text color={colors.accent}>Themed text</Text>;
 * };
 * ```
 */

// Types
export type {
  ColorToken,
  ColorValue,
  ThemeColors,
  PartialThemeColors,
  ThemeDefinition,
  ResolvedTheme,
  ResolvedColors,
  ColorMode,
} from './types.js';

export {
  COLOR_TOKENS,
  isColorToken,
  isHexColor,
  is256ColorIndex,
  isValidColorValue,
} from './types.js';

// Theme class and utilities
export {
  Theme,
  getTheme,
  setTheme,
  isThemeInitialized,
  detectColorMode,
  hexToRgb,
  rgbTo256,
  rgbTo16,
  index256To16,
} from './Theme.js';

// Built-in themes
export {
  darkTheme,
  lightTheme,
  builtInThemes,
  getBuiltInTheme,
  isBuiltInTheme,
  getBuiltInThemeNames,
  getDefaultThemeName,
} from './themes.js';

// Theme loader
export {
  CUSTOM_THEMES_DIR,
  ThemeLoadError,
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
  autoInitTheme,
} from './loader.js';

// React/Ink support
export {
  ThemeContext,
  ThemeProvider,
  useTheme,
  useThemeColor,
  useThemeColors,
  withTheme,
} from './ThemeContext.js';

export type { ThemeContextValue, ThemeProviderProps } from './ThemeContext.js';
