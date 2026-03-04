/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { getTheme, isThemeInitialized, hexToRgb } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

const DEFAULT_BORDER_COLOR = '#8a8a8a';
const PLAN_BORDER_COLOR = '#ff9d3f';
const SHELL_BORDER_COLOR = '#c8c8c8';

// Fallback colors used when theme is not initialized
const FALLBACK_BOX_BG = '#2b2b2b';
const FALLBACK_BOX_FG = '#a0a0a0';

export type InputBorderStyle = 'default' | 'plan' | 'shell';

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
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor('userMessageBg');
      if (hex) {
        const code = hexToAnsiRgb(hex, 'bg');
        if (code) return code;
      }
    } catch { /* use fallback */ }
  }
  return hexToAnsiRgb(FALLBACK_BOX_BG, 'bg');
}

function resolveBoxFg(): string {
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor('userMessageText');
      if (hex) {
        const code = hexToAnsiRgb(hex, 'fg');
        if (code) return code;
      }
    } catch { /* use fallback */ }
  }
  return hexToAnsiRgb(FALLBACK_BOX_FG, 'fg');
}

function resolveBorderFg(style: InputBorderStyle): string {
  if (isThemeInitialized()) {
    try {
      const hex = getTheme().getColor(resolveBorderToken(style));
      if (hex) {
        const code = hexToAnsiRgb(hex, 'fg');
        if (code) return code;
      }
    } catch { /* use fallback */ }
  }
  return hexToAnsiRgb(resolveBorderFallback(style), 'fg');
}

export function drawInputTopBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  const border = `┌${'─'.repeat(innerWidth)}┐`;
  return resolveBoxBg() + resolveBorderFg(style) + border + CLEAR_TO_EOL + RESET_ALL;
}

export function drawInputBottomBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  const border = `└${'─'.repeat(innerWidth)}┘`;
  return resolveBoxBg() + resolveBorderFg(style) + border + CLEAR_TO_EOL + RESET_ALL;
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const ANSI_OR_CHAR_PATTERN = /(?:\u001b\[[0-9;]*m)|[\s\S]/g;

function getVisibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, '').length;
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

export function drawInputBox(left: string, width: number, right?: string): string {
  const bg = resolveBoxBg();
  const fg = resolveBoxFg();
  const base = bg + fg;
  const visLeft = getVisibleLength(left);

  if (!right) {
    const pad = Math.max(0, width - visLeft);
    return base + stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(pad) + CLEAR_TO_EOL + RESET_ALL;
  }

  const visRight = getVisibleLength(right);
  const minGap = 2;
  const available = width - visLeft - minGap;

  if (available <= 0) {
    const pad = Math.max(0, width - visLeft);
    return base + stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(pad) + CLEAR_TO_EOL + RESET_ALL;
  }

  const clippedRight = visRight > available
    ? truncateVisible(right, available)
    : right;
  const clippedRightVis = getVisibleLength(clippedRight);
  const gap = Math.max(0, width - visLeft - clippedRightVis);
  const line = stabilizeBoxAnsi(left, bg, fg) + ' '.repeat(gap) + stabilizeBoxAnsi(clippedRight, bg, fg);

  return base + line + CLEAR_TO_EOL + RESET_ALL;
}
