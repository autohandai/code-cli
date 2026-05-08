/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from '../theme/ThemeContext.js';

export interface UserMessageProps {
  /** The message text to display */
  children: string;
  /** Whether this is a queued message (not yet processed) */
  isQueued?: boolean;
}

const COLLAPSE_LINE_THRESHOLD = 15;
const COLLAPSE_CHAR_THRESHOLD = 1500;
const TRUNCATE_LINE_MIN = 5;
const BYTE_SIZE_THRESHOLD = 1024;
const DEFAULT_MESSAGE_WIDTH = 80;
const MIN_MESSAGE_WIDTH = 20;

type ContentType = 'Code block' | 'JSON' | 'Stack trace' | 'Log output' | 'Diff' | 'Text';

function detectContentType(text: string): ContentType {
  if (/^```/m.test(text) || /```[\s\S]*?```/.test(text)) return 'Code block';
  try {
    const trimmed = text.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      JSON.parse(trimmed);
      return 'JSON';
    }
  } catch {}
  if (/^Error:.*\n\s+at\s/m.test(text) || /at\s+\w+\s*\(/.test(text)) return 'Stack trace';
  if (/^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/m.test(text)) return 'Log output';
  if (/^diff --git/m.test(text) || /^(---\s+a\/|\+\+\+\s+b\/)/m.test(text)) return 'Diff';
  return 'Text';
}

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function wrapVisibleLine(line: string, width: number): string[] {
  if (line.length === 0) {
    return [''];
  }

  const rows: string[] = [];
  let current = '';
  let currentWidth = 0;

  for (const char of Array.from(line)) {
    const charWidth = stringWidth(char);
    if (current && currentWidth + charWidth > width) {
      rows.push(current);
      current = char;
      currentWidth = charWidth;
      continue;
    }

    current += char;
    currentWidth += charWidth;
  }

  rows.push(current);
  return rows;
}

function buildStyledRows(text: string, width: number): string[] {
  const rowWidth = Math.max(MIN_MESSAGE_WIDTH, width);
  const innerWidth = Math.max(1, rowWidth - 2);
  const verticalPaddingRow = ' '.repeat(rowWidth);

  const contentRows = text
    .split('\n')
    .flatMap((line) => wrapVisibleLine(line, innerWidth))
    .map((line) => {
      const padding = Math.max(0, innerWidth - stringWidth(line));
      return ` ${line}${' '.repeat(padding)} `;
    });

  return [verticalPaddingRow, ...contentRows, verticalPaddingRow];
}

/**
 * UserMessage displays a user's prompt with a styled background.
 * Similar to how Codex displays user messages with a light gray background.
 *
 * Emits explicit themed ANSI rows so the gray background includes the
 * surrounding cells, not only the message glyphs.
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { theme } = useTheme();
  const { stdout } = useStdout();

  const lines = children.split('\n');
  const lineCount = lines.length;
  const charCount = children.length;
  const byteSize = Buffer.byteLength(children, 'utf8');
  const width = stdout.columns ?? DEFAULT_MESSAGE_WIDTH;

  const shouldCollapse = lineCount > COLLAPSE_LINE_THRESHOLD || charCount > COLLAPSE_CHAR_THRESHOLD;
  const shouldTruncate = !shouldCollapse && lineCount > TRUNCATE_LINE_MIN && lineCount <= COLLAPSE_LINE_THRESHOLD;
  const renderMessage = (text: string) => (
    <Box
      marginTop={1}
      width="100%"
      flexDirection="column"
    >
      {buildStyledRows(text, width).map((row, index) => (
        <Text key={index}>
          {theme.bold(theme.fgBg('userMessageText', 'userMessageBg', row))}
        </Text>
      ))}
    </Box>
  );

  if (shouldCollapse) {
    const contentType = detectContentType(children);
    const parts: string[] = [contentType];
    if (lineCount > COLLAPSE_LINE_THRESHOLD) {
      parts.push(`${lineCount} lines`);
    }
    parts.push('collapsed for readability');
    if (byteSize >= BYTE_SIZE_THRESHOLD) {
      parts.push(formatByteSize(byteSize));
    }

    return renderMessage(`${isQueued ? '(queued) ' : ''}${parts.join(' · ')}`);
  }

  if (shouldTruncate) {
    const displayText = lines.slice(0, TRUNCATE_LINE_MIN).join('\n') + '\n...';

    return renderMessage(`${isQueued ? '(queued) ' : ''}${displayText}`);
  }

  return renderMessage(`${isQueued ? '(queued) ' : ''}${children}`);
}

/**
 * Memoized UserMessage - only re-renders when content changes
 */
export const UserMessage = memo(UserMessageComponent, (prev, next) => {
  return prev.children === next.children && prev.isQueued === next.isQueued;
});
