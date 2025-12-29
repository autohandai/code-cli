/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ColorToken, ResolvedColors, ColorMode } from './types.js';

/**
 * Theme class provides methods for applying colors to terminal output.
 * Supports truecolor (24-bit), 256-color, and basic 16-color modes.
 */
export class Theme {
  readonly name: string;
  readonly colors: ResolvedColors;
  private readonly colorMode: ColorMode;
  private readonly ansiCache: Map<string, string> = new Map();

  constructor(name: string, colors: ResolvedColors, colorMode?: ColorMode) {
    this.name = name;
    this.colors = colors;
    this.colorMode = colorMode ?? detectColorMode();
  }

  /**
   * Apply foreground color to text.
   */
  fg(token: ColorToken, text: string): string {
    if (this.colorMode === 'none') return text;
    const color = this.colors[token];
    if (!color) return text;
    const ansi = this.getAnsiCode(color, 'fg');
    return `${ansi}${text}\x1b[39m`;
  }

  /**
   * Apply background color to text.
   */
  bg(token: ColorToken, text: string): string {
    if (this.colorMode === 'none') return text;
    const color = this.colors[token];
    if (!color) return text;
    const ansi = this.getAnsiCode(color, 'bg');
    return `${ansi}${text}\x1b[49m`;
  }

  /**
   * Apply both foreground and background colors.
   */
  fgBg(fgToken: ColorToken, bgToken: ColorToken, text: string): string {
    if (this.colorMode === 'none') return text;
    const fgColor = this.colors[fgToken];
    const bgColor = this.colors[bgToken];
    const fgAnsi = fgColor ? this.getAnsiCode(fgColor, 'fg') : '';
    const bgAnsi = bgColor ? this.getAnsiCode(bgColor, 'bg') : '';
    return `${fgAnsi}${bgAnsi}${text}\x1b[0m`;
  }

  /**
   * Apply bold style.
   */
  bold(text: string): string {
    return `\x1b[1m${text}\x1b[22m`;
  }

  /**
   * Apply italic style.
   */
  italic(text: string): string {
    return `\x1b[3m${text}\x1b[23m`;
  }

  /**
   * Apply underline style.
   */
  underline(text: string): string {
    return `\x1b[4m${text}\x1b[24m`;
  }

  /**
   * Apply dim style.
   */
  dimStyle(text: string): string {
    return `\x1b[2m${text}\x1b[22m`;
  }

  /**
   * Apply strikethrough style.
   */
  strikethrough(text: string): string {
    return `\x1b[9m${text}\x1b[29m`;
  }

  /**
   * Reset all styles.
   */
  reset(text: string): string {
    return `\x1b[0m${text}\x1b[0m`;
  }

  /**
   * Get raw color value for a token.
   */
  getColor(token: ColorToken): string {
    return this.colors[token] || '';
  }

  /**
   * Get current color mode.
   */
  getColorMode(): ColorMode {
    return this.colorMode;
  }

  /**
   * Convert color value to ANSI escape code.
   */
  private getAnsiCode(color: string, type: 'fg' | 'bg'): string {
    const cacheKey = `${color}:${type}`;
    const cached = this.ansiCache.get(cacheKey);
    if (cached) return cached;

    const code = this.colorToAnsi(color, type);
    this.ansiCache.set(cacheKey, code);
    return code;
  }

  /**
   * Convert a color value to ANSI code based on color mode.
   */
  private colorToAnsi(color: string, type: 'fg' | 'bg'): string {
    // Empty string means terminal default
    if (!color) return '';

    // Handle hex colors
    if (color.startsWith('#')) {
      return this.hexToAnsi(color, type);
    }

    // Handle 256-color index (as string number)
    const numValue = parseInt(color, 10);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 255) {
      return this.index256ToAnsi(numValue, type);
    }

    // Fallback - treat as named color (shouldn't happen with resolved colors)
    return '';
  }

  /**
   * Convert hex color to ANSI code.
   */
  private hexToAnsi(hex: string, type: 'fg' | 'bg'): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return '';

    const base = type === 'fg' ? 38 : 48;

    if (this.colorMode === 'truecolor') {
      // 24-bit truecolor
      return `\x1b[${base};2;${rgb.r};${rgb.g};${rgb.b}m`;
    } else if (this.colorMode === '256') {
      // Convert to nearest 256-color
      const index = rgbTo256(rgb.r, rgb.g, rgb.b);
      return `\x1b[${base};5;${index}m`;
    } else if (this.colorMode === '16') {
      // Convert to nearest basic color
      const index = rgbTo16(rgb.r, rgb.g, rgb.b);
      const code = type === 'fg' ? (index < 8 ? 30 + index : 90 + index - 8) : (index < 8 ? 40 + index : 100 + index - 8);
      return `\x1b[${code}m`;
    }

    return '';
  }

  /**
   * Convert 256-color index to ANSI code.
   */
  private index256ToAnsi(index: number, type: 'fg' | 'bg'): string {
    const base = type === 'fg' ? 38 : 48;

    if (this.colorMode === 'truecolor' || this.colorMode === '256') {
      return `\x1b[${base};5;${index}m`;
    } else if (this.colorMode === '16') {
      // Map to basic 16 colors
      const basicIndex = index < 16 ? index : index256To16(index);
      const code = type === 'fg' ? (basicIndex < 8 ? 30 + basicIndex : 90 + basicIndex - 8) : (basicIndex < 8 ? 40 + basicIndex : 100 + basicIndex - 8);
      return `\x1b[${code}m`;
    }

    return '';
  }
}

