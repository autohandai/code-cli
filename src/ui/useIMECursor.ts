/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useIMECursor - Hook for positioning hardware cursor for IME support
 *
 * This hook positions the terminal's hardware cursor at the actual input
 * location after Ink renders. This is essential for IME (Input Method Editor)
 * to display the candidate window at the correct position.
 *
 * Without this, the IME candidate window would appear at the wrong location
 * because Ink hides the cursor during rendering and doesn't restore it to
 * the input position.
 */

import { useEffect, useRef } from 'react';
import { useStdout } from 'ink';
import { CURSOR, moveTo, calculateSingleLineCursor } from './cursorPositioning.js';

export interface IMECursorOptions {
  /** Whether the input is currently active */
  isActive: boolean;
  /** The current input text */
  value: string;
  /** The cursor position within the text (0-based) */
  cursorOffset: number;
  /** The row where the input box starts (1-based, relative to screen) */
  inputStartRow?: number;
  /** The column where the input content starts (1-based) */
  inputStartCol?: number;
  /** Maximum width for wrapping (optional) */
  maxWidth?: number;
}

/**
 * Calculate the screen row for the input box.
 * This is an approximation based on the terminal height and typical layout.
 */
function estimateInputRow(): number {
  // The input is typically at the bottom of the screen
  // We estimate based on the terminal height minus the status line and borders
  const terminalHeight = process.stdout.rows || 24;
  // Reserve space for status line (1) + input box borders (2) + margin (1)
  return Math.max(1, terminalHeight - 4);
}

/**
 * Hook to position the hardware cursor for IME support.
 *
 * This should be used in the input component to ensure the cursor is
 * positioned correctly after each render.
 *
 * @example
 * ```tsx
 * function InputComponent({ value, cursorOffset, isActive }) {
 *   useIMECursor({
 *     isActive,
 *     value,
 *     cursorOffset,
 *   });
 *
 *   return <Text>{value}</Text>;
 * }
 * ```
 */
export function useIMECursor(options: IMECursorOptions): void {
  const {
    isActive,
    value,
    cursorOffset,
    inputStartRow,
    inputStartCol = 2, // Default: after the border character
    maxWidth,
  } = options;

  const stdout = useStdout();
  const lastPositionRef = useRef<{ row: number; col: number } | null>(null);

  useEffect(() => {
    if (!isActive || !stdout) {
      return;
    }

    // Calculate cursor position
    const startRow = inputStartRow ?? estimateInputRow();
    const { row, col } = calculateSingleLineCursor(
      value,
      cursorOffset,
      startRow,
      inputStartCol,
      maxWidth
    );

    // Only update if position changed
    if (
      lastPositionRef.current?.row !== row ||
      lastPositionRef.current?.col !== col
    ) {
      lastPositionRef.current = { row, col };
    }

    // Position cursor and make it visible
    // Use a microtask to ensure this runs after Ink's render
    const timer = setTimeout(() => {
      if (isActive) {
        stdout.write(moveTo(row, col) + CURSOR.SHOW);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [isActive, value, cursorOffset, inputStartRow, inputStartCol, maxWidth, stdout]);

  // Show cursor when component unmounts or becomes inactive
  useEffect(() => {
    return () => {
      if (isActive && stdout) {
        stdout.write(CURSOR.SHOW);
      }
    };
  }, [isActive, stdout]);
}

/**
 * Write cursor position directly to stdout.
 * Use this for imperative cursor positioning outside of React components.
 */
export function positionIMECursor(
  value: string,
  cursorOffset: number,
  options?: {
    inputStartRow?: number;
    inputStartCol?: number;
    maxWidth?: number;
  }
): void {
  const startRow = options?.inputStartRow ?? estimateInputRow();
  const startCol = options?.inputStartCol ?? 2;

  const { row, col } = calculateSingleLineCursor(
    value,
    cursorOffset,
    startRow,
    startCol,
    options?.maxWidth
  );

  process.stdout.write(moveTo(row, col) + CURSOR.SHOW);
}