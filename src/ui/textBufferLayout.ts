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
  logicalLines: string[];
}

interface GraphemeCell {
  segment: string;
  start: number;
  end: number;
  width: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function getGraphemeCells(value: string): GraphemeCell[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment, index }) => ({
    segment,
    start: index,
    end: index + segment.length,
    width: stringWidth(segment),
  }));
}

function stringIndexAtVisualColumn(value: string, visualColumn: number): number {
  const targetColumn = Math.max(0, visualColumn);
  let currentColumn = 0;

  for (const grapheme of getGraphemeCells(value)) {
    const nextColumn = currentColumn + grapheme.width;
    if (targetColumn <= currentColumn) {
      return grapheme.start;
    }
    if (targetColumn < nextColumn) {
      return targetColumn - currentColumn >= Math.ceil(grapheme.width / 2)
        ? grapheme.end
        : grapheme.start;
    }
    currentColumn = nextColumn;
  }

  return value.length;
}

/* ------------------------------------------------------------------ */
/*  Layout calculation                                                 */
/* ------------------------------------------------------------------ */

/**
 * Wrap `lines` into visual lines that fit within `viewportWidth` columns.
 *
 * Uses a greedy word-wrap algorithm:
 * 1. Walk each logical line by grapheme cluster.
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
      const graphemes = getGraphemeCells(line);
      let position = 0;

      while (position < graphemes.length) {
        const segStart = graphemes[position]!.start;
        const visIdx = visualLines.length;

        let currentWidth = 0;
        let lastSpacePosition = -1;
        let endPosition = position;

        while (endPosition < graphemes.length) {
          const grapheme = graphemes[endPosition]!;
          if (currentWidth + grapheme.width > width && endPosition > position) {
            break;
          }

          currentWidth += grapheme.width;
          endPosition += 1;

          if (grapheme.segment === ' ') {
            lastSpacePosition = endPosition;
          }

          if (currentWidth >= width) {
            break;
          }
        }

        if (endPosition < graphemes.length) {
          if (lastSpacePosition > position) {
            const segmentEnd = graphemes[lastSpacePosition - 1]!.end;
            const segment = line.slice(segStart, segmentEnd);
            visualLines.push(segment);
            visRows.push([visIdx, segStart]);
            visualToLogicalMap.push([logRow, segStart]);
            position = lastSpacePosition;
          } else {
            const segmentEnd = graphemes[endPosition - 1]!.end;
            const segment = line.slice(segStart, segmentEnd);
            visualLines.push(segment);
            visRows.push([visIdx, segStart]);
            visualToLogicalMap.push([logRow, segStart]);
            position = endPosition;
          }
        } else {
          const segment = line.slice(segStart);
          visualLines.push(segment);
          visRows.push([visIdx, segStart]);
          visualToLogicalMap.push([logRow, segStart]);
          position = endPosition;
        }
      }
    }

    logicalToVisualMap.push(visRows);
  }

  return {
    visualLines,
    logicalToVisual: logicalToVisualMap,
    visualToLogical: visualToLogicalMap,
    logicalLines: [...lines],
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
 * the matching terminal cell column.
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
      const logicalLine = layout.logicalLines[logRow] ?? '';
      return [visRow, stringWidth(logicalLine.slice(logColStart, logCol))];
    }
  }

  // Fallback: first span
  const [visRow, logColStart] = spans[0];
  const logicalLine = layout.logicalLines[logRow] ?? '';
  return [visRow, stringWidth(logicalLine.slice(logColStart, logCol))];
}

/**
 * Convert a visual cursor position to a logical (row, col) position.
 *
 * Looks up `visualToLogical[visRow]` to get `[logRow, logColStart]`,
 * then snaps the terminal cell column to a grapheme boundary.
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
  const visualLine = layout.visualLines[visRow] ?? '';
  return [logRow, logColStart + stringIndexAtVisualColumn(visualLine, visCol)];
}
