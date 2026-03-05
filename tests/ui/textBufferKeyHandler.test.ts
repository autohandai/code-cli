/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { handleTextBufferKey } from '../../src/ui/textBufferKeyHandler.js';
import { TextBuffer } from '../../src/ui/textBuffer.js';

// Helper to create readline-compatible key objects
function makeKey(
  name: string,
  opts: Partial<{
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    sequence: string;
  }> = {},
): {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
} {
  return { name, ...opts };
}

describe('handleTextBufferKey', () => {
  describe('printable characters', () => {
    it('inserts single character', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, 'a', makeKey('a'));
      expect(result).toBe('handled');
      expect(buf.getText()).toBe('a');
    });

    it('inserts multiple characters (paste-like)', () => {
      const buf = new TextBuffer(80, 10);
      handleTextBufferKey(buf, 'abc', makeKey('a'));
      expect(buf.getText()).toBe('abc');
    });

    it('inserts unicode characters', () => {
      const buf = new TextBuffer(80, 10);
      handleTextBufferKey(buf, '\u00e9', makeKey('\u00e9'));
      expect(buf.getText()).toBe('\u00e9');
    });

    it('inserts emoji', () => {
      const buf = new TextBuffer(80, 10);
      handleTextBufferKey(buf, '\u{1F600}', makeKey('\u{1F600}'));
      expect(buf.getText()).toBe('\u{1F600}');
    });

    it('appends to existing text', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      handleTextBufferKey(buf, ' ', makeKey('space'));
      handleTextBufferKey(buf, 'world', makeKey('w'));
      expect(buf.getText()).toBe('hello world');
    });
  });

  describe('backspace and delete', () => {
    it('handles backspace', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      handleTextBufferKey(buf, '', makeKey('backspace'));
      expect(buf.getText()).toBe('a');
    });

    it('handles backspace at start of buffer (no-op)', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('backspace'));
      expect(buf.getText()).toBe('ab');
    });

    it('handles delete key', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('delete'));
      expect(buf.getText()).toBe('b');
    });

    it('handles delete at end of buffer (no-op)', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      handleTextBufferKey(buf, '', makeKey('delete'));
      expect(buf.getText()).toBe('ab');
    });

    it('backspace merges lines', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(1, 0);
      handleTextBufferKey(buf, '', makeKey('backspace'));
      expect(buf.getText()).toBe('helloworld');
    });
  });

  describe('arrow keys', () => {
    it('handles left arrow', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      handleTextBufferKey(buf, '', makeKey('left'));
      expect(buf.getCursorCol()).toBe(1);
    });

    it('handles right arrow', () => {
      const buf = new TextBuffer(80, 10, 'ab');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('right'));
      expect(buf.getCursorCol()).toBe(1);
    });

    it('handles up arrow', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      handleTextBufferKey(buf, '', makeKey('up'));
      expect(buf.getCursorRow()).toBe(0);
    });

    it('handles down arrow', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('down'));
      expect(buf.getCursorRow()).toBe(1);
    });

    it('left arrow wraps to previous line', () => {
      const buf = new TextBuffer(80, 10, 'abc\ndef');
      buf.setCursor(1, 0);
      handleTextBufferKey(buf, '', makeKey('left'));
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(3);
    });

    it('right arrow wraps to next line', () => {
      const buf = new TextBuffer(80, 10, 'abc\ndef');
      buf.setCursor(0, 3);
      handleTextBufferKey(buf, '', makeKey('right'));
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(0);
    });
  });

  describe('home and end', () => {
    it('handles home', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      handleTextBufferKey(buf, '', makeKey('home'));
      expect(buf.getCursorCol()).toBe(0);
    });

    it('handles end', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('end'));
      expect(buf.getCursorCol()).toBe(5);
    });

    it('handles Ctrl+A as home', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      handleTextBufferKey(buf, '\x01', makeKey('a', { ctrl: true }));
      expect(buf.getCursorCol()).toBe(0);
    });

    it('handles Ctrl+E as end', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '\x05', makeKey('e', { ctrl: true }));
      expect(buf.getCursorCol()).toBe(5);
    });
  });

  describe('word navigation', () => {
    it('handles Ctrl+Left for word left', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      handleTextBufferKey(buf, '', makeKey('left', { ctrl: true }));
      expect(buf.getCursorCol()).toBe(6);
    });

    it('handles Ctrl+Right for word right', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('right', { ctrl: true }));
      expect(buf.getCursorCol()).toBe(5);
    });

    it('handles Alt+Left for word left', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      handleTextBufferKey(buf, '', makeKey('left', { meta: true }));
      expect(buf.getCursorCol()).toBe(6);
    });

    it('handles Alt+Right for word right', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 0);
      handleTextBufferKey(buf, '', makeKey('right', { meta: true }));
      expect(buf.getCursorCol()).toBe(5);
    });
  });

  describe('enter and newline', () => {
    it('returns "submit" for plain Enter', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      const result = handleTextBufferKey(buf, '\r', makeKey('return'));
      expect(result).toBe('submit');
      // Should NOT modify buffer
      expect(buf.getText()).toBe('hello');
    });

    it('inserts newline for Shift+Enter', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      const result = handleTextBufferKey(buf, '', makeKey('return', { shift: true }));
      expect(result).toBe('handled');
      expect(buf.getLines()).toEqual(['hello', '']);
    });

    it('inserts newline for Alt+Enter', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      const result = handleTextBufferKey(buf, '', makeKey('return', { meta: true }));
      expect(result).toBe('handled');
      expect(buf.getLines()).toEqual(['hello', '']);
    });

    it('inserts newline mid-text for Shift+Enter', () => {
      const buf = new TextBuffer(80, 10, 'helloworld');
      buf.setCursor(0, 5);
      const result = handleTextBufferKey(buf, '', makeKey('return', { shift: true }));
      expect(result).toBe('handled');
      expect(buf.getLines()).toEqual(['hello', 'world']);
    });

    it('returns "submit" for Enter even when buffer is empty', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, '\r', makeKey('return'));
      expect(result).toBe('submit');
      expect(buf.getText()).toBe('');
    });
  });

  describe('unhandled keys', () => {
    it('returns "unhandled" for Escape', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, '\x1b', makeKey('escape'));
      expect(result).toBe('unhandled');
    });

    it('returns "unhandled" for Ctrl+C', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, '\x03', makeKey('c', { ctrl: true }));
      expect(result).toBe('unhandled');
    });

    it('returns "unhandled" for F-keys', () => {
      const buf = new TextBuffer(80, 10);
      expect(handleTextBufferKey(buf, '', makeKey('f1'))).toBe('unhandled');
      expect(handleTextBufferKey(buf, '', makeKey('f12'))).toBe('unhandled');
    });

    it('returns "unhandled" for unmapped Ctrl combos', () => {
      const buf = new TextBuffer(80, 10);
      expect(handleTextBufferKey(buf, '', makeKey('z', { ctrl: true }))).toBe('unhandled');
      expect(handleTextBufferKey(buf, '', makeKey('x', { ctrl: true }))).toBe('unhandled');
    });

    it('returns "unhandled" for Tab', () => {
      const buf = new TextBuffer(80, 10);
      expect(handleTextBufferKey(buf, '\t', makeKey('tab'))).toBe('unhandled');
    });

    it('does not modify buffer for unhandled keys', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      handleTextBufferKey(buf, '\x1b', makeKey('escape'));
      handleTextBufferKey(buf, '\x03', makeKey('c', { ctrl: true }));
      handleTextBufferKey(buf, '\t', makeKey('tab'));
      expect(buf.getText()).toBe('hello');
      expect(buf.getCursorCol()).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('ignores empty string with undefined key name', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, '', { name: undefined });
      expect(result).toBe('unhandled');
      expect(buf.getText()).toBe('');
    });

    it('handles backspace returning "handled"', () => {
      const buf = new TextBuffer(80, 10, 'a');
      const result = handleTextBufferKey(buf, '', makeKey('backspace'));
      expect(result).toBe('handled');
    });

    it('handles arrow keys returning "handled"', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      expect(handleTextBufferKey(buf, '', makeKey('left'))).toBe('handled');
      expect(handleTextBufferKey(buf, '', makeKey('right'))).toBe('handled');
      expect(handleTextBufferKey(buf, '', makeKey('home'))).toBe('handled');
      expect(handleTextBufferKey(buf, '', makeKey('end'))).toBe('handled');
    });

    it('handles null/undefined str gracefully', () => {
      const buf = new TextBuffer(80, 10);
      const result = handleTextBufferKey(buf, '', { name: undefined });
      expect(result).toBe('unhandled');
      expect(buf.getText()).toBe('');
    });

    it('handles rapid sequential key events', () => {
      const buf = new TextBuffer(80, 10);
      for (const ch of 'hello world') {
        handleTextBufferKey(buf, ch, makeKey(ch));
      }
      expect(buf.getText()).toBe('hello world');
    });

    it('handles Ctrl+A then Ctrl+E (home then end)', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      handleTextBufferKey(buf, '\x01', makeKey('a', { ctrl: true })); // home
      expect(buf.getCursorCol()).toBe(0);
      handleTextBufferKey(buf, '\x05', makeKey('e', { ctrl: true })); // end
      expect(buf.getCursorCol()).toBe(5);
    });

    it('handles Shift+Enter then Enter (multiline then submit)', () => {
      const buf = new TextBuffer(80, 10, 'line1');
      handleTextBufferKey(buf, '', makeKey('return', { shift: true })); // newline
      handleTextBufferKey(buf, 'l', makeKey('l'));
      handleTextBufferKey(buf, 'i', makeKey('i'));
      handleTextBufferKey(buf, 'n', makeKey('n'));
      handleTextBufferKey(buf, 'e', makeKey('e'));
      handleTextBufferKey(buf, '2', makeKey('2'));
      expect(buf.getText()).toBe('line1\nline2');
      const result = handleTextBufferKey(buf, '\r', makeKey('return'));
      expect(result).toBe('submit');
      expect(buf.getText()).toBe('line1\nline2'); // submit doesn't modify buffer
    });

    it('does not insert control characters', () => {
      const buf = new TextBuffer(80, 10);
      handleTextBufferKey(buf, '\x00', makeKey('null')); // null byte
      handleTextBufferKey(buf, '\x01', makeKey('a')); // without ctrl flag, control char filtered
      expect(buf.getText()).toBe('');
    });

    it('handles backspace on multi-line at line boundary', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(1, 0);
      handleTextBufferKey(buf, '', makeKey('backspace'));
      expect(buf.getText()).toBe('helloworld');
      expect(buf.getCursorRow()).toBe(0);
    });
  });
});
