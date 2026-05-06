/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { getPromptBlockWidth, getRankedSlashCommandMatches } from '../inputPrompt.js';
import type { SlashCommand } from '../../core/slashCommandTypes.js';

export interface SlashCommandSuggestion {
  command: string;
  description: string;
}

interface SlashCommandDropdownProps {
  suggestions: SlashCommandSuggestion[];
  activeIndex: number;
  visible: boolean;
}

const MAX_SUGGESTIONS = 5;

function truncateVisible(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return '…';
  return `${text.slice(0, maxWidth - 1)}…`;
}

function SlashCommandDropdownComponent({ suggestions, activeIndex, visible }: SlashCommandDropdownProps) {
  const { theme } = useTheme();
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
  const commandWidth = Math.min(24, Math.floor(availableWidth * 0.4));
  const descWidth = availableWidth - commandWidth - gap;

  return (
    <Box flexDirection="column" marginTop={1}>
      {displaySuggestions.map((suggestion, index) => {
        const isSelected = index === activeIndex;
        const pointer = isSelected ? '▸' : ' ';
        const cmd = truncateVisible(suggestion.command, commandWidth);
        const desc = suggestion.description ? truncateVisible(suggestion.description, descWidth) : '';

        return (
          <Box key={suggestion.command}>
            <Text>
              {theme.fg(isSelected ? 'accent' : 'text', `${pointer} ${cmd}`)}
            </Text>
            {desc && (
              <Text>{theme.fg('muted', `  ${desc}`)}</Text>
            )}
          </Box>
        );
      })}
      <Text>{theme.fg('dim', '  Tab to accept · ↑↓ to navigate')}</Text>
    </Box>
  );
}

export const SlashCommandDropdown = memo(SlashCommandDropdownComponent, (prev, next) => {
  return (
    prev.visible === next.visible &&
    prev.activeIndex === next.activeIndex &&
    prev.suggestions.length === next.suggestions.length &&
    prev.suggestions === next.suggestions
  );
});

/**
 * Match / slash command pattern in text before cursor.
 * Returns the seed (text after /) and the start index of the /, or null.
 */
export function matchSlashCommand(text: string, cursorOffset: number): { seed: string; startIndex: number } | null {
  const beforeCursor = text.slice(0, cursorOffset);
  // Match / at start of input or after whitespace, followed by command chars.
  const match = /(?:^|\s)(\/([A-Za-z0-9_?-]*))$/.exec(beforeCursor);
  if (!match) return null;
  // We want the / and everything after it
  const fullMatch = match[1]!; // e.g. "/mo"
  const seed = match[2] ?? '';  // e.g. "mo"
  return {
    seed,
    startIndex: match.index + (match[0]!.length - fullMatch.length),
  };
}

/**
 * Build slash command suggestions from a seed string and the command list.
 * Mirrors the filtering logic from buildSlashSuggestionLines in inputPrompt.ts.
 */
export function buildSlashSuggestions(
  seed: string,
  slashCommands: SlashCommand[],
  limit = MAX_SUGGESTIONS
): SlashCommandSuggestion[] {
  const matches = getRankedSlashCommandMatches(seed, slashCommands)
    .slice(0, limit);

  return matches.map((m) => ({
    command: m.command,
    description: m.description ?? '',
  }));
}

/**
 * Build subcommand suggestions when the user has typed a full command + space.
 */
export function buildSubcommandSuggestions(
  input: string,
  slashCommands: SlashCommand[],
  limit = MAX_SUGGESTIONS
): SlashCommandSuggestion[] | null {
  const trimmed = input.replace(/^\s+/, '');
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return null;

  const cmdPart = trimmed.slice(0, spaceIdx).toLowerCase();
  const subSeed = trimmed.slice(spaceIdx + 1).toLowerCase().trim();

  const parent = slashCommands.find(
    (cmd) => cmd.command.toLowerCase() === cmdPart
  );

  if (!parent) return null;
  if (!parent.subcommands || parent.subcommands.length === 0) return [];

  const matches = parent.subcommands
    .filter((sub) =>
      subSeed === '' ? true : sub.name.toLowerCase().startsWith(subSeed)
    )
    .slice(0, limit);

  return matches.map((m) => ({
    command: `${parent.command} ${m.name}`,
    description: m.description,
  }));
}
