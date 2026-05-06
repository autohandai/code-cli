/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Env = Record<string, string | undefined>;
type DebugLineWriter = (message: string) => void;

export function isAutohandDebugEnabled(env: Env = process.env): boolean {
  const value = env.AUTOHAND_DEBUG?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function writeAutohandDebugLine(message: string, writer?: DebugLineWriter): void {
  if (!isAutohandDebugEnabled()) {
    return;
  }

  if (writer) {
    writer(message);
    return;
  }

  const line = message.endsWith('\n') ? message : `${message}\n`;
  process.stderr.write(line);
}
