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
  /** Passive empty-input placeholder text. */
  placeholderText?: string;
  /** Model-generated empty-input next-prompt suggestion. */
  nextPromptSuggestion?: string;
  /** Inline completion suffix shown after the current input. */
  inlineGhostSuffix?: string;
}

function InputLineComponent({
  value,
  cursorOffset,
  isActive,
  width,
  borderStyle = 'default',
  placeholderText,
  nextPromptSuggestion,
  inlineGhostSuffix,
}: InputLineProps) {
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
      width,
      borderStyle,
      {
        placeholderText,
        nextPromptSuggestion,
        inlineGhostSuffix,
      }
    );
    return {
      plainLines: lines.map((line) => stripAnsiCodes(line)),
      cursorRow,
      cursorColumn,
    };
  }, [value, cursorOffset, width, borderStyle, placeholderText, nextPromptSuggestion, inlineGhostSuffix]);

  const renderContentLine = (line: string, index: number) => {
    if (index !== displayData.cursorRow) {
      return (
        <Text key={index}>
          {theme.fgBg('userMessageText', 'userMessageBg', line)}
        </Text>
      );
    }

    const cursorColumn = Math.max(0, Math.min(line.length - 1, displayData.cursorColumn));
    const before = line.slice(0, cursorColumn);
    const cursorChar = line[cursorColumn] ?? ' ';
    const after = line.slice(cursorColumn + 1);

    return (
      <Box key={index}>
        <Text>{theme.fgBg('userMessageText', 'userMessageBg', before)}</Text>
        <Text inverse>{theme.fgBg('userMessageText', 'userMessageBg', cursorChar)}</Text>
        <Text>{theme.fgBg('userMessageText', 'userMessageBg', after)}</Text>
      </Box>
    );
  };

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
    <Box flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', borders.top)}</Text>
      {displayData.plainLines.map(renderContentLine)}
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
    prev.borderStyle === next.borderStyle &&
    prev.placeholderText === next.placeholderText &&
    prev.nextPromptSuggestion === next.nextPromptSuggestion &&
    prev.inlineGhostSuffix === next.inlineGhostSuffix
  );
});
