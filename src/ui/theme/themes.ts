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
 * Dracula theme - popular dark theme with vibrant colors.
 * Based on the official Dracula color palette.
 */
export const draculaTheme: ThemeDefinition = {
  name: 'dracula',
  vars: {
    // Dracula palette
    background: '#282a36',
    currentLine: '#44475a',
    foreground: '#f8f8f2',
    comment: '#6272a4',
    cyan: '#8be9fd',
    green: '#50fa7b',
    orange: '#ffb86c',
    pink: '#ff79c6',
    purple: '#bd93f9',
    red: '#ff5555',
    yellow: '#f1fa8c',
    // Additional grays
    gray100: '#f8f8f2',
    gray200: '#e6e6e6',
    gray300: '#bfbfbf',
    gray400: '#6272a4',
    gray500: '#44475a',
    gray600: '#383a46',
    gray700: '#282a36',
    gray800: '#21222c',
    gray900: '#191a21',
  },
  colors: {
    // Core UI
    accent: 'purple',
    border: 'comment',
    borderAccent: 'purple',
    borderMuted: 'currentLine',
    success: 'green',
    error: 'red',
    warning: 'orange',
    muted: 'comment',
    dim: 'currentLine',
    text: 'foreground',
    // Backgrounds & Content
    userMessageBg: 'currentLine',
    userMessageText: 'foreground',
    toolPendingBg: 'gray800',
    toolSuccessBg: '#1e3a1e',
    toolErrorBg: '#3a1e1e',
    toolTitle: 'purple',
    toolOutput: 'foreground',
    // Diff Colors
    diffAdded: 'green',
    diffRemoved: 'red',
    diffContext: 'comment',
    // Syntax Highlighting
    syntaxComment: 'comment',
    syntaxKeyword: 'pink',
    syntaxFunction: 'green',
    syntaxVariable: 'foreground',
    syntaxString: 'yellow',
    syntaxNumber: 'purple',
    syntaxType: 'cyan',
    syntaxOperator: 'pink',
    syntaxPunctuation: 'foreground',
    // Markdown
    mdHeading: 'purple',
    mdLink: 'cyan',
    mdLinkUrl: 'comment',
    mdCode: 'green',
    mdCodeBlock: 'foreground',
    mdCodeBlockBorder: 'comment',
    mdQuote: 'yellow',
    mdQuoteBorder: 'comment',
    mdHr: 'comment',
    mdListBullet: 'cyan',
  },
};

/**
 * Sandy theme - warm, earthy tones inspired by desert landscapes.
 * Perfect for a cozy, muted aesthetic.
 */
export const sandyTheme: ThemeDefinition = {
  name: 'sandy',
  vars: {
    // Sandy/desert palette
    sand: '#e8d5b7',
    sandDark: '#d4c4a8',
    sandLight: '#f5ece0',
    terracotta: '#c45c3e',
    rust: '#a04030',
    cactus: '#6b8e23',
    sage: '#8fbc8f',
    clay: '#8b6914',
    dune: '#c4a35a',
    stone: '#7a6a5a',
    adobe: '#bc8f8f',
    // Grays (warm-tinted)
    gray100: '#f5f0e8',
    gray200: '#e8e0d5',
    gray300: '#d5c8b8',
    gray400: '#a89888',
    gray500: '#8a7a6a',
    gray600: '#6a5a4a',
    gray700: '#4a3a2a',
    gray800: '#3a2a1a',
    gray900: '#2a1a0a',
  },
  colors: {
    // Core UI
    accent: 'terracotta',
    border: 'stone',
    borderAccent: 'terracotta',
    borderMuted: 'gray600',
    success: 'cactus',
    error: 'rust',
    warning: 'dune',
    muted: 'stone',
    dim: 'gray600',
    text: 'gray100',
    // Backgrounds & Content
    userMessageBg: 'gray700',
    userMessageText: 'gray100',
    toolPendingBg: 'gray800',
    toolSuccessBg: '#2a3a2a',
    toolErrorBg: '#3a2a2a',
    toolTitle: 'terracotta',
    toolOutput: 'gray300',
    // Diff Colors
    diffAdded: 'cactus',
    diffRemoved: 'rust',
    diffContext: 'stone',
    // Syntax Highlighting
    syntaxComment: 'stone',
    syntaxKeyword: 'terracotta',
    syntaxFunction: 'cactus',
    syntaxVariable: 'dune',
    syntaxString: 'sage',
    syntaxNumber: 'clay',
    syntaxType: 'adobe',
    syntaxOperator: 'gray300',
    syntaxPunctuation: 'gray400',
    // Markdown
    mdHeading: 'terracotta',
    mdLink: 'cactus',
    mdLinkUrl: 'stone',
    mdCode: 'dune',
    mdCodeBlock: 'gray200',
    mdCodeBlockBorder: 'stone',
    mdQuote: 'sage',
    mdQuoteBorder: 'stone',
    mdHr: 'gray600',
    mdListBullet: 'terracotta',
  },
};

