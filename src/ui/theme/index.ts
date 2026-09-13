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
 * import { ThemeProvider, useTheme } from './ui/theme/ThemeContext.js';
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

// Theme class and utilities
export {
  Theme,
  getTheme,
  setTheme,
  isThemeInitialized,
  themedFg,
  hexToRgb,
} from './Theme.js';

// Built-in themes
export {
  getBuiltInThemeNames,
  getDefaultThemeName,
} from './themes.js';

// Theme loader
export {
  CUSTOM_THEMES_DIR,
  loadTheme,
  initTheme,
  listAvailableThemes,
  themeExists,
  configureThemeSources,
  autoInitTheme,
} from './loader.js';