/**
 * Detect terminal color capabilities.
 */
export function detectColorMode(): ColorMode {
  // Check for NO_COLOR environment variable
  if (process.env.NO_COLOR !== undefined) {
    return 'none';
  }

  // Check for FORCE_COLOR
  if (process.env.FORCE_COLOR !== undefined) {
    const level = parseInt(process.env.FORCE_COLOR, 10);
    if (level === 0) return 'none';
    if (level === 1) return '16';
    if (level === 2) return '256';
    if (level >= 3) return 'truecolor';
  }

  // Check COLORTERM for truecolor support
  const colorterm = process.env.COLORTERM;
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    return 'truecolor';
  }

  // Check TERM for color support
  const term = process.env.TERM || '';
  if (term.includes('256color') || term.includes('256-color')) {
    return '256';
  }

  if (term.includes('color') || term.includes('ansi') || term === 'xterm') {
    return '16';
  }

  // Default to 256 colors on modern terminals
  if (process.stdout.isTTY) {
    return '256';
  }

  return 'none';
}

/**
 * Parse hex color to RGB.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})$/);
  if (match) {
    return {
      r: parseInt(match[1], 16),
      g: parseInt(match[2], 16),
      b: parseInt(match[3], 16),
    };
  }

  // Handle shorthand (#rgb)
  const shortMatch = hex.match(/^#?([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])$/);
  if (shortMatch) {
    return {
      r: parseInt(shortMatch[1] + shortMatch[1], 16),
      g: parseInt(shortMatch[2] + shortMatch[2], 16),
      b: parseInt(shortMatch[3] + shortMatch[3], 16),
    };
  }

  return null;
}

/**
 * Convert RGB to nearest 256-color index.
 * Uses the 6x6x6 color cube (indices 16-231) for colors,
 * and grayscale ramp (indices 232-255) for grays.
 */
export function rgbTo256(r: number, g: number, b: number): number {
  // Check if it's a grayscale color
  if (r === g && g === b) {
    if (r < 8) return 16; // Black
    if (r > 248) return 231; // White
    return Math.round((r - 8) / 10) + 232;
  }

  // Map to 6x6x6 color cube
  const ri = Math.round(r / 51);
  const gi = Math.round(g / 51);
  const bi = Math.round(b / 51);
  return 16 + 36 * ri + 6 * gi + bi;
}

/**
 * Convert RGB to nearest basic 16-color index.
 */
export function rgbTo16(r: number, g: number, b: number): number {
  // Simple quantization to 16 colors
  const bright = (r + g + b) / 3 > 128 ? 8 : 0;
  const ri = r > 128 ? 1 : 0;
  const gi = g > 128 ? 2 : 0;
  const bi = b > 128 ? 4 : 0;
  return bright + ri + gi + bi;
}

/**
 * Convert 256-color index to nearest 16-color index.
 */
export function index256To16(index: number): number {
  if (index < 16) return index;

  if (index >= 232) {
    // Grayscale
    const gray = (index - 232) * 10 + 8;
    return gray > 128 ? 15 : 0;
  }

  // Color cube
  const adjusted = index - 16;
  const r = Math.floor(adjusted / 36) * 51;
  const g = Math.floor((adjusted % 36) / 6) * 51;
  const b = (adjusted % 6) * 51;
  return rgbTo16(r, g, b);
}

/**
 * Global theme instance.
 * Initialized with dark theme by default, can be replaced via initTheme().
 */
let globalTheme: Theme | null = null;

/**
 * Get the current global theme.
 */
export function getTheme(): Theme {
  if (!globalTheme) {
    throw new Error('Theme not initialized. Call initTheme() first.');
  }
  return globalTheme;
}

/**
 * Set the global theme.
 */
export function setTheme(theme: Theme): void {
  globalTheme = theme;
}

/**
 * Check if theme is initialized.
 */
export function isThemeInitialized(): boolean {
  return globalTheme !== null;
}