/**
 * TUI theme - New Zealand inspired colors for terminal.
 * Features silver fern greens, paua shell blues/purples, and Maori-inspired accents.
 */
export const tuiTheme: ThemeDefinition = {
  name: 'tui',
  vars: {
    // New Zealand palette
    silverFern: '#7fb069',      // Silver fern green
    fernDark: '#4a7c3f',        // Dark fern
    paua: '#4b0082',            // Paua shell purple
    pauaBlue: '#1e90ff',        // Paua shell blue
    pauaTeal: '#20b2aa',        // Paua teal highlights
    kowhai: '#ffd700',          // Kowhai yellow
    pohutukawa: '#dc143c',      // Pohutukawa red
    kiwi: '#8b4513',            // Kiwi brown
    sky: '#87ceeb',             // NZ sky blue
    snow: '#f0f8ff',            // Southern Alps snow
    obsidian: '#1a1a2e',        // Maori obsidian
    // Grays (cool-tinted)
    gray100: '#e8f0f0',
    gray200: '#c0d0d8',
    gray300: '#90a8b0',
    gray400: '#607880',
    gray500: '#405058',
    gray600: '#303840',
    gray700: '#202830',
    gray800: '#151c22',
    gray900: '#0a1015',
  },
  colors: {
    // Core UI
    accent: 'pauaBlue',
    border: 'gray500',
    borderAccent: 'pauaTeal',
    borderMuted: 'gray600',
    success: 'silverFern',
    error: 'pohutukawa',
    warning: 'kowhai',
    muted: 'gray400',
    dim: 'gray600',
    text: 'snow',
    // Backgrounds & Content
    userMessageBg: 'gray700',
    userMessageText: 'snow',
    toolPendingBg: 'gray800',
    toolSuccessBg: '#1a2a1a',
    toolErrorBg: '#2a1a1a',
    toolTitle: 'pauaTeal',
    toolOutput: 'gray200',
    // Diff Colors
    diffAdded: 'silverFern',
    diffRemoved: 'pohutukawa',
    diffContext: 'gray400',
    // Syntax Highlighting
    syntaxComment: 'gray400',
    syntaxKeyword: 'paua',
    syntaxFunction: 'pauaBlue',
    syntaxVariable: 'pauaTeal',
    syntaxString: 'silverFern',
    syntaxNumber: 'kowhai',
    syntaxType: 'sky',
    syntaxOperator: 'gray200',
    syntaxPunctuation: 'gray300',
    // Markdown
    mdHeading: 'pauaBlue',
    mdLink: 'pauaTeal',
    mdLinkUrl: 'gray400',
    mdCode: 'silverFern',
    mdCodeBlock: 'gray200',
    mdCodeBlockBorder: 'gray500',
    mdQuote: 'kowhai',
    mdQuoteBorder: 'gray500',
    mdHr: 'gray600',
    mdListBullet: 'pauaTeal',
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
  dracula: draculaTheme,
  sandy: sandyTheme,
  tui: tuiTheme,
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
