/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import type { ThemeDefinition } from './types.js';

/**
 * Parsed Ghostty theme with raw palette and metadata colors.
 */
export interface GhosttyPalette {
  palette: Map<number, string>;
  background: string;
  foreground: string;
  cursorColor?: string;
  cursorText?: string;
  selectionBackground?: string;
  selectionForeground?: string;
}

/**
 * Known Ghostty theme directories by platform.
 */
function getGhosttyThemeDirs(): string[] {
  const dirs: string[] = [];

  if (platform() === 'darwin') {
    dirs.push('/Applications/Ghostty.app/Contents/Resources/ghostty/themes');
  }

  // Linux XDG paths
  const xdgDataDirs = process.env.XDG_DATA_DIRS?.split(':') ?? ['/usr/share', '/usr/local/share'];
  for (const dir of xdgDataDirs) {
    dirs.push(join(dir, 'ghostty', 'themes'));
  }

  // User config dir (custom Ghostty themes)
  const configHome = process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '', '.config');
  dirs.push(join(configHome, 'ghostty', 'themes'));

  return dirs;
}

/**
 * Find the first existing Ghostty themes directory.
 */
export function findGhosttyThemesDir(): string | null {
  for (const dir of getGhosttyThemeDirs()) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

/**
 * List all available Ghostty theme names.
 */
export function listGhosttyThemes(): string[] {
  const dir = findGhosttyThemesDir();
  if (!dir) return [];

  try {
    return readdirSync(dir)
      .filter(f => !f.startsWith('.'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Parse a Ghostty theme file into a palette.
 */
export function parseGhosttyTheme(content: string): GhosttyPalette {
  const palette = new Map<number, string>();
  let background = '#1a1a1a';
  let foreground = '#e0e0e0';
  let cursorColor: string | undefined;
  let cursorText: string | undefined;
  let selectionBackground: string | undefined;
  let selectionForeground: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();

    if (key === 'palette') {
      // Format: palette = N=#RRGGBB
      const paletteEq = value.indexOf('=');
      if (paletteEq !== -1) {
        const idx = parseInt(value.slice(0, paletteEq), 10);
        const color = value.slice(paletteEq + 1).trim();
        if (!isNaN(idx) && idx >= 0 && idx <= 15 && /^#[0-9a-fA-F]{6}$/.test(color)) {
          palette.set(idx, color);
        }
      }
    } else if (key === 'background') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) background = value;
    } else if (key === 'foreground') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) foreground = value;
    } else if (key === 'cursor-color') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) cursorColor = value;
    } else if (key === 'cursor-text') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) cursorText = value;
    } else if (key === 'selection-background') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) selectionBackground = value;
    } else if (key === 'selection-foreground') {
      if (/^#[0-9a-fA-F]{6}$/.test(value)) selectionForeground = value;
    }
  }

  return { palette, background, foreground, cursorColor, cursorText, selectionBackground, selectionForeground };
}

/**
 * Adjust a hex color brightness by a factor.
 * factor > 1 lightens, factor < 1 darkens.
 */
