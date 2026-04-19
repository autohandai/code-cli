/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  CURSOR,
  moveTo,
  moveUp,
  moveDown,
  moveForward,
  moveBackward,
  calculateSingleLineCursor,
} from '../../src/ui/cursorPositioning.js';

describe('cursorPositioning', () => {
  describe('CURSOR constants', () => {
    it('should have correct SHOW sequence', () => {
      expect(CURSOR.SHOW).toBe('\x1b[?25h');
    });

    it('should have correct HIDE sequence', () => {
      expect(CURSOR.HIDE).toBe('\x1b[?25l');
    });

    it('should have correct SAVE sequence', () => {
      expect(CURSOR.SAVE).toBe('\x1b[s');
    });

    it('should have correct RESTORE sequence', () => {
      expect(CURSOR.RESTORE).toBe('\x1b[u');
    });
  });

  describe('moveTo', () => {
    it('should generate correct sequence for position (1, 1)', () => {
      expect(moveTo(1, 1)).toBe('\x1b[1;1H');
    });

    it('should generate correct sequence for position (10, 20)', () => {
      expect(moveTo(10, 20)).toBe('\x1b[10;20H');
    });

    it('should handle large positions', () => {
      expect(moveTo(100, 200)).toBe('\x1b[100;200H');
    });
  });

  describe('moveUp', () => {
    it('should generate correct sequence for moving up 1 row', () => {
      expect(moveUp(1)).toBe('\x1b[1A');
    });

    it('should generate correct sequence for moving up multiple rows', () => {
      expect(moveUp(5)).toBe('\x1b[5A');
    });

    it('should return empty string for 0 rows', () => {
      expect(moveUp(0)).toBe('');
    });
  });

  describe('moveDown', () => {
    it('should generate correct sequence for moving down 1 row', () => {
      expect(moveDown(1)).toBe('\x1b[1B');
    });

    it('should generate correct sequence for moving down multiple rows', () => {
      expect(moveDown(3)).toBe('\x1b[3B');
    });

    it('should return empty string for 0 rows', () => {
      expect(moveDown(0)).toBe('');
    });
  });

  describe('moveForward', () => {
    it('should generate correct sequence for moving forward 1 column', () => {
      expect(moveForward(1)).toBe('\x1b[1C');
    });

    it('should generate correct sequence for moving forward multiple columns', () => {
      expect(moveForward(10)).toBe('\x1b[10C');
    });

    it('should return empty string for 0 columns', () => {
      expect(moveForward(0)).toBe('');
    });
  });

  describe('moveBackward', () => {
    it('should generate correct sequence for moving backward 1 column', () => {
      expect(moveBackward(1)).toBe('\x1b[1D');
    });

    it('should generate correct sequence for moving backward multiple columns', () => {
      expect(moveBackward(7)).toBe('\x1b[7D');
    });

    it('should return empty string for 0 columns', () => {
      expect(moveBackward(0)).toBe('');
    });
  });

  describe('calculateSingleLineCursor', () => {
    it('should calculate cursor position for empty text', () => {
      const result = calculateSingleLineCursor('', 0, 10, 2);
      expect(result).toEqual({ row: 10, col: 2 });
    });

    it('should calculate cursor position at start of text', () => {
      const result = calculateSingleLineCursor('hello', 0, 10, 2);
      expect(result).toEqual({ row: 10, col: 2 });
    });

    it('should calculate cursor position in middle of text', () => {
      const result = calculateSingleLineCursor('hello', 2, 10, 2);
      expect(result).toEqual({ row: 10, col: 4 });
    });

    it('should calculate cursor position at end of text', () => {
      const result = calculateSingleLineCursor('hello', 5, 10, 2);
      expect(result).toEqual({ row: 10, col: 7 });
    });

    it('should handle wrapping when maxWidth is provided', () => {
      // Text: "hello world" (11 chars)
      // Cursor at position 7 (after "hello w")
      // Start at col 2, maxWidth 10
      // Effective width = 10 - 2 + 1 = 9
      // Position 7 fits in first line (0-8)
      const result = calculateSingleLineCursor('hello world', 7, 10, 2, 10);
      expect(result).toEqual({ row: 10, col: 9 });
    });

    it('should handle wrapping to second line', () => {
      // Text: "hello world" (11 chars)
      // Cursor at position 10 (at end)
      // Start at col 2, maxWidth 10
      // Effective width = 10 - 2 + 1 = 9
      // Position 10 wraps to second line (10 - 9 = 1)
      const result = calculateSingleLineCursor('hello world', 10, 10, 2, 10);
      expect(result).toEqual({ row: 11, col: 3 });
    });

    it('should handle multi-byte characters', () => {
      // Emoji: '👋' is 1 code point but 2 UTF-16 code units
      // cursorOffset is code-point based
      const result = calculateSingleLineCursor('👋👋', 1, 10, 2);
      expect(result).toEqual({ row: 10, col: 3 });
    });
  });
});