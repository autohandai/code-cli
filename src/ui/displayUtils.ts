/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Display utilities for smart content rendering
 */

/**
 * Matches all ANSI SGR escape sequences (colors, bold, etc.).
 * Uses the `/g` flag — safe for `.replace()` but stateful with `.test()` / `.exec()`.
 * Prefer `stripAnsiCodes()` for stripping; only import this if you need `.replace()`
 * with a custom replacement string.
 */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Strip all ANSI SGR codes from a string */
export function stripAnsiCodes(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

/**
 * Enable bracketed paste mode — terminal will wrap pasted content
 * in escape sequences so the application can distinguish typed from pasted text.
 */
export function enableBracketedPaste(output: NodeJS.WriteStream): void {
  try {
    output.write('\x1b[?2004h');
  } catch (error) {
    if (process.env.DEBUG_PASTE) {
      output.write(`[DEBUG] Failed to enable bracketed paste: ${error}\n`);
    }
  }
}

/** Disable bracketed paste mode in terminal. */
export function disableBracketedPaste(output: NodeJS.WriteStream): void {
  try {
    output.write('\x1b[?2004l');
  } catch { /* best effort */ }
}

/** Fisher-Yates in-place shuffle of an array. */
export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export interface ContentDisplay {
  /** What to show in UI */
  visual: string;
  /** Full content for LLM */
  actual: string;
  /** Whether indicator was applied */
  isPasted: boolean;
  /** Total lines in content */
  lineCount: number;
}

/**
 * Determine how to display content based on line count.
 * Shows compact indicator for pastes with 5+ lines.
 */
export function getContentDisplay(text: string): ContentDisplay {
  if (!text) {
    return {
      visual: '',
      actual: '',
      isPasted: false,
      lineCount: 1
    };
  }

  const lines = text.split('\n');
  const lineCount = lines.length;

  if (lineCount >= 5) {
    return {
      visual: `[Text pasted: ${lineCount} lines]`,
      actual: text,
      isPasted: true,
      lineCount
    };
  }

  return {
    visual: text,
    actual: text,
    isPasted: false,
    lineCount
  };
}
