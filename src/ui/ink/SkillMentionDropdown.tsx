/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * `$skill` mention autocomplete dropdown for the Ink composer. Mirrors the
 * shape of SlashCommandDropdown so the keyboard handlers in AgentUI can
 * treat both list types uniformly.
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth } from '../inputPrompt.js';
import { buildSkillMentionSuggestions, type SkillMentionInfo } from '../mentionFilter.js';

export interface SkillSuggestion {
  /** Already prefixed with `$` so AgentUI can replace text directly. */
  name: string;
  description: string;
  isActive: boolean;
}

interface SkillMentionDropdownProps {
  suggestions: SkillSuggestion[];
  activeIndex: number;
  visible: boolean;
}

const MAX_SUGGESTIONS = 5;

function truncateVisible(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

function SkillMentionDropdownComponent({ suggestions, activeIndex, visible }: SkillMentionDropdownProps) {
  const { colors } = useTheme();
  const width = getPromptBlockWidth(process.stdout.columns);

  const displaySuggestions = useMemo(
    () => suggestions.slice(0, MAX_SUGGESTIONS),
    [suggestions]
  );

  if (!visible || displaySuggestions.length === 0) {
    return null;
  }

  const pointerWidth = 2;
  const gap = 2;
  const availableWidth = Math.max(20, width - pointerWidth - gap);
  const nameWidth = Math.min(28, Math.floor(availableWidth * 0.4));
  const descWidth = availableWidth - nameWidth - gap;

  return (
    <Box flexDirection="column" marginTop={1}>
      {displaySuggestions.map((suggestion, index) => {
        const isSelected = index === activeIndex;
        const pointer = isSelected ? '▸' : ' ';
        const name = truncateVisible(suggestion.name, nameWidth);
        const desc = suggestion.description ? truncateVisible(suggestion.description, descWidth) : '';

        return (
          <Box key={suggestion.name}>
            <Text color={isSelected ? 'cyan' : undefined}>
              {pointer} {isSelected ? name : <Text color={colors.text}>{name}</Text>}
              {suggestion.isActive ? <Text color={colors.success}> ●</Text> : null}
            </Text>
            {desc && <Text color={colors.muted}>  {desc}</Text>}
          </Box>
        );
      })}
      <Text color={colors.dim}>  Tab to accept · ↑↓ to navigate</Text>
    </Box>
  );
}

export const SkillMentionDropdown = memo(SkillMentionDropdownComponent, (prev, next) => {
  return (
    prev.visible === next.visible &&
    prev.activeIndex === next.activeIndex &&
    prev.suggestions === next.suggestions
  );
});

/**
 * Detect a `$skill` mention immediately before the cursor.
 *
 * Matches `$` at the start of the input or after whitespace, optionally
 * followed by a partial skill name. Returns the seed and the offset of the
 * leading `$` so callers can replace the range when accepting a suggestion.
 */
export function matchSkillMention(
  text: string,
  cursorOffset: number
): { seed: string; startIndex: number } | null {
  const beforeCursor = text.slice(0, cursorOffset);
  const match = /(?:^|\s)(\$([A-Za-z0-9_-]*))$/.exec(beforeCursor);
  if (!match) return null;
  const fullMatch = match[1]!; // e.g. "$rea"
  const seed = match[2] ?? '';
  return {
    seed,
    startIndex: match.index + (match[0]!.length - fullMatch.length),
  };
}

/**
 * Build skill autocomplete suggestions from the provider's skill list.
 *
 * Wraps `buildSkillMentionSuggestions` and re-attaches the original
 * `description` and `isActive` flags so the UI can render them.
 */
export function buildSkillSuggestions(
  seed: string,
  skills: SkillMentionInfo[],
  limit = MAX_SUGGESTIONS
): SkillSuggestion[] {
  const matchingNames = buildSkillMentionSuggestions(skills, seed, limit);
  if (matchingNames.length === 0) return [];

  const byName = new Map(skills.map((s) => [s.name, s] as const));
  return matchingNames
    .map((name) => {
      const info = byName.get(name);
      if (!info) return null;
      return {
        name: `$${info.name}`,
        description: info.description,
        isActive: info.isActive,
      };
    })
    .filter((s): s is SkillSuggestion => s !== null);
}
