/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

export function drawInputBox(prompt: string, width: number): string {
  const padded = prompt.padEnd(width, ' ');
  return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(padded);
}
