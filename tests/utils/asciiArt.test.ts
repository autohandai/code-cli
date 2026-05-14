/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import {
  getTerminalColumns,
  renderAutohandLogo,
} from '../../src/utils/asciiArt.js';

function logoLineWidths(logo: string): number[] {
  return logo.split('\n').map((line) => stringWidth(line));
}

describe('responsive Autohand ASCII logo', () => {
  it('fits a compact terminal width without clipping', () => {
    const logo = renderAutohandLogo({ columns: 40 });

    expect(logoLineWidths(logo).every((width) => width <= 40)).toBe(true);
    expect(logo).toContain('()');
  });

  it('falls back to a tiny logo for very narrow terminal widths', () => {
    const logo = renderAutohandLogo({ columns: 12 });

    expect(logoLineWidths(logo).every((width) => width <= 12)).toBe(true);
    expect(logo).toBe('o o o o\no o o o');
  });

  it('uses a text fallback when the terminal cannot fit logo art', () => {
    expect(renderAutohandLogo({ columns: 6 })).toBe('ah');
  });

  it('can keep the full login wordmark on very wide terminals', () => {
    const logo = renderAutohandLogo({ columns: 140, includeWordmark: true });

    expect(logo).toContain('█████');
    expect(logoLineWidths(logo).every((width) => width <= 140)).toBe(true);
  });

  it('reads terminal width from the output stream when available', () => {
    const output = { columns: 44 } as NodeJS.WriteStream;

    expect(getTerminalColumns(output)).toBe(44);
  });
});
