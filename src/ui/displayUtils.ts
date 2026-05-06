/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Display utilities for smart content rendering
 */

/**
 * Matches ANSI escape sequences commonly emitted by shells, PTYs, and CLIs.
 * Includes CSI control codes (colors, cursor movement, line clearing) and OSC
 * sequences (window title, hyperlinks) terminated by BEL or ST.
 */
const ANSI_PATTERN = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]/g;

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
  /** Total Unicode code points in content */
  charCount: number;
}

const PASTE_LINE_THRESHOLD = 5;
const PASTE_CHAR_THRESHOLD = 1500;

/**
 * Determine how to display content based on size.
 * Shows compact indicator for large pastes that are either:
 * - multi-line with at least `PASTE_LINE_THRESHOLD` lines
 * - or very long single-line content with `PASTE_CHAR_THRESHOLD` or more chars
 */
export function getContentDisplay(text: string): ContentDisplay {
  const charCount = Array.from(text).length;

  if (!text) {
    return {
      visual: '',
      actual: '',
      isPasted: false,
      lineCount: 1,
      charCount,
    };
  }

  const lines = text.split('\n');
  const lineCount = lines.length;

  if (lineCount >= PASTE_LINE_THRESHOLD || charCount >= PASTE_CHAR_THRESHOLD) {
    return {
      visual: `[Text pasted ${charCount} chars]`,
      actual: text,
      isPasted: true,
      lineCount,
      charCount,
    };
  }

  return {
    visual: text,
    actual: text,
    isPasted: false,
    lineCount,
    charCount,
  };
}
