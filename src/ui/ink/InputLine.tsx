/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useLayoutEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import type { InputBorderStyle } from '../box.js';

function drawInkRule(width: number): string {
  return '─'.repeat(Math.max(0, width));
}

function writeComposerCursorPosition(
  cursorColumn: number,
  cursorRow: number,
  lineCount: number
): number {
  if (process.stdout.isTTY !== true) {
    return 0;
  }

  const terminalColumn = cursorColumn + 1;
  const rowsAfterCursor = Math.max(0, lineCount - 1 - cursorRow + 4);
  const rowMove = rowsAfterCursor > 0 ? `\x1b[${rowsAfterCursor}A` : '';
  process.stdout.write(`${rowMove}\x1b[${terminalColumn}G\x1b[?25h`);
  return rowsAfterCursor;
}

function restoreComposerCursorBaseline(rowsAfterCursor: number): void {
  if (process.stdout.isTTY !== true || rowsAfterCursor <= 0) {
    return;
  }

  process.stdout.write(`\x1b[${rowsAfterCursor}B`);
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

export function resolveInputLineCursorPosition(
  isActive: boolean,
  position: { left: number; top: number } | null,
  cursorData: { cursorRow: number; cursorColumn: number }
): { x: number; y: number } | undefined {
  if (!isActive || !position) {
    return undefined;
  }

  return {
    x: position.left + cursorData.cursorColumn,
    y: position.top + cursorData.cursorRow + 1,
  };
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

  useEffect(() => {
    if (!isActive || process.stdout.isTTY !== true) {
      return undefined;
    }

    process.stdout.write('\x1b[2 q');
    return () => {
      process.stdout.write('\x1b[0 q');
    };
  }, [isActive]);

  const borderToken = borderStyle === 'plan'
    ? 'warning'
    : borderStyle === 'shell'
      ? 'dim'
      : 'borderAccent';

  const rule = useMemo(() => drawInkRule(width), [width]);

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

  useLayoutEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const rowsAfterCursor = writeComposerCursorPosition(
      displayData.cursorColumn,
      displayData.cursorRow,
      displayData.plainLines.length
    );

    return () => {
      restoreComposerCursorBaseline(rowsAfterCursor);
    };
  }, [isActive, displayData.cursorColumn, displayData.cursorRow, displayData.plainLines.length]);

  const renderContentLine = (line: string, index: number) => {
    return (
      <Text key={index}>
        {theme.fgBg('userMessageText', 'userMessageBg', line)}
      </Text>
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

  // Active state mirrors the open prompt style from readline mode.
  return (
    <Box flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
      {displayData.plainLines.map(renderContentLine)}
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
    </Box>
  );
}

export const InputLine = InputLineComponent;
