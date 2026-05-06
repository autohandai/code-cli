/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth } from '../inputPrompt.js';
import { getShellCommandSuggestions } from '../shellCommand.js';

export interface ShellCommandSuggestion {
  command: string;
}

interface ShellCommandDropdownProps {
  suggestions: ShellCommandSuggestion[];
  activeIndex: number;
  visible: boolean;
}

const MAX_SUGGESTIONS = 5;

function truncateVisible(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

function ShellCommandDropdownComponent({ suggestions, activeIndex, visible }: ShellCommandDropdownProps) {
  const { theme } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);

  const displaySuggestions = useMemo(() =>
    suggestions.slice(0, MAX_SUGGESTIONS),
    [suggestions]
  );

  if (!visible || displaySuggestions.length === 0) {
    return null;
  }

  const commandWidth = Math.max(20, width - 4);

  return (
    <Box flexDirection="column" marginTop={1}>
      {displaySuggestions.map((suggestion, index) => {
        const isSelected = index === activeIndex;
        const pointer = isSelected ? '▸' : ' ';
        const command = truncateVisible(suggestion.command, commandWidth);

        return (
          <Box key={suggestion.command}>
            <Text>{theme.fg(isSelected ? 'accent' : 'text', `${pointer} ${command}`)}</Text>
          </Box>
        );
      })}
      <Text>{theme.fg('dim', '  Tab to accept · ↑↓ to navigate')}</Text>
    </Box>
  );
}

export const ShellCommandDropdown = memo(ShellCommandDropdownComponent, (prev, next) => {
  return (
    prev.visible === next.visible &&
    prev.activeIndex === next.activeIndex &&
    prev.suggestions.length === next.suggestions.length &&
    prev.suggestions === next.suggestions
  );
});

export function buildShellCommandSuggestions(
  input: string,
  workspaceRoot?: string,
  limit = MAX_SUGGESTIONS
): ShellCommandSuggestion[] {
  return getShellCommandSuggestions(input, { cwd: workspaceRoot, limit })
    .map((command) => ({ command }));
}