function adjustBrightness(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r * factor).toString(16).padStart(2, '0')}${clamp(g * factor).toString(16).padStart(2, '0')}${clamp(b * factor).toString(16).padStart(2, '0')}`;
}

/**
 * Mix two hex colors by a ratio (0 = first color, 1 = second color).
 */
function mixColors(hex1: string, hex2: string, ratio: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(r1 + (r2 - r1) * ratio);
  const g = clamp(g1 + (g2 - g1) * ratio);
  const b = clamp(b1 + (b2 - b1) * ratio);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Get relative luminance of a hex color (0 = black, 1 = white).
 */
function getLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Convert a Ghostty palette into an Autohand ThemeDefinition.
 *
 * Maps the 16 ANSI colors to our 39 semantic tokens:
 * - ANSI 0/8: black/bright-black → comments, borders
 * - ANSI 1/9: red/bright-red → errors, keywords, operators
 * - ANSI 2/10: green/bright-green → success, strings, diff-added
 * - ANSI 3/11: yellow/bright-yellow → warnings, numbers
 * - ANSI 4/12: blue/bright-blue → accent, links, functions
 * - ANSI 5/13: magenta/bright-magenta → types, keywords
 * - ANSI 6/14: cyan/bright-cyan → variables, headings
 * - ANSI 7/15: white/bright-white → text, punctuation
 */
export function ghosttyPaletteToTheme(name: string, gp: GhosttyPalette): ThemeDefinition {
  // Helper to get palette color with fallback
  const p = (idx: number, fallback: string): string => gp.palette.get(idx) ?? fallback;

  const bg = gp.background;
  const fg = gp.foreground;
  const isDark = getLuminance(bg) < 0.5;

  // Derive surface colors from background
  const bgSurface = isDark ? adjustBrightness(bg, 1.3) : adjustBrightness(bg, 0.95);
  const bgOverlay = isDark ? adjustBrightness(bg, 1.5) : adjustBrightness(bg, 0.90);
  const borderColor = isDark ? adjustBrightness(bg, 2.0) : adjustBrightness(bg, 0.80);
  const borderMuted = isDark ? adjustBrightness(bg, 1.6) : adjustBrightness(bg, 0.88);

  // Derive tool result backgrounds by mixing ANSI colors with bg
  const green = p(2, '#4caf50');
  const red = p(1, '#f44336');
  const toolSuccessBg = mixColors(bg, green, 0.15);
  const toolErrorBg = mixColors(bg, red, 0.15);

  return {
    name,
    vars: {
      // ANSI palette
      black: p(0, '#000000'),
      red: p(1, '#cc0000'),
      green: p(2, '#4caf50'),
      yellow: p(3, '#cdcd00'),
      blue: p(4, '#0000cd'),
      magenta: p(5, '#cd00cd'),
      cyan: p(6, '#00cdcd'),
      white: p(7, '#e5e5e5'),
      brightBlack: p(8, '#666666'),
      brightRed: p(9, '#ff0000'),
      brightGreen: p(10, '#00ff00'),
      brightYellow: p(11, '#ffff00'),
      brightBlue: p(12, '#0000ff'),
      brightMagenta: p(13, '#ff00ff'),
      brightCyan: p(14, '#00ffff'),
      brightWhite: p(15, '#ffffff'),
      // Derived
      bg,
      fg,
      bgSurface,
      bgOverlay,
      borderColor,
      borderMuted,
      toolSuccessBg,
      toolErrorBg,
    },
    colors: {
      // Core UI
      accent: 'blue',
      border: 'borderColor',
      borderAccent: 'blue',
      borderMuted: 'borderMuted',
      success: 'green',
      error: 'red',
      warning: 'yellow',
      muted: 'brightBlack',
      dim: 'fg',
      text: 'fg',
      // Backgrounds & Content
      userMessageBg: 'bgSurface',
      userMessageText: 'fg',
      toolPendingBg: 'bgOverlay',
      toolSuccessBg: 'toolSuccessBg',
      toolErrorBg: 'toolErrorBg',
      toolTitle: 'blue',
      toolOutput: 'white',
      // Diff Colors
      diffAdded: 'green',
      diffRemoved: 'red',
      diffContext: 'brightBlack',
      // Syntax Highlighting
      syntaxComment: 'brightBlack',
      syntaxKeyword: 'magenta',
      syntaxFunction: 'blue',
      syntaxVariable: 'cyan',
      syntaxString: 'green',
      syntaxNumber: 'yellow',
      syntaxType: 'brightCyan',
      syntaxOperator: 'red',
      syntaxPunctuation: 'white',
      // Markdown
      mdHeading: 'blue',
      mdLink: 'cyan',
      mdLinkUrl: 'brightBlack',
      mdCode: 'yellow',
      mdCodeBlock: 'fg',
      mdCodeBlockBorder: 'borderColor',
      mdQuote: 'white',
      mdQuoteBorder: 'brightBlack',
      mdHr: 'borderColor',
      mdListBullet: 'cyan',
    },
  };
}

/**
 * Load a single Ghostty theme by name and convert to ThemeDefinition.
 */
export function loadGhosttyTheme(themeName: string): ThemeDefinition | null {
  const dir = findGhosttyThemesDir();
  if (!dir) return null;

  const filePath = join(dir, themeName);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const palette = parseGhosttyTheme(content);
    return ghosttyPaletteToTheme(themeName, palette);
  } catch {
    return null;
  }
}
