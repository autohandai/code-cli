/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

const DEFAULT_BORDER_COLOR = '#8a8a8a';

function themedFg(token: ColorToken, text: string, fallback: (value: string) => string): string {
  if (!isThemeInitialized()) {
    return fallback(text);
  }

  try {
    return getTheme().fg(token, text);
  } catch {
    return fallback(text);
  }
}

export function drawInputTopBorder(width: number): string {
  const innerWidth = Math.max(0, width - 2);
  return themedFg(
    'borderAccent',
    `┌${'─'.repeat(innerWidth)}┐`,
    (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value)
  );
}

export function drawInputBottomBorder(width: number): string {
  const innerWidth = Math.max(0, width - 2);
  return themedFg(
    'borderAccent',
    `└${'─'.repeat(innerWidth)}┘`,
    (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value)
  );
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

export function drawInputBox(prompt: string, width: number): string {
  const innerWidth = Math.max(0, width - 2);
  const truncated = truncateVisible(prompt, innerWidth);
  const paddingSize = Math.max(0, innerWidth - getVisibleLength(truncated));
  const content = `${truncated}${' '.repeat(paddingSize)}`;
  const leftBorder = themedFg('border', '│', (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value));
  const rightBorder = themedFg('border', '│', (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value));
  return `${leftBorder}${content}${rightBorder}`;
}
