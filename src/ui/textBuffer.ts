/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Code-point-safe string length (handles emoji and surrogate pairs).
 */
function cpLen(s: string): number {
  return Array.from(s).length;
}

/**
 * Code-point-safe string slice (handles emoji and surrogate pairs).
 */
function cpSlice(s: string, start: number, end?: number): string {
  return Array.from(s).slice(start, end).join('');
}

/**
 * Regex matching control characters to strip from inserted text.
 * Keeps \n (0x0A) and \r (0x0D) for newline normalization.
 * Keeps \t (0x09) for tab support.
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * A text buffer that manages a `lines[]` array with a 2D cursor (row, col).
 *
 * Designed for multi-line terminal text editing. Uses code-point-safe string
 * operations so that emoji and CJK characters are handled correctly.
 *
 * This class manages the data model only (no rendering or layout). Later tasks
 * add visual layout, wrapping, and viewport scrolling on top of this foundation.
 */
export class TextBuffer {
  private lines: string[];
  private cursorRow: number;
  private cursorCol: number;
  private viewportWidth: number;
  private viewportHeight: number;
  private preferredCol: number | null = null;

  constructor(viewportWidth: number, viewportHeight: number, initialText?: string) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;

    if (initialText !== undefined && initialText !== '') {
      const normalized = normalizeNewlines(initialText);
      this.lines = normalized.split('\n');
      // Place cursor at end of text
      this.cursorRow = this.lines.length - 1;
      this.cursorCol = cpLen(this.lines[this.cursorRow]!);
    } else {
      this.lines = [''];
      this.cursorRow = 0;
      this.cursorCol = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Returns a shallow copy of the logical lines array. */
  getLines(): string[] {
    return [...this.lines];
  }

  /** Returns the current cursor row (0-based logical line index). */
  getCursorRow(): number {
    return this.cursorRow;
  }

  /** Returns the current cursor column (0-based code-point offset). */
  getCursorCol(): number {
    return this.cursorCol;
  }

  /** Returns the number of logical lines. */
  getLineCount(): number {
    return this.lines.length;
  }

  /** Returns all lines joined with `\n`. Empty single-line buffer returns `''`. */
  getText(): string {
    if (this.lines.length === 1 && this.lines[0] === '') {
      return '';
    }
    return this.lines.join('\n');
  }

  /** Returns `true` when the buffer holds no text (single empty line). */
  isEmpty(): boolean {
    return this.lines.length === 1 && this.lines[0] === '';
  }

  // ---------------------------------------------------------------------------
  // Cursor positioning
  // ---------------------------------------------------------------------------

  /**
   * Sets the cursor to (row, col), clamping both to valid ranges.
   * Row is clamped to [0, lineCount-1]. Col is clamped to [0, lineLen].
   */
  setCursor(row: number, col: number): void {
    // Clamp row
    row = Math.max(0, Math.min(row, this.lines.length - 1));
    // Clamp col to the length of the target line
    const lineLen = cpLen(this.lines[row]!);
    col = Math.max(0, Math.min(col, lineLen));

    this.cursorRow = row;
    this.cursorCol = col;
  }

  // ---------------------------------------------------------------------------
  // Cursor movement
  // ---------------------------------------------------------------------------

  /** Moves cursor left by one code point. Wraps to end of previous line at col 0. */
  moveLeft(): void {
    this.preferredCol = null;
    if (this.cursorCol > 0) {
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
      this.cursorCol = cpLen(this.lines[this.cursorRow]!);
    }
  }

  /** Moves cursor right by one code point. Wraps to start of next line at end of line. */
  moveRight(): void {
    this.preferredCol = null;
    const lineLen = cpLen(this.lines[this.cursorRow]!);
    if (this.cursorCol < lineLen) {
      this.cursorCol++;
    } else if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      this.cursorCol = 0;
    }
  }

  /** Moves cursor up one line. Clamps column to target line length, preserving preferredCol. */
  moveUp(): void {
    if (this.cursorRow <= 0) return;
    if (this.preferredCol === null) {
      this.preferredCol = this.cursorCol;
    }
    this.cursorRow--;
    const lineLen = cpLen(this.lines[this.cursorRow]!);
    this.cursorCol = Math.min(this.preferredCol, lineLen);
  }

  /** Moves cursor down one line. Clamps column to target line length, preserving preferredCol. */
  moveDown(): void {
    if (this.cursorRow >= this.lines.length - 1) return;
    if (this.preferredCol === null) {
      this.preferredCol = this.cursorCol;
    }
    this.cursorRow++;
    const lineLen = cpLen(this.lines[this.cursorRow]!);
    this.cursorCol = Math.min(this.preferredCol, lineLen);
  }

  /** Moves cursor to the start of the current line. */
  moveHome(): void {
    this.preferredCol = null;
    this.cursorCol = 0;
  }

  /** Moves cursor to the end of the current line. */
  moveEnd(): void {
    this.preferredCol = null;
    this.cursorCol = cpLen(this.lines[this.cursorRow]!);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Inserts text at the current cursor position.
   *
   * - Control characters (except `\n`, `\r`, `\t`) are stripped.
   * - `\r\n` and `\r` are normalized to `\n`.
   * - Newlines split the current line.
   * - Cursor advances to the end of the inserted text.
   */
  insert(text: string): void {
    if (text === '') return;
    this.preferredCol = null;

    // Strip unwanted control characters, then normalize newlines
    const cleaned = text.replace(CONTROL_CHAR_RE, '');
    const normalized = normalizeNewlines(cleaned);

    const insertLines = normalized.split('\n');
    const currentLine = this.lines[this.cursorRow]!;

    const before = cpSlice(currentLine, 0, this.cursorCol);
    const after = cpSlice(currentLine, this.cursorCol);

    if (insertLines.length === 1) {
      // Single-line insert: splice into the current line
      this.lines[this.cursorRow] = before + insertLines[0] + after;
      this.cursorCol += cpLen(insertLines[0]!);
    } else {
      // Multi-line insert: first line joins with before, last line joins with after
      const firstLine = before + insertLines[0]!;
      const lastLine = insertLines[insertLines.length - 1]! + after;

      const newLines = [
        firstLine,
        ...insertLines.slice(1, -1),
        lastLine,
      ];

      this.lines.splice(this.cursorRow, 1, ...newLines);
      this.cursorRow += insertLines.length - 1;
      this.cursorCol = cpLen(insertLines[insertLines.length - 1]!);
    }
  }

  /**
   * Deletes the character before the cursor (backspace behavior).
   *
   * - At column 0 of a line, merges with the previous line.
   * - At the start of the buffer, does nothing.
   */
  backspace(): void {
    this.preferredCol = null;
    if (this.cursorCol > 0) {
      // Delete one code point before cursor
      const line = this.lines[this.cursorRow]!;
      this.lines[this.cursorRow] = cpSlice(line, 0, this.cursorCol - 1) + cpSlice(line, this.cursorCol);
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      // Merge current line with previous line
      const prevLine = this.lines[this.cursorRow - 1]!;
      const prevLen = cpLen(prevLine);
      this.lines[this.cursorRow - 1] = prevLine + this.lines[this.cursorRow]!;
      this.lines.splice(this.cursorRow, 1);
      this.cursorRow--;
      this.cursorCol = prevLen;
    }
  }

  /**
   * Deletes the character at the cursor position (forward delete behavior).
   *
   * - At the end of a line, merges with the next line.
   * - At the end of the buffer, does nothing.
   */
  delete(): void {
    this.preferredCol = null;
    const line = this.lines[this.cursorRow]!;
    const lineLen = cpLen(line);

    if (this.cursorCol < lineLen) {
      // Delete one code point at cursor
      this.lines[this.cursorRow] = cpSlice(line, 0, this.cursorCol) + cpSlice(line, this.cursorCol + 1);
    } else if (this.cursorRow < this.lines.length - 1) {
      // Merge next line into current line
      this.lines[this.cursorRow] = line + this.lines[this.cursorRow + 1]!;
      this.lines.splice(this.cursorRow + 1, 1);
    }
  }

  /**
   * Replaces all buffer content and moves the cursor to the end.
   */
  setText(text: string): void {
    const normalized = normalizeNewlines(text);
    if (normalized === '') {
      this.lines = [''];
      this.cursorRow = 0;
      this.cursorCol = 0;
    } else {
      this.lines = normalized.split('\n');
      this.cursorRow = this.lines.length - 1;
      this.cursorCol = cpLen(this.lines[this.cursorRow]!);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalizes `\r\n` and standalone `\r` to `\n`. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
