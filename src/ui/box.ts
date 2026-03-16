/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getTheme, isThemeInitialized, hexToRgb } from './theme/index.js';
import type { ColorToken } from './theme/types.js';
import { stripAnsiCodes } from './displayUtils.js';

const DEFAULT_BORDER_COLOR = '#8a8a8a';
const PLAN_BORDER_COLOR = '#ff9d3f';
const SHELL_BORDER_COLOR = '#c8c8c8';

// Fallback colors used when theme is not initialized
const FALLBACK_BOX_BG = '#2b2b2b';
const FALLBACK_BOX_FG = '#a0a0a0';

export type InputBorderStyle = 'default' | 'plan' | 'shell';

// Frame-level color cache — invalidated per render frame and on theme change.
let cachedBoxBg: string | null = null;
let cachedBoxFg: string | null = null;
const cachedBorderFg = new Map<InputBorderStyle, string>();
let cachedThemeRef: unknown = null;

function ensureCacheValid(): void {
  const currentTheme = isThemeInitialized() ? getTheme() : null;
  if (currentTheme !== cachedThemeRef) {
    cachedBoxBg = null;
    cachedBoxFg = null;
    cachedBorderFg.clear();
    cachedThemeRef = currentTheme;
  }
}

export function invalidateBoxColorCache(): void {
  cachedBoxBg = null;
  cachedBoxFg = null;
  cachedBorderFg.clear();
}

function resolveBorderToken(style: InputBorderStyle): ColorToken {
  if (style === 'plan') {
    return 'warning';
  }
  if (style === 'shell') {
    return 'dim';
  }
  return 'borderAccent';
}

function resolveBorderFallback(style: InputBorderStyle): string {
  if (style === 'plan') {
    return PLAN_BORDER_COLOR;
  }
  if (style === 'shell') {
    return SHELL_BORDER_COLOR;
  }
  return DEFAULT_BORDER_COLOR;
}

function hexToAnsiRgb(hex: string, type: 'fg' | 'bg'): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const base = type === 'fg' ? 38 : 48;
  return `\x1b[${base};2;${rgb.r};${rgb.g};${rgb.b}m`;
}

function resolveBoxBg(): string {
  ensureCacheValid();
  if (cachedBoxBg !== null) return cachedBoxBg;
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor('userMessageBg');
      if (hex) {
        const code = hexToAnsiRgb(hex, 'bg');
        if (code) { cachedBoxBg = code; return code; }
      }
    } catch { /* use fallback */ }
  }
  const result = hexToAnsiRgb(FALLBACK_BOX_BG, 'bg');
  cachedBoxBg = result;
  return result;
}

function resolveBoxFg(): string {
  ensureCacheValid();
  if (cachedBoxFg !== null) return cachedBoxFg;
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor('userMessageText');
      if (hex) {
        const code = hexToAnsiRgb(hex, 'fg');
        if (code) { cachedBoxFg = code; return code; }
      }
    } catch { /* use fallback */ }
  }
  const result = hexToAnsiRgb(FALLBACK_BOX_FG, 'fg');
  cachedBoxFg = result;
  return result;
}

function resolveBorderFg(style: InputBorderStyle): string {
  ensureCacheValid();
  const cached = cachedBorderFg.get(style);
  if (cached !== undefined) return cached;
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor(resolveBorderToken(style));
      if (hex) {
        const code = hexToAnsiRgb(hex, 'fg');
        if (code) { cachedBorderFg.set(style, code); return code; }
      }
    } catch { /* use fallback */ }
  }
  const result = hexToAnsiRgb(resolveBorderFallback(style), 'fg');
  cachedBorderFg.set(style, result);
  return result;
}

export function drawInputTopBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  const border = `┌${'─'.repeat(innerWidth)}┐`;
  return resolveBoxBg() + resolveBorderFg(style) + border + RESET_ALL + CLEAR_TO_EOL;
}

export function drawInputBottomBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  const border = `└${'─'.repeat(innerWidth)}┘`;
  return resolveBoxBg() + resolveBorderFg(style) + border + RESET_ALL + CLEAR_TO_EOL;
}

const ANSI_OR_CHAR_PATTERN = /(?:\u001b\[[0-9;]*m)|[\s\S]/g;

function getVisibleLength(value: string): number {
  return stripAnsiCodes(value).length;
}

function truncateVisible(value: string, maxVisible: number): string {
  if (maxVisible <= 0 || value.length === 0) {
    return '';
  }

  let visible = 0;
  let out = '';
  const tokens = value.match(ANSI_OR_CHAR_PATTERN) ?? [];
  for (const token of tokens) {
    if (token.startsWith('\u001b[')) {
      out += token;
      continue;
    }
    if (visible >= maxVisible) {
      break;
    }
    out += token;
    visible += 1;
  }
  return out;
}

const RESET_ALL = '\x1b[0m';
// Erase from cursor to end of line using the CURRENT attributes.
// Placed AFTER RESET_ALL so it clears with the terminal's default bg,
// preventing box background color from bleeding past the right border.
const CLEAR_TO_EOL = '\x1b[K';

/**
 * Re-apply background/foreground after any inner ANSI codes that would
 * otherwise reset them.  This prevents styled content (e.g. themed
 * prefix, chalk.gray placeholder) from breaking the box background.
 */
function stabilizeBoxAnsi(text: string, bg: string, fg: string): string {
  const base = bg + fg;
  return text
    .replace(/\x1b\[0m/g, RESET_ALL + base)
    .replace(/\x1b\[49m/g, bg)
    .replace(/\x1b\[39m/g, fg);
}

export function drawInputBox(left: string, width: number, right?: string, style: InputBorderStyle = 'default'): string {
  const bg = resolveBoxBg();
  const fg = resolveBoxFg();
  const borderFg = resolveBorderFg(style);
  const base = bg + fg;
  const innerWidth = Math.max(0, width - 2);
  const visLeft = getVisibleLength(left);
  const lBorder = borderFg + '│' + fg;
  const rBorder = borderFg + '│';

  const END = RESET_ALL + CLEAR_TO_EOL;

  if (!right) {
    const pad = Math.max(0, innerWidth - visLeft);
    return base + lBorder + stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(pad) + rBorder + END;
  }

  const visRight = getVisibleLength(right);
  const minGap = 2;
  const available = innerWidth - visLeft - minGap;

  if (available <= 0) {
    const pad = Math.max(0, innerWidth - visLeft);
    return base + lBorder + stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(pad) + rBorder + END;
  }

  const clippedRight = visRight > available
    ? truncateVisible(right, available)
    : right;
  const clippedRightVis = getVisibleLength(clippedRight);
  const gap = Math.max(0, innerWidth - visLeft - clippedRightVis);
  const line = stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(gap) + stabilizeBoxAnsi(clippedRight, bg, fg);

  return base + lBorder + line + rBorder + END;
}
