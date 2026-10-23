/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { AUTOHAND_LOGO_FRAME_COUNT } from '../../src/utils/autohandLogoData.js';
import {
  ASCII_FRIEND,
  LOGO_LINES,
  getTerminalColumns,
  renderAutohandLogo,
} from '../../src/utils/asciiArt.js';

function logoLineWidths(logo: string): number[] {
  return logo.split('\n').map((line) => stringWidth(line));
}

describe('responsive Autohand ASCII logo', () => {
  it('preserves the SVG curves with shape-matched cells instead of symbolic ring outlines', () => {
    const art = renderAutohandLogo({ columns: 80, rows: 16 });
    expect(Math.max(...logoLineWidths(art))).toBe(48);
    expect(art).toMatch(/[\u2801-\u28ff]/u);
    expect(art).not.toContain('( o )');
  });

  it('shows continuous motion across the body as well as the orbit', () => {
    const frames = Array.from({ length: 15 }, (_, frame) => renderAutohandLogo({ columns: 80, rows: 16, frame }));
    expect(new Set(frames).size).toBeGreaterThanOrEqual(8);
    const body = (art: string) => art.split('\n').slice(2, -2).map(line => line.slice(8, -8)).join('');
    expect(body(frames[0])).not.toBe(body(frames[14]));
  });

  it('animates SVG geometry within a compact, fixed canvas', () => {
    const first = renderAutohandLogo({ columns: 120, rows: 30, frame: 0 });
    const next = renderAutohandLogo({ columns: 120, rows: 30, frame: 12 });
    expect(next).not.toBe(first);
    expect(first.split('\n')).toHaveLength(12);
    expect(next.split('\n')).toHaveLength(12);
    expect(Math.max(...logoLineWidths(first))).toBeLessThanOrEqual(48);
    expect(Math.max(...logoLineWidths(next))).toBeLessThanOrEqual(48);
  });

  it('wraps every scene phase without growing the canvas or dropping the mark', () => {
    for (const size of [{ columns: 48, rows: 12 }, { columns: 36, rows: 10 }, { columns: 28, rows: 8 }, { columns: 24, rows: 6 }]) {
      for (let frame = 0; frame < AUTOHAND_LOGO_FRAME_COUNT; frame++) {
        const art = renderAutohandLogo({ ...size, frame });
        expect(art.split('\n')).toHaveLength(size.rows);
        expect(logoLineWidths(art).every(width => width === size.columns)).toBe(true);
        expect(art.replace(/\s/gu, '').length).toBeGreaterThan(30);
        expect(art).toMatch(/^[\x20-\x7e\u2800-\u28ff·•●\n]+$/u);
        expect(renderAutohandLogo({ ...size, frame: frame + AUTOHAND_LOGO_FRAME_COUNT })).toBe(art);
      }
    }
    expect(renderAutohandLogo({ frame: -1 })).toBe(renderAutohandLogo({ frame: AUTOHAND_LOGO_FRAME_COUNT - 1 }));
    expect(renderAutohandLogo({ frame: Number.NaN })).toBe(ASCII_FRIEND);
    expect(renderAutohandLogo({ frame: Number.POSITIVE_INFINITY })).toBe(ASCII_FRIEND);
  });
  it.each([
    { columns: 80, expectedColumns: 48, expectedRows: 12 },
    { columns: 56, expectedColumns: 48, expectedRows: 12 },
    { columns: 40, expectedColumns: 36, expectedRows: 10 },
    { columns: 32, expectedColumns: 28, expectedRows: 8 },
    { columns: 31, expectedColumns: 28, expectedRows: 8 },
    { columns: 24, expectedColumns: 24, expectedRows: 6 },
  ])('selects a faithful mark that fits $columns columns', ({ columns, expectedColumns, expectedRows }) => {
    const logo = renderAutohandLogo({ columns });

    expect(Math.max(...logoLineWidths(logo))).toBe(expectedColumns);
    expect(logo.split('\n')).toHaveLength(expectedRows);
    expect(logo).toMatch(/^[\x20-\x7e\u2800-\u28ff·•●\n]+$/u);
  });

  it('retains ink in all eight ring regions of the SVG layout', () => {
    const lines = renderAutohandLogo({ columns: 56 }).split('\n');
    for (const [top, bottom] of [[1, 6], [6, 11]]) {
      for (let ring = 0; ring < 4; ring++) {
        const ink = lines.slice(top, bottom).map(line => line.slice(6 + ring * 9, 15 + ring * 9)).join('');
        expect(ink.match(/[\u2801-\u28ff]/gu)?.length).toBeGreaterThan(3);
      }
    }
  });

  it.each([
    { columns: 23, expected: 'autohand' },
    { columns: 12, expected: 'autohand' },
    { columns: 8, expected: 'autohand' },
    { columns: 7, expected: 'ah' },
    { columns: 2, expected: 'ah' },
    { columns: 1, expected: 'a' },
    { columns: 0, expected: 'a' },
    { columns: -10, expected: 'a' },
    { columns: 1.9, expected: 'a' },
  ])('uses a fitting text fallback at $columns columns', ({ columns, expected }) => {
    expect(renderAutohandLogo({ columns })).toBe(expected);
  });

  it('uses the same mark and a simple wordmark on wide terminals', () => {
    const logo = renderAutohandLogo({ columns: 140, includeWordmark: true });

    expect(logo).toBe(`${ASCII_FRIEND}\n\n${' '.repeat(20)}autohand`);
    expect(LOGO_LINES.join('\n')).toBe(logo);
    expect(logo.split('\n')).toHaveLength(14);
    expect(logoLineWidths(logo).every((width) => width <= 140)).toBe(true);
  });

  it.each([
    { rows: 14, expectedRows: 12, expectedColumns: 48 },
    { rows: 10, expectedRows: 10, expectedColumns: 36 },
    { rows: 9, expectedRows: 8, expectedColumns: 28 },
    { rows: 7, expectedRows: 6, expectedColumns: 24 },
    { rows: 5, expectedRows: 1, expectedColumns: 8 },
    { rows: 1, expectedRows: 1, expectedColumns: 8 },
  ])('fits the available $rows logo rows', ({ rows, expectedRows, expectedColumns }) => {
    const logo = renderAutohandLogo({ columns: 80, rows });

    expect(logo.split('\n')).toHaveLength(expectedRows);
    expect(Math.max(...logoLineWidths(logo))).toBe(expectedColumns);
  });

  it.each([0, -1, 0.9])('omits the mark when no complete logo row fits: %s', (rows) => {
    expect(renderAutohandLogo({ columns: 80, rows })).toBe('');
  });

  it('includes the wordmark in the available height budget', () => {
    const logo = renderAutohandLogo({ columns: 80, rows: 14, includeWordmark: true });

    expect(logo.split('\n')).toHaveLength(14);
    expect(Math.max(...logoLineWidths(logo))).toBe(48);
    expect(logo.split('\n').at(-1)).toBe(`${' '.repeat(20)}autohand`);
  });

  it('never exceeds constrained columns or rows during terminal resizing', () => {
    for (let columns = 1; columns <= 140; columns++) {
      for (let rows = 1; rows <= 20; rows++) {
        for (const includeWordmark of [false, true]) {
          const logo = renderAutohandLogo({ columns, rows, includeWordmark });

          expect(logoLineWidths(logo).every((width) => width <= columns)).toBe(true);
          expect(logo.split('\n').length).toBeLessThanOrEqual(rows);
        }
      }
    }
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('uses safe dimensions for an unavailable terminal size: %s', (dimension) => {
    expect(renderAutohandLogo({ columns: dimension, rows: dimension })).toBe(ASCII_FRIEND);
    expect(getTerminalColumns({ columns: dimension })).toBe(80);
  });

  it('reads terminal width from the output stream when available', () => {
    const output = { columns: 44 };

    expect(getTerminalColumns(output)).toBe(44);
  });
});
