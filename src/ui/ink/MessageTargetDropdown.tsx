/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `:alias` recipient autocomplete for the Ink composer. Lists every actor the
 * user can address by name: running sub-agents, teammates, and peer sessions.
 * Mirrors SkillMentionDropdown so AgentUI treats every list the same way.
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth } from '../inputPrompt.js';
import type { MessageTargetSuggestion } from '../messageTargets.js';

interface MessageTargetDropdownProps {
  suggestions: MessageTargetSuggestion[];
  activeIndex: number;
  visible: boolean;
}

const MAX_SUGGESTIONS = 5;

function truncateVisible(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

function MessageTargetDropdownComponent({ suggestions, activeIndex, visible }: MessageTargetDropdownProps) {
  const { theme } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);
  const displaySuggestions = useMemo(() => suggestions.slice(0, MAX_SUGGESTIONS), [suggestions]);

  if (!visible || displaySuggestions.length === 0) {
    return null;
  }

  const pointerWidth = 2;
  const gap = 2;
  const availableWidth = Math.max(20, width - pointerWidth - gap);
  const aliasWidth = Math.min(28, Math.floor(availableWidth * 0.4));
  const detailWidth = availableWidth - aliasWidth - gap;

  return (
    <Box flexDirection="column" marginTop={1}>
      {displaySuggestions.map((suggestion, index) => {
        const isSelected = index === activeIndex;
        const pointer = isSelected ? '▸' : ' ';
        const alias = truncateVisible(suggestion.alias, aliasWidth);
        const detail = truncateVisible(
          suggestion.messageable ? suggestion.detail : `${suggestion.detail} · ${suggestion.reason ?? 'unavailable'}`,
          detailWidth,
        );
        return (
          <Box key={suggestion.alias}>
            <Text>
              {theme.fg(isSelected ? 'accent' : 'text', `${pointer} ${alias}`)}
              {suggestion.messageable ? theme.fg('success', ' ●') : theme.fg('dim', ' ○')}
            </Text>
            {detail && <Text>{theme.fg('muted', `  ${detail}`)}</Text>}
          </Box>
        );
      })}
      <Text>{theme.fg('dim', '  Tab to accept · ↑↓ to navigate · Enter sends ":alias message"')}</Text>
    </Box>
  );
}

export const MessageTargetDropdown = memo(MessageTargetDropdownComponent, (prev, next) => (
  prev.visible === next.visible
  && prev.activeIndex === next.activeIndex
  && prev.suggestions === next.suggestions
));
