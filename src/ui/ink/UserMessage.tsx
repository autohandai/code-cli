/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
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
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { colors } = useTheme();
  
  // Truncate long messages for display
  const displayText = children.length > 200 
    ? children.slice(0, 197) + '...' 
    : children;

  return (
    <Box 
      marginTop={1}
      paddingX={1}
      width="100%"
    >
      <Text 
        backgroundColor={colors.userMessageBg || '#333333'}
        color={colors.userMessageText || '#ffffff'}
      >
        {isQueued ? '(queued) ' : ''}{displayText}
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