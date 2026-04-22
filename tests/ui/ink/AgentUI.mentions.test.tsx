/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render as inkRender, type Instance as InkInstance } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import { PassThrough, Writable } from 'node:stream';
import { AgentUI, createInitialUIState, handleInkTextBufferInput } from '../../../src/ui/ink/AgentUI.js';
import { FileMentionDropdown, matchFileMention, parseFileSuggestions } from '../../../src/ui/ink/FileMentionDropdown.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { TextBuffer } from '../../../src/ui/textBuffer.js';
import type { Key as InkKey } from 'ink';

function createMockStdout() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  (stream as any).columns = 80;
  (stream as any).rows = 24;
  (stream as any).isTTY = true;
  return {
    stream,
    lastFrame: () => {
      // Ink writes ANSI sequences; the last complete frame is the last chunk
      const last = chunks[chunks.length - 1];
      return last ? last.toString('utf8') : '';
    },
  };
}

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
    ...overrides,
  };
}

let lastInkInstance: InkInstance | null = null;

function renderAgentUIWithStdin(props: Partial<React.ComponentProps<typeof AgentUI>> = {}) {
  const stdin = new PassThrough();
  (stdin as any).isTTY = true;
  (stdin as any).setRawMode = () => {};
  (stdin as any).ref = () => {};
  (stdin as any).unref = () => {};

  const { stream, lastFrame } = createMockStdout();

  const instance = inkRender(
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
    ),
    {
      stdin: stdin as any,
      stdout: stream as any,
      stderr: stream as any,
      exitOnCtrlC: false,
      patchConsole: false,
    }
  );

  lastInkInstance = instance;
  return { stdin, lastFrame };
}

afterEach(() => {
  cleanup();
  if (lastInkInstance) {
    lastInkInstance.unmount();
    lastInkInstance.cleanup();
    lastInkInstance = null;
  }
});

describe('AgentUI @ mention handling', () => {
  const originalColumns = process.stdout.columns;

  beforeEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: 80,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
      configurable: true,
    });
  });

  it('accepts a file mention on Tab immediately after typing the seed', async () => {
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

  it('accepts the second suggestion when navigating down then Tab', async () => {
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

    await new Promise(r => setTimeout(r, 50));

    const frame = lastFrame();
    expect(frame).toContain('@src/core/agent.ts');
  });

  it('preserves text after the cursor when accepting a mention with Tab', async () => {
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

  it('dismisses the mention dropdown when the mention pattern is no longer matched', async () => {
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
    await new Promise(r => setTimeout(r, 50));

    const frameWithDropdown = lastFrame();
    // The dropdown renders filename and directory in separate columns,
    // so the full path isn't a contiguous substring.
    expect(frameWithDropdown).toContain('index.ts');
    expect(frameWithDropdown).toContain('Tab to accept');

    // Press space to dismiss mention
    stdin.write(' ');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 50));

    const frameAfterSpace = lastFrame();
    // Should no longer show the dropdown hint
    expect(frameAfterSpace).not.toContain('Tab to accept');
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
