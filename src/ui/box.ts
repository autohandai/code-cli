/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';

const DEFAULT_BORDER_COLOR = '#8a8a8a';
const PLAN_BORDER_COLOR = '#ff9d3f';
const SHELL_BORDER_COLOR = '#c8c8c8';

export type InputBorderStyle = 'default' | 'plan' | 'shell';

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

function drawBorderText(style: InputBorderStyle, text: string): string {
  return themedFg(
    resolveBorderToken(style),
    text,
    (value) => chalk.hex(resolveBorderFallback(style))(value)
  );
}

export function drawInputTopBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  return drawBorderText(style, `┌${'─'.repeat(innerWidth)}┐`);
}

export function drawInputBottomBorder(width: number, style: InputBorderStyle = 'default'): string {
  const innerWidth = Math.max(0, width - 2);
  return drawBorderText(style, `└${'─'.repeat(innerWidth)}┘`);
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

export function drawInputBox(left: string, width: number, right?: string): string {
  const visLeft = getVisibleLength(left);

  if (!right) {
    const pad = Math.max(0, width - visLeft);
    return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(left + ' '.repeat(pad));
  }

  const visRight = getVisibleLength(right);
  const minGap = 2;
  const available = width - visLeft - minGap;

  if (available <= 0) {
    const pad = Math.max(0, width - visLeft);
    return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(left + ' '.repeat(pad));
  }

  const clippedRight = visRight > available
    ? truncateVisible(right, available)
    : right;
  const clippedRightVis = getVisibleLength(clippedRight);
  const gap = Math.max(0, width - visLeft - clippedRightVis);
  const line = left + ' '.repeat(gap) + clippedRight;

  return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(line);
}
