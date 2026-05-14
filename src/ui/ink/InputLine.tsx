/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useCursor, type DOMElement } from 'ink';
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

function getAbsoluteInkPosition(
  node: DOMElement | null
): { left: number; top: number } | null {
  if (!node) {
    return null;
  }

  let left = 0;
  let top = 0;
  let current: DOMElement | undefined = node;

  while (current && current.nodeName !== 'ink-root') {
    const layout = current.yogaNode?.getComputedLayout();
    left += layout?.left ?? 0;
    top += layout?.top ?? 0;
    current = current.parentNode;
  }

  return { left, top };
}

function renderHardwareCursorFallback(line: string, cursorColumn: number): string {
  if (cursorColumn < 0 || cursorColumn >= line.length) {
    return line;
  }

  // Some terminals let Ink hide the hardware cursor after redraws, so keep a
  // visible cursor cell without dropping the character at the cursor offset.
  const rightBorder = line.slice(-1);
  const beforeRightBorder = line.slice(0, -1);
  const shiftedContent = beforeRightBorder.slice(
    cursorColumn,
    Math.max(cursorColumn, beforeRightBorder.length - 1)
  );

  return `${beforeRightBorder.slice(0, cursorColumn)}█${shiftedContent}${rightBorder}`;
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
  const rootRef = useRef<DOMElement>(null);
  const { setCursorPosition } = useCursor();
  const [cursorVisible, setCursorVisible] = useState(true);

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

  useEffect(() => {
    if (!isActive) {
      setCursorVisible(true);
      return;
    }

    const timer = setInterval(() => {
      setCursorVisible((visible) => !visible);
    }, 530);

    return () => {
      clearInterval(timer);
    };
  }, [isActive]);

  useEffect(() => {
    setCursorVisible(true);
  }, [value, cursorOffset]);

  const cursorPosition = (() => {
    if (!isActive) {
      return undefined;
    }

    const position = getAbsoluteInkPosition(rootRef.current);
    return {
      x: (position?.left ?? 0) + displayData.cursorColumn,
      y: (position?.top ?? 0) + displayData.cursorRow + 1,
    };
  })();

  setCursorPosition(cursorPosition);

  const renderedLines = useMemo(() => {
    if (!isActive || !cursorVisible) {
      return displayData.plainLines;
    }

    return displayData.plainLines.map((line, index) => (
      index === displayData.cursorRow
        ? renderHardwareCursorFallback(line, displayData.cursorColumn)
        : line
    ));
  }, [cursorVisible, displayData.cursorColumn, displayData.cursorRow, displayData.plainLines, isActive]);

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

  // Active state mirrors the boxed prompt style from readline mode.
  return (
    <Box ref={rootRef} flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', borders.top)}</Text>
      {renderedLines.map(renderContentLine)}
      <Text>{theme.fgBg(borderToken, 'userMessageBg', borders.bottom)}</Text>
    </Box>
  );
}

export const InputLine = InputLineComponent;
