/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Terminal window/tab title (OSC 0). Shows the session name and a colour
 * marker for its state, so a busy tab, one waiting on you, and a finished one
 * can be told apart from the tab strip.
 */

export type TerminalTitleState = 'idle' | 'working' | 'waiting';

export const TERMINAL_TITLE_BASE = 'Autohand Code';

const STATE_MARKERS: Record<TerminalTitleState, string> = {
  working: '🔴',
  waiting: '🟡',
  idle: '🟢',
};

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

export function formatTerminalTitle(name: string | undefined, state: TerminalTitleState): string {
  const marker = STATE_MARKERS[state];
  const label = name?.trim();
  return label ? `${marker} ${label} · Autohand` : `${marker} ${TERMINAL_TITLE_BASE}`;
}

export function terminalTitleSequence(title: string): string {
  return `\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, ' ')}\x07`;
}

export class TerminalTitleController {
  private name: string | undefined;
  private state: TerminalTitleState = 'idle';
  private lastWritten: string | undefined;

  constructor(
    private readonly write: (text: string) => void,
    private readonly enabled: boolean,
  ) {}

  setName(name: string | undefined): void {
    this.name = name?.trim() || undefined;
    this.apply();
  }

  setState(state: TerminalTitleState): void {
    this.state = state;
    this.apply();
  }

  getTitle(): string {
    return formatTerminalTitle(this.name, this.state);
  }

  /** Puts the plain product title back so the tab does not keep a stale state after exit. */
  restore(): void {
    this.emit(TERMINAL_TITLE_BASE);
  }

  private apply(): void {
    this.emit(this.getTitle());
  }

  private emit(title: string): void {
    if (!this.enabled || title === this.lastWritten) return;
    this.lastWritten = title;
    this.write(terminalTitleSequence(title));
  }
}
