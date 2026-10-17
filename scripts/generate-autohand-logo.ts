/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fromSvg } from 'ascii.rest/kit';

const source = await readFile(new URL('../assets/autohand-logo.svg', import.meta.url), 'utf8');
const circles = [...source.matchAll(/<circle\b[^>]*\/>/gu)].map(match => match[0]);
if (circles.length !== 16) throw new Error('The Autohand SVG must contain eight rings and eight centers.');
const mark = `${source.match(/<svg\b[^>]*>/u)?.[0]}<g id="float"><g id="mark">${circles.join('')}</g></g></svg>`;
const fps = 15;
const frameCount = 120;
const period = frameCount / fps;

function composeScene(front: string, columns: number, rows: number, frame: number): string {
  const phase = frame / frameCount * Math.PI * 2;
  const body = front.split('\n').map(line => [...line]);
  const scene = Array.from({ length: rows }, () => Array<string>(columns).fill(' '));
  const put = (column: number, row: number, glyph: string) => {
    if (row < 0 || row >= rows || column < 0 || column >= columns) return;
    scene[row][column] = glyph;
  };

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if ((column * 43 + row * 71) % 167 === 3) put(column, row, '.');
    }
  }

  const moonX = (columns - 1) / 2 + Math.cos(phase + 0.7) * (columns / 2 - 2);
  const moonY = (rows - 1) / 2 + Math.sin(phase + 0.7) * (rows / 2 - 1.2);
  const moonInFront = Math.sin(phase + 0.7) > 0;
  const drawMoon = () => {
    for (let row = Math.floor(moonY - 1); row <= Math.ceil(moonY + 1); row++) {
      for (let column = Math.floor(moonX - 1.6); column <= Math.ceil(moonX + 1.6); column++) {
        const x = (column - moonX) / 1.6;
        const y = (row - moonY) * 2 / 1.6;
        const distance = x * x + y * y;
        if (distance >= 1) continue;
        const light = Math.max(0, -0.6 * x - 0.5 * y + 0.6 * Math.sqrt(1 - distance));
        put(column, row, light > 0.6 ? '●' : light > 0.25 ? '•' : '·');
      }
    }
  };
  if (!moonInFront) drawMoon();

  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      if (body[row][column] !== ' ') put(column + 1, row + 1, '·');
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (body[row][column] !== ' ') put(column, row, body[row][column]);
    }
  }
  if (moonInFront) drawMoon();
  return scene.map(line => line.join('')).join('\n');
}

const sizes = [
  { columns: 48, rows: 12 },
  { columns: 36, rows: 10 },
  { columns: 28, rows: 8 },
  { columns: 24, rows: 6 },
];
const variants = [];
for (const { columns, rows } of sizes) {
  const logo = fromSvg(mark, {
    cols: columns, rows, margin: [3, 1], color: false, style: 'braille', fps,
    '#float': {
      motion: (t) => {
        const phase = t / period * Math.PI * 2;
        return { y: 0.45 * Math.sin(phase), rotate: 0.035 * Math.sin(phase), scale: [0.97 + 0.03 * Math.cos(phase), 1] };
      },
      period,
    },
    '#mark': { motion: 'glint', every: 4 },
  }).default();
  const frames = Array.from({ length: frameCount }, (_, frame) => composeScene(logo(frame / fps), columns, rows, frame));
  variants.push({ columns, lines: frames[0].split('\n'), frames });
}
const output = `/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generated from assets/autohand-logo.svg with ascii.rest/kit.
 * Regenerate with: bun scripts/generate-autohand-logo.ts
 */
export const AUTOHAND_LOGO_FRAME_COUNT = ${frameCount};
export const AUTOHAND_LOGO_FPS = ${fps};
export const AUTOHAND_LOGO_ART: readonly {
  columns: number;
  lines: readonly string[];
  frames: readonly string[];
}[] = ${JSON.stringify(variants, null, 2)};
`;
await writeFile(new URL('../src/utils/autohandLogoData.ts', import.meta.url), output);
