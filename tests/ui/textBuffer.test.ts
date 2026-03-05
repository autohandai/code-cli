/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TextBuffer } from '../../src/ui/textBuffer.js';

describe('TextBuffer', () => {
  describe('constructor', () => {
    it('creates empty buffer with single empty line', () => {
      const buf = new TextBuffer(80, 10);
      expect(buf.getLines()).toEqual(['']);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('creates buffer from initial text', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      expect(buf.getLines()).toEqual(['hello', 'world']);
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('normalizes CRLF to LF', () => {
      const buf = new TextBuffer(80, 10, 'a\r\nb\rc');
      expect(buf.getLines()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('insert', () => {
    it('inserts character at cursor', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('a');
      expect(buf.getLines()).toEqual(['a']);
      expect(buf.getCursorCol()).toBe(1);
    });

    it('inserts at middle of text', () => {
      const buf = new TextBuffer(80, 10, 'ac');
      buf.setCursor(0, 1);
      buf.insert('b');
      expect(buf.getLines()).toEqual(['abc']);
      expect(buf.getCursorCol()).toBe(2);
    });

    it('inserts newline splits line', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 5);
      buf.insert('\n');
      expect(buf.getLines()).toEqual(['hello', ' world']);
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('inserts multi-line text', () => {
      const buf = new TextBuffer(80, 10, 'ac');
      buf.setCursor(0, 1);
      buf.insert('x\ny\nz');
      expect(buf.getLines()).toEqual(['ax', 'y', 'zc']);
      expect(buf.getCursorRow()).toBe(2);
      expect(buf.getCursorCol()).toBe(1);
    });

    it('strips control characters except newline', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('hello\x00\x01world');
      expect(buf.getLines()).toEqual(['helloworld']);
    });
  });

  describe('backspace', () => {
    it('deletes character before cursor', () => {
      const buf = new TextBuffer(80, 10, 'abc');
      buf.setCursor(0, 2);
      buf.backspace();
      expect(buf.getLines()).toEqual(['ac']);
      expect(buf.getCursorCol()).toBe(1);
    });

    it('does nothing at start of buffer', () => {
      const buf = new TextBuffer(80, 10, 'abc');
      buf.setCursor(0, 0);
      buf.backspace();
      expect(buf.getLines()).toEqual(['abc']);
    });

    it('merges with previous line at line start', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(1, 0);
      buf.backspace();
      expect(buf.getLines()).toEqual(['helloworld']);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });
  });

  describe('delete', () => {
    it('deletes character at cursor', () => {
      const buf = new TextBuffer(80, 10, 'abc');
      buf.setCursor(0, 1);
      buf.delete();
      expect(buf.getLines()).toEqual(['ac']);
      expect(buf.getCursorCol()).toBe(1);
    });

    it('does nothing at end of buffer', () => {
      const buf = new TextBuffer(80, 10, 'abc');
      buf.delete();
      expect(buf.getLines()).toEqual(['abc']);
    });

    it('merges next line at end of line', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(0, 5);
      buf.delete();
      expect(buf.getLines()).toEqual(['helloworld']);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });
  });

  describe('getText', () => {
    it('joins lines with newline', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      expect(buf.getText()).toBe('hello\nworld');
    });

    it('returns empty string for empty buffer', () => {
      const buf = new TextBuffer(80, 10);
      expect(buf.getText()).toBe('');
    });
  });

  describe('setText', () => {
    it('replaces all content and moves cursor to end', () => {
      const buf = new TextBuffer(80, 10, 'old');
      buf.setText('new\ntext');
      expect(buf.getLines()).toEqual(['new', 'text']);
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(4);
    });

    it('clears buffer when given empty string', () => {
      const buf = new TextBuffer(80, 10, 'old');
      buf.setText('');
      expect(buf.getLines()).toEqual(['']);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(0);
    });
  });

  describe('isEmpty', () => {
    it('returns true for empty buffer', () => {
      const buf = new TextBuffer(80, 10);
      expect(buf.isEmpty()).toBe(true);
    });

    it('returns false for non-empty buffer', () => {
      const buf = new TextBuffer(80, 10, 'a');
      expect(buf.isEmpty()).toBe(false);
    });

    it('returns true for single empty line', () => {
      const buf = new TextBuffer(80, 10, '');
      expect(buf.isEmpty()).toBe(true);
    });
  });

  describe('getLineCount', () => {
    it('returns 1 for single line', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      expect(buf.getLineCount()).toBe(1);
    });

    it('returns correct count for multi-line', () => {
      const buf = new TextBuffer(80, 10, 'a\nb\nc');
      expect(buf.getLineCount()).toBe(3);
    });

    it('returns 1 for empty buffer', () => {
      const buf = new TextBuffer(80, 10);
      expect(buf.getLineCount()).toBe(1);
    });
  });

  describe('setCursor', () => {
    it('sets cursor to valid position', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(0, 3);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(3);
    });

    it('clamps row to valid range', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(5, 0);
      expect(buf.getCursorRow()).toBe(0);
    });

    it('clamps negative row to 0', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(-1, 0);
      expect(buf.getCursorRow()).toBe(0);
    });

    it('clamps col to line length', () => {
      const buf = new TextBuffer(80, 10, 'hi');
      buf.setCursor(0, 10);
      expect(buf.getCursorCol()).toBe(2);
    });

    it('clamps negative col to 0', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, -3);
      expect(buf.getCursorCol()).toBe(0);
    });
  });

  describe('cursor movement', () => {
    describe('moveLeft', () => {
      it('moves cursor left by one', () => {
        const buf = new TextBuffer(80, 10, 'abc');
        buf.moveLeft();
        expect(buf.getCursorCol()).toBe(2);
      });

      it('wraps to end of previous line at col 0', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.setCursor(1, 0);
        buf.moveLeft();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(5);
      });

      it('does nothing at start of buffer', () => {
        const buf = new TextBuffer(80, 10, 'abc');
        buf.setCursor(0, 0);
        buf.moveLeft();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(0);
      });
    });

    describe('moveRight', () => {
      it('moves cursor right by one', () => {
        const buf = new TextBuffer(80, 10, 'abc');
        buf.setCursor(0, 0);
        buf.moveRight();
        expect(buf.getCursorCol()).toBe(1);
      });

      it('wraps to start of next line at end of line', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.setCursor(0, 5);
        buf.moveRight();
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(0);
      });

      it('does nothing at end of buffer', () => {
        const buf = new TextBuffer(80, 10, 'abc');
        buf.moveRight();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(3);
      });
    });

    describe('moveUp', () => {
      it('moves to previous line preserving column', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.moveUp();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(5);
      });

      it('clamps column to shorter line', () => {
        const buf = new TextBuffer(80, 10, 'hi\nworld');
        buf.moveUp();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(2);
      });

      it('preserves preferredCol across short lines', () => {
        const buf = new TextBuffer(80, 10, 'longline\nhi\nlongline');
        buf.setCursor(2, 7);
        buf.moveUp(); // row 1, col clamped to 2, preferredCol = 7
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(2);
        buf.moveUp(); // row 0, col restored to 7
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(7);
      });

      it('does nothing on first line', () => {
        const buf = new TextBuffer(80, 10, 'hello');
        buf.setCursor(0, 3);
        buf.moveUp();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(3);
      });
    });

    describe('moveDown', () => {
      it('moves to next line preserving column', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.setCursor(0, 3);
        buf.moveDown();
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(3);
      });

      it('clamps column to shorter line', () => {
        const buf = new TextBuffer(80, 10, 'world\nhi');
        buf.setCursor(0, 4);
        buf.moveDown();
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(2);
      });

      it('preserves preferredCol across short lines', () => {
        const buf = new TextBuffer(80, 10, 'longline\nhi\nlongline');
        buf.setCursor(0, 7);
        buf.moveDown(); // row 1, col clamped to 2, preferredCol = 7
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(2);
        buf.moveDown(); // row 2, col restored to 7
        expect(buf.getCursorRow()).toBe(2);
        expect(buf.getCursorCol()).toBe(7);
      });

      it('does nothing on last line', () => {
        const buf = new TextBuffer(80, 10, 'hello');
        buf.setCursor(0, 0);
        buf.moveDown();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(0);
      });
    });

    describe('moveHome', () => {
      it('moves cursor to start of line', () => {
        const buf = new TextBuffer(80, 10, 'hello');
        buf.moveHome();
        expect(buf.getCursorCol()).toBe(0);
      });

      it('stays on same row', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.moveHome();
        expect(buf.getCursorRow()).toBe(1);
        expect(buf.getCursorCol()).toBe(0);
      });
    });

    describe('moveEnd', () => {
      it('moves cursor to end of line', () => {
        const buf = new TextBuffer(80, 10, 'hello');
        buf.setCursor(0, 0);
        buf.moveEnd();
        expect(buf.getCursorCol()).toBe(5);
      });

      it('stays on same row', () => {
        const buf = new TextBuffer(80, 10, 'hello\nworld');
        buf.setCursor(0, 0);
        buf.moveEnd();
        expect(buf.getCursorRow()).toBe(0);
        expect(buf.getCursorCol()).toBe(5);
      });
    });

    describe('preferredCol interactions', () => {
      it('clears preferredCol on moveLeft', () => {
        const buf = new TextBuffer(80, 10, 'longline\nhi\nlongline');
        buf.setCursor(0, 7);
        buf.moveDown(); // sets preferredCol = 7, col clamped to 2
        buf.moveLeft(); // clears preferredCol, col = 1
        buf.moveDown(); // should use current col (1), not old preferredCol
        expect(buf.getCursorCol()).toBe(1);
      });

      it('clears preferredCol on insert', () => {
        const buf = new TextBuffer(80, 10, 'longline\nhi\nlongline');
        buf.setCursor(0, 7);
        buf.moveDown(); // sets preferredCol = 7
        buf.insert('x'); // clears preferredCol
        buf.moveDown(); // should use current col (3 = 2+1 from 'hxi'), not 7
        expect(buf.getCursorCol()).toBe(3);
      });
    });
  });
});
