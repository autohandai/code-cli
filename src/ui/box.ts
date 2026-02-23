/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

export function drawInputBox(left: string, width: number, right?: string): string {
  if (!right) {
    const padded = left.padEnd(width, ' ');
    return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(padded);
  }

  const minGap = 2;
  const available = width - left.length - minGap;

  if (available <= 0) {
    const padded = left.padEnd(width, ' ');
    return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(padded);
  }

  const rightText = right.length > available ? right.slice(0, available) : right;
  const gap = width - left.length - rightText.length;
  const line = left + ' '.repeat(Math.max(0, gap)) + rightText;

  return chalk.bgHex('#2b2b2b').hex('#a0a0a0')(line);
}
