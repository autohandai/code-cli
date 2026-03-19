/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState, getPromptBlockWidth } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { getContentDisplay } from '../displayUtils.js';

function drawInkBorder(width: number, position: 'top' | 'bottom'): string {
  const innerWidth = Math.max(0, width - 2);
  return position === 'top'
    ? `┌${'─'.repeat(innerWidth)}┐`
    : `└${'─'.repeat(innerWidth)}┘`;
}

export interface InputLineProps {
  value: string;
  cursorOffset: number;
  isActive: boolean;
}

function InputLineComponent({ value, cursorOffset, isActive }: InputLineProps) {
  const { colors } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);
  const topBorder = drawInkBorder(width, 'top');
  const bottomBorder = drawInkBorder(width, 'bottom');
  const displayValue = getContentDisplay(value).visual;
  const displayCursorOffset = Math.min(cursorOffset, displayValue.length);
  const { lines } = buildMultiLineRenderState(displayValue, displayCursorOffset, width);
  const plainLines = lines.map((line) => stripAnsiCodes(line));

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
