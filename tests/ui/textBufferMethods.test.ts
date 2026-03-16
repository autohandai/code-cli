/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TextBuffer } from '../../src/ui/textBuffer.js';

describe('TextBuffer new methods', () => {
  // ---------------------------------------------------------------------------
  // deleteToEnd
  // ---------------------------------------------------------------------------
  describe('deleteToEnd', () => {
    it('deletes from cursor to end of current line', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 5);
      buf.deleteToEnd();
      expect(buf.getLines()).toEqual(['hello']);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('merges with next line when cursor is at end of line', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(0, 5);
      buf.deleteToEnd();
      expect(buf.getLines()).toEqual(['helloworld']);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('does nothing on empty buffer', () => {
      const buf = new TextBuffer(80, 10);
      buf.deleteToEnd();
      expect(buf.getLines()).toEqual(['']);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('clears the rest of the line from position 0', () => {
      const buf = new TextBuffer(80, 10, 'abc');
      buf.setCursor(0, 0);
      buf.deleteToEnd();
      expect(buf.getLines()).toEqual(['']);
      expect(buf.getCursorCol()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteToStart
  // ---------------------------------------------------------------------------
  describe('deleteToStart', () => {
    it('deletes from cursor to start of current line', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 5);
      buf.deleteToStart();
      expect(buf.getLines()).toEqual([' world']);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('moves cursor to column 0', () => {
      const buf = new TextBuffer(80, 10, 'abcdef');
      buf.setCursor(0, 3);
      buf.deleteToStart();
      expect(buf.getCursorCol()).toBe(0);
    });

    it('does nothing when cursor is already at start of line', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 0);
      buf.deleteToStart();
      expect(buf.getLines()).toEqual(['hello']);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('clears whole line when cursor is at end', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.deleteToStart();
      expect(buf.getLines()).toEqual(['']);
      expect(buf.getCursorCol()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // deletePreviousWord
  // ---------------------------------------------------------------------------
  describe('deletePreviousWord', () => {
    it('deletes previous word from end of line', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.deletePreviousWord();
      expect(buf.getText()).toBe('hello ');
      expect(buf.getCursorCol()).toBe(6);
    });

    it('deletes only word when there is only one word', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.deletePreviousWord();
      expect(buf.getText()).toBe('');
      expect(buf.getCursorCol()).toBe(0);
    });

    it('skips trailing spaces before deleting word', () => {
      const buf = new TextBuffer(80, 10, 'hello   ');
      buf.deletePreviousWord();
      expect(buf.getText()).toBe('');
      expect(buf.getCursorCol()).toBe(0);
    });

    it('does nothing when cursor is at start of line', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 0);
      buf.deletePreviousWord();
      expect(buf.getText()).toBe('hello');
      expect(buf.getCursorCol()).toBe(0);
    });

    it('deletes previous word from middle of line', () => {
      const buf = new TextBuffer(80, 10, 'foo bar baz');
      buf.setCursor(0, 7); // cursor after "bar"
      buf.deletePreviousWord();
      expect(buf.getText()).toBe('foo  baz');
      expect(buf.getCursorCol()).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // setCursorPosition
  // ---------------------------------------------------------------------------
  describe('setCursorPosition', () => {
    it('sets cursor to given row and col', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursorPosition(1, 3);
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(3);
    });

    it('clamps row to valid range (below 0)', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursorPosition(-5, 2);
      expect(buf.getCursorRow()).toBe(0);
    });

    it('clamps row to valid range (above max)', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursorPosition(100, 2);
      expect(buf.getCursorRow()).toBe(1);
    });

    it('clamps col to valid range (below 0)', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursorPosition(0, -3);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('clamps col to line length (above max)', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursorPosition(0, 100);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('works on single-line buffer', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursorPosition(0, 5);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });
  });
});
