/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth } from '../inputPrompt.js';

export interface FileMentionSuggestion {
  path: string;
  filename: string;
  directory: string;
}

interface FileMentionDropdownProps {
  suggestions: FileMentionSuggestion[];
  activeIndex: number;
  visible: boolean;
}

const MAX_SUGGESTIONS = 5;

function truncateVisible(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

function FileMentionDropdownComponent({ suggestions, activeIndex, visible }: FileMentionDropdownProps) {
  const { colors } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);

  const displaySuggestions = useMemo(() => 
    suggestions.slice(0, MAX_SUGGESTIONS),
    [suggestions]
  );

  if (!visible || displaySuggestions.length === 0) {
    return null;
  }

  // Calculate column widths
  const pointerWidth = 2; // "▸ " or "  "
  const gap = 2;
  const availableWidth = Math.max(20, width - pointerWidth - gap);
  const filenameWidth = Math.min(24, Math.floor(availableWidth * 0.4));
  const dirWidth = availableWidth - filenameWidth - gap;

  return (
    <Box flexDirection="column" marginTop={1}>
      {displaySuggestions.map((suggestion, index) => {
        const isSelected = index === activeIndex;
        const pointer = isSelected ? '▸' : ' ';
        const filename = truncateVisible(suggestion.filename, filenameWidth);
        const dir = suggestion.directory ? truncateVisible(suggestion.directory, dirWidth) : '';

        return (
          <Box key={suggestion.path}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {pointer} {isSelected ? filename : <Text color={colors.text}>{filename}</Text>}
            </Text>
            {dir && (
              <Text color={colors.muted}>  {dir}</Text>
            )}
          </Box>
        );
      })}
      <Text color={colors.dim}>  Tab to accept · ↑↓ to navigate</Text>
    </Box>
  );
}

export const FileMentionDropdown = memo(FileMentionDropdownComponent, (prev, next) => {
  return (
    prev.visible === next.visible &&
    prev.activeIndex === next.activeIndex &&
    prev.suggestions.length === next.suggestions.length &&
    prev.suggestions === next.suggestions
  );
});

/**
 * Parse file suggestions from a list of file paths
 */
export function parseFileSuggestions(files: string[]): FileMentionSuggestion[] {
  return files.map(file => {
    const normalized = file.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const filename = parts.pop() || normalized;
    const directory = parts.join('/');
    return { path: file, filename, directory };
  });
}

/**
 * Match @ mention pattern in text before cursor
 */
export function matchFileMention(text: string, cursorOffset: number): { seed: string; startIndex: number } | null {
  const beforeCursor = text.slice(0, cursorOffset);
  const match = /@([A-Za-z0-9_./\\-]*)$/.exec(beforeCursor);
  if (!match) return null;
  return {
    seed: match[1] ?? '',
    startIndex: match.index,
  };
}