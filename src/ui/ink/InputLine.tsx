/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useEffect, useRef } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState, getPromptBlockWidth } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { getContentDisplay } from '../displayUtils.js';
import { CURSOR, moveTo, calculateSingleLineCursor } from '../cursorPositioning.js';

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
function estimateInputRow(stdout: NodeJS.WriteStream, lineCount: number): number {
  const terminalHeight = stdout.rows || 24;
  // Input box: top border + content lines + bottom border
  // Plus margin (1) and status line above
  const inputBoxHeight = 2 + lineCount; // borders + content
  return Math.max(1, terminalHeight - inputBoxHeight - 1);
}

export interface InputLineProps {
  value: string;
  cursorOffset: number;
  isActive: boolean;
}

function InputLineComponent({ value, cursorOffset, isActive }: InputLineProps) {
  const { colors } = useTheme();
  const stdout = useStdout();
  const width = getPromptBlockWidth(process.stdout.columns);
  const topBorder = drawInkBorder(width, 'top');
  const bottomBorder = drawInkBorder(width, 'bottom');
  const displayValue = getContentDisplay(value).visual;
  const displayCursorOffset = Math.min(cursorOffset, displayValue.length);
  const { lines, cursorRow, cursorColumn } = buildMultiLineRenderState(displayValue, displayCursorOffset, width);
  const plainLines = lines.map((line) => stripAnsiCodes(line));
  
  // Track last cursor position to avoid unnecessary updates
  const lastCursorRef = useRef<{ row: number; col: number } | null>(null);

  // Position hardware cursor for IME support after render
  useEffect(() => {
    if (!isActive || !stdout) {
      return;
    }

    // Calculate the screen position of the cursor
    // cursorRow is 0-based within the input box content
    // cursorColumn is the screen column (includes border offset)
    const inputStartRow = estimateInputRow(stdout, plainLines.length);
    // Row: input start + top border (1) + cursor row within content
    const row = inputStartRow + 1 + cursorRow;
    // Column is already the screen column from buildMultiLineRenderState
    const col = cursorColumn + 1; // Convert 0-based to 1-based

    // Only update if position changed
    if (
      lastCursorRef.current?.row !== row ||
      lastCursorRef.current?.col !== col
    ) {
      lastCursorRef.current = { row, col };
    }

    // Position cursor after Ink's render cycle
    const timer = setTimeout(() => {
      if (isActive && stdout) {
        stdout.write(moveTo(row, col) + CURSOR.SHOW);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [isActive, stdout, cursorRow, cursorColumn, plainLines.length]);

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
      <Text>{topBorder}</Text>
      {plainLines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
      <Text>{bottomBorder}</Text>
    </Box>
  );
}

/**
 * Memoized InputLine - prevents unnecessary re-renders
 */
export const InputLine = memo(InputLineComponent, (prev, next) => {
  return (
    prev.value === next.value &&
    prev.cursorOffset === next.cursorOffset &&
    prev.isActive === next.isActive
  );
});