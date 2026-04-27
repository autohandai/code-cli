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

const COLLAPSE_LINE_THRESHOLD = 15;
const COLLAPSE_CHAR_THRESHOLD = 1500;
const TRUNCATE_LINE_MIN = 5;
const BYTE_SIZE_THRESHOLD = 1024;

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

/**
 * UserMessage displays a user's prompt with a styled background.
 * Similar to how Codex displays user messages with a light gray background.
 *
 * Uses Box width="100%" so Ink/Yoga manages the width correctly across
 * terminal resizes — no manual padding hacks that leave artifacts.
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { colors } = useTheme();

  const lines = children.split('\n');
  const lineCount = lines.length;
  const charCount = children.length;
  const byteSize = Buffer.byteLength(children, 'utf8');

  const shouldCollapse = lineCount > COLLAPSE_LINE_THRESHOLD || charCount > COLLAPSE_CHAR_THRESHOLD;
  const shouldTruncate = !shouldCollapse && lineCount > TRUNCATE_LINE_MIN && lineCount <= COLLAPSE_LINE_THRESHOLD;

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

    return (
      <Box
        marginTop={1}
        paddingX={1}
        width="100%"
        flexDirection="column"
      >
        <Text
          color={colors.userMessageBg || '#333333'}
          backgroundColor={colors.userMessageText || '#ffffff'}
          bold
        >
          {isQueued ? '(queued) ' : ''}{parts.join(' · ')}
        </Text>
      </Box>
    );
  }

  if (shouldTruncate) {
    const displayText = lines.slice(0, TRUNCATE_LINE_MIN).join('\n') + '\n...';

    return (
      <Box
        marginTop={1}
        paddingX={1}
        width="100%"
      >
        <Text
          color={colors.userMessageBg || '#333333'}
          backgroundColor={colors.userMessageText || '#ffffff'}
          bold
        >
          {isQueued ? '(queued) ' : ''}{displayText}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      marginTop={1}
      paddingX={1}
      width="100%"
    >
      <Text
        color={colors.userMessageBg || '#333333'}
        backgroundColor={colors.userMessageText || '#ffffff'}
        bold
      >
        {isQueued ? '(queued) ' : ''}{children}
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
