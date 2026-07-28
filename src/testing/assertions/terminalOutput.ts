/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function hasTerminalProcessPid(screen: string, pid: number): boolean {
  return new RegExp(`\\bpid\\s+${pid}(?!\\d)`, 'u').test(screen);
}
