/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useEffect, useRef, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { getContentDisplay } from '../displayUtils.js';
import { CURSOR, moveTo } from '../cursorPositioning.js';

function drawInkBorder(width: number, position: 'top' | 'bottom'): string {
  const innerWidth = Math.max(0, width - 2);
  return position === 'top'
    ? `┌${'─'.repeat(innerWidth)}┐`
    : `└${'─'.repeat(innerWidth)}┘`;
}

/**
 * Calculate the screen row for the input box.
 * This estimates where the input appears on screen for IME cursor positioning.
 */
function estimateInputRow(lineCount: number): number {
  const terminalHeight = process.stdout.rows || 24;
  // Input box: top border + content lines + bottom border
  // Plus margin (1) and status line above
  const inputBoxHeight = 2 + lineCount; // borders + content
  return Math.max(1, terminalHeight - inputBoxHeight - 1);
}

export interface InputLineProps {
  value: string;
  cursorOffset: number;
  isActive: boolean;
  /** Terminal width - passed from parent to avoid useStdout re-renders */
  width: number;
}

function InputLineComponent({ value, cursorOffset, isActive, width }: InputLineProps) {
  const { colors } = useTheme();
  
  // Memoize borders - only recalculate when width changes
  const borders = useMemo(() => ({
    top: drawInkBorder(width, 'top'),
    bottom: drawInkBorder(width, 'bottom'),
  }), [width]);
  
  // Memoize display value processing
  const displayData = useMemo(() => {
    const displayValue = getContentDisplay(value).visual;
    const displayCursorOffset = Math.min(cursorOffset, displayValue.length);
    const { lines, cursorRow, cursorColumn } = buildMultiLineRenderState(
      displayValue,
      displayCursorOffset,
      width
    );
    return {
      plainLines: lines.map((line) => stripAnsiCodes(line)),
      cursorRow,
      cursorColumn,
    };
  }, [value, cursorOffset, width]);
  
  // Track last cursor position to avoid unnecessary updates
  const lastCursorRef = useRef<{ row: number; col: number } | null>(null);

  // Position hardware cursor for IME support after render
  useEffect(() => {
    if (!isActive) {
      return;
    }

    // Calculate the screen position of the cursor
    const inputStartRow = estimateInputRow(displayData.plainLines.length);
    const row = inputStartRow + 1 + displayData.cursorRow;
    const col = displayData.cursorColumn + 1;

    // Only update if position changed
    if (
      lastCursorRef.current?.row !== row ||
      lastCursorRef.current?.col !== col
    ) {
      lastCursorRef.current = { row, col };
    }

    // Position cursor after Ink's render cycle
    const timer = setTimeout(() => {
      if (isActive) {
        process.stdout.write(moveTo(row, col) + CURSOR.SHOW);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [isActive, displayData.cursorRow, displayData.cursorColumn, displayData.plainLines.length]);

  // Keep space stable when queue input is inactive.
  if (!isActive) {
    return (
      <Box marginTop={1} height={3}>
        <Text color={colors.dim}> </Text>
      </Box>
    );
  }

  // Active state mirrors the boxed prompt style from readline mode.
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>{borders.top}</Text>
      {displayData.plainLines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
      <Text>{borders.bottom}</Text>
    </Box>
  );
}

/**
 * Memoized InputLine - prevents unnecessary re-renders
 * Only re-renders when value, cursorOffset, isActive, or width changes
 */
export const InputLine = memo(InputLineComponent, (prev, next) => {
  return (
    prev.value === next.value &&
    prev.cursorOffset === next.cursorOffset &&
    prev.isActive === next.isActive &&
    prev.width === next.width
  );
});