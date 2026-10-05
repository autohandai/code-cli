/**
 * Turns an Axo frame into terminal rows: two pixel rows per text row using half-block
 * glyphs (`▀` top pixel in the foreground, bottom pixel in the background).
 */

import type { ColorMode } from '../theme/types.js';
import { AXO_PALETTE } from './axoSprites.js';

const RESET = '\x1b[0m';
const UPPER = '▀';
const LOWER = '▄';
const FULL = '█';

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function nearestCubeIndex(channel: number): number {
  let best = 0;
  for (let index = 1; index < CUBE_STEPS.length; index += 1) {
    if (Math.abs(CUBE_STEPS[index]! - channel) < Math.abs(CUBE_STEPS[best]! - channel)) best = index;
  }
  return best;
}

/** Nearest xterm-256 colour-cube entry. */
export function toXterm256(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 16 + 36 * nearestCubeIndex(r) + 6 * nearestCubeIndex(g) + nearestCubeIndex(b);
}

/** Axo needs at least 256 colours to read as Axo; with fewer it stays hidden. */
export function canRenderAxo(colorMode: ColorMode): boolean {
  return colorMode === 'truecolor' || colorMode === '256';
}

function paint(hex: string, layer: 'fg' | 'bg', colorMode: ColorMode): string {
  const base = layer === 'fg' ? 38 : 48;
  if (colorMode === '256') return `\x1b[${base};5;${toXterm256(hex)}m`;
  const { r, g, b } = parseHex(hex);
  return `\x1b[${base};2;${r};${g};${b}m`;
}

function pixelColor(row: string | undefined, x: number): string | null {
  const symbol = row?.[x];
  if (symbol === undefined || symbol === '.') return null;
  return AXO_PALETTE[Number.parseInt(symbol, 16)] ?? null;
}

/**
 * Renders one frame. `mirror` flips it horizontally (the art faces right; Axo sits on
 * the right of the composer and faces left, toward the prompt).
 */
export function renderAxoRows(
  frame: readonly string[],
  options: { readonly colorMode: ColorMode; readonly mirror: boolean },
): string[] {
  if (!canRenderAxo(options.colorMode)) return [];
  const width = Math.max(0, ...frame.map((row) => row.length));
  const rows: string[] = [];
  for (let y = 0; y < frame.length; y += 2) {
    const top = options.mirror ? [...(frame[y] ?? '')].reverse().join('') : frame[y];
    const bottom = options.mirror ? [...(frame[y + 1] ?? '')].reverse().join('') : frame[y + 1];
    let line = '';
    for (let x = 0; x < width; x += 1) {
      const upper = pixelColor(top, x);
      const lower = pixelColor(bottom, x);
      if (!upper && !lower) {
        line += ' ';
      } else if (upper && lower && upper === lower) {
        line += `${paint(upper, 'fg', options.colorMode)}${FULL}${RESET}`;
      } else if (upper && lower) {
        line += `${paint(upper, 'fg', options.colorMode)}${paint(lower, 'bg', options.colorMode)}${UPPER}${RESET}`;
      } else if (upper) {
        line += `${paint(upper, 'fg', options.colorMode)}${UPPER}${RESET}`;
      } else {
        line += `${paint(lower!, 'fg', options.colorMode)}${LOWER}${RESET}`;
      }
    }
    rows.push(line);
  }
  return rows;
}
