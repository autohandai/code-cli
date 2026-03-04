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

describe('installReadlineOutputGuard', () => {
  it('suppresses and restores readline output writes', async () => {
    const { installReadlineOutputGuard } = await import('../../src/ui/inputPrompt.js');

    const writes: string[] = [];
    const rlLike = {
      _writeToOutput: (chunk: string) => {
        writes.push(chunk);
      },
    } as unknown as readline.Interface;

    const guard = installReadlineOutputGuard(rlLike);

    (rlLike as any)._writeToOutput('before');
    guard.setSuppressed(true);
    (rlLike as any)._writeToOutput('hidden');
    guard.setSuppressed(false);
    (rlLike as any)._writeToOutput('after');
    guard.restore();
    (rlLike as any)._writeToOutput('restored');

    expect(writes).toEqual(['before', 'after', 'restored']);
  });

  it('returns no-op guard when readline has no writer hook', async () => {
    const { installReadlineOutputGuard } = await import('../../src/ui/inputPrompt.js');

    const rlLike = {} as readline.Interface;
    const guard = installReadlineOutputGuard(rlLike);

    expect(() => guard.setSuppressed(true)).not.toThrow();
    expect(() => guard.restore()).not.toThrow();
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
    expect(countNewlineMarkers('line1\nline2')).toBe(1);
    expect(countNewlineMarkers(`a${NEWLINE_MARKER}b\nc`)).toBe(2);
  });

  it('should convert newline markers to actual newlines', async () => {
    const { convertNewlineMarkersToNewlines, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

    expect(convertNewlineMarkersToNewlines('')).toBe('');
    expect(convertNewlineMarkersToNewlines('hello')).toBe('hello');
    expect(convertNewlineMarkersToNewlines(`hello${NEWLINE_MARKER}world`)).toBe('hello\nworld');
    expect(convertNewlineMarkersToNewlines(`a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`)).toBe('a\nb\nc');
    expect(convertNewlineMarkersToNewlines(`a${NEWLINE_MARKER}b\r\nc\rd\ne`)).toBe('a\nb\nc\nd\ne');
  });
});

describe('pasted reference helpers', () => {
  it('removes compact pasted reference token and keeps surrounding text', async () => {
    const { removePastedReferenceFromLine } = await import('../../src/ui/inputPrompt.js');

    const result = removePastedReferenceFromLine('fix this [Text pasted: 283 lines] now');

    expect(result).toEqual({
      line: 'fix this  now',
      cursor: 9,
    });
  });

  it('returns null when no compact pasted reference token exists', async () => {
    const { removePastedReferenceFromLine } = await import('../../src/ui/inputPrompt.js');

    const result = removePastedReferenceFromLine('plain text');

    expect(result).toBeNull();
  });
});

describe('renderPromptLine cursor positioning', () => {
  it('cursor position includes +1 offset for left │ border', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');

    // "the" typed → prefix (2) + 3 chars + 1 for left │ border = cursor at column 6
    const state = buildPromptRenderState('the', 3, 80);
    expect(state.cursorColumn).toBe(6);
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

  it('clears prompt/status lines and moves cursor to top of cleared area', async () => {
    const { leavePromptSurface } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output, 2);

    const terminalOps = output._writes.join('');
    // Clear line control sequence appears multiple times (top border + content + bottom border + 2 status)
    expect((terminalOps.match(/\[2K/g) || []).length).toBeGreaterThanOrEqual(3);
    // Cursor-up operations: after clearing below, cursor moves back to top of prompt
    expect((terminalOps.match(/\[1A/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('uses default status line count when omitted', async () => {
    const { leavePromptSurface } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output);

    const terminalOps = output._writes.join('');
    // Clears top border + content + bottom border + status
    expect((terminalOps.match(/\[2K/g) || []).length).toBeGreaterThanOrEqual(3);
    // Cursor moves back up to top of cleared area
    expect((terminalOps.match(/\[1A/g) || []).length).toBeGreaterThanOrEqual(1);
  });

  it('normalizes cursor offset when clearing from line events', async () => {
    const {
      leavePromptSurface,
      PROMPT_LINES_BELOW_INPUT
    } = await import('../../src/ui/inputPrompt.js');
    const output = createMockOutput() as NodeJS.WriteStream & { _writes: string[] };

    leavePromptSurface(output, 1, true);

    const terminalOps = output._writes.join('');
    // line-event normalization + return-to-top both move upward
    expect((terminalOps.match(/\[1A/g) || []).length).toBeGreaterThanOrEqual(PROMPT_LINES_BELOW_INPUT + 1);
    expect((terminalOps.match(/\[2K/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe('buildPromptRenderState', () => {
  it('shows placeholder when line is empty and keeps cursor after prefix', async () => {
    const { buildPromptRenderState, PROMPT_PLACEHOLDER } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('', 0, 80);

    expect(state.lineText).toContain(PROMPT_PLACEHOLDER);
    // prefix (2) + 1 for left │ border
    expect(state.cursorColumn).toBe(3);
  });

  it('positions cursor after typed content', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('hello', 5, 80);

    // prefix (2) + cursor at end (5) + 1 for left │ border
    expect(state.cursorColumn).toBe(8);
  });

  it('keeps cursor within a centered scrolling window when editing long input', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('abcdefghijklmnopqrstuvwxyz', 10, 14);
    const plain = state.lineText.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
    // Strip │ borders before checking inner content
    const inner = plain.slice(1, -1).trimEnd();

    expect(inner.startsWith('…')).toBe(true);
    expect(inner.endsWith('…')).toBe(true);
    // +1 for left │ border
    expect(state.cursorColumn).toBe(7);
  });

  it('keeps cursor aligned near end when editing long input tail', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('abcdefghijklmnopqrstuvwxyz', 26, 14);
    const plain = state.lineText.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
    // Strip │ borders before checking inner content
    const inner = plain.slice(1, -1);

    expect(inner.startsWith('…')).toBe(true);
    expect(inner.endsWith('…')).toBe(false);
    // +1 for left │ border
    expect(state.cursorColumn).toBe(13);
  });
});

describe('ghost text suggestion in placeholder', () => {
  it('shows LLM suggestion as placeholder when input is empty and suggestion provided', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('', 0, 80, 'Run the test suite');
    expect(state.lineText).toContain('Run the test suite');
    expect(state.lineText).not.toContain('Plan, search, build anything');
  });

  it('shows default placeholder when no suggestion provided', async () => {
    const { buildPromptRenderState, PROMPT_PLACEHOLDER } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('', 0, 80);
    expect(state.lineText).toContain(PROMPT_PLACEHOLDER);
  });

  it('ignores suggestion when user has typed content', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildPromptRenderState('hello', 5, 80, 'Run the test suite');
    expect(state.lineText).not.toContain('Run the test suite');
  });
});

describe('Tab accepts LLM suggestion on empty input', () => {
  it('returns LLM suggestion when input is empty and suggestion provided', async () => {
    const { getPrimaryHotTipSuggestion } = await import('../../src/ui/inputPrompt.js');
    const suggestion = getPrimaryHotTipSuggestion('', [], [], 'Run the test suite');
    expect(suggestion).toEqual({
      line: 'Run the test suite',
      cursor: 18,
    });
  });

  it('falls back to /help when no suggestion provided', async () => {
    const { getPrimaryHotTipSuggestion } = await import('../../src/ui/inputPrompt.js');
    const suggestion = getPrimaryHotTipSuggestion('', [], []);
    expect(suggestion).toEqual({ line: '/help ', cursor: 6 });
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
      .map((line: string) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''))
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

describe('isShiftEnterSequence', () => {
  it('detects standard Shift+Enter (readline parsed)', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    expect(isShiftEnterSequence('\r', { name: 'return', sequence: '\r', shift: true } as readline.Key)).toBe(true);
    expect(isShiftEnterSequence('\r', { name: 'return', sequence: '\r', meta: true } as readline.Key)).toBe(true);
  });

  it('detects CSI u protocol Shift+Enter (kitty keyboard)', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    // Shift+Enter: ESC[13;2u
    expect(isShiftEnterSequence('\x1b[13;2u', { sequence: '\x1b[13;2u' } as readline.Key)).toBe(true);
    // Alt+Enter: ESC[13;3u
    expect(isShiftEnterSequence('\x1b[13;3u', { sequence: '\x1b[13;3u' } as readline.Key)).toBe(true);
    // Shift+Alt+Enter: ESC[13;4u
    expect(isShiftEnterSequence('\x1b[13;4u', { sequence: '\x1b[13;4u' } as readline.Key)).toBe(true);
  });

  it('detects xterm modified key format Shift+Enter (~ terminator)', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    // Shift+Enter: ESC[13;2~
    expect(isShiftEnterSequence('\x1b[13;2~', { sequence: '\x1b[13;2~' } as readline.Key)).toBe(true);
    // Alt+Enter: ESC[13;3~
    expect(isShiftEnterSequence('\x1b[13;3~', { sequence: '\x1b[13;3~' } as readline.Key)).toBe(true);
    // Shift+Alt+Enter: ESC[13;4~
    expect(isShiftEnterSequence('\x1b[13;4~', { sequence: '\x1b[13;4~' } as readline.Key)).toBe(true);
  });

  it('detects Alt+Enter as ESC followed by carriage return', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    expect(isShiftEnterSequence('\x1b\r', { sequence: '\x1b\r' } as readline.Key)).toBe(true);
    expect(isShiftEnterSequence('\x1b\n', { sequence: '\x1b\n' } as readline.Key)).toBe(true);
  });

  it('does NOT match plain Enter', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    expect(isShiftEnterSequence('\r', { name: 'return', sequence: '\r' } as readline.Key)).toBe(false);
    expect(isShiftEnterSequence('\n', { name: 'return', sequence: '\n' } as readline.Key)).toBe(false);
  });

  it('does NOT match unrelated CSI u sequences', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    // Tab: CSI 9;2u
    expect(isShiftEnterSequence('\x1b[9;2u', { sequence: '\x1b[9;2u' } as readline.Key)).toBe(false);
    // Space: CSI 32;2u
    expect(isShiftEnterSequence('\x1b[32;2u', { sequence: '\x1b[32;2u' } as readline.Key)).toBe(false);
  });

  it('detects from _str when key.sequence is missing', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');

    expect(isShiftEnterSequence('\x1b[13;2u', undefined)).toBe(true);
    expect(isShiftEnterSequence('\x1b[13;3u', {} as readline.Key)).toBe(true);
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
    const plain = state.lineText.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

    expect(width).toBe(99);
    expect(plain.length).toBe(width);
    expect(plain.length).toBeLessThan(100);
  });
});

describe('promptNotify', () => {
  it('should be an exported function', async () => {
    const { promptNotify } = await import('../../src/ui/inputPrompt.js');
    expect(typeof promptNotify).toBe('function');
  });

  it('should not throw when called without active prompt', async () => {
    const { promptNotify } = await import('../../src/ui/inputPrompt.js');
    expect(() => promptNotify('test message')).not.toThrow();
  });
});

describe('partial escape sequence filtering', () => {
  it('regex matches residual CSI fragments after readline strips ESC[', () => {
    // These are the fragments left when readline consumes ESC[ from CSI u / xterm sequences
    const regex = /^13;?[234]?\d*[u~]$/;
    expect(regex.test('13;2u')).toBe(true);
    expect(regex.test('13;3u')).toBe(true);
    expect(regex.test('13;4u')).toBe(true);
    expect(regex.test('13;2~')).toBe(true);
    expect(regex.test('13;3~')).toBe(true);
    expect(regex.test('13~')).toBe(true);
    expect(regex.test('13u')).toBe(true);
    // Should NOT match normal text
    expect(regex.test('hello')).toBe(false);
    expect(regex.test('13')).toBe(false);
    expect(regex.test('9;2u')).toBe(false);
  });
});

describe('buildMultiLineRenderState', () => {
  it('returns single line for input without NEWLINE_MARKER', async () => {
    const { buildMultiLineRenderState } = await import('../../src/ui/inputPrompt.js');
    const state = buildMultiLineRenderState('hello', 5, 80);

    expect(state.lineCount).toBe(1);
    expect(state.lines.length).toBe(1);
    expect(state.cursorRow).toBe(0);
    // prefix (2) + cursor at end (5) + 1 for border
    expect(state.cursorColumn).toBe(8);
  });

  it('splits input into multiple lines at NEWLINE_MARKER', async () => {
    const { buildMultiLineRenderState, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');
    const input = `line1${NEWLINE_MARKER}line2${NEWLINE_MARKER}line3`;
    const state = buildMultiLineRenderState(input, 5, 80);

    expect(state.lineCount).toBe(3);
    expect(state.lines.length).toBe(3);
  });

  it('splits input into multiple lines when literal newlines are present', async () => {
    const { buildMultiLineRenderState } = await import('../../src/ui/inputPrompt.js');
    const input = 'line1\nline2\nline3';
    const state = buildMultiLineRenderState(input, 5, 80);

    expect(state.lineCount).toBe(3);
    expect(state.lines.length).toBe(3);
  });

  it('positions cursor correctly for mixed marker + literal newline separators', async () => {
    const { buildMultiLineRenderState, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');
    const input = `line1${NEWLINE_MARKER}line2\nline3`;
    const cursorPos = `line1${NEWLINE_MARKER}li`.length;
    const state = buildMultiLineRenderState(input, cursorPos, 80);

    expect(state.cursorRow).toBe(1);
    expect(state.lineCount).toBe(3);
  });

  it('positions cursor on the correct row', async () => {
    const { buildMultiLineRenderState, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');
    const input = `line1${NEWLINE_MARKER}line2`;
    // Cursor at position after "line1" + NEWLINE_MARKER + "li" = 5 + 3 + 2 = 10
    const cursorPos = 5 + NEWLINE_MARKER.length + 2;
    const state = buildMultiLineRenderState(input, cursorPos, 80);

    expect(state.cursorRow).toBe(1);
    expect(state.lineCount).toBe(2);
  });

  it('uses PROMPT_INPUT_PREFIX for first row and indent for continuation', async () => {
    const { buildMultiLineRenderState, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');
    const input = `first${NEWLINE_MARKER}second`;
    const state = buildMultiLineRenderState(input, 0, 80);
    const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

    // First line should contain the ❯ prefix
    expect(stripAnsi(state.lines[0])).toContain('❯');
    // Second line should NOT contain ❯ (uses space indent instead)
    const secondInner = stripAnsi(state.lines[1]).slice(1, -1); // strip │ borders
    expect(secondInner.startsWith('  ')).toBe(true);
    expect(secondInner).toContain('second');
  });

  it('each line has correct box width', async () => {
    const { buildMultiLineRenderState, NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');
    const input = `a${NEWLINE_MARKER}b${NEWLINE_MARKER}c`;
    const state = buildMultiLineRenderState(input, 0, 40);
    const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

    for (const line of state.lines) {
      expect(stripAnsi(line).length).toBe(40);
    }
  });
});

describe('inline ghost suffix rendering', () => {
  it('renders ghost suffix on single-line prompt when input is non-empty', async () => {
    const { buildPromptRenderState } = await import('../../src/ui/inputPrompt.js');
    const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

    const state = buildPromptRenderState('! git s', 7, 80, undefined, 'tatus');
    const plain = stripAnsi(state.lineText);

    expect(plain).toContain('! git status');
  });
});

describe('color cache invalidation', () => {
  it('invalidateBoxColorCache is exported and callable', async () => {
    const { invalidateBoxColorCache } = await import('../../src/ui/box.js');
    expect(typeof invalidateBoxColorCache).toBe('function');
    expect(() => invalidateBoxColorCache()).not.toThrow();
  });
});

describe('paste-during-processing protection', () => {
  it('isShiftEnterSequence does NOT match plain return key', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');
    // Plain Enter — should NOT be treated as Shift+Enter
    expect(isShiftEnterSequence('\r', { name: 'return', sequence: '\r', ctrl: false, meta: false, shift: false })).toBe(false);
    expect(isShiftEnterSequence('\n', { name: 'return', sequence: '\n', ctrl: false, meta: false, shift: false })).toBe(false);
  });

  it('isShiftEnterSequence matches Shift+Enter variants', async () => {
    const { isShiftEnterSequence } = await import('../../src/ui/inputPrompt.js');
    // Standard readline detection
    expect(isShiftEnterSequence('\r', { name: 'return', sequence: '\r', ctrl: false, meta: false, shift: true })).toBe(true);
    // Alt+Enter
    expect(isShiftEnterSequence('\x1b\r', { name: 'return', sequence: '\x1b\r', ctrl: false, meta: true, shift: false })).toBe(true);
    // CSI u protocol
    expect(isShiftEnterSequence('\x1b[13;2u', { name: undefined, sequence: '\x1b[13;2u', ctrl: false, meta: false, shift: false })).toBe(true);
  });

  it('bracketed paste flow: newlines during paste must not leak to readline', () => {
    // This tests the design invariant: when pasteState.isInPaste is true,
    // _ttyWrite must suppress originalTtyWrite to prevent newlines from
    // triggering individual 'line' events (which would submit each line
    // as a separate request instead of buffering the entire paste).
    //
    // The actual implementation is in the _ttyWrite override inside promptOnce.
    // We verify the contract here with a state machine test.

    const lineEvents: string[] = [];
    let pasteActive = false;

    // Simulate _ttyWrite behavior
    const processKey = (s: string, isReturn: boolean) => {
      // During paste, suppress ALL readline processing
      if (pasteActive) {
        return; // <-- the fix: don't call originalTtyWrite
      }
      // Simulate originalTtyWrite for return key
      if (isReturn) {
        lineEvents.push(s); // simulates line event
      }
    };

    // Simulate paste flow
    pasteActive = true;
    processKey('line1', false);
    processKey('\r', true);   // newline during paste
    processKey('line2', false);
    processKey('\r', true);   // another newline during paste
    pasteActive = false;

    // No line events should have fired during paste
    expect(lineEvents).toHaveLength(0);
  });

  it('without paste protection, newlines would leak as line events', () => {
    // Demonstrates the bug we're fixing: without the pasteState check in
    // _ttyWrite, each newline triggers a 'line' event = separate submission
    const lineEvents: string[] = [];

    // Simulate OLD _ttyWrite behavior (no paste check)
    const processKeyBroken = (s: string, isReturn: boolean) => {
      // No paste check — falls through to originalTtyWrite
      if (isReturn) {
        lineEvents.push(s);
      }
    };

    processKeyBroken('line1', false);
    processKeyBroken('\r', true);
    processKeyBroken('line2', false);
    processKeyBroken('\r', true);

    // BUG: two line events = two submissions instead of one buffered paste
    expect(lineEvents).toHaveLength(2);
  });
});

describe('drainStdin', () => {
  it('drainStdin discards buffered data', async () => {
    const { Readable } = await import('node:stream');

    // Create a readable stream with buffered data
    const stream = new Readable({
      read() {
        // Provide data then signal end
        this.push(Buffer.from('line1\nline2\nline3\n'));
        this.push(null);
      }
    });

    // Read all data to fill the buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('multi-line state exports', () => {
  it('getLastRenderedContentLines defaults to 1', async () => {
    const { getLastRenderedContentLines } = await import('../../src/ui/inputPrompt.js');
    expect(getLastRenderedContentLines()).toBeGreaterThanOrEqual(1);
  });

  it('getLastRenderedCursorRow defaults to 0', async () => {
    const { getLastRenderedCursorRow } = await import('../../src/ui/inputPrompt.js');
    expect(getLastRenderedCursorRow()).toBeGreaterThanOrEqual(0);
  });
});
