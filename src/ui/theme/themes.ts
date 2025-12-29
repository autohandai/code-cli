/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThemeColors, ThemeDefinition } from './types.js';

/**
 * Dark theme - default theme optimized for dark terminal backgrounds.
 * Uses vibrant colors for visibility against dark backgrounds.
 */
export const darkTheme: ThemeDefinition = {
  name: 'dark',
  vars: {
    // Base colors
    cyan: '#00bcd4',
    green: '#4caf50',
    red: '#f44336',
    yellow: '#ffeb3b',
    blue: '#2196f3',
    magenta: '#e91e63',
    orange: '#ff9800',
    // Grays
    gray100: '#f5f5f5',
    gray200: '#eeeeee',
    gray300: '#e0e0e0',
    gray400: '#bdbdbd',
    gray500: '#9e9e9e',
    gray600: '#757575',
    gray700: '#616161',
    gray800: '#424242',
    gray900: '#212121',
    // Backgrounds
    bgDark: '#1a1a1a',
    bgMedium: '#2b2b2b',
    bgLight: '#3a3a3a',
  },
  colors: {
    // Core UI
    accent: 'cyan',
    border: 'gray700',
    borderAccent: 'cyan',
    borderMuted: 'gray800',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    muted: 'gray500',
    dim: 'gray700',
    text: 'gray200',
    // Backgrounds & Content
    userMessageBg: 'bgMedium',
    userMessageText: 'gray200',
    toolPendingBg: 'bgLight',
    toolSuccessBg: '#1b3d1b',
    toolErrorBg: '#3d1b1b',
    toolTitle: 'cyan',
    toolOutput: 'gray400',
    // Diff Colors
    diffAdded: '#4caf50',
    diffRemoved: '#f44336',
    diffContext: 'gray500',
    // Syntax Highlighting
    syntaxComment: 'gray600',
    syntaxKeyword: 'magenta',
    syntaxFunction: 'blue',
    syntaxVariable: 'cyan',
    syntaxString: 'green',
    syntaxNumber: 'yellow',
    syntaxType: 'cyan',
    syntaxOperator: 'gray300',
    syntaxPunctuation: 'gray400',
    // Markdown
    mdHeading: 'cyan',
    mdLink: 'blue',
    mdLinkUrl: 'gray500',
    mdCode: 'orange',
    mdCodeBlock: 'gray300',
    mdCodeBlockBorder: 'gray700',
    mdQuote: 'gray400',
    mdQuoteBorder: 'gray600',
    mdHr: 'gray700',
    mdListBullet: 'cyan',
  },
};

/**
 * Light theme - optimized for light terminal backgrounds.
 * Uses darker, more saturated colors for visibility against light backgrounds.
 */
export const lightTheme: ThemeDefinition = {
  name: 'light',
  vars: {
    // Base colors (darker for light bg)
    cyan: '#0097a7',
    green: '#388e3c',
    red: '#d32f2f',
    yellow: '#f9a825',
    blue: '#1976d2',
    magenta: '#c2185b',
    orange: '#ef6c00',
    // Grays (inverted)
    gray100: '#212121',
    gray200: '#424242',
    gray300: '#616161',
    gray400: '#757575',
    gray500: '#9e9e9e',
    gray600: '#bdbdbd',
    gray700: '#e0e0e0',
    gray800: '#eeeeee',
    gray900: '#f5f5f5',
    // Backgrounds
    bgLight: '#ffffff',
    bgMedium: '#f5f5f5',
    bgDark: '#eeeeee',
  },
  colors: {
    // Core UI
    accent: 'cyan',
    border: 'gray600',
    borderAccent: 'cyan',
    borderMuted: 'gray700',
    success: 'green',
    error: 'red',
    warning: 'yellow',
    muted: 'gray400',
    dim: 'gray500',
    text: 'gray100',
    // Backgrounds & Content
    userMessageBg: 'bgMedium',
    userMessageText: 'gray100',
    toolPendingBg: 'bgDark',
    toolSuccessBg: '#e8f5e9',
    toolErrorBg: '#ffebee',
    toolTitle: 'cyan',
    toolOutput: 'gray300',
    // Diff Colors
    diffAdded: '#2e7d32',
    diffRemoved: '#c62828',
    diffContext: 'gray400',
    // Syntax Highlighting
    syntaxComment: 'gray500',
    syntaxKeyword: 'magenta',
    syntaxFunction: 'blue',
    syntaxVariable: 'cyan',
    syntaxString: 'green',
    syntaxNumber: 'orange',
    syntaxType: 'cyan',
    syntaxOperator: 'gray300',
    syntaxPunctuation: 'gray400',
    // Markdown
    mdHeading: 'cyan',
    mdLink: 'blue',
    mdLinkUrl: 'gray400',
    mdCode: 'orange',
    mdCodeBlock: 'gray200',
    mdCodeBlockBorder: 'gray600',
    mdQuote: 'gray300',
    mdQuoteBorder: 'gray500',
    mdHr: 'gray600',
    mdListBullet: 'cyan',
  },
};

/**
 * Map of built-in theme names to their definitions.
 */
export const builtInThemes: Record<string, ThemeDefinition> = {
  dark: darkTheme,
  light: lightTheme,
};

/**
 * Get a built-in theme by name.
 */
export function getBuiltInTheme(name: string): ThemeDefinition | undefined {
  return builtInThemes[name];
}

/**
 * Check if a theme name refers to a built-in theme.
 */
export function isBuiltInTheme(name: string): boolean {
  return name in builtInThemes;
}

/**
 * Get list of all built-in theme names.
 */
export function getBuiltInThemeNames(): string[] {
  return Object.keys(builtInThemes);
}

/**
 * Get the default theme name.
 */
export function getDefaultThemeName(): string {
  return 'dark';
}
