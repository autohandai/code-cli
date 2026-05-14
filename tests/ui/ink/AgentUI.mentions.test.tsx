/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { AgentUI, createInitialUIState, handleInkTextBufferInput } from '../../../src/ui/ink/AgentUI.js';
import { FileMentionDropdown, matchFileMention, parseFileSuggestions } from '../../../src/ui/ink/FileMentionDropdown.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { TextBuffer } from '../../../src/ui/textBuffer.js';
import type { Key as InkKey } from 'ink';

function createInkKey(overrides: Partial<InkKey> = {}): InkKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    home: false,
    end: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

function renderAgentUIWithStdin(props: Partial<React.ComponentProps<typeof AgentUI>> = {}) {
  const { lastFrame, stdin } = render(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(AgentUI, {
          state: createInitialUIState(),
          onInstruction: () => {},
          onEscape: () => {},
          onCtrlC: () => {},
          ...props,
        })
      )
    )
  );

  return { stdin, lastFrame };
}

afterEach(() => {
  cleanup();
});

describe('AgentUI @ mention handling', () => {
  // Skip all mention handling tests with ink 7.0.0 + React 19 due to compatibility issues
  // with ink-testing-library v3.0.0. The core mention functionality is tested
  // by the unit tests below (matchFileMention, parseFileSuggestions, TextBuffer).
  beforeAll(() => {
    console.warn('Skipping AgentUI mention handling tests due to ink 7.0.0 + React 19 compatibility issues');
  });

  it.skip('accepts a file mention on Tab immediately after typing the seed', async () => {
    const { stdin, lastFrame } = renderAgentUIWithStdin({
      state: {
        ...createInitialUIState(),
        isWorking: true,
      },
      filesProvider: () => ['src/index.ts', 'src/core/agent.ts', 'package.json'],
    });
    // Give Ink time to mount before sending input
    await new Promise(r => setImmediate(r));

    // Type @sr rapidly — use setImmediate between writes so Ink processes
    // each keystroke individually rather than batching them into one chunk.
    stdin.write('@');
    await new Promise(r => setImmediate(r));
    stdin.write('s');
    await new Promise(r => setImmediate(r));
    stdin.write('r');
    await new Promise(r => setImmediate(r));
    // Press Tab immediately (before 16ms throttle flushes)
    stdin.write('\t');
    await new Promise(r => setImmediate(r));

    // Allow React to render after the 16ms throttle fires
    await new Promise(r => setTimeout(r, 50));

    const frame = lastFrame();
    // The mention should be inserted into the input line
    expect(frame).toContain('@src/index.ts');
  });

  it.skip('accepts the second suggestion when navigating down then Tab', async () => {
    const { stdin, lastFrame } = renderAgentUIWithStdin({
      state: {
        ...createInitialUIState(),
        isWorking: true,
      },
      filesProvider: () => ['src/index.ts', 'src/core/agent.ts', 'package.json'],
    });

    // Type @s
    stdin.write('@');
    await new Promise(r => setImmediate(r));
    stdin.write('s');
    await new Promise(r => setImmediate(r));
    // Wait for mention dropdown to appear
    await new Promise(r => setTimeout(r, 50));

    // Navigate down to second suggestion
    stdin.write('\x1b[B'); // Down arrow CSI
    await new Promise(r => setImmediate(r));
    // Press Tab
    stdin.write('\t');
    await new Promise(r => setImmediate(r));

    await new Promise(r => setTimeout(r, 100));

    const frame = lastFrame();
    expect(frame).toContain('@src/core/agent.ts');
  });

  it.skip('preserves text after the cursor when accepting a mention with Tab', async () => {
    const { stdin, lastFrame } = renderAgentUIWithStdin({
      state: {
        ...createInitialUIState(),
        isWorking: true,
      },
      filesProvider: () => ['src/index.ts', 'src/core/agent.ts'],
    });

    // Type "hello @sr world" with cursor before "world"
    // We need to move cursor back after typing
    for (const ch of 'hello @sr world') {
      stdin.write(ch);
      await new Promise(r => setImmediate(r));
    }
    // Move cursor left 6 times (" world".length)
    for (let i = 0; i < 6; i++) {
      stdin.write('\x1b[D'); // Left arrow
      await new Promise(r => setImmediate(r));
    }
    // Press Tab to accept mention
    stdin.write('\t');
    await new Promise(r => setImmediate(r));

    await new Promise(r => setTimeout(r, 50));

    const frame = lastFrame();
    // Should contain the full text with mention preserved and trailing text intact
    // The replacement includes a trailing space, and the original trailing text
    // had a leading space, so we end up with two spaces between mention and text.
    expect(frame).toContain('hello @src/index.ts  world');
  });

  it.skip('dismisses the mention dropdown when the mention pattern is no longer matched', async () => {
    // This test is flaky with ink 7.0.0 due to changes in rendering cycle timing
    // The core mention functionality is tested by other tests
    const { stdin, lastFrame } = renderAgentUIWithStdin({
      state: {
        ...createInitialUIState(),
        isWorking: true,
      },
      filesProvider: () => ['src/index.ts'],
    });

    // Type @s to trigger dropdown
    stdin.write('@');
    await new Promise(r => setImmediate(r));
    stdin.write('s');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 100));

    const frameWithDropdown = lastFrame();
    // The dropdown renders filename and directory in separate columns,
    // so the full path isn't a contiguous substring.
    expect(frameWithDropdown).toContain('index.ts');
    expect(frameWithDropdown).toContain('Tab to accept');

    // Press backspace twice to delete 's' and '@' to break the mention pattern
    stdin.write('\x7f'); // Backspace to delete 's'
    await new Promise(r => setImmediate(r));
    stdin.write('\x7f'); // Backspace to delete '@'
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 200));

    const frameAfterBackspace = lastFrame();
    // Should no longer show the dropdown hint
    expect(frameAfterBackspace).not.toContain('Tab to accept');
  });
});

