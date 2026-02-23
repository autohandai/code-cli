/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import type { SlashCommand } from '../../src/core/slashCommandTypes.js';
import { Theme, setTheme } from '../../src/ui/theme/Theme.js';
import type { ResolvedColors } from '../../src/ui/theme/types.js';
import { COLOR_TOKENS } from '../../src/ui/theme/types.js';

function createMockColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const base: ResolvedColors = {} as ResolvedColors;
  for (const token of COLOR_TOKENS) {
    base[token] = '#ffffff';
  }
  return { ...base, ...overrides };
}

// We need to test the safeEmitKeypressEvents function
// First, let's create a mock module to test the function behavior

describe('safeEmitKeypressEvents', () => {
  let originalEmitKeypressEvents: typeof readline.emitKeypressEvents;

  beforeEach(() => {
    // Save the original function
    originalEmitKeypressEvents = readline.emitKeypressEvents;
    // Reset the spy for each test
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restore the original function
    readline.emitKeypressEvents = originalEmitKeypressEvents;
  });

  it('should call emitKeypressEvents with the stream', async () => {
    // Dynamically import to get fresh module state
    const { safeEmitKeypressEvents } = await import('../../src/ui/inputPrompt.js');

    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents');

    // Create a mock stream with unique identity
    const mockStream = new EventEmitter() as NodeJS.ReadStream;
    (mockStream as any)._uniqueId = Math.random();

    safeEmitKeypressEvents(mockStream);

    expect(emitSpy).toHaveBeenCalled();
  });

  it('should track streams using WeakSet for garbage collection', async () => {
    // This test verifies the implementation uses WeakSet
    // which allows garbage collection of streams
    const { safeEmitKeypressEvents } = await import('../../src/ui/inputPrompt.js');

    const emitSpy = vi.spyOn(readline, 'emitKeypressEvents');

    // Create multiple unique streams
    const streams: NodeJS.ReadStream[] = [];
    for (let i = 0; i < 3; i++) {
      const stream = new EventEmitter() as NodeJS.ReadStream;
      (stream as any)._uniqueId = `stream-${i}-${Math.random()}`;
      streams.push(stream);
    }

    // Each unique stream should trigger emitKeypressEvents
    for (const stream of streams) {
      safeEmitKeypressEvents(stream);
    }

    // All 3 unique streams should have been instrumented
    expect(emitSpy).toHaveBeenCalledTimes(3);
  });
});

