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

/** Threshold for treating text as "large pasted content" */
const LARGE_TEXT_LINES_THRESHOLD = 15;
const LARGE_TEXT_CHARS_THRESHOLD = 1500;

/**
 * Format byte size to human readable string
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Detect if text looks like pasted content (code block, log, etc.)
 */
function detectContentType(text: string): string {
  const trimmed = text.trim();
  
  // Check for code blocks
  if (trimmed.startsWith('```') || trimmed.includes('\n```')) {
    return 'Code block';
  }
  
  // Check for JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'JSON';
    } catch {
      // Not valid JSON
    }
  }
  
  // Check for stack trace
  if (trimmed.includes('at ') && trimmed.includes(':') && 
      (trimmed.includes('Error:') || trimmed.includes('Exception:') || 
       trimmed.includes('\n    at '))) {
    return 'Stack trace';
  }
  
  // Check for log output
  const lines = trimmed.split('\n');
  const logPattern = /^\d{4}-\d{2}-\d{2}|^\[\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}:\d{2}|^\[INFO\]|^\[WARN\]|^\[ERROR\]|^\[DEBUG\]/;
  const logLines = lines.filter(l => logPattern.test(l.trim()));
  if (logLines.length > lines.length * 0.5 && lines.length > 3) {
    return 'Log output';
  }
  
  // Check for diff/patch
  if (trimmed.startsWith('diff --git') || 
      (trimmed.includes('\n--- ') && trimmed.includes('\n+++ '))) {
    return 'Diff';
  }
  
  return 'Text';
}

/**
 * UserMessage displays a user's prompt with a styled background.
 * Similar to how Codex displays user messages with a light gray background.
 *
 * Features:
 * - Full-width background using space padding
 * - Compacts long messages to max 5 lines with "..." indicator
 * - Renders large pasted content as a compact bordered box
 */
function UserMessageComponent({ children, isQueued = false }: UserMessageProps) {
  const { colors } = useTheme();
  const { stdout } = useStdout();

  const terminalWidth = stdout?.columns ?? 80;

  // Check if this is large text that should be compacted
  const isLargeText = useMemo(() => {
    const lines = children.split('\n');
    const charCount = children.length;
    return lines.length > LARGE_TEXT_LINES_THRESHOLD || charCount > LARGE_TEXT_CHARS_THRESHOLD;
  }, [children]);

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

  // Compact display for large pasted content
  const compactInfo = useMemo(() => {
    if (!isLargeText) return null;
    
    const lines = children.split('\n');
    const charCount = children.length;
    const byteSize = Buffer.byteLength(children, 'utf-8');
    const contentType = detectContentType(children);
    
    return {
      lines: lines.length,
      size: formatSize(byteSize),
      chars: charCount,
      type: contentType,
    };
  }, [children, isLargeText]);

  // Render compact box for large text
  if (isLargeText && compactInfo) {
    const prefix = isQueued ? '(queued) ' : '';
    const label = `${prefix}${compactInfo.type}`;
    const stats = `${compactInfo.lines} lines, ${compactInfo.size}`;
    
    return (
      <Box 
        marginTop={1} 
        flexDirection="column"
        borderStyle="round"
        borderColor={colors.userMessageBg || '#757575'}
        paddingX={1}
      >
        <Box>
          <Text 
            color={colors.userMessageText || '#f5f5f5'}
            backgroundColor={colors.userMessageBg || '#757575'}
            bold
          >
            {' '}
            {label}
            {' '}
          </Text>
          <Text dimColor>
            {' '}
            {stats}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor italic>
            Content sent to assistant (collapsed for readability)
          </Text>
        </Box>
      </Box>
    );
  }

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