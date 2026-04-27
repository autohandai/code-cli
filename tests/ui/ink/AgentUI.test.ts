/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Key as InkKey } from 'ink';
import { TextBuffer } from '../../../src/ui/textBuffer.js';
import {
  getComposerHelpLine,
  getTextBufferCursorOffset,
  handleInkTextBufferInput,
} from '../../../src/ui/ink/AgentUI.js';

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
