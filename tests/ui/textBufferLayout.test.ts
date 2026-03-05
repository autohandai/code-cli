/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { calculateLayout, logicalToVisual, visualToLogical } from '../../src/ui/textBufferLayout.js';

describe('calculateLayout', () => {
  it('returns single visual line for short text', () => {
    const layout = calculateLayout(['hello'], 20);
    expect(layout.visualLines).toEqual(['hello']);
    expect(layout.visualToLogical).toEqual([[0, 0]]);
  });

  it('wraps long line at word boundary', () => {
    const layout = calculateLayout(['hello world'], 10);
    // 'hello ' fits in 10 cols, then 'world' wraps
    expect(layout.visualLines.length).toBe(2);
    expect(layout.visualLines[0]).toBe('hello ');
    expect(layout.visualLines[1]).toBe('world');
    expect(layout.visualToLogical).toEqual([[0, 0], [0, 6]]);
  });

  it('hard-wraps when no word boundary exists', () => {
    const layout = calculateLayout(['abcdefghijklmno'], 10);
    expect(layout.visualLines[0]).toBe('abcdefghij');
    expect(layout.visualLines[1]).toBe('klmno');
    expect(layout.visualToLogical).toEqual([[0, 0], [0, 10]]);
  });

  it('handles multiple logical lines', () => {
    const layout = calculateLayout(['hello', 'world'], 20);
    expect(layout.visualLines).toEqual(['hello', 'world']);
    expect(layout.visualToLogical).toEqual([[0, 0], [1, 0]]);
  });

  it('handles empty lines', () => {
    const layout = calculateLayout(['hello', '', 'world'], 20);
    expect(layout.visualLines).toEqual(['hello', '', 'world']);
    expect(layout.visualToLogical).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it('wraps multiple long lines independently', () => {
    const layout = calculateLayout(['aaaa bbbb', 'cccc dddd'], 6);
    expect(layout.visualLines.length).toBe(4);
    expect(layout.visualToLogical[0]).toEqual([0, 0]);
    expect(layout.visualToLogical[2]).toEqual([1, 0]);
  });

  it('builds correct logicalToVisual map', () => {
    const layout = calculateLayout(['hello world'], 10);
    // logical line 0 spans visual lines 0 and 1
    expect(layout.logicalToVisual[0].length).toBe(2);
    expect(layout.logicalToVisual[0][0]).toEqual([0, 0]);
    expect(layout.logicalToVisual[0][1]).toEqual([1, 6]);
  });

  it('handles line that exactly fills viewport width', () => {
    const layout = calculateLayout(['abcdefghij'], 10);
    expect(layout.visualLines).toEqual(['abcdefghij']);
  });

  it('handles line one char over viewport width', () => {
    const layout = calculateLayout(['abcdefghijk'], 10);
    expect(layout.visualLines.length).toBe(2);
  });

  it('handles empty input', () => {
    const layout = calculateLayout([''], 80);
    expect(layout.visualLines).toEqual(['']);
  });

  it('handles viewport width of 1', () => {
    const layout = calculateLayout(['abc'], 1);
    expect(layout.visualLines.length).toBe(3);
    expect(layout.visualLines).toEqual(['a', 'b', 'c']);
  });

  it('handles consecutive spaces', () => {
    const layout = calculateLayout(['a     b'], 20);
    expect(layout.visualLines.length).toBe(1);
  });
});

describe('logicalToVisual', () => {
  it('maps logical cursor to visual position — no wrap', () => {
    const layout = calculateLayout(['hello'], 20);
    expect(logicalToVisual(layout, 0, 3)).toEqual([0, 3]);
  });

  it('maps logical cursor to visual position — after wrap', () => {
    const layout = calculateLayout(['hello world'], 10);
    // cursor at logical col 7 ('o' in 'world') → visual line 1, col 1
    expect(logicalToVisual(layout, 0, 7)).toEqual([1, 1]);
  });

  it('maps start of wrapped line correctly', () => {
    const layout = calculateLayout(['hello world'], 10);
    expect(logicalToVisual(layout, 0, 6)).toEqual([1, 0]);
  });

  it('maps cursor at end of line', () => {
    const layout = calculateLayout(['hello'], 20);
    expect(logicalToVisual(layout, 0, 5)).toEqual([0, 5]);
  });

  it('maps second logical line', () => {
    const layout = calculateLayout(['hello', 'world'], 20);
    expect(logicalToVisual(layout, 1, 3)).toEqual([1, 3]);
  });
});

describe('visualToLogical', () => {
  it('maps visual cursor back — no wrap', () => {
    const layout = calculateLayout(['hello'], 20);
    expect(visualToLogical(layout, 0, 3)).toEqual([0, 3]);
  });

  it('maps visual cursor back — after wrap', () => {
    const layout = calculateLayout(['hello world'], 10);
    // visual line 1, col 1 → logical line 0, col 7
    expect(visualToLogical(layout, 1, 1)).toEqual([0, 7]);
  });

  it('round-trips correctly', () => {
    const layout = calculateLayout(['hello world foo bar'], 8);
    for (let lr = 0; lr < layout.logicalToVisual.length; lr++) {
      const spans = layout.logicalToVisual[lr];
      for (let si = 0; si < spans.length; si++) {
        const [vr] = spans[si];
        const visLine = layout.visualLines[vr];
        const isLastSpan = si === spans.length - 1;
        // When a logical line wraps, the cursor at vc == visLine.length
        // on a non-terminal visual line is ambiguous with vc == 0 on the
        // next visual line.  logicalToVisual correctly resolves to the
        // next line, so we only test up to visLine.length on the last
        // visual segment of each logical line.
        const maxVc = isLastSpan ? visLine.length : visLine.length - 1;
        for (let vc = 0; vc <= maxVc; vc++) {
          const [lr2, lc2] = visualToLogical(layout, vr, vc);
          const [vr2, vc2] = logicalToVisual(layout, lr2, lc2);
          expect(vr2).toBe(vr);
          expect(vc2).toBe(vc);
        }
      }
    }
  });
});
