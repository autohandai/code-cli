/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import type { InputBorderStyle } from '../box.js';

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
  /** Terminal width - passed from parent to avoid useStdout re-renders */
  width: number;
  /** Border style - mirrors readline/terminal regions behavior */
  borderStyle?: InputBorderStyle;
}

function InputLineComponent({ value, cursorOffset, isActive, width, borderStyle = 'default' }: InputLineProps) {
  const { theme } = useTheme();

  const borderToken = borderStyle === 'plan'
    ? 'warning'
    : borderStyle === 'shell'
      ? 'dim'
      : 'borderAccent';

  // Memoize borders - only recalculate when width changes
  const borders = useMemo(() => ({
    top: drawInkBorder(width, 'top'),
    bottom: drawInkBorder(width, 'bottom'),
  }), [width]);

  // Memoize display value processing
  const displayData = useMemo(() => {
    const displayValue = value;
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

  // Keep space stable when queue input is inactive.
  if (!isActive) {
    return (
      <Box marginTop={1} height={3}>
        <Text>{theme.fg('dim', ' ')}</Text>
      </Box>
    );
  }

  // Active state mirrors the boxed prompt style from readline mode.
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', borders.top)}</Text>
      {displayData.plainLines.map((line, index) => (
        <Text key={index}>{theme.fgBg('userMessageText', 'userMessageBg', line)}</Text>
      ))}
      <Text>{theme.fgBg(borderToken, 'userMessageBg', borders.bottom)}</Text>
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
    prev.width === next.width &&
    prev.borderStyle === next.borderStyle
  );
});
