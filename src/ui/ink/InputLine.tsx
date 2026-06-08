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

function drawInkRule(width: number): string {
  return '─'.repeat(Math.max(0, width));
}

// Sum yoga layout offsets up to ink-root. The returned coordinates are
// relative to Ink's output origin, which is exactly what Ink's `useCursor`
// expects. Ink's renderer moves the hardware cursor relative to the bottom of
// its own output and calls buildReturnToBottom before every eraseLines, so
// frame rewrites stay aligned even when the terminal scrolls.
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
  const rootRef = useRef<DOMElement>(null);
  const [, setLayoutReadyVersion] = useState(0);
  const { setCursorPosition } = useCursor();

  useEffect(() => {
    if (!isActive || process.stdout.isTTY !== true) {
      return undefined;
    }

    process.stdout.write('\x1b[2 q');
    return () => {
      process.stdout.write('\x1b[0 q');
    };
  }, [isActive]);

  useEffect(() => {
    if (isActive && rootRef.current) {
      setLayoutReadyVersion((version) => version + 1);
    }
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

  const cursorPosition = resolveInputLineCursorPosition(
    isActive,
    getAbsoluteInkPosition(rootRef.current),
    displayData
  );

  setCursorPosition(cursorPosition);

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
    <Box ref={rootRef} flexDirection="column">
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
      {displayData.plainLines.map(renderContentLine)}
      <Text>{theme.fgBg(borderToken, 'userMessageBg', rule)}</Text>
    </Box>
  );
}

export const InputLine = InputLineComponent;
