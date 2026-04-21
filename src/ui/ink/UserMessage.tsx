/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface UserMessageProps {
  /** The message text to display */
  children: string;
  /** Whether this is a queued message (not yet processed) */
  isQueued?: boolean;
}

/** Maximum number of lines to show before collapsing */
const MAX_DISPLAY_LINES = 5;

/**
 * UserMessage displays a user's prompt with a styled background.
 * Similar to how Codex displays user messages with a light gray background.
 *
 * Features:
 * - Full-width background using space padding
 * - Compacts long messages to max 5 lines with "..." indicator
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { colors } = useTheme();
  const { stdout } = useStdout();

  const terminalWidth = stdout?.columns ?? 80;

  // Process message: wrap to terminal width and limit to max lines
  const displayLines = useMemo(() => {
    const prefix = isQueued ? '(queued) ' : '';
    const fullText = `${prefix}${children}`;

    // Approximate characters per line (account for padding)
    const charsPerLine = Math.max(1, terminalWidth - 2);

    // Split into lines (respect existing newlines)
    const existingLines = fullText.split('\n');
    const wrappedLines: string[] = [];

    for (const line of existingLines) {
      if (line.length <= charsPerLine) {
        wrappedLines.push(line);
      } else {
        // Wrap long lines
        for (let i = 0; i < line.length; i += charsPerLine) {
          wrappedLines.push(line.slice(i, i + charsPerLine));
        }
      }
    }

    // Limit to max lines
    if (wrappedLines.length > MAX_DISPLAY_LINES) {
      const truncated = wrappedLines.slice(0, MAX_DISPLAY_LINES);
      // Add indicator to last line
      const lastLine = truncated[MAX_DISPLAY_LINES - 1];
      const indicator = ' ...';
      const available = charsPerLine - indicator.length;
      truncated[MAX_DISPLAY_LINES - 1] = lastLine.slice(0, available) + indicator;
      return truncated;
    }

    return wrappedLines;
  }, [children, isQueued, terminalWidth]);

  return (
    <Box marginTop={1} flexDirection="column">
      {displayLines.map((line, idx) => (
        <Text
          key={idx}
          color={colors.userMessageText || '#f5f5f5'}
          backgroundColor={colors.userMessageBg || '#757575'}
          bold
        >
          {line.padEnd(terminalWidth - 1)}
        </Text>
      ))}
    </Box>
  );
}

/**
 * Memoized UserMessage - only re-renders when content changes
 */
export const UserMessage = memo(UserMessageComponent, (prev, next) => {
  return prev.children === next.children && prev.isQueued === next.isQueued;
});