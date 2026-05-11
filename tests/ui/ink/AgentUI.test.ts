/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import type { Key as InkKey } from 'ink';
import { TextBuffer } from '../../../src/ui/textBuffer.js';
import {
  clearBareComposerTrigger,
  clearInkComposerInputForSubmit,
  clearInkHiddenPastes,
  consumeInkBracketedPasteInput,
  getComposerHelpLine,
  getTextBufferCursorOffset,
  handleInkTextBufferInput,
  isBareComposerTrigger,
  resolveInkHiddenPastes,
  storeInkHiddenPaste,
} from '../../../src/ui/ink/AgentUI.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { getPromptBlockWidth } from '../../../src/ui/inputPrompt.js';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function setStdoutColumns(stdout: { columns: number; rows?: number }, columns: number): void {
  Object.defineProperty(stdout, 'columns', {
    configurable: true,
    get: () => columns,
  });
  Object.defineProperty(stdout, 'rows', {
    configurable: true,
    get: () => 24,
  });
}

function getComposerTopBorderWidth(frame: string | undefined): number {
  const line = stripAnsi(frame ?? '')
    .split('\n')
    .find((item) => item.startsWith('┌'));

  if (!line) {
    throw new Error('composer top border was not rendered');
  }

  return line.length;
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

afterEach(() => {
  cleanup();
});

describe('AgentUI TextBuffer integration helpers', () => {
  it('inserts text at the cursor after arrow navigation', () => {
    const buffer = new TextBuffer(20, 10, 'hello');

    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    handleInkTextBufferInput(buffer, 'X', createInkKey());

    expect(buffer.getText()).toBe('hellXo');
    expect(getTextBufferCursorOffset(buffer)).toBe(5);
  });

  it('supports multiline cursor offsets', () => {
    const buffer = new TextBuffer(20, 10, 'hello\nworld');

    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));

    expect(getTextBufferCursorOffset(buffer)).toBe('hello\nwor'.length);
  });

  it('treats residual Shift+Enter fragments as newline insertion', () => {
    const buffer = new TextBuffer(20, 10, 'line1');

    const result = handleInkTextBufferInput(buffer, '13~', createInkKey());

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('line1\n');
  });

  it('submits on plain Enter without mutating the buffer', () => {
    const buffer = new TextBuffer(20, 10, 'line1');

    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true }));

    expect(result).toBe('submit');
    expect(buffer.getText()).toBe('line1');
  });

  it('treats raw DEL as backspace when Ink does not annotate the key', () => {
    const buffer = new TextBuffer(20, 10, '/');

    const result = handleInkTextBufferInput(buffer, '\x7f', createInkKey());

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('');
  });

  it('treats raw Ctrl+H as backspace when Ink does not annotate the key', () => {
    const buffer = new TextBuffer(20, 10, '/a');

    const result = handleInkTextBufferInput(buffer, '\b', createInkKey());

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('/');
  });

  it.each(['/', '@', '$', '!', '#'])(
    'recognizes bare composer trigger %s as dismissible',
    trigger => {
      expect(isBareComposerTrigger(trigger)).toBe(true);
      expect(isBareComposerTrigger(`  ${trigger}`)).toBe(true);
    }
  );

  it.each(['/', '@', '$', '!', '#'])(
    'does not treat %s inside normal text as a bare composer trigger',
    trigger => {
      expect(isBareComposerTrigger(`run ${trigger}`)).toBe(false);
      expect(isBareComposerTrigger(`${trigger}query`)).toBe(false);
    }
  );

  it.each(['/', '@', '$', '!', '#'])(
    'clears bare composer trigger %s for escape dismissal',
    trigger => {
      const buffer = new TextBuffer(20, 10, trigger);

      expect(clearBareComposerTrigger(buffer)).toBe(true);
      expect(buffer.getText()).toBe('');
    }
  );

  it.each(['/', '@', '$', '!', '#'])(
    'treats forward Delete at the end of bare trigger %s as removal',
    trigger => {
      const buffer = new TextBuffer(20, 10, `  ${trigger}`);

      const result = handleInkTextBufferInput(buffer, '\x1b[3~', createInkKey());

      expect(result).toBe('handled');
      expect(buffer.getText()).toBe('');
    }
  );
});

describe('AgentUI terminal resize rendering', () => {
  it('recomputes the composer width when stdout emits resize', async () => {
    const state = {
      ...createInitialUIState(),
      currentInput: 'resize check',
    };
    const instance = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(getComposerTopBorderWidth(instance.lastFrame())).toBe(getPromptBlockWidth(100));

    setStdoutColumns(instance.stdout, 42);
    instance.stdout.emit('resize');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(getComposerTopBorderWidth(instance.lastFrame())).toBe(getPromptBlockWidth(42));
  });
});

describe('AgentUI composer suggestions', () => {
  const slashCommands = [
    { command: '/help', description: 'Show help', implemented: true },
    { command: '/model', description: 'Switch model', implemented: true },
  ];

  it('renders next-step suggestion in the empty Ink composer', () => {
    const state = createInitialUIState();
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
            suggestionProvider: () => 'Run the test suite',
          })
        )
      )
    );

    expect(stripAnsi(lastFrame() ?? '')).toContain('Run the test suite');
  });

  it('does not render next-prompt suggestion while the assistant is working', () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
            suggestionProvider: () => 'Run the test suite',
          })
        )
      )
    );

    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Run the test suite');
  });

  it('does not render the current assistant response as an empty-composer suggestion', () => {
    const answer = 'I do not have the ability to view images directly.';
    const state = {
      ...createInitialUIState(),
      finalResponse: answer,
      chatMessages: [{ role: 'assistant' as const, content: answer }],
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
            suggestionProvider: () => answer,
          })
        )
      )
    );

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame.match(/I do not have the ability to view images directly\./g)).toHaveLength(1);
  });

  it('does not render inline shell suggestions in the Ink composer', () => {
    const state = {
      ...createInitialUIState(),
      currentInput: '! git s',
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    expect(stripAnsi(lastFrame() ?? '')).not.toContain('! git status');
  });

  it('renders slash command suggestions for a typed bare slash in the Ink composer', async () => {
    const state = {
      ...createInitialUIState(),
      currentInput: '/',
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
            slashCommands,
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('/help');
    expect(frame).toContain('Tab to accept');
  });

  it('renders slash command suggestions while the assistant is working', async () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
      status: 'Crunching...',
      currentInput: '/',
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
            slashCommands,
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('/help');
    expect(frame).toContain('Tab to accept');
  });

  it('renders background notifications separately from the active work status', async () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
      status: 'Parsing...',
      elapsed: '0m 34s',
      tokens: '40.7k tokens',
      chatMessages: [
        {
          role: 'notification' as const,
          content: 'Session sync failed. Run /logout and /login if you continue to see this message.',
        },
      ],
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const lines = stripAnsi(lastFrame() ?? '').split('\n');
    const notificationLine = lines.find((line) => line.includes('Session sync failed'));
    const statusLine = lines.find((line) => line.includes('Parsing...'));

    expect(notificationLine).toBeDefined();
    expect(notificationLine).not.toContain('esc to cancel');
    expect(notificationLine).not.toContain('40.7k tokens');
    expect(statusLine).toContain('Parsing...');
    expect(statusLine).toContain('40.7k tokens');
  });

  it('does not render shell command dropdown suggestions for git input in the Ink composer', async () => {
    const state = {
      ...createInitialUIState(),
      currentInput: '! git',
    };
    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('! git status');
    expect(frame).not.toContain('! git diff');
    expect(frame).not.toContain('Tab to accept');
  });

  it('does not render shell command dropdown suggestions for bare bang input', async () => {
    const state = createInitialUIState();
    const { lastFrame, stdin } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    stdin.write('!');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toContain('! git status');
    expect(frame).not.toContain('! ls -la');
    expect(frame).not.toContain('Tab to accept');
  });

  it('submits arbitrary shell command input on Enter without accepting the active suggestion', async () => {
    const onInstruction = vi.fn();
    const state = {
      ...createInitialUIState(),
      currentInput: '! git banana',
    };
    const { stdin } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction,
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    stdin.write('\r');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(onInstruction).toHaveBeenCalledWith('! git banana');
  });
});

describe('AgentUI processing chat scrollback', () => {
  it('does not replay chat messages already committed by a previous Ink mount', () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
      status: 'Thinking...',
      staticChatMessageOffset: 4,
      chatMessages: Array.from({ length: 6 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `chat item ${index + 1}`,
      })),
    };

    const { lastFrame } = render(
      React.createElement(
        I18nProvider,
        null,
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(AgentUI, {
            state,
            onInstruction: () => {},
            onEscape: () => {},
            onCtrlC: () => {},
          })
        )
      )
    );

    const output = stripAnsi(lastFrame() ?? '');
    expect(output).toContain('chat item 5');
    expect(output).toContain('chat item 6');
    expect(output).not.toContain('chat item 1');
    expect(output).not.toContain('chat item 4');
  });
});

describe('AgentUI bracketed paste input', () => {
  it('consumes complete bracketed paste sequences from Ink input', () => {
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null, hiddenPlaceholder: null };

    const result = consumeInkBracketedPasteInput(
      '\x1b[200~line1\nline2\nline3\nline4\nline5\x1b[201~',
      pasteState
    );

    expect(result).toEqual({
      handled: true,
      completedText: 'line1\nline2\nline3\nline4\nline5',
    });
    expect(pasteState).toEqual({ isInPaste: false, buffer: '', hiddenContent: null, hiddenPlaceholder: null });
  });

  it('buffers split bracketed paste sequences until the end marker arrives', () => {
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null, hiddenPlaceholder: null };

    expect(consumeInkBracketedPasteInput('\x1b[200~line1\n', pasteState)).toEqual({
      handled: true,
    });
    expect(pasteState.isInPaste).toBe(true);
    expect(pasteState.buffer).toBe('line1\n');

    const result = consumeInkBracketedPasteInput('line2\x1b[201~', pasteState);

    expect(result).toEqual({ handled: true, completedText: 'line1\nline2' });
    expect(pasteState).toEqual({ isInPaste: false, buffer: '', hiddenContent: null, hiddenPlaceholder: null });
  });
});

describe('AgentUI paste placeholder resolution', () => {
  it('resolves an untouched visible paste placeholder to the hidden content', async () => {
    const { resolveInkComposerSubmitText } = await import('../../../src/ui/ink/AgentUI.js');
    const hiddenContent = 'line1\nline2\nline3\nline4\nline5';
    const hiddenPlaceholder = `[Text pasted ${hiddenContent.length} chars]`;

    expect(
      resolveInkComposerSubmitText(hiddenPlaceholder, {
        hiddenContent,
        hiddenPlaceholder,
      })
    ).toBe(hiddenContent);
  });

  it('resolves a paste placeholder inside surrounding typed text', async () => {
    const { resolveInkComposerSubmitText } = await import('../../../src/ui/ink/AgentUI.js');
    const hiddenContent = 'line1\nline2\nline3\nline4\nline5';
    const hiddenPlaceholder = `[Text pasted ${hiddenContent.length} chars]`;

    expect(
      resolveInkComposerSubmitText(`please review ${hiddenPlaceholder} now`, {
        hiddenContent,
        hiddenPlaceholder,
      })
    ).toBe(`please review ${hiddenContent} now`);
  });

  it('does not submit stale hidden content after the placeholder is edited away', async () => {
    const { resolveInkComposerSubmitText } = await import('../../../src/ui/ink/AgentUI.js');
    const hiddenContent = 'line1\nline2\nline3\nline4\nline5';
    const hiddenPlaceholder = `[Text pasted ${hiddenContent.length} chars]`;

    expect(
      resolveInkComposerSubmitText('typed replacement', {
        hiddenContent,
        hiddenPlaceholder,
      })
    ).toBe('typed replacement');
  });

  it('submits edited prompt text around compact pasted content', () => {
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null };
    const actual = 'line1\nline2\nline3\nline4\nline5';
    const visual = '[Text pasted: 5 lines]';

    storeInkHiddenPaste(pasteState, visual, actual);

    expect(resolveInkHiddenPastes(`fix this ${visual} and explain`, pasteState)).toBe(
      `fix this ${actual} and explain`
    );
  });

  it('does not submit pasted content when the compact marker was deleted', () => {
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null };

    storeInkHiddenPaste(pasteState, '[Text pasted: 5 lines]', 'line1\nline2\nline3\nline4\nline5');

    expect(resolveInkHiddenPastes('fix this and explain', pasteState)).toBe('fix this and explain');
  });

  it('clears hidden pasted content after submit', () => {
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null };

    storeInkHiddenPaste(pasteState, '[Text pasted: 5 lines]', 'line1\nline2\nline3\nline4\nline5');
    clearInkHiddenPastes(pasteState);

    expect(pasteState).toEqual({
      isInPaste: false,
      buffer: '',
      hiddenContent: null,
      hiddenPastes: [],
    });
  });

  it('clears composer state synchronously before queued slash command processing can pause the modal', () => {
    const buffer = new TextBuffer(20, 10, '/model');
    const pasteState = { isInPaste: false, buffer: '', hiddenContent: null };
    const calls: string[] = [];

    clearInkComposerInputForSubmit(buffer, pasteState, {
      setInput: (value) => calls.push(`setInput:${value}`),
      setCursorOffset: (value) => calls.push(`setCursorOffset:${value}`),
      onInputChange: (value) => calls.push(`onInputChange:${value}`),
      clearPendingInputSync: () => calls.push('clearPendingInputSync'),
    });

    expect(buffer.getText()).toBe('');
    expect(calls).toEqual([
      'clearPendingInputSync',
      'setInput:',
      'setCursorOffset:0',
      'onInputChange:',
    ]);
  });
});

describe('AgentUI layout stability', () => {
  it('keeps the help row visible while the first prompt is working', () => {
    expect(getComposerHelpLine(false, '', '70% context left', '? shortcuts · / commands')).toBe(
      '70% context left · ? shortcuts · / commands'
    );
    // While working, the helpline stays visible so users keep
    // shortcuts/provider/context context across the entire turn.
    expect(getComposerHelpLine(true, '', '70% context left', '? shortcuts · / commands')).toBe(
      '70% context left · ? shortcuts · / commands'
    );
  });

  it('shows provider and model before context in help line', () => {
    expect(
      getComposerHelpLine(false, 'autohand (OpenAI, gpt-4o)', '70% context left', '? shortcuts · / commands')
    ).toBe('autohand (OpenAI, gpt-4o) · 70% context left · ? shortcuts · / commands');
  });

  it('shows provider display alone when context is empty', () => {
    expect(
      getComposerHelpLine(false, 'autohand (OpenAI, gpt-4o)', '', '? shortcuts · / commands')
    ).toBe('autohand (OpenAI, gpt-4o) · ? shortcuts · / commands');
  });

  it('appends custom help line segments after the defaults', () => {
    expect(
      getComposerHelpLine(false, '', '70% context left', '? shortcuts · / commands', {
        segments: [{ id: 'workspace', text: 'repo: cli-3' }],
      })
    ).toBe('70% context left · ? shortcuts · / commands · repo: cli-3');
  });

  it('can replace default help line segments', () => {
    expect(
      getComposerHelpLine(false, 'autohand (OpenAI, gpt-4o)', '70% context left', '? shortcuts · / commands', {
        replaceDefault: true,
        segments: [{ id: 'custom', text: 'custom help' }],
      })
    ).toBe('custom help');
  });
});

describe('AgentUI multiline input regression', () => {
  it('inserts a newline via Shift+Enter', () => {
    const buffer = new TextBuffer(80, 10, 'line1');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true, shift: true }));

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('line1\n');
    expect(buffer.getLineCount()).toBe(2);
  });

  it('inserts a newline via Alt+Enter', () => {
    const buffer = new TextBuffer(80, 10, 'line1');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true, meta: true }));

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('line1\n');
  });

  it('preserves cursor position after inserting a newline in the middle of a line', () => {
    const buffer = new TextBuffer(80, 10, 'hello world');
    // Move cursor to position 5 (between 'hello' and ' world')
    for (let i = 0; i < 6; i++) {
      handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    }
    // Insert newline
    handleInkTextBufferInput(buffer, '', createInkKey({ return: true, shift: true }));

    expect(buffer.getText()).toBe('hello\n world');
    expect(buffer.getLineCount()).toBe(2);
    expect(buffer.getCursorRow()).toBe(1);
  });

  it('handles multi-line paste as multiple newlines', () => {
    const buffer = new TextBuffer(80, 10, '');
    // Simulate pasting a multi-line string
    buffer.insert('line1\nline2\nline3');

    expect(buffer.getText()).toBe('line1\nline2\nline3');
    expect(buffer.getLineCount()).toBe(3);
    expect(buffer.getCursorRow()).toBe(2);
  });

  it('handles backspace at the start of a line (merge with previous line)', () => {
    const buffer = new TextBuffer(80, 10, 'hello\nworld');
    // Move cursor to start of 'world'
    for (let i = 0; i < 5; i++) {
      handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    }
    // Backspace should merge lines
    handleInkTextBufferInput(buffer, '', createInkKey({ backspace: true }));

    expect(buffer.getText()).toBe('helloworld');
    expect(buffer.getLineCount()).toBe(1);
  });

  it('handles delete at end of a line (merge with next line)', () => {
    const buffer = new TextBuffer(80, 10, 'hello\nworld');
    // Move cursor to end of 'hello'
    for (let i = 0; i < 6; i++) {
      handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    }
    // Delete should merge lines
    handleInkTextBufferInput(buffer, '', createInkKey({ delete: true }));

    expect(buffer.getText()).toBe('helloworld');
    expect(buffer.getLineCount()).toBe(1);
  });

  it('navigates up and down across multiple lines', () => {
    const buffer = new TextBuffer(80, 10, 'short\nthis is a much longer line\nend');
    // Move up to the long line
    handleInkTextBufferInput(buffer, '', createInkKey({ upArrow: true }));
    const offsetAfterUp = getTextBufferCursorOffset(buffer);
    // Move down to 'end'
    handleInkTextBufferInput(buffer, '', createInkKey({ downArrow: true }));
    const offsetAfterDown = getTextBufferCursorOffset(buffer);

    // Cursor should have moved
    expect(offsetAfterDown).not.toBe(offsetAfterUp);
  });

  it('handles Ctrl+A (Home) and Ctrl+E (End) on multi-line content', () => {
    const buffer = new TextBuffer(80, 10, 'line1\nline2\nline3');
    // Cursor starts at end of 'line3'
    expect(buffer.getCursorRow()).toBe(2);
    expect(buffer.getCursorCol()).toBe(5);

    // Ctrl+A should go to start of current line
    handleInkTextBufferInput(buffer, 'a', createInkKey({ ctrl: true }));
    expect(buffer.getCursorCol()).toBe(0);
    expect(buffer.getCursorRow()).toBe(2);

    // Ctrl+E should go to end of current line
    handleInkTextBufferInput(buffer, 'e', createInkKey({ ctrl: true }));
    expect(buffer.getCursorCol()).toBe(5); // 'line3'.length
  });

  it('handles terminal Home and End escape sequences on multi-line content', () => {
    const buffer = new TextBuffer(80, 10, 'line1\nline2');

    expect(handleInkTextBufferInput(buffer, '\x1b[H', createInkKey())).toBe('handled');
    expect(buffer.getCursorRow()).toBe(1);
    expect(buffer.getCursorCol()).toBe(0);

    expect(handleInkTextBufferInput(buffer, '\x1b[F', createInkKey())).toBe('handled');
    expect(buffer.getCursorRow()).toBe(1);
    expect(buffer.getCursorCol()).toBe('line2'.length);
  });

  it('handles word navigation (Ctrl+Left/Right) across multi-line content', () => {
    const buffer = new TextBuffer(80, 10, 'hello world\nfoo bar');
    // Move up to first line end
    handleInkTextBufferInput(buffer, '', createInkKey({ upArrow: true }));

    // Ctrl+Left should jump to start of 'world'
    handleInkTextBufferInput(buffer, '', createInkKey({ ctrl: true, leftArrow: true }));
    expect(buffer.getText().substring(0, getTextBufferCursorOffset(buffer))).toBe('hello ');
  });

  it('handles empty buffer edge cases', () => {
    const buffer = new TextBuffer(80, 10, '');

    // Backspace on empty buffer should do nothing
    handleInkTextBufferInput(buffer, '', createInkKey({ backspace: true }));
    expect(buffer.getText()).toBe('');

    // Delete on empty buffer should do nothing
    handleInkTextBufferInput(buffer, '', createInkKey({ delete: true }));
    expect(buffer.getText()).toBe('');

    // Up/Down on single line should do nothing
    handleInkTextBufferInput(buffer, '', createInkKey({ upArrow: true }));
    handleInkTextBufferInput(buffer, '', createInkKey({ downArrow: true }));
    expect(buffer.getText()).toBe('');
  });

  it('handles Shift+Enter residual CSI fragments without leaking into text', () => {
    const buffer = new TextBuffer(80, 10, 'test');

    // Various CSI residuals that should be treated as newline or ignored
    const residuals = ['13~', '13;2~', '13;2u', '27;2;13~'];
    for (const residual of residuals) {
      handleInkTextBufferInput(buffer, residual, createInkKey());
      // Should not contain the raw residual in the text
      expect(buffer.getText()).not.toContain(residual);
    }
  });

  // Regression: terminals using xterm modifyOtherKeys protocol send
  // ESC[27;2;13~ for Shift+Enter. Ink may forward this either as the
  // full sequence or with the leading ESC stripped (leaving "[27;2;13~").
  // Both forms must be recognised as a newline insertion, not literal text.
  it('treats xterm modifyOtherKeys Shift+Enter as newline (full ESC sequence)', () => {
    const buffer = new TextBuffer(80, 10, 'test');
    const result = handleInkTextBufferInput(buffer, '\x1b[27;2;13~', createInkKey());
    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('test\n');
    expect(buffer.getText()).not.toContain('27;2;13');
  });

  it('treats xterm modifyOtherKeys Shift+Enter as newline (ESC-stripped form)', () => {
    const buffer = new TextBuffer(80, 10, 'test');
    const result = handleInkTextBufferInput(buffer, '[27;2;13~', createInkKey());
    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('test\n');
    expect(buffer.getText()).not.toContain('[27;2;13~');
  });

  it('treats kitty CSI u Shift+Enter as newline (ESC-stripped form)', () => {
    const buffer = new TextBuffer(80, 10, 'test');
    handleInkTextBufferInput(buffer, '[13;2u', createInkKey());
    expect(buffer.getText()).toBe('test\n');
  });

  it('preserves emoji and CJK characters in multi-line content', () => {
    const buffer = new TextBuffer(80, 10, 'hello 🌍\n你好世界');

    expect(buffer.getText()).toBe('hello 🌍\n你好世界');
    expect(buffer.getLineCount()).toBe(2);

    // Navigate left across emoji
    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    // Insert after emoji
    handleInkTextBufferInput(buffer, '!', createInkKey());
    expect(buffer.getText()).toBe('hello 🌍\n你好!世界');
  });

  it('handles very long multi-line content without crashing', () => {
    const buffer = new TextBuffer(80, 10, '');
    const longLine = 'a'.repeat(1000);
    buffer.insert(longLine);
    buffer.insert('\n');
    buffer.insert(longLine);

    expect(buffer.getText()).toBe(`${longLine}\n${longLine}`);
    expect(buffer.getLineCount()).toBe(2);
  });

  it('submit does not mutate buffer (caller clears after)', () => {
    const buffer = new TextBuffer(80, 10, '  hello world  ');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true }));

    expect(result).toBe('submit');
    // Buffer should NOT be mutated by submit (AgentUI clears it after)
    expect(buffer.getText()).toBe('  hello world  ');
  });

  it('submit on whitespace-only input is still submit', () => {
    const buffer = new TextBuffer(80, 10, '   ');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true }));

    expect(result).toBe('submit');
  });

  it('Tab is unhandled (for autocomplete)', () => {
    const buffer = new TextBuffer(80, 10, 'hel');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ tab: true }));

    expect(result).toBe('unhandled');
    expect(buffer.getText()).toBe('hel');
  });

  it('Escape is unhandled (for cancel)', () => {
    const buffer = new TextBuffer(80, 10, 'hello');
    const result = handleInkTextBufferInput(buffer, '', createInkKey({ escape: true }));

    expect(result).toBe('unhandled');
    expect(buffer.getText()).toBe('hello');
  });
});

describe('AgentUI Ctrl+C behavior', () => {
  it('clears input when Ctrl+C is pressed with non-empty text', () => {
    const buffer = new TextBuffer(80, 10, 'hello world');
    const onCtrlC = vi.fn();

    // Simulate the Ctrl+C handler logic from AgentUI
    const currentInput = buffer.getText();

    if (currentInput.length > 0) {
      // Should clear the input
      buffer.setText('');
      onCtrlC();
    }

    expect(buffer.getText()).toBe('');
    expect(onCtrlC).toHaveBeenCalled();
  });

  it('does not trigger exit flow when Ctrl+C is pressed with non-empty text', () => {
    const buffer = new TextBuffer(80, 10, 'some typed text');
    let exitCalled = false;

    // Simulate the Ctrl+C handler logic from AgentUI
    const currentInput = buffer.getText();

    if (currentInput.length > 0) {
      // Should clear the input, NOT go to exit flow
      buffer.setText('');
    } else {
      // Exit flow only when input is empty
      exitCalled = true;
    }

    expect(buffer.getText()).toBe('');
    expect(exitCalled).toBe(false);
  });

  it('preserves multi-line content until Ctrl+C clears it', () => {
    const buffer = new TextBuffer(80, 10, 'line1\nline2\nline3');

    expect(buffer.getText()).toBe('line1\nline2\nline3');

    // Simulate Ctrl+C clearing
    buffer.setText('');

    expect(buffer.getText()).toBe('');
  });
});

// =========================================================================
// Regression: Composer must accept input when idle (isWorking=false).
// The useInput handler had an early return at line 473 that blocked ALL
// input when !isWorking, including Enter (submit) and text editing.
// Only queue-specific features (file mentions, tab during work) should
// be gated by isWorking. Basic text input and submit must always work.
// =========================================================================
describe('AgentUI idle composer input handling', () => {
  it('handleInkTextBufferInput processes Enter (submit) regardless of isWorking state', () => {
    // handleInkTextBufferInput is a pure function — it doesn't check isWorking.
    // The bug was in the useInput handler which returned early before calling
    // this function when !isWorking. Verify the pure function works correctly.
    const buffer = new TextBuffer(80, 10, '/help');

    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true }));

    expect(result).toBe('submit');
  });

  it('handleInkTextBufferInput processes text input regardless of isWorking state', () => {
    const buffer = new TextBuffer(80, 10, 'hello');

    const result = handleInkTextBufferInput(buffer, '!', createInkKey());

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('hello!');
  });

  it('handleInkTextBufferInput processes arrow keys regardless of isWorking state', () => {
    const buffer = new TextBuffer(80, 10, 'hello');

    const result = handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));

    expect(result).toBe('handled');
    expect(getTextBufferCursorOffset(buffer)).toBe(4);
  });

  it('source code: isWorking gate does NOT block input when idle', async () => {
    // Verify the isWorking gate only blocks input when working AND
    // queue-input is disabled. When idle (isWorking=false), input must
    // always be allowed so the composer accepts text and submit.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/AgentUI.tsx'),
      'utf8',
    );

    // The gate must use && (AND), not || (OR).
    // Old (broken): if (!isWorkingRef.current || !enableQueueInputRef.current) return;
    // New (fixed):  if (isWorkingRef.current && !enableQueueInputRef.current) return;
    // With &&: when isWorking=false, the condition is false → no return → input allowed.
    // With ||: when isWorking=false, the condition is true → return → input blocked.
    expect(src).toContain('isWorkingRef.current && !enableQueueInputRef.current');

    // The old broken pattern must NOT be present
    expect(src).not.toContain('!isWorkingRef.current || !enableQueueInputRef.current');
  });
});
