/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized ASCII artwork for the CLI
 */
import { AUTOHAND_LOGO_ART, AUTOHAND_LOGO_FRAME_COUNT } from './autohandLogoData.js';

const DEFAULT_TERMINAL_COLUMNS = 80;
const WORDMARK = 'autohand';

const LOGO_VARIANTS = AUTOHAND_LOGO_ART.map((variant) => ({
  ...variant,
  art: variant.lines.join('\n'),
}));

export interface RenderAutohandLogoOptions {
  columns?: number;
  rows?: number;
  includeWordmark?: boolean;
  frame?: number;
}

function centeredWordmark(columns: number): string {
  return `${' '.repeat(Math.floor((columns - WORDMARK.length) / 2))}${WORDMARK}`;
}

export const ASCII_FRIEND = LOGO_VARIANTS[0].art;
export const LOGO_LINES = [
  ...AUTOHAND_LOGO_ART[0].lines,
  '',
  centeredWordmark(AUTOHAND_LOGO_ART[0].columns),
];

function normalizeColumns(columns: number | undefined): number {
  if (typeof columns !== 'number' || !Number.isFinite(columns)) {
    return DEFAULT_TERMINAL_COLUMNS;
  }

  return Math.max(1, Math.floor(columns));
}

export function getTerminalColumns(output: Pick<NodeJS.WriteStream, 'columns'> = process.stdout): number {
  return normalizeColumns(output.columns);
}

export function renderAutohandLogo(options: RenderAutohandLogoOptions = {}): string {
  const columns = normalizeColumns(options.columns);
  const rows = typeof options.rows === 'number' && Number.isFinite(options.rows)
    ? Math.max(0, Math.floor(options.rows))
    : Number.POSITIVE_INFINITY;
  if (rows === 0) {
    return '';
  }

  const wordmarkRows = options.includeWordmark ? 2 : 0;
  const match = LOGO_VARIANTS.find((variant) =>
    variant.columns <= columns && variant.lines.length + wordmarkRows <= rows
  );
  if (match) {
    const frame = typeof options.frame === 'number' && Number.isFinite(options.frame) ? Math.floor(options.frame) : 0;
    const phase = (frame % AUTOHAND_LOGO_FRAME_COUNT + AUTOHAND_LOGO_FRAME_COUNT) % AUTOHAND_LOGO_FRAME_COUNT;
    const art = match.frames[phase];
    return options.includeWordmark
      ? `${art}\n\n${centeredWordmark(match.columns)}`
      : art;
  }

  return columns >= WORDMARK.length ? WORDMARK : 'ah'.slice(0, columns);
}
