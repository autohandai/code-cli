/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralized ASCII artwork for the CLI
 */
import stringWidth from 'string-width';

const DEFAULT_TERMINAL_COLUMNS = 80;

export interface RenderAutohandLogoOptions {
  columns?: number;
  includeWordmark?: boolean;
}

/**
 * Braille pattern logo (friendly mascot)
 * Used in: welcome banner, about command, main CLI banner
 */
const DETAILED_LOGO_LINES = [
  '⢀⡴⠛⠛⠻⣷⡄⠀⣠⡶⠟⠛⠻⣶⡄⢀⣴⡾⠛⠛⢿⣦⠀⢀⣴⠞⠛⠛⠶⡀',
  '⡎⠀⢰⣶⡆⠈⣿⣴⣿⠁⣴⣶⡄⠘⣿⣾⡏⢀⣶⣦⠀⢻⡇⣿⠃⢠⣶⡆⠀⢹',
  '⢧⠀⠘⠛⠃⢠⡿⠙⣿⡀⠙⠛⠃⣰⡿⢻⣧⠈⠛⠛⢀⣾⠇⢻⣆⠈⠛⠋⠀⡼',
  '⠈⠻⢶⣶⡾⠟⠁⠀⠘⠿⢶⣶⡾⠟⠁⠀⠙⠷⣶⣶⠿⠋⠀⠈⠻⠷⣶⡶⠚⠁',
  '⢀⣴⠿⠿⠷⣦⡀⠀⣠⣶⠿⠻⢷⣦⡀⠀⣠⡾⠟⠿⣶⣄⠀⢀⣴⡾⠿⠿⣶⣄',
  '⡾⠃⢠⣤⡄⠘⣿⣠⣿⠁⣠⣤⡄⠹⣷⣼⡏⢀⣤⣤⠈⢿⡆⣾⠏⢀⣤⣄⠈⢿',
  '⢧⡀⠸⠿⠇⢀⣿⠺⣿⡀⠻⠿⠃⢰⣿⢿⣇⠈⠿⠿⠀⣼⡇⢿⣇⠘⠿⠇⠀⣸',
  '⠈⢿⣦⣤⣴⡿⠃⠀⠙⢷⣦⣤⣶⡿⠁⠈⠻⣷⣤⣤⡾⠛⠀⠈⢿⣦⣤⣤⠴⠁'
];

const COMPACT_LOGO_LINES = [
  ' .--.  .--.  .--.  .--.',
  '(() ) (() ) (() ) (() )',
  " '--'  '--'  '--'  '--'",
  ' .--.  .--.  .--.  .--.',
  '(() ) (() ) (() ) (() )',
  " '--'  '--'  '--'  '--'",
];

const TINY_LOGO_LINES = [
  'o o o o',
  'o o o o',
];

/**
 * Combined logo: ASCII_FRIEND + Autohand in Figlet style side by side
 * Used in: authentication/login screen
 */
export const LOGO_LINES = [
  '⢀⡴⠛⠛⠻⣷⡄⠀⣠⡶⠟⠛⠻⣶⡄⢀⣴⡾⠛⠛⢿⣦⠀⢀⣴⠞⠛⠛⠶⡀     █████  ██    ██ ████████  ██████  ██   ██  █████  ███    ██ ██████',
  '⡎⠀⢰⣶⡆⠈⣿⣴⣿⠁⣴⣶⡄⠘⣿⣾⡏⢀⣶⣦⠀⢻⡇⣿⠃⢠⣶⡆⠀⢹     ██   ██ ██    ██    ██    ██    ██ ██   ██ ██   ██ ████   ██ ██   ██',
  '⢧⠀⠘⠛⠃⢠⡿⠙⣿⡀⠙⠛⠃⣰⡿⢻⣧⠈⠛⠛⢀⣾⠇⢻⣆⠈⠛⠋⠀⡼     ███████ ██    ██    ██    ██    ██ ███████ ███████ ██ ██  ██ ██   ██',
  '⠈⠻⢶⣶⡾⠟⠁⠀⠘⠿⢶⣶⡾⠟⠁⠀⠙⠷⣶⣶⠿⠋⠀⠈⠻⠷⣶⡶⠚⠁     ██   ██ ██    ██    ██    ██    ██ ██   ██ ██   ██ ██  ██ ██ ██   ██',
  '⢀⣴⠿⠿⠷⣦⡀⠀⣠⣶⠿⠻⢷⣦⡀⠀⣠⡾⠟⠿⣶⣄⠀⢀⣴⡾⠿⠿⣶⣄     ██   ██  ██████     ██     ██████  ██   ██ ██   ██ ██   ████ ██████',
  '⡾⠃⢠⣤⡄⠘⣿⣠⣿⠁⣠⣤⡄⠹⣷⣼⡏⢀⣤⣤⠈⢿⡆⣾⠏⢀⣤⣄⠈⢿',
  '⢧⡀⠸⠿⠇⢀⣿⠺⣿⡀⠻⠿⠃⢰⣿⢿⣇⠈⠿⠿⠀⣼⡇⢿⣇⠘⠿⠇⠀⣸',
  '⠈⢿⣦⣤⣴⡿⠃⠀⠙⢷⣦⣤⣶⡿⠁⠈⠻⣷⣤⣤⡾⠛⠀⠈⢿⣦⣤⣤⠴⠁'
];

export const ASCII_FRIEND = DETAILED_LOGO_LINES.join('\n');

function maxLineWidth(lines: readonly string[]): number {
  return Math.max(...lines.map((line) => stringWidth(line)));
}

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
  const candidates = [
    ...(options.includeWordmark ? [{ lines: LOGO_LINES, minColumns: 120 }] : []),
    { lines: DETAILED_LOGO_LINES, minColumns: 64 },
    { lines: COMPACT_LOGO_LINES, minColumns: 24 },
    { lines: TINY_LOGO_LINES, minColumns: 7 },
  ];

  const match = candidates.find((candidate) =>
    columns >= candidate.minColumns && maxLineWidth(candidate.lines) <= columns
  );
  if (match) {
    return match.lines.join('\n');
  }

  return columns >= 'autohand'.length ? 'autohand' : 'ah';
}
