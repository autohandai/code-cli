/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import { getTheme, isThemeInitialized } from '../ui/theme/Theme.js';
import type { ColorToken } from '../ui/theme/types.js';

type Styler = (text: string) => string;

export interface CommandTheme {
  accent: Styler;
  muted: Styler;
  text: Styler;
  success: Styler;
  warning: Styler;
  error: Styler;
  bold: Styler;
  heading: Styler;
  link: Styler;
  tab: Styler;
  selectedTab: Styler;
  progressFilled: Styler;
  progressEmpty: Styler;
}

export function createCommandTheme(): CommandTheme {
  const theme = isThemeInitialized() ? getTheme() : null;

  const fg = (token: ColorToken, fallback: Styler): Styler => {
    return (value: string) => theme ? theme.fg(token, value) : fallback(value);
  };

  const accent = fg('accent', chalk.cyan);
  const muted = fg('muted', chalk.gray);
  const text = fg('text', chalk.white);
  const success = fg('success', chalk.green);
  const warning = fg('warning', chalk.yellow);
  const error = fg('error', chalk.red);
  const bold: Styler = (value) => theme ? theme.bold(value) : chalk.bold(value);

  return {
    accent,
    muted,
    text,
    success,
    warning,
    error,
    bold,
    heading: (value) => bold(accent(value)),
    link: (value) => theme ? theme.underline(accent(value)) : chalk.cyan.underline(value),
    tab: (value) => muted(` ${value} `),
    selectedTab: (value) => theme
      ? theme.fgBg('userMessageText', 'accent', ` ${value} `)
      : chalk.bgWhite.black(` ${value} `),
    progressFilled: accent,
    progressEmpty: muted,
  };
}
