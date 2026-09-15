/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Terminal window/tab title (OSC 0). Shows the session name and a small
 * marker for its state so the tab strip tells them apart: a braille spinner
 * that moves in step with the status-row spinner while a turn runs, ◐ while
 * the turn waits on you, ✓ once it completed, ✗ when it failed. A failure stays until
 * the next turn starts. In iTerm2 the tab itself is also coloured green,
 * orange, or red through its proprietary tab-colour escape; other terminals
 * ignore that sequence, so they get the glyph alone.
 */

export type TerminalTitleState = 'idle' | 'working' | 'waiting' | 'failed';

export const TERMINAL_TITLE_BASE = 'Autohand Code';

/** Braille "jumping beans", shared with the status-row spinner so both move together. */
export const WORKING_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const STATE_MARKERS: Record<Exclude<TerminalTitleState, 'working'>, string> = {
  idle: '✓',
  waiting: '◐',
  failed: '✗',
};

type Rgb = readonly [number, number, number];
const TAB_COLOURS: Record<Exclude<TerminalTitleState, 'working'>, Rgb> = {
  idle: [52, 199, 89],
  waiting: [255, 149, 0],
  failed: [255, 59, 48],
};

export interface TerminalTitleOptions {
  /** Colour the tab itself; only iTerm2 understands the escape. */
  tabColour?: boolean;
}

/**
 * Same gate as the startup title write: only a real terminal, and never when
 * stdout carries structured or protocol output that a title escape would corrupt.
 */
export function shouldWriteTerminalTitle(argv: readonly string[], isTTY: boolean | undefined): boolean {
  if (!isTTY) return false;
  const structured = argv.some((arg) => (
    arg === '--json' || arg.startsWith('--json=') || arg === '--output-format' || arg.startsWith('--output-format=')
  ));
  const protocol = argv.some((arg, index) => (
    arg === '--answer-only' || arg === '--setup-only' || arg === '--acp' || arg === '--mode=rpc' || arg === '--mode=acp'
    || (arg === '--mode' && (argv[index + 1] === 'rpc' || argv[index + 1] === 'acp'))
  ));
  return !structured && !protocol;
}

export function formatTerminalTitle(name: string | undefined, state: TerminalTitleState, frame = 0): string {
  const marker = state === 'working'
    ? WORKING_SPINNER_FRAMES[Math.abs(frame) % WORKING_SPINNER_FRAMES.length]
    : STATE_MARKERS[state];
  const label = name?.trim();
  return label ? `${marker} ${label} · Autohand` : `${marker} ${TERMINAL_TITLE_BASE}`;
}

export function terminalTitleSequence(title: string): string {
  return `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, ' ')}\x07`;
}

/** iTerm2 tab colour (OSC 6); `undefined` puts the tab back to its default colour. */
export function iTermTabColourSequence(colour: Rgb | undefined): string {
  if (!colour) return '\x1b]6;1;bg;*;default\x07';
  const [red, green, blue] = colour;
  return `\x1b]6;1;bg;red;brightness;${red}\x07\x1b]6;1;bg;green;brightness;${green}\x07\x1b]6;1;bg;blue;brightness;${blue}\x07`;
}

export class TerminalTitleController {
  private name: string | undefined;
  private state: TerminalTitleState = 'idle';
  private frame = 0;
  private lastWritten: string | undefined;
  private lastColour: string | undefined;

  constructor(
    private readonly write: (text: string) => void,
    private readonly enabled: boolean,
    private readonly options: TerminalTitleOptions = {},
  ) {}

  setName(name: string | undefined): void {
    this.name = name?.trim() || undefined;
    this.apply();
  }

  setState(state: TerminalTitleState): void {
    // Going idle never hides a failure; only the next turn replaces the mark.
    if (state === 'idle' && this.state === 'failed') return;
    if (state === 'working' && this.state !== 'working') this.frame = 0;
    this.state = state;
    this.apply();
  }

  /** Mirrors the status-row spinner frame while a turn runs; ignored in every other state. */
  setFrame(frame: number): void {
    if (this.state !== 'working') return;
    this.frame = Math.abs(frame) % WORKING_SPINNER_FRAMES.length;
    this.apply();
  }

  getTitle(): string {
    return formatTerminalTitle(this.name, this.state, this.frame);
  }

  /** Puts the plain product title and default tab colour back so nothing stays stale after exit. */
  restore(): void {
    this.emitColour(undefined);
    this.emit(TERMINAL_TITLE_BASE);
  }

  private apply(): void {
    this.emitColour(this.state === 'working' ? undefined : TAB_COLOURS[this.state]);
    this.emit(this.getTitle());
  }

  private emit(title: string): void {
    if (!this.enabled || title === this.lastWritten) return;
    this.lastWritten = title;
    this.write(terminalTitleSequence(title));
  }

  private emitColour(colour: Rgb | undefined): void {
    if (!this.enabled || !this.options.tabColour) return;
    const sequence = iTermTabColourSequence(colour);
    if (sequence === this.lastColour) return;
    this.lastColour = sequence;
    this.write(sequence);
  }
}
