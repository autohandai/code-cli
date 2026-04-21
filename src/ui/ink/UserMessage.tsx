/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface UserMessageProps {
  /** The message text to display */
  children: string;
  /** Whether this is a queued message (not yet processed) */
  isQueued?: boolean;
}

/**
 * UserMessage displays a user's prompt with a styled background.
 * Similar to how Codex displays user messages with a light gray background.
 * Uses inverse colors to create a visible background effect across the full width.
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { colors } = useTheme();
  const { stdout } = useStdout();
  
  // Truncate long messages for display
  const displayText = children.length > 200 
    ? children.slice(0, 197) + '...' 
    : children;

  // Get terminal width and pad text to fill full width
  // This ensures the background color spans the entire terminal width
  const terminalWidth = stdout?.columns ?? 80;
  const prefix = isQueued ? '(queued) ' : '';
  const fullText = ` ${prefix}${displayText}`;
  // Pad with spaces to fill the terminal width (minus 1 for safety)
  const paddedText = fullText.padEnd(terminalWidth - 1);

  // Use inverse styling to create a visible background effect
  // This swaps foreground and background colors for better visibility
  return (
    <Box marginTop={1}>
      <Text 
        color={colors.userMessageBg || '#333333'}
        backgroundColor={colors.userMessageText || '#ffffff'}
        bold
      >
        {paddedText}
      </Text>
    </Box>
  );
}

/**
 * Memoized UserMessage - only re-renders when content changes
 */
export const UserMessage = memo(UserMessageComponent, (prev, next) => {
  return prev.children === next.children && prev.isQueued === next.isQueued;
});