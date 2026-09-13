/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cursor positioning utilities for IME (Input Method Editor) support.
 *
 * For IME to work correctly, the terminal's hardware cursor must be positioned
 * at the actual input location. This allows the IME candidate window to appear
 * at the correct position relative to the text being composed.
 *
 * This module provides utilities for:
 * - Calculating cursor position from text buffer state
 * - Outputting cursor positioning sequences
 * - Managing cursor visibility during input
 */

// ANSI escape sequences for cursor control
export const CURSOR = {
  /** Show cursor */
  SHOW: '\x1b[?25h',
  /** Hide cursor */
  HIDE: '\x1b[?25l',
  /** Save cursor position */
  SAVE: '\x1b[s',
  /** Restore cursor position */
  RESTORE: '\x1b[u',
  /** Query cursor position (response: ESC [ row ; col R) */
  QUERY: '\x1b[6n',
  /** Enable cursor blinking */
  ENABLE_BLINK: '\x1b[?12h',
  /** Disable cursor blinking */
  DISABLE_BLINK: '\x1b[?12l',
} as const;

/**
 * Move cursor to absolute position (1-based).
 * @param row Row number (1-based)
 * @param col Column number (1-based)
 * @returns ANSI sequence to move cursor
 */
export function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/**
 * Move cursor up by N rows.
 */
export function moveUp(rows: number = 1): string {
  return rows > 0 ? `\x1b[${rows}A` : '';
}

/**
 * Move cursor down by N rows.
 */
export function moveDown(rows: number = 1): string {
  return rows > 0 ? `\x1b[${rows}B` : '';
}

/**
 * Move cursor forward (right) by N columns.
 */
export function moveForward(cols: number = 1): string {
  return cols > 0 ? `\x1b[${cols}C` : '';
}

/**
 * Move cursor backward (left) by N columns.
 */
export function moveBackward(cols: number = 1): string {
  return cols > 0 ? `\x1b[${cols}D` : '';
}

/**
 * Calculate cursor position for a single-line input.
 *
 * For single-line inputs (like the InputLine component), this calculates
 * the cursor position based on the cursor offset within the text.
 *
 * @param text The input text
 * @param cursorOffset The cursor position within the text (0-based)
 * @param startRow The row where the input starts (1-based)
 * @param startCol The column where the input content starts (1-based)
 * @param maxWidth Maximum width for wrapping (optional)
 * @returns The (row, col) position for the hardware cursor (1-based)
 */
export function calculateSingleLineCursor(
  text: string,
  cursorOffset: number,
  startRow: number,
  startCol: number,
  maxWidth?: number
): { row: number; col: number } {
  if (!maxWidth) {
    // No wrapping - simple calculation
    return {
      row: startRow,
      col: startCol + cursorOffset,
    };
  }
  
  // Account for wrapping
  const effectiveWidth = maxWidth - startCol + 1;
  const wrappedRows = Math.floor(cursorOffset / effectiveWidth);
  const wrappedCol = cursorOffset % effectiveWidth;
  
  return {
    row: startRow + wrappedRows,
    col: startCol + wrappedCol,
  };
}