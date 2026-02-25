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
  const innerWidth = Math.max(0, width - 2);
  let content = '';

  if (!right) {
    const clippedLeft = truncateVisible(left, innerWidth);
    const paddingSize = Math.max(0, innerWidth - getVisibleLength(clippedLeft));
    content = `${clippedLeft}${' '.repeat(paddingSize)}`;
  } else {
    const minGap = 2;
    const visLeft = getVisibleLength(left);
    const visRight = getVisibleLength(right);
    const availableForLeft = Math.max(0, innerWidth - minGap);

    let clippedLeft = visLeft > availableForLeft
      ? truncateVisible(left, availableForLeft)
      : left;
    let clippedLeftVis = getVisibleLength(clippedLeft);
    let availableForRight = innerWidth - clippedLeftVis - minGap;

    if (availableForRight < 0) {
      clippedLeft = truncateVisible(clippedLeft, Math.max(0, innerWidth));
      clippedLeftVis = getVisibleLength(clippedLeft);
      availableForRight = 0;
    }

    const clippedRight = visRight > availableForRight
      ? truncateVisible(right, Math.max(0, availableForRight))
      : right;
    const clippedRightVis = getVisibleLength(clippedRight);
    const gap = Math.max(0, innerWidth - clippedLeftVis - clippedRightVis);
    content = `${clippedLeft}${' '.repeat(gap)}${clippedRight}`;

    const visibleContent = getVisibleLength(content);
    if (visibleContent < innerWidth) {
      content += ' '.repeat(innerWidth - visibleContent);
    }
  }

  const leftBorder = themedFg('border', '│', (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value));
  const rightBorder = themedFg('border', '│', (value) => chalk.hex(DEFAULT_BORDER_COLOR)(value));
  return `${leftBorder}${content}${rightBorder}`;
}
