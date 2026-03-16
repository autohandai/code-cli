/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  calculateLayout,
  logicalToVisual,
  visualToLogical,
  type VisualLayout,
} from './textBufferLayout.js';

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
 * Integrates with the visual layout engine to provide word-wrapping,
 * visual cursor positioning, and viewport scrolling.
 */
export class TextBuffer {
  private lines: string[];
  private cursorRow: number;
  private cursorCol: number;
  private viewportWidth: number;
  private viewportHeight: number;
  private preferredCol: number | null = null;

  /** Cached layout result; recomputed lazily when dirty. */
  private cachedLayout: VisualLayout | null = null;
  /** Becomes `true` when lines or viewport dimensions change. */
  private layoutDirty = true;
  /** Visual row offset for viewport scrolling. */
  private scrollRow = 0;

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

    this.ensureCursorVisible();
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
    this.ensureCursorVisible();
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

  /**
   * Moves cursor up one visual row. Navigates within wrapped lines as well
   * as across logical line boundaries. Preserves preferred visual column.
   */
  moveUp(): void {
    const layout = this.getVisualLayout();
    const strCol = cpToStrIndex(this.lines[this.cursorRow]!, this.cursorCol);
    const [visRow, visCol] = logicalToVisual(layout, this.cursorRow, strCol);

    if (visRow <= 0) return; // already at the top visual row

    if (this.preferredCol === null) {
      this.preferredCol = visCol;
    }

    const targetVisRow = visRow - 1;
    const targetVisLine = layout.visualLines[targetVisRow]!;
    const clampedVisCol = Math.min(this.preferredCol, targetVisLine.length);

    const [logRow, logStrCol] = visualToLogical(layout, targetVisRow, clampedVisCol);
    this.cursorRow = logRow;
    this.cursorCol = strToCpIndex(this.lines[logRow]!, logStrCol);
    this.ensureCursorVisible();
  }

  /**
   * Moves cursor down one visual row. Navigates within wrapped lines as well
   * as across logical line boundaries. Preserves preferred visual column.
   */
  moveDown(): void {
    const layout = this.getVisualLayout();
    const strCol = cpToStrIndex(this.lines[this.cursorRow]!, this.cursorCol);
    const [visRow, visCol] = logicalToVisual(layout, this.cursorRow, strCol);

    if (visRow >= layout.visualLines.length - 1) return; // already at the bottom visual row

    if (this.preferredCol === null) {
      this.preferredCol = visCol;
    }

    const targetVisRow = visRow + 1;
    const targetVisLine = layout.visualLines[targetVisRow]!;
    const clampedVisCol = Math.min(this.preferredCol, targetVisLine.length);

    const [logRow, logStrCol] = visualToLogical(layout, targetVisRow, clampedVisCol);
    this.cursorRow = logRow;
    this.cursorCol = strToCpIndex(this.lines[logRow]!, logStrCol);
    this.ensureCursorVisible();
  }

  /**
   * Moves cursor left by one word boundary using `Intl.Segmenter`.
   * Jumps to the start of the previous word-like segment. At column 0,
   * wraps to the end of the previous logical line.
   */
  moveWordLeft(): void {
    this.preferredCol = null;

    if (this.cursorCol === 0) {
      // At line start, jump to end of previous line
      if (this.cursorRow > 0) {
        this.cursorRow--;
        this.cursorCol = cpLen(this.lines[this.cursorRow]!);
      }
      return;
    }

    const line = this.lines[this.cursorRow]!;
    const codePoints = Array.from(line);
    // Convert code-point cursor to string index for segmenter
    const strCursor = codePoints.slice(0, this.cursorCol).join('').length;

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const segments = Array.from(segmenter.segment(line));

    // Find the last word-like segment that starts before the cursor
    let target: { index: number } | null = null;
    for (const seg of segments) {
      if (seg.isWordLike && seg.index < strCursor) {
        target = seg;
      }
    }

    if (target !== null) {
      // Convert string index back to code-point index
      this.cursorCol = strToCpIndex(line, target.index);
    } else {
      this.cursorCol = 0;
    }

    this.ensureCursorVisible();
  }

  /**
   * Moves cursor right by one word boundary using `Intl.Segmenter`.
   * Jumps to the end of the current/next word-like segment. At end of line,
   * wraps to the start of the next logical line.
   */
  moveWordRight(): void {
    this.preferredCol = null;

    const line = this.lines[this.cursorRow]!;
    const lineLen = cpLen(line);

    if (this.cursorCol >= lineLen) {
      // At line end, jump to start of next line
      if (this.cursorRow < this.lines.length - 1) {
        this.cursorRow++;
        this.cursorCol = 0;
      }
      return;
    }

    const codePoints = Array.from(line);
    // Convert code-point cursor to string index for segmenter
    const strCursor = codePoints.slice(0, this.cursorCol).join('').length;

    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const segments = Array.from(segmenter.segment(line));

    // Find the first word-like segment that ends after the cursor
    for (const seg of segments) {
      const segEnd = seg.index + seg.segment.length;
      if (seg.isWordLike && segEnd > strCursor) {
        this.cursorCol = strToCpIndex(line, segEnd);
        this.ensureCursorVisible();
        return;
      }
    }

    // No word found after cursor — move to end of line
    this.cursorCol = lineLen;
    this.ensureCursorVisible();
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
    this.layoutDirty = true;

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

    this.ensureCursorVisible();
  }

  /**
   * Deletes the character before the cursor (backspace behavior).
   *
   * - At column 0 of a line, merges with the previous line.
   * - At the start of the buffer, does nothing.
   */
  backspace(): void {
    this.preferredCol = null;
    this.layoutDirty = true;
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

    this.ensureCursorVisible();
  }

  /**
   * Deletes the character at the cursor position (forward delete behavior).
   *
   * - At the end of a line, merges with the next line.
   * - At the end of the buffer, does nothing.
   */
  delete(): void {
    this.preferredCol = null;
    this.layoutDirty = true;
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

    this.ensureCursorVisible();
  }

  /**
   * Deletes from cursor to end of current line.
   * If cursor is already at end of line, merges with the next line (like Delete at EOL).
   */
  deleteToEnd(): void {
    this.preferredCol = null;
    this.layoutDirty = true;
    const line = this.lines[this.cursorRow]!;
    const lineLen = cpLen(line);

    if (this.cursorCol < lineLen) {
      // Delete from cursor to end of line
      this.lines[this.cursorRow] = cpSlice(line, 0, this.cursorCol);
    } else if (this.cursorRow < this.lines.length - 1) {
      // At end of line — merge with next line
      this.lines[this.cursorRow] = line + this.lines[this.cursorRow + 1]!;
      this.lines.splice(this.cursorRow + 1, 1);
    }

    this.ensureCursorVisible();
  }

  /**
   * Deletes from cursor to start of current line.
   * Cursor moves to column 0.
   */
  deleteToStart(): void {
    this.preferredCol = null;
    this.layoutDirty = true;
    const line = this.lines[this.cursorRow]!;

    if (this.cursorCol > 0) {
      this.lines[this.cursorRow] = cpSlice(line, this.cursorCol);
      this.cursorCol = 0;
    }

    this.ensureCursorVisible();
  }

  /**
   * Deletes the previous word before the cursor.
   * Skips trailing spaces, then skips non-space characters.
   * Uses code-point-safe string indexing.
   */
  deletePreviousWord(): void {
    this.preferredCol = null;
    this.layoutDirty = true;

    if (this.cursorCol === 0) return;

    const line = this.lines[this.cursorRow]!;
    const beforeCursor = cpSlice(line, 0, this.cursorCol);
    const chars = Array.from(beforeCursor);

    let i = chars.length;

    // Skip trailing spaces
    while (i > 0 && chars[i - 1] === ' ') {
      i--;
    }
    // Skip non-space characters (the word itself)
    while (i > 0 && chars[i - 1] !== ' ') {
      i--;
    }

    const after = cpSlice(line, this.cursorCol);
    this.lines[this.cursorRow] = chars.slice(0, i).join('') + after;
    this.cursorCol = i;

    this.ensureCursorVisible();
  }

  /**
   * Sets cursor to (row, col) with bounds clamping.
   * Row is clamped to [0, lineCount-1]. Col is clamped to [0, lineLen].
   */
  setCursorPosition(row: number, col: number): void {
    // Clamp row
    row = Math.max(0, Math.min(row, this.lines.length - 1));
    // Clamp col to the length of the target line
    const lineLen = cpLen(this.lines[row]!);
    col = Math.max(0, Math.min(col, lineLen));

    this.cursorRow = row;
    this.cursorCol = col;
    this.preferredCol = null;
    this.ensureCursorVisible();
  }

  /**
   * Replaces all buffer content and moves the cursor to the end.
   */
  setText(text: string): void {
    this.layoutDirty = true;
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

    this.ensureCursorVisible();
  }

  // ---------------------------------------------------------------------------
  // Visual layout integration
  // ---------------------------------------------------------------------------

  /**
   * Returns the cached visual layout, recomputing it if dirty.
   * The layout maps logical lines to word-wrapped visual lines.
   */
  getVisualLayout(): VisualLayout {
    if (this.layoutDirty || this.cachedLayout === null) {
      this.cachedLayout = calculateLayout(this.lines, this.viewportWidth);
      this.layoutDirty = false;
    }
    return this.cachedLayout;
  }

  /**
   * Returns the visual (row, col) position of the cursor after wrapping.
   * The visual row accounts for word-wrapped lines.
   */
  getVisualCursor(): [number, number] {
    const layout = this.getVisualLayout();
    const strCol = cpToStrIndex(this.lines[this.cursorRow]!, this.cursorCol);
    return logicalToVisual(layout, this.cursorRow, strCol);
  }

  /** Returns the total number of visual lines after wrapping. */
  getVisualLineCount(): number {
    return this.getVisualLayout().visualLines.length;
  }

  /** Returns the current scroll row offset. */
  getScrollRow(): number {
    return this.scrollRow;
  }

  /**
   * Returns the visual lines currently visible within the viewport.
   * This is the slice `visualLines[scrollRow .. scrollRow + viewportHeight)`.
   */
  getRenderedLines(): string[] {
    const layout = this.getVisualLayout();
    return layout.visualLines.slice(
      this.scrollRow,
      this.scrollRow + this.viewportHeight,
    );
  }

  /**
   * Updates viewport dimensions and marks the layout for recomputation.
   */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.layoutDirty = true;
    this.ensureCursorVisible();
  }

  // ---------------------------------------------------------------------------
  // Private: scroll management
  // ---------------------------------------------------------------------------

  /**
   * Adjusts `scrollRow` so the visual cursor is within the visible viewport.
   * Called after any cursor movement or layout change.
   */
  private ensureCursorVisible(): void {
    const layout = this.getVisualLayout();
    const strCol = cpToStrIndex(this.lines[this.cursorRow]!, this.cursorCol);
    const [visRow] = logicalToVisual(layout, this.cursorRow, strCol);

    if (visRow < this.scrollRow) {
      this.scrollRow = visRow;
    } else if (visRow >= this.scrollRow + this.viewportHeight) {
      this.scrollRow = visRow - this.viewportHeight + 1;
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

/**
 * Converts a code-point column index to a string (UTF-16) index.
 * This bridges TextBuffer's code-point cursor with the layout engine's
 * string-index-based column tracking.
 */
function cpToStrIndex(s: string, cpCol: number): number {
  const codePoints = Array.from(s);
  const clamped = Math.min(cpCol, codePoints.length);
  return codePoints.slice(0, clamped).join('').length;
}

/**
 * Converts a string (UTF-16) index to a code-point column index.
 */
function strToCpIndex(s: string, strIdx: number): number {
  const prefix = s.slice(0, strIdx);
  return Array.from(prefix).length;
}
