/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo, useRef } from 'react';
import { Box, Text, useBoxMetrics, useCursor, type DOMElement } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildMultiLineRenderState } from '../inputPrompt.js';
import { stripAnsiCodes } from '../displayUtils.js';
import type { InputBorderStyle } from '../box.js';

function drawInkRule(width: number): string {
  return '─'.repeat(Math.max(0, width));
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
  /** Whether the terminal hardware cursor should be moved into the composer. */
  enableHardwareCursor?: boolean;
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
  enableHardwareCursor = true,
}: InputLineProps) {
  const { theme } = useTheme();
  const rootRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(rootRef);
  const { setCursorPosition } = useCursor();

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

  setCursorPosition(
    resolveInputLineCursorPosition(
      isActive && enableHardwareCursor && metrics.hasMeasured,
      metrics,
      displayData
    )
  );

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
      <Box ref={rootRef} marginTop={1} height={3}>
        <Text>{theme.fg('dim', ' ')}</Text>
      </Box>
    );
  }

  // Active state mirrors the open prompt style from readline mode.
  return (
    <Box ref={rootRef} flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
      {displayData.plainLines.map(renderContentLine)}
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
    </Box>
  );
}

export const InputLine = InputLineComponent;
