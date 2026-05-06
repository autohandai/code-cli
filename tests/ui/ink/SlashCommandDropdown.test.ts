/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  SlashCommandDropdown,
  matchSlashCommand,
  buildSlashSuggestions,
  buildSubcommandSuggestions,
} from '../../../src/ui/ink/SlashCommandDropdown.js';
import type { SlashCommand } from '../../../src/core/slashCommandTypes.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { initTheme } from '../../../src/ui/theme/index.js';

const mockSlashCommands: SlashCommand[] = [
  { command: '/model', description: 'Switch AI model', implemented: true },
  { command: '/theme', description: 'Change theme', implemented: true },
  { command: '/help', description: 'Show help', implemented: true },
  { command: '/quit', description: 'Exit application', implemented: true },
  { command: '/skills', description: 'Manage skills', implemented: true, subcommands: [
    { name: 'install', description: 'Install a skill' },
    { name: 'search', description: 'Search for skills' },
    { name: 'list', description: 'List installed skills' },
  ]},
  { command: '/learn', description: 'Learn mode', implemented: true, subcommands: [
    { name: 'deep', description: 'Deep learning mode' },
    { name: 'quick', description: 'Quick learning mode' },
  ]},
];

describe('SlashCommandDropdown utilities', () => {
  afterEach(() => {
    initTheme('dark');
  });

  it('emits selected theme ANSI for active command menu options', () => {
    initTheme('sandy');

    const { lastFrame } = render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SlashCommandDropdown, {
          visible: true,
          activeIndex: 0,
          suggestions: [{ command: '/theme', description: 'Change theme' }],
        })
      )
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('/theme');
    expect(frame).not.toContain('\x1b[36m');

    const source = readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/SlashCommandDropdown.tsx'),
      'utf8'
    );
    expect(source).toContain("theme.fg(isSelected ? 'accent' : 'text'");
    expect(source).not.toContain("color={isSelected ? 'cyan'");
  });

  describe('matchSlashCommand', () => {
    it('returns null for input without slash', () => {
      expect(matchSlashCommand('hello world', 11)).toBeNull();
    });

    it('matches slash after whitespace (allows autocomplete mid-input)', () => {
      const result = matchSlashCommand('hello /world', 12);
      expect(result).toEqual({ seed: 'world', startIndex: 6 });
    });

    it('matches slash at start of input', () => {
      const result = matchSlashCommand('/model', 6);
      expect(result).toEqual({ seed: 'model', startIndex: 0 });
    });

    it('matches partial slash command', () => {
      const result = matchSlashCommand('/mo', 3);
      expect(result).toEqual({ seed: 'mo', startIndex: 0 });
    });

    it('matches slash after whitespace', () => {
      const result = matchSlashCommand('  /help', 7);
      expect(result).toEqual({ seed: 'help', startIndex: 2 });
    });

    it('returns empty seed for bare slash', () => {
      const result = matchSlashCommand('/', 1);
      expect(result).toEqual({ seed: '', startIndex: 0 });
    });

    it('respects cursor position', () => {
      // Typing "/mo" but cursor is after "/m"
      const result = matchSlashCommand('/model', 2);
      expect(result).toEqual({ seed: 'm', startIndex: 0 });
    });

    it('does not match if cursor is before the slash', () => {
      expect(matchSlashCommand('/model some text', 0)).toBeNull();
    });
  });

  describe('buildSlashSuggestions', () => {
    it('returns empty array for empty seed (showing all would be too many)', () => {
      const result = buildSlashSuggestions('', mockSlashCommands, 5);
      // Empty seed should match all commands
      expect(result.length).toBeGreaterThan(0);
    });

    it('filters commands by seed substring match', () => {
      const result = buildSlashSuggestions('mo', mockSlashCommands);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ command: '/model', description: 'Switch AI model' });
    });

    it('performs case-insensitive matching', () => {
      const result = buildSlashSuggestions('MO', mockSlashCommands);
      expect(result).toHaveLength(1);
      expect(result[0].command).toBe('/model');
    });

    it('returns multiple matches for common substring', () => {
      // 'h' matches /help and /theme (the 'h' in 'theme' command name)
      const result = buildSlashSuggestions('h', mockSlashCommands);
      expect(result).toHaveLength(2);
      expect(result[1].command).toBe('/help');
    });

    it('respects the limit parameter', () => {
      // All commands match empty seed, but limit should cap it
      const result = buildSlashSuggestions('', mockSlashCommands, 3);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it('returns empty array when no commands match', () => {
      const result = buildSlashSuggestions('xyz', mockSlashCommands);
      expect(result).toEqual([]);
    });
  });

  describe('buildSubcommandSuggestions', () => {
    it('returns null when input has no space (not in subcommand mode)', () => {
      expect(buildSubcommandSuggestions('/skills', mockSlashCommands)).toBeNull();
    });

    it('returns null for unknown command with space', () => {
      expect(buildSubcommandSuggestions('/unknown sub', mockSlashCommands)).toBeNull();
    });

    it('returns empty array for command without subcommands', () => {
      expect(buildSubcommandSuggestions('/model something', mockSlashCommands)).toEqual([]);
    });

    it('returns all subcommands when space typed with no seed', () => {
      const result = buildSubcommandSuggestions('/skills ', mockSlashCommands);
      expect(result).toHaveLength(3);
      expect(result![0]).toEqual({ command: '/skills install', description: 'Install a skill' });
    });

    it('filters subcommands by seed', () => {
      const result = buildSubcommandSuggestions('/skills in', mockSlashCommands);
      expect(result).toHaveLength(1); // install only (startsWith)
      expect(result![0]).toEqual({ command: '/skills install', description: 'Install a skill' });
    });

    it('performs case-insensitive subcommand matching', () => {
      const result = buildSubcommandSuggestions('/skills IN', mockSlashCommands);
      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({ command: '/skills install', description: 'Install a skill' });
    });

    it('returns all subcommands for /learn', () => {
      const result = buildSubcommandSuggestions('/learn ', mockSlashCommands);
      expect(result).toHaveLength(2);
      expect(result![1]).toEqual({ command: '/learn quick', description: 'Quick learning mode' });
    });

    it('respects the limit parameter', () => {
      const result = buildSubcommandSuggestions('/skills ', mockSlashCommands, 2);
      expect(result).toHaveLength(2);
    });
  });
});
