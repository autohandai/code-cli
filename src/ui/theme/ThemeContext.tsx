/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { FC, ReactNode } from 'react';
import type { Theme } from './Theme.js';
import type { ColorToken, ResolvedColors } from './types.js';
import { getTheme, isThemeInitialized } from './Theme.js';
import { initTheme } from './loader.js';

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
  const theme = useMemo(() => {
    // Use provided theme if available
    if (providedTheme) return providedTheme;

    // Try to get initialized global theme
    if (isThemeInitialized()) {
      return getTheme();
    }

    // Initialize theme if name provided
    if (themeName) {
      return initTheme(themeName);
    }

    // Initialize default theme
    return initTheme();
  }, [providedTheme, themeName]);

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

/**
 * Hook to get a specific color from the theme.
 *
 * @example
 * ```tsx
 * const accentColor = useThemeColor('accent');
 * return <Text color={accentColor}>Accented text</Text>;
 * ```
 */
export function useThemeColor(token: ColorToken): string {
  const { colors } = useTheme();
  return colors[token];
}

/**
 * Hook to get multiple colors from the theme.
 *
 * @example
 * ```tsx
 * const { success, error, warning } = useThemeColors(['success', 'error', 'warning']);
 * ```
 */
export function useThemeColors<T extends ColorToken>(tokens: T[]): Pick<ResolvedColors, T> {
  const { colors } = useTheme();
  return tokens.reduce(
    (acc, token) => {
      acc[token] = colors[token];
      return acc;
    },
    {} as Pick<ResolvedColors, T>
  );
}

/**
 * Higher-order component to inject theme props.
 *
 * @example
 * ```tsx
 * interface Props { message: string; }
 * const MyComponent = withTheme<Props>(({ message, theme, colors }) => (
 *   <Text color={colors.accent}>{message}</Text>
 * ));
 * ```
 */
export function withTheme<P extends object>(
  Component: React.ComponentType<P & ThemeContextValue>
): FC<P> {
  const WithTheme: FC<P> = (props) => {
    const themeContext = useTheme();
    return <Component {...props} {...themeContext} />;
  };

  WithTheme.displayName = `WithTheme(${Component.displayName || Component.name || 'Component'})`;
  return WithTheme;
}
