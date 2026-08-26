/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  applyPeersScroll,
  clampScrollOffset,
  formatScrollPosition,
  maxScrollOffset,
  windowPeerLines,
} from '../../../src/ui/ink/peersScreenModel.js';

const lines = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `line-${index}`);

describe('maxScrollOffset', () => {
  it('is zero when the content fits', () => {
    expect(maxScrollOffset(5, 10)).toBe(0);
    expect(maxScrollOffset(10, 10)).toBe(0);
  });

  it('stops with the last line visible', () => {
    expect(maxScrollOffset(30, 10)).toBe(20);
  });
});

describe('clampScrollOffset', () => {
  it('never scrolls above the first line', () => {
    expect(clampScrollOffset(-5, 30, 10)).toBe(0);
  });

  it('never scrolls past the last screenful', () => {
    expect(clampScrollOffset(999, 30, 10)).toBe(20);
  });

  it('rejects a non-finite offset instead of producing NaN rows', () => {
    expect(clampScrollOffset(Number.NaN, 30, 10)).toBe(0);
  });
});

describe('windowPeerLines', () => {
  it('always emits exactly one screenful, so frames never change height', () => {
    // A varying frame height is what makes the alternate screen flicker.
    expect(windowPeerLines(lines(3), 0, 10).lines).toHaveLength(10);
    expect(windowPeerLines(lines(50), 0, 10).lines).toHaveLength(10);
    expect(windowPeerLines([], 0, 10).lines).toHaveLength(10);
  });

  it('pads short content with blanks rather than undefined', () => {
    const window = windowPeerLines(lines(2), 0, 5);
    expect(window.lines.slice(2)).toEqual(['', '', '']);
  });

  it('returns the requested slice', () => {
    const window = windowPeerLines(lines(30), 5, 3);
    expect(window.lines).toEqual(['line-5', 'line-6', 'line-7']);
  });

  it('reports top and bottom edges', () => {
    expect(windowPeerLines(lines(30), 0, 10)).toMatchObject({ atTop: true, atBottom: false });
    expect(windowPeerLines(lines(30), 20, 10)).toMatchObject({ atTop: false, atBottom: true });
  });

  it('is both top and bottom when everything fits', () => {
    expect(windowPeerLines(lines(4), 0, 10)).toMatchObject({
      atTop: true,
      atBottom: true,
      scrollable: false,
    });
  });

  it('clamps an out-of-range offset instead of rendering blanks', () => {
    const window = windowPeerLines(lines(30), 999, 10);
    expect(window.offset).toBe(20);
    expect(window.lines[0]).toBe('line-20');
  });

  it('survives a zero or negative height', () => {
    expect(windowPeerLines(lines(30), 0, 0).lines).toHaveLength(1);
    expect(windowPeerLines(lines(30), 0, -4).lines).toHaveLength(1);
  });
});

describe('applyPeersScroll', () => {
  it('moves a line at a time', () => {
    expect(applyPeersScroll('down', 0, 30, 10)).toBe(1);
    expect(applyPeersScroll('up', 5, 30, 10)).toBe(4);
  });

  it('keeps one line of context across a page', () => {
    expect(applyPeersScroll('pageDown', 0, 100, 10)).toBe(9);
    expect(applyPeersScroll('pageUp', 20, 100, 10)).toBe(11);
  });

  it('jumps to the ends', () => {
    expect(applyPeersScroll('top', 15, 30, 10)).toBe(0);
    expect(applyPeersScroll('bottom', 0, 30, 10)).toBe(20);
  });

  it('does not run past either edge', () => {
    expect(applyPeersScroll('up', 0, 30, 10)).toBe(0);
    expect(applyPeersScroll('down', 20, 30, 10)).toBe(20);
    expect(applyPeersScroll('pageDown', 20, 30, 10)).toBe(20);
  });

  it('stays put when the content fits', () => {
    expect(applyPeersScroll('down', 0, 5, 10)).toBe(0);
    expect(applyPeersScroll('bottom', 0, 5, 10)).toBe(0);
  });
});

describe('formatScrollPosition', () => {
  it('is omitted when everything fits', () => {
    expect(formatScrollPosition(windowPeerLines(lines(4), 0, 10))).toBeNull();
  });

  it('reports the visible range', () => {
    expect(formatScrollPosition(windowPeerLines(lines(92), 13, 18))).toBe('14-31 of 92');
  });

  it('never claims more lines than exist at the bottom', () => {
    expect(formatScrollPosition(windowPeerLines(lines(25), 999, 10))).toBe('16-25 of 25');
  });
});
