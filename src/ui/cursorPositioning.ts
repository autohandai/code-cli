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

import type { TextBuffer } from './textBuffer.js';

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
 * Calculate the visual cursor position for IME support.
 *
 * This computes where the hardware cursor should be placed based on:
 * - The text buffer's cursor position (row, col)
 * - The input box's position on screen
 * - Word wrapping and line breaks
 *
 * @param buffer The text buffer containing cursor position
 * @param inputBoxStartRow The row where the input box starts (1-based)
 * @param inputBoxStartCol The column where the input box content starts (1-based)
 * @param viewportWidth The width of the input area for wrapping
 * @returns The (row, col) position for the hardware cursor (1-based)
 */
export function calculateIMECursor(
  buffer: TextBuffer,
  inputBoxStartRow: number,
  inputBoxStartCol: number,
  _viewportWidth: number
): { row: number; col: number } {
  // Get visual cursor position (accounts for word wrapping)
  const [visualRow, visualCol] = buffer.getVisualCursor();
  
  // Calculate absolute position
  // visualRow is 0-based, visualCol is 0-based string index
  const row = inputBoxStartRow + visualRow;
  const col = inputBoxStartCol + visualCol;
  
  return { row, col };
}

/**
 * Generate ANSI sequence to position cursor for IME input.
 *
 * @param buffer The text buffer containing cursor position
 * @param inputBoxStartRow The row where the input box starts (1-based)
 * @param inputBoxStartCol The column where the input box content starts (1-based)
 * @param viewportWidth The width of the input area for wrapping
 * @returns ANSI sequence to position cursor and make it visible
 */
export function positionCursorForIME(
  buffer: TextBuffer,
  inputBoxStartRow: number,
  inputBoxStartCol: number,
  viewportWidth: number
): string {
  const { row, col } = calculateIMECursor(
    buffer,
    inputBoxStartRow,
    inputBoxStartCol,
    viewportWidth
  );
  
  // Position cursor and ensure it's visible
  return moveTo(row, col) + CURSOR.SHOW;
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

/**
 * Hook-compatible function to get cursor position for IME.
 *
 * This is designed to be called from a React component's render or useEffect
 * to position the cursor after the component renders.
 *
 * @param stdout The process.stdout stream
 * @param buffer The text buffer
 * @param inputBoxStartRow The row where the input box starts
 * @param inputBoxStartCol The column where input content starts
 * @param viewportWidth The width of the input area
 */
export function writeIMECursor(
  stdout: NodeJS.WriteStream,
  buffer: TextBuffer,
  inputBoxStartRow: number,
  inputBoxStartCol: number,
  viewportWidth: number
): void {
  const sequence = positionCursorForIME(
    buffer,
    inputBoxStartRow,
    inputBoxStartCol,
    viewportWidth
  );
  stdout.write(sequence);
}

/**
 * Make cursor visible and position it for input.
 * Call this when input focus is gained.
 */
export function showCursorForInput(stdout: NodeJS.WriteStream): void {
  stdout.write(CURSOR.SHOW);
}

/**
 * Hide cursor (typically during non-input rendering).
 * Call this when rendering output that shouldn't show a cursor.
 */
export function hideCursorForOutput(stdout: NodeJS.WriteStream): void {
  stdout.write(CURSOR.HIDE);
}