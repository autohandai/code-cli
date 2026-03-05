/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visual layout engine for TextBuffer.
 * Wraps logical lines to visual lines based on viewport width and builds
 * bidirectional mapping tables between logical and visual positions.
 */

import stringWidth from 'string-width';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Result of laying out logical lines into visual (wrapped) lines.
 *
 * - `visualLines` — the text of every visual row after word-wrapping.
 * - `logicalToVisual` — for each logical row, an ordered list of
 *   `[visualRow, logicalColStart]` pairs describing which visual rows
 *   it spans and where each visual row begins in the logical line.
 * - `visualToLogical` — for each visual row, the `[logicalRow, logicalColStart]`
 *   it maps back to.
 */
export interface VisualLayout {
  visualLines: string[];
  logicalToVisual: Array<Array<[number, number]>>;
  visualToLogical: Array<[number, number]>;
}

/* ------------------------------------------------------------------ */
/*  Layout calculation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Wrap `lines` into visual lines that fit within `viewportWidth` columns.
 *
 * Uses a greedy word-wrap algorithm:
 * 1. Walk each logical line character by character.
 * 2. Track the current visual line width via `stringWidth`.
 * 3. Remember the last space position for word-boundary breaking.
 * 4. When adding a character would exceed `viewportWidth`:
 *    - If there was a space, break after that space.
 *    - Otherwise hard-break at the current position.
 * 5. Build mapping tables as we go.
 */
export function calculateLayout(
  lines: string[],
  viewportWidth: number,
): VisualLayout {
  const visualLines: string[] = [];
  const logicalToVisualMap: Array<Array<[number, number]>> = [];
  const visualToLogicalMap: Array<[number, number]> = [];

  const width = Math.max(viewportWidth, 1);

  for (let logRow = 0; logRow < lines.length; logRow++) {
    const line = lines[logRow];
    const visRows: Array<[number, number]> = [];

    if (line.length === 0) {
      // Empty logical line → one empty visual line
      const visIdx = visualLines.length;
      visualLines.push('');
      visRows.push([visIdx, 0]);
      visualToLogicalMap.push([logRow, 0]);
    } else {
      let pos = 0;

      while (pos < line.length) {
        const segStart = pos;
        const visIdx = visualLines.length;

        // Greedily collect characters that fit in the viewport width
        let currentWidth = 0;
        let lastSpacePos = -1; // position *after* the space character
        let endPos = pos;

        while (endPos < line.length) {
          const ch = line[endPos];
          const chWidth = stringWidth(ch);

          if (currentWidth + chWidth > width) {
            break;
          }

          currentWidth += chWidth;
          endPos++;

          if (ch === ' ') {
            lastSpacePos = endPos; // position after the space
          }
        }

        if (endPos < line.length) {
          // Need to wrap — decide where to break
          if (lastSpacePos > pos) {
            // Word-boundary break: include the trailing space in this line
            const segment = line.slice(segStart, lastSpacePos);
            visualLines.push(segment);
            visRows.push([visIdx, segStart]);
            visualToLogicalMap.push([logRow, segStart]);
            pos = lastSpacePos;
          } else {
            // Hard break: no space found, break at the exact width boundary
            const segment = line.slice(segStart, endPos);
            visualLines.push(segment);
            visRows.push([visIdx, segStart]);
            visualToLogicalMap.push([logRow, segStart]);
            pos = endPos;
          }
        } else {
          // Remainder fits — last segment of this logical line
          const segment = line.slice(segStart, endPos);
          visualLines.push(segment);
          visRows.push([visIdx, segStart]);
          visualToLogicalMap.push([logRow, segStart]);
          pos = endPos;
        }
      }
    }

    logicalToVisualMap.push(visRows);
  }

  return {
    visualLines,
    logicalToVisual: logicalToVisualMap,
    visualToLogical: visualToLogicalMap,
  };
}

/* ------------------------------------------------------------------ */
/*  Coordinate mapping                                                 */
/* ------------------------------------------------------------------ */

/**
 * Convert a logical cursor position to a visual (row, col) position.
 *
 * Searches `logicalToVisual[logRow]` to find the visual row whose
 * `logColStart` range contains `logCol`, then returns
 * `[visualRow, logCol - logColStart]`.
 */
export function logicalToVisual(
  layout: VisualLayout,
  logRow: number,
  logCol: number,
): [number, number] {
  const spans = layout.logicalToVisual[logRow];
  if (!spans || spans.length === 0) {
    return [0, 0];
  }

  // Walk spans in reverse to find the last one whose logColStart <= logCol
  for (let i = spans.length - 1; i >= 0; i--) {
    const [visRow, logColStart] = spans[i];
    if (logCol >= logColStart) {
      return [visRow, logCol - logColStart];
    }
  }

  // Fallback: first span
  const [visRow, logColStart] = spans[0];
  return [visRow, logCol - logColStart];
}

/**
 * Convert a visual cursor position to a logical (row, col) position.
 *
 * Looks up `visualToLogical[visRow]` to get `[logRow, logColStart]`,
 * then returns `[logRow, logColStart + visCol]`.
 */
export function visualToLogical(
  layout: VisualLayout,
  visRow: number,
  visCol: number,
): [number, number] {
  const mapping = layout.visualToLogical[visRow];
  if (!mapping) {
    return [0, 0];
  }

  const [logRow, logColStart] = mapping;
  return [logRow, logColStart + visCol];
}
