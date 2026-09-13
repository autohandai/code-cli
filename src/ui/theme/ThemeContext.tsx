/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { FC, ReactNode } from 'react';
import type { Theme } from './Theme.js';
import type { ColorToken, ResolvedColors } from './types.js';
import { getThemeSnapshot, subscribeThemeChanges } from './Theme.js';
import { loadTheme } from './loader.js';
import { getDefaultThemeName } from './themes.js';

/**
 * Theme context value.
 */
export interface ThemeContextValue {
  /** Current theme instance */
  theme: Theme;
  /** Direct access to resolved colors */
  colors: ResolvedColors;
  /** Theme name */
  name: string;
  /** Get hex color value for a token */
  getColor: (token: ColorToken) => string;
}

/**
 * Default context value (will throw if used without provider).
 */
const defaultContextValue: ThemeContextValue = {
  get theme(): Theme {
    throw new Error('ThemeContext not initialized. Wrap your app with ThemeProvider.');
  },
  get colors(): ResolvedColors {
    throw new Error('ThemeContext not initialized. Wrap your app with ThemeProvider.');
  },
  get name(): string {
    throw new Error('ThemeContext not initialized. Wrap your app with ThemeProvider.');
  },
  getColor: () => {
    throw new Error('ThemeContext not initialized. Wrap your app with ThemeProvider.');
  },
};

/**
 * React context for theme.
 */
export const ThemeContext = createContext<ThemeContextValue>(defaultContextValue);

/**
 * Props for ThemeProvider.
 */
export interface ThemeProviderProps {
  /** Theme instance to provide */
  theme?: Theme;
  /** Theme name to load (alternative to providing theme instance) */
  themeName?: string;
  /** Children components */
  children: ReactNode;
}

/**
 * Theme provider component for Ink applications.
 * Provides theme context to all child components.
 */
export const ThemeProvider: FC<ThemeProviderProps> = ({ theme: providedTheme, themeName, children }) => {
  const globalTheme = useSyncExternalStore(
    subscribeThemeChanges,
    getThemeSnapshot,
    getThemeSnapshot
  );

  const theme = useMemo(() => {
    // Use provided theme if available
    if (providedTheme) return providedTheme;

    // Try to get initialized global theme
    if (globalTheme) {
      return globalTheme;
    }

    // Load a provider-local theme if name provided
    if (themeName) {
      return loadTheme(themeName);
    }

    // Load default theme without mutating global theme during render
    return loadTheme(getDefaultThemeName());
  }, [providedTheme, themeName, globalTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      colors: theme.colors,
      name: theme.name,
      getColor: (token: ColorToken) => theme.getColor(token),
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Hook to access theme in Ink components.
 *
 * @example
 * ```tsx
 * const { colors, theme } = useTheme();
 * return <Text color={colors.accent}>Hello</Text>;
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  return context;
}