describe('AgentUI Ctrl+C exit handling', () => {
  it('requests host exit on the second Ctrl+C with an empty composer', async () => {
    const onInstruction = vi.fn();
    const onCtrlC = vi.fn();
    const { stdin, lastFrame } = renderAgentUIWithStdin({
      state: {
        ...createInitialUIState(),
        isWorking: false,
      },
      onInstruction,
      onCtrlC,
    });

    await new Promise(r => setImmediate(r));

    stdin.write('\x03');
    await new Promise(r => setTimeout(r, 50));

    expect(onInstruction).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Press Ctrl+C again to exit');

    stdin.write('\x03');
    await new Promise(r => setTimeout(r, 50));

    expect(onInstruction).not.toHaveBeenCalled();
    expect(onCtrlC).toHaveBeenCalledOnce();
  });
});

describe('matchFileMention edge cases', () => {
  it('matches @ at the end of input', () => {
    const result = matchFileMention('hello @', 7);
    expect(result).toEqual({ seed: '', startIndex: 6 });
  });

  it('matches @ with a seed', () => {
    const result = matchFileMention('check @src', 10);
    expect(result).toEqual({ seed: 'src', startIndex: 6 });
  });

  it('matches @ even when preceded by a letter (current regex behaviour)', () => {
    // The current regex does not enforce a word boundary before @.
    const result = matchFileMention('email@example.com', 17);
    expect(result).toEqual({ seed: 'example.com', startIndex: 5 });
  });

  it('matches empty seed when cursor is immediately after @', () => {
    const result = matchFileMention('hello @src/world', 7);
    expect(result).toEqual({ seed: '', startIndex: 6 });
  });

  it('matches path-like seeds with slashes', () => {
    const result = matchFileMention('look at @src/core/', 18);
    expect(result).toEqual({ seed: 'src/core/', startIndex: 8 });
  });
});

describe('parseFileSuggestions', () => {
  it('parses paths into filename and directory', () => {
    const result = parseFileSuggestions(['src/index.ts', 'package.json']);
    expect(result).toEqual([
      { path: 'src/index.ts', filename: 'index.ts', directory: 'src' },
      { path: 'package.json', filename: 'package.json', directory: '' },
    ]);
  });
});

describe('FileMentionDropdown rendering', () => {
  it('renders visible suggestions with a selected indicator', () => {
    const { lastFrame } = render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(FileMentionDropdown, {
          suggestions: [
            { path: 'src/index.ts', filename: 'index.ts', directory: 'src' },
            { path: 'package.json', filename: 'package.json', directory: '' },
          ],
          activeIndex: 0,
          visible: true,
        })
      )
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('index.ts');
    expect(frame).toContain('package.json');
    expect(frame).toContain('▸');
  });

  it('returns null when not visible', () => {
    const { lastFrame } = render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(FileMentionDropdown, {
          suggestions: [{ path: 'a.ts', filename: 'a.ts', directory: '' }],
          activeIndex: 0,
          visible: false,
        })
      )
    );
    expect(lastFrame()).toBe('');
  });
});

describe('TextBuffer mention insertion', () => {
  it('inserts mention replacing seed and preserving trailing text', () => {
    const buffer = new TextBuffer(80, 10, 'hello @sr world');
    // Move cursor back 6 chars so it's after '@sr'
    for (let i = 0; i < 6; i++) {
      handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    }

    const cursorOffset = buffer.getText().length - 6; // position after '@sr'
    const mentionStartIndex = buffer.getText().indexOf('@');
    const suggestion = { path: 'src/index.ts', filename: 'index.ts', directory: 'src' };

    const currentText = buffer.getText();
    const beforeMention = currentText.slice(0, mentionStartIndex);
    const afterCursor = currentText.slice(cursorOffset);
    const replacement = `@${suggestion.path} `;
    const newText = beforeMention + replacement + afterCursor;
    buffer.setText(newText);

    expect(buffer.getText()).toBe('hello @src/index.ts  world');
  });
});
