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

  // -------------------------------------------------------------------------
  // Word navigation (Task 6)
  // -------------------------------------------------------------------------

  describe('word navigation', () => {
    it('moveWordLeft jumps to previous word start', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.moveWordLeft();
      expect(buf.getCursorCol()).toBe(6); // start of 'world'
    });

    it('moveWordLeft from middle of word jumps to word start', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 8); // middle of 'world'
      buf.moveWordLeft();
      expect(buf.getCursorCol()).toBe(6);
    });

    it('moveWordLeft at line start jumps to end of previous line', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(1, 0);
      buf.moveWordLeft();
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('moveWordRight jumps past current word', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 0);
      buf.moveWordRight();
      expect(buf.getCursorCol()).toBe(5); // end of 'hello'
    });

    it('moveWordRight from space jumps to end of next word', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 5); // at space
      buf.moveWordRight();
      expect(buf.getCursorCol()).toBe(11); // end of 'world'
    });

    it('moveWordRight at line end jumps to start of next line', () => {
      const buf = new TextBuffer(80, 10, 'hello\nworld');
      buf.setCursor(0, 5);
      buf.moveWordRight();
      expect(buf.getCursorRow()).toBe(1);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('moveWordLeft does nothing at start of buffer', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 0);
      buf.moveWordLeft();
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('moveWordRight does nothing at end of buffer', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.moveWordRight();
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('moveWordLeft with multiple spaces', () => {
      const buf = new TextBuffer(80, 10, 'hello   world');
      buf.setCursor(0, 13);
      buf.moveWordLeft();
      expect(buf.getCursorCol()).toBe(8); // start of 'world'
    });

    it('moveWordRight with multiple spaces', () => {
      const buf = new TextBuffer(80, 10, 'hello   world');
      buf.setCursor(0, 0);
      buf.moveWordRight();
      expect(buf.getCursorCol()).toBe(5); // end of 'hello'
    });
  });

  // -------------------------------------------------------------------------
  // Visual layout integration (Task 5)
  // -------------------------------------------------------------------------

  describe('visual layout integration', () => {
    it('recomputes layout when lines change', () => {
      const buf = new TextBuffer(10, 5);
      buf.insert('hello world');
      const layout = buf.getVisualLayout();
      // 'hello world' wraps at width 10 → 'hello ' + 'world' = 2 visual lines
      expect(layout.visualLines.length).toBe(2);
    });

    it('recomputes layout on viewport resize', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      expect(buf.getVisualLayout().visualLines.length).toBe(2);
      buf.setViewport(30, 5);
      expect(buf.getVisualLayout().visualLines.length).toBe(1);
    });

    it('caches layout until dirty', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      const layout1 = buf.getVisualLayout();
      const layout2 = buf.getVisualLayout();
      // Same object reference when nothing changed
      expect(layout1).toBe(layout2);
    });

    it('invalidates cache on insert', () => {
      const buf = new TextBuffer(10, 5, 'hi');
      const layout1 = buf.getVisualLayout();
      buf.insert('!');
      const layout2 = buf.getVisualLayout();
      expect(layout1).not.toBe(layout2);
    });

    it('invalidates cache on backspace', () => {
      const buf = new TextBuffer(10, 5, 'hi');
      const layout1 = buf.getVisualLayout();
      buf.backspace();
      const layout2 = buf.getVisualLayout();
      expect(layout1).not.toBe(layout2);
    });

    it('invalidates cache on delete', () => {
      const buf = new TextBuffer(10, 5, 'hi');
      buf.setCursor(0, 0);
      const layout1 = buf.getVisualLayout();
      buf.delete();
      const layout2 = buf.getVisualLayout();
      expect(layout1).not.toBe(layout2);
    });

    it('invalidates cache on setText', () => {
      const buf = new TextBuffer(10, 5, 'hi');
      const layout1 = buf.getVisualLayout();
      buf.setText('new');
      const layout2 = buf.getVisualLayout();
      expect(layout1).not.toBe(layout2);
    });

    it('provides visual cursor position', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      // Cursor at end of 'hello world' → logical (0,11)
      // Wraps to ['hello ', 'world'], cursor at visual (1, 5)
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(1);
      expect(vCol).toBe(5);
    });

    it('visual cursor at start of buffer', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      buf.setCursor(0, 0);
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(0);
      expect(vCol).toBe(0);
    });

    it('getVisualLineCount reflects wrapping', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      // Wraps to 2 visual lines
      expect(buf.getVisualLineCount()).toBe(2);
    });

    it('getVisualLineCount with multiple logical lines', () => {
      const buf = new TextBuffer(10, 5, 'hello world\nfoo');
      // 'hello world' wraps to 2, 'foo' = 1 → total 3
      expect(buf.getVisualLineCount()).toBe(3);
    });

    it('getRenderedLines returns viewport slice', () => {
      // 5 logical lines, no wrapping at width 20, viewport height 2
      const buf = new TextBuffer(20, 2, 'line1\nline2\nline3\nline4\nline5');
      // Cursor at end → logical (4, 5), visual row 4
      // Viewport height 2, so rendered = 2 lines near cursor
      const rendered = buf.getRenderedLines();
      expect(rendered.length).toBeLessThanOrEqual(2);
      // Cursor is on the last line, so the last line should be visible
      expect(rendered).toContain('line5');
    });

    it('getRenderedLines returns all lines if fewer than viewport', () => {
      const buf = new TextBuffer(20, 10, 'hello\nworld');
      const rendered = buf.getRenderedLines();
      expect(rendered).toEqual(['hello', 'world']);
    });
  });

  // -------------------------------------------------------------------------
  // Visual cursor movement with wrapping (Task 5)
  // -------------------------------------------------------------------------

  describe('visual cursor movement with wrapping', () => {
    it('moveUp crosses visual wrap boundaries within same logical line', () => {
      // 'hello world' at width 10 → ['hello ', 'world']
      const buf = new TextBuffer(10, 5, 'hello world');
      // Cursor at end → visual (1, 5)
      const [startVisRow] = buf.getVisualCursor();
      expect(startVisRow).toBe(1);
      buf.moveUp();
      const [newVisRow] = buf.getVisualCursor();
      expect(newVisRow).toBe(0);
    });

    it('moveDown crosses visual wrap boundaries within same logical line', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      buf.setCursor(0, 0); // visual (0, 0)
      const [startVisRow] = buf.getVisualCursor();
      expect(startVisRow).toBe(0);
      buf.moveDown();
      const [newVisRow] = buf.getVisualCursor();
      expect(newVisRow).toBe(1);
    });

    it('moveUp preserves visual column across wrapped lines', () => {
      // 'hello world' at width 10 → ['hello ', 'world']
      const buf = new TextBuffer(10, 5, 'hello world');
      // Place cursor at logical col 8 → 'hello world'[8]='r' → visual (1, 2)
      buf.setCursor(0, 8);
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(1);
      expect(vCol).toBe(2);

      buf.moveUp(); // visual (0, 2)
      const [newVRow, newVCol] = buf.getVisualCursor();
      expect(newVRow).toBe(0);
      expect(newVCol).toBe(2);
    });

    it('moveDown preserves visual column across wrapped lines', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      buf.setCursor(0, 2); // visual (0, 2) — 'l' in 'hello'
      buf.moveDown(); // visual (1, 2) — 'r' in 'world'
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(1);
      expect(vCol).toBe(2);
    });

    it('moveUp from first visual row does nothing', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      buf.setCursor(0, 0); // visual (0, 0)
      buf.moveUp();
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(0);
      expect(vCol).toBe(0);
    });

    it('moveDown from last visual row does nothing', () => {
      const buf = new TextBuffer(10, 5, 'hello world');
      // Cursor at end → visual (1, 5)
      buf.moveDown();
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(1);
      expect(vCol).toBe(5);
    });

    it('moveDown clamps to shorter visual line', () => {
      // 'abcdefghij' at width 5 → ['abcde', 'fghij']
      // Then 'xy' on next logical line → visual line 2 = 'xy'
      const buf = new TextBuffer(5, 5, 'abcdefghij\nxy');
      buf.setCursor(0, 4); // logical (0,4) → visual (0, 4)
      buf.moveDown(); // visual row 1 is 'fghij' (5 chars) → col stays 4
      const [vRow1, vCol1] = buf.getVisualCursor();
      expect(vRow1).toBe(1);
      expect(vCol1).toBe(4);

      buf.moveDown(); // visual row 2 is 'xy' (2 chars) → col clamped to 2
      const [vRow2, vCol2] = buf.getVisualCursor();
      expect(vRow2).toBe(2);
      expect(vCol2).toBe(2);
    });

    it('moveUp across logical line boundary', () => {
      // Two logical lines, each fits in width 20 → 2 visual lines
      const buf = new TextBuffer(20, 5, 'hello\nworld');
      // Cursor at end → logical (1, 5), visual (1, 5)
      buf.moveUp();
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(0);
      expect(vCol).toBe(5);
    });

    it('moveDown across logical line boundary', () => {
      const buf = new TextBuffer(20, 5, 'hello\nworld');
      buf.setCursor(0, 3); // visual (0, 3)
      buf.moveDown();
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBe(1);
      expect(vCol).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Viewport scrolling (Task 5)
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles emoji correctly (multi-codepoint)', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('hello 👋 world');
      expect(buf.getText()).toBe('hello 👋 world');
      // 'hello 👋 world' = 13 code points: h,e,l,l,o,' ',👋,' ',w,o,r,l,d
      // cursor at col 13 (end), 7 moveLeft → col 6 (before 👋)
      buf.moveLeft(); // col 12
      buf.moveLeft(); // col 11
      buf.moveLeft(); // col 10
      buf.moveLeft(); // col 9
      buf.moveLeft(); // col 8
      buf.moveLeft(); // col 7 (the space after emoji)
      buf.moveLeft(); // col 6 (before 👋)
      buf.insert('X');
      expect(buf.getText()).toBe('hello X👋 world');
    });

    it('handles rapid insert + delete cycles', () => {
      const buf = new TextBuffer(80, 10);
      for (let i = 0; i < 100; i++) {
        buf.insert('x');
      }
      expect(buf.getText()).toBe('x'.repeat(100));
      for (let i = 0; i < 100; i++) {
        buf.backspace();
      }
      expect(buf.getText()).toBe('');
      expect(buf.getCursorCol()).toBe(0);
    });

    it('handles very long single line', () => {
      const buf = new TextBuffer(20, 5);
      buf.insert('a'.repeat(200));
      const layout = buf.getVisualLayout();
      expect(layout.visualLines.length).toBe(10); // 200/20
      expect(buf.getText().length).toBe(200);
    });

    it('handles many short lines', () => {
      const buf = new TextBuffer(80, 5);
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
      buf.setText(lines.join('\n'));
      expect(buf.getLineCount()).toBe(50);
      const rendered = buf.getRenderedLines();
      expect(rendered.length).toBeLessThanOrEqual(5);
    });

    it('cursor stays valid after viewport resize', () => {
      const buf = new TextBuffer(20, 10, 'hello world foo bar');
      const textBefore = buf.getText();
      buf.setViewport(10, 10);
      expect(buf.getText()).toBe(textBefore);
      const [vRow, vCol] = buf.getVisualCursor();
      expect(vRow).toBeGreaterThanOrEqual(0);
      expect(vCol).toBeGreaterThanOrEqual(0);
    });

    it('backspace on empty buffer is safe', () => {
      const buf = new TextBuffer(80, 10);
      buf.backspace();
      buf.backspace();
      buf.backspace();
      expect(buf.getText()).toBe('');
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(0);
    });

    it('delete on empty buffer is safe', () => {
      const buf = new TextBuffer(80, 10);
      buf.delete();
      buf.delete();
      buf.delete();
      expect(buf.getText()).toBe('');
    });

    it('insert empty string is a no-op', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      const textBefore = buf.getText();
      const colBefore = buf.getCursorCol();
      buf.insert('');
      expect(buf.getText()).toBe(textBefore);
      expect(buf.getCursorCol()).toBe(colBefore);
    });

    it('handles mixed newline styles in paste', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('line1\r\nline2\rline3\nline4');
      expect(buf.getLines()).toEqual(['line1', 'line2', 'line3', 'line4']);
    });

    it('setCursor clamps to valid range', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(-1, -5);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(0);
      buf.setCursor(100, 100);
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(5);
    });

    it('handles whitespace-only lines', () => {
      const buf = new TextBuffer(80, 10, '   \n   ');
      expect(buf.getLines()).toEqual(['   ', '   ']);
      expect(buf.getText()).toBe('   \n   ');
    });

    it('handles tab characters', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('hello\tworld');
      expect(buf.getText()).toBe('hello\tworld');
    });

    it('handles newline at start of text', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('\nhello');
      expect(buf.getLines()).toEqual(['', 'hello']);
    });

    it('handles newline at end of text', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('hello\n');
      expect(buf.getLines()).toEqual(['hello', '']);
    });

    it('handles multiple consecutive newlines', () => {
      const buf = new TextBuffer(80, 10);
      buf.insert('a\n\n\nb');
      expect(buf.getLines()).toEqual(['a', '', '', 'b']);
    });

    it('moveUp from first visual line stays put', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 3);
      buf.moveUp();
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(3);
    });

    it('moveDown from last visual line stays put', () => {
      const buf = new TextBuffer(80, 10, 'hello');
      buf.setCursor(0, 3);
      buf.moveDown();
      expect(buf.getCursorRow()).toBe(0);
      expect(buf.getCursorCol()).toBe(3);
    });

    it('insert after delete maintains cursor integrity', () => {
      const buf = new TextBuffer(80, 10, 'hello world');
      buf.setCursor(0, 5);
      buf.delete(); // delete space
      buf.insert('_');
      expect(buf.getText()).toBe('hello_world');
      expect(buf.getCursorCol()).toBe(6);
    });

    it('setText then getText round-trips', () => {
      const buf = new TextBuffer(80, 10);
      const text = 'line1\nline2\nline3';
      buf.setText(text);
      expect(buf.getText()).toBe(text);
    });

    it('handles very narrow viewport', () => {
      const buf = new TextBuffer(3, 10, 'hello');
      const layout = buf.getVisualLayout();
      expect(layout.visualLines.length).toBeGreaterThan(1);
    });

    it('handles viewport height of 1', () => {
      const buf = new TextBuffer(80, 1, 'line1\nline2\nline3');
      const rendered = buf.getRenderedLines();
      expect(rendered.length).toBe(1);
    });
  });

  describe('viewport scrolling', () => {
    it('starts with scrollRow 0', () => {
      const buf = new TextBuffer(20, 3, 'a\nb\nc\nd\ne');
      buf.setCursor(0, 0);
      expect(buf.getScrollRow()).toBe(0);
    });

    it('scrolls down when cursor moves below viewport', () => {
      const buf = new TextBuffer(20, 3, 'a\nb\nc\nd\ne');
      buf.setCursor(0, 0);
      expect(buf.getScrollRow()).toBe(0);
      buf.setCursor(4, 1); // move to 'e' → visual row 4
      // Viewport height 3 → scrollRow should make row 4 visible
      // scrollRow must be >= 4 - 3 + 1 = 2
      expect(buf.getScrollRow()).toBeGreaterThanOrEqual(2);
      const rendered = buf.getRenderedLines();
      expect(rendered).toContain('e');
    });

    it('scrolls up when cursor moves above viewport', () => {
      const buf = new TextBuffer(20, 3, 'a\nb\nc\nd\ne');
      buf.setCursor(4, 1); // scroll to bottom
      buf.setCursor(0, 1); // jump to top
      expect(buf.getScrollRow()).toBe(0);
      const rendered = buf.getRenderedLines();
      expect(rendered).toContain('a');
    });

    it('getScrollRow reflects scroll position', () => {
      const buf = new TextBuffer(20, 2, 'a\nb\nc\nd');
      buf.setCursor(3, 1); // bottom, visual row 3
      // viewport height 2, so scrollRow >= 2
      expect(buf.getScrollRow()).toBeGreaterThan(0);
    });

    it('scrollRow stays 0 when all content fits in viewport', () => {
      const buf = new TextBuffer(20, 10, 'a\nb');
      buf.setCursor(1, 1);
      expect(buf.getScrollRow()).toBe(0);
    });

    it('scrolls with wrapped lines', () => {
      // 'hello world' at width 6 wraps to ['hello ', 'world']
      // Then 3 more short lines → total 5 visual lines
      const buf = new TextBuffer(6, 2, 'hello world\na\nb\nc');
      // Cursor at end → logical (3,1) → visual row 4
      // viewport height 2 → scrollRow >= 3
      expect(buf.getScrollRow()).toBeGreaterThanOrEqual(3);
      const rendered = buf.getRenderedLines();
      expect(rendered).toContain('c');
    });
  });
});
