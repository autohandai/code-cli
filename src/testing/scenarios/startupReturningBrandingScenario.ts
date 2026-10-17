/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Session } from 'tuistory';
import stripAnsi from 'strip-ansi';

export function isStartupLogoRow(line: string): boolean {
  return line.trim().length > 0 && /^[ "'(),./08:=OPY\\^_bdopq|~\u2800-\u28ff·•●-]+$/u.test(line);
}

export function returningStartupViewport(session: Session): string {
  const terminal = session.getTerminalData();
  return terminal.lines.slice(-terminal.rows)
    .map((line) => line.spans.map((span) => span.text).join('').trimEnd())
    .join('\n').trimEnd();
}

export function returningStartupLogoRows(output: string): string[] {
  return stripAnsi(output).split('\n').map((line) => line.trimEnd())
    .filter(isStartupLogoRow);
}