describe('Display content utilities', () => {
  it('should calculate display content with truncation', async () => {
    const { getDisplayContent } = await import('../../src/ui/inputPrompt.js');

    // Short content should not be truncated
    const shortResult = getDisplayContent('hello', 80);
    expect(shortResult.isTruncated).toBe(false);
    expect(shortResult.display).toBe('hello');

    // Empty content
    const emptyResult = getDisplayContent('', 80);
    expect(emptyResult.display).toBe('');
    expect(emptyResult.totalLines).toBe(0);
  });

  it('should count newline markers correctly', async () => {
    const { countNewlineMarkers, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

    expect(countNewlineMarkers('')).toBe(0);
    expect(countNewlineMarkers('hello')).toBe(0);
    expect(countNewlineMarkers(`hello${NEWLINE_MARKER}world`)).toBe(1);
    expect(countNewlineMarkers(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe(2);
  });

  it('should convert newline markers to actual newlines', async () => {
    const { convertNewlineMarkersToNewlines, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

    expect(convertNewlineMarkersToNewlines('')).toBe('');
    expect(convertNewlineMarkersToNewlines('hello')).toBe('hello');
    expect(convertNewlineMarkersToNewlines(`hello${NEWLINE_MARKER}world`)).toBe('hello\nworld');
    expect(convertNewlineMarkersToNewlines(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe('a\nb\nc');
  });
});

describe('Prompt surface teardown', () => {
  function createMockOutput(): NodeJS.WriteStream {
    const stream = new EventEmitter() as NodeJS.WriteStream;
    const writes: string[] = [];
    (stream as any)._writes = writes;
    (stream as any).columns = 120;
    (stream as any).write = (chunk: string | Buffer) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    };
    return stream;
  }

  it('clears prompt/status lines and advances cursor below the surface', async () => {
    const { leavePromptSurface } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output, 2);

    const terminalOps = output._writes.join('');
    // Clear line control sequence appears multiple times
    expect((terminalOps.match(/\[2K/g) || []).length).toBeGreaterThanOrEqual(3);
    // Cursor-down operations: 2 status lines + 1 final free line
    expect((terminalOps.match(/\[1B/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it('uses default status line count when omitted', async () => {
    const { leavePromptSurface, PROMPT_LINES_BELOW_INPUT } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output);

    const terminalOps = output._writes.join('');
    // Default STATUS_LINE_COUNT is 1, plus prompt lines below input and one final line advance.
    expect((terminalOps.match(/\[1B/g) || []).length).toBeGreaterThanOrEqual(PROMPT_LINES_BELOW_INPUT + 2);
  });

  it('normalizes cursor offset when clearing from line events', async () => {
    const { leavePromptSurface, PROMPT_LINES_BELOW_INPUT } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output, 1, true);

    const terminalOps = output._writes.join('');
    // line-event normalization moves upward before the clear pass
    expect((terminalOps.match(/\[1A/g) || []).length).toBeGreaterThanOrEqual(PROMPT_LINES_BELOW_INPUT);
    expect((terminalOps.match(/\[2K/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildPromptRenderState', () => {
  it('shows placeholder when line is empty and keeps cursor after prefix', async () => {
    const { buildPromptRenderState, PROMPT_PLACEHOLDER } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('', 0, 80);

    expect(state.lineText).toContain(PROMPT_PLACEHOLDER);
    expect(state.cursorColumn).toBe(3);
  });

  it('positions cursor after typed content', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('hello', 5, 80);

    // border (1) + prefix "> " (2) + cursor at end (5)
    expect(state.cursorColumn).toBe(8);
  });
});

describe('themed prompt rendering', () => {
  beforeEach(() => {
    setTheme(null as unknown as Theme);
  });

  afterEach(() => {
    setTheme(null as unknown as Theme);
  });

  it('uses muted theme color for placeholder content', async () => {
    const theme = new Theme('test', createMockColors({ muted: '#102030' }), 'truecolor');
    setTheme(theme);

    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('', 0, 40);

    expect(state.lineText).toContain('\x1b[38;2;16;32;48m');
  });

  it('uses accent theme color for prompt prefix when input is non-empty', async () => {
    const theme = new Theme('test', createMockColors({ accent: '#304050' }), 'truecolor');
    setTheme(theme);

    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('hello', 5, 40);

    expect(state.lineText).toContain('\x1b[38;2;48;64;80m');
  });
});

describe('prompt hot tips', () => {
  const files = [
    'src/index.ts',
    'docs/config-reference.md',
    'tests/ui/inputPrompt.test.ts',
  ];
  const slashCommands: SlashCommand[] = [
    { command: '/help', description: 'show help', implemented: true },
    { command: '/login', description: 'sign in', implemented: true },
    { command: '/review', description: 'review changes', implemented: true },
  ];

  it('returns mention suggestions when line ends with @ seed', async () => {
    const { buildPromptHotTips } = await import('../../src/ui/inputPrompt.js');
    const tips = buildPromptHotTips('@src/i', files, slashCommands);

    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0]?.label).toContain('Tab -> @src/index.ts');
  });

  it('returns slash command suggestions for slash mode', async () => {
    const { buildPromptHotTips } = await import('../../src/ui/inputPrompt.js');
    const tips = buildPromptHotTips('/he', files, slashCommands);

    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0]?.label).toContain('Tab -> /help');
  });

  it('returns shell suggestions for shell mode', async () => {
    const { buildPromptHotTips } = await import('../../src/ui/inputPrompt.js');
    const tips = buildPromptHotTips('! bun', files, slashCommands);

    expect(tips.length).toBeGreaterThan(0);
    expect(tips[0]?.label).toContain('Tab -> !');
  });

  it('returns default tips for plain input', async () => {
    const { buildPromptHotTips } = await import('../../src/ui/inputPrompt.js');
    const tips = buildPromptHotTips('', files, slashCommands);

    expect(tips[0]?.label).toBe('Tab -> /help');
    expect(tips.some((tip: { label: string }) => tip.label.includes('@'))).toBe(true);
  });

  it('returns a primary suggestion for mention mode', async () => {
    const { getPrimaryHotTipSuggestion } = await import('../../src/ui/inputPrompt.js');
    const suggestion = getPrimaryHotTipSuggestion('@src/i', files, slashCommands);

    expect(suggestion).toEqual({
      line: '@src/index.ts ',
      cursor: '@src/index.ts '.length,
    });
  });

  it('returns /help as the primary suggestion for empty input', async () => {
    const { getPrimaryHotTipSuggestion } = await import('../../src/ui/inputPrompt.js');
    const suggestion = getPrimaryHotTipSuggestion('', files, slashCommands);

    expect(suggestion).toEqual({ line: '/help ', cursor: 6 });
  });

  it('builds contextual status text for ? help in the status line', async () => {
    const { buildContextualPromptStatusLine } = await import('../../src/ui/inputPrompt.js');
    const status = buildContextualPromptStatusLine('/he', files, slashCommands);

    expect(status).toContain('hot tip');
    expect(status).toContain('/help');
  });

  it('builds contextual help panel with implemented shortcuts only', async () => {
    const { buildContextualHelpPanelLines } = await import('../../src/ui/inputPrompt.js');
    const lines = buildContextualHelpPanelLines('', 80, files, slashCommands)
      .map((line: string) => line.replace(/\u001b\[[0-9;]*m/g, ''))
      .join('\n');

    expect(lines).toContain('tab accepts suggestion');
    expect(lines).toContain('shift + tab toggles plan mode');
    expect(lines).toContain('? toggles this shortcuts panel');
    expect(lines).not.toContain('ctrl + g');
    expect(lines).not.toContain('esc esc to edit previous message');
  });
});

describe('prompt shortcut key helpers', () => {
  it('detects Shift+Tab across terminal variants', async () => {
    const { isShiftTabShortcut } = await import('../../src/ui/inputPrompt.js');

    expect(isShiftTabShortcut('\x1b[Z', { name: 'tab', sequence: '\x1b[Z', shift: false } as readline.Key)).toBe(true);
    expect(isShiftTabShortcut('', { name: 'backtab', sequence: '\x1b[Z' } as readline.Key)).toBe(true);
    expect(isShiftTabShortcut('', { name: 'tab', sequence: '\t', shift: true } as readline.Key)).toBe(true);
    expect(isShiftTabShortcut('\t', { name: 'tab', sequence: '\t', shift: false } as readline.Key)).toBe(false);
  });

  it('does not classify Shift+Tab as plain tab', async () => {
    const { isPlainTabShortcut } = await import('../../src/ui/inputPrompt.js');

    expect(isPlainTabShortcut('\x1b[Z', { name: 'tab', sequence: '\x1b[Z', shift: false } as readline.Key)).toBe(false);
    expect(isPlainTabShortcut('\t', { name: 'tab', sequence: '\t', shift: false } as readline.Key)).toBe(true);
  });

  it('auto-hides shortcut help only on editable keys', async () => {
    const { shouldAutoHideShortcutHelp } = await import('../../src/ui/inputPrompt.js');

    expect(shouldAutoHideShortcutHelp('a', { name: 'a' } as readline.Key)).toBe(true);
    expect(shouldAutoHideShortcutHelp('', { name: 'backspace' } as readline.Key)).toBe(true);
    expect(shouldAutoHideShortcutHelp('\t', { name: 'tab', sequence: '\t', shift: false } as readline.Key)).toBe(false);
    expect(shouldAutoHideShortcutHelp('\x1b[Z', { name: 'tab', sequence: '\x1b[Z', shift: false } as readline.Key)).toBe(false);
    expect(shouldAutoHideShortcutHelp('', { name: 'escape' } as readline.Key)).toBe(false);
  });
});

describe('getPromptBlockWidth', () => {
  it('uses one column less than terminal width to avoid auto-wrap', async () => {
    const { getPromptBlockWidth } = await import('../../src/ui/inputPrompt.js');
    expect(getPromptBlockWidth(120)).toBe(119);
    expect(getPromptBlockWidth(80)).toBe(79);
  });

  it('has a floor for very small/unknown widths', async () => {
    const { getPromptBlockWidth } = await import('../../src/ui/inputPrompt.js');
    expect(getPromptBlockWidth(undefined)).toBe(79); // default 80 - 1
    expect(getPromptBlockWidth(5)).toBe(10);
  });

  it('keeps rendered prompt line strictly below terminal columns', async () => {
    const { getPromptBlockWidth, buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const width = getPromptBlockWidth(100);
    const state = buildPromptRenderState('hello world', 11, width);
    const plain = state.lineText.replace(/\u001b\[[0-9;]*m/g, '');

    expect(width).toBe(99);
    expect(plain.length).toBe(width);
    expect(plain.length).toBeLessThan(100);
  });
});
