/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

export function drawInputBox(prompt: string, width: number): string {
  const horizontal = chalk.gray('─'.repeat(width));
  const top = chalk.gray(`┌${horizontal}┐`);
  const bottom = chalk.gray(`└${horizontal}┘`);
  const padded = prompt.padEnd(width, ' ');
  return [top, `${chalk.gray('│')}${padded}${chalk.gray('│')}`, bottom].join('\n');
}
