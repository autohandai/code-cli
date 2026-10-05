/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import stringWidth from 'string-width';
import { describe, expect, it } from 'vitest';
import { canRenderAxo, renderAxoRows, toXterm256 } from '../../../src/ui/axo/axoRender.js';
import { AXO_FRAMES, AXO_PALETTE, AXO_SPRITE_PIXEL_HEIGHT, AXO_SPRITE_WIDTH } from '../../../src/ui/axo/axoSprites.js';

const strip = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, '');

describe('renderAxoRows', () => {
  it('packs two pixel rows into each text row at a fixed width', () => {
    for (const frames of Object.values(AXO_FRAMES)) {
      for (const frame of frames) {
        expect(frame).toHaveLength(AXO_SPRITE_PIXEL_HEIGHT);
        const rows = renderAxoRows(frame, { colorMode: 'truecolor', mirror: true });
        expect(rows).toHaveLength(AXO_SPRITE_PIXEL_HEIGHT / 2);
        for (const row of rows) expect(stringWidth(row)).toBe(AXO_SPRITE_WIDTH);
      }
    }
  });

  it('chooses the half block that matches which pixels are painted', () => {
    const [a] = AXO_PALETTE;
    const rows = renderAxoRows(['0.0.', '00..'], { colorMode: 'truecolor', mirror: false });
    expect(strip(rows[0]!)).toBe('█▄▀ ');
    expect(rows[0]).toContain('\u001b[38;2;');
    expect(a).toMatch(/^#/);
  });

  it('mirrors so Axo faces the prompt', () => {
    const rows = renderAxoRows(['0...', '....'], { colorMode: 'truecolor', mirror: true });
    expect(strip(rows[0]!)).toBe('   ▀');
  });

  it('falls back to the 256-colour cube, and stays hidden with fewer colours', () => {
    expect(renderAxoRows(['0', '0'], { colorMode: '256', mirror: false })[0]).toContain('\u001b[38;5;');
    expect(toXterm256('#000000')).toBe(16);
    expect(toXterm256('#ffffff')).toBe(231);
    expect(canRenderAxo('16')).toBe(false);
    expect(renderAxoRows(['0', '0'], { colorMode: 'none', mirror: false })).toEqual([]);
  });
});
