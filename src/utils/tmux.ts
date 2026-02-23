/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'node:crypto';

export function isTmuxEnabled(value: boolean | undefined): value is true {
  return value === true;
}

export function stripTmuxArgs(argv: string[]): string[] {
  const out: string[] = [];

  for (const arg of argv) {
    if (arg === '--tmux') {
      continue;
    }
    out.push(arg);
  }

  return out;
}

export function createTmuxSessionName(prefix = 'autohand'): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(2).toString('hex');
  return `${prefix}-${stamp}-${rand}`;
}

function shellQuote(arg: string): string {
  if (arg.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=,+@%-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildTmuxLaunchCommand(argv: string[]): string {
  const cleaned = stripTmuxArgs(argv);
  const quoted = cleaned.map(shellQuote).join(' ');
  return `AUTOHAND_TMUX_LAUNCHED=1 ${quoted}`;
}
