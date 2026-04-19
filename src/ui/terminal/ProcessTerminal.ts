/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Terminal } from './Terminal.js';
import { StdinBuffer } from '../StdinBuffer.js';
import {
  queryKittyProtocol,
  enableKittyProtocol,
  disableKittyProtocol,
  enableModifyOtherKeys,
  disableModifyOtherKeys,
  parseKittyResponse,
  isKittyProtocolActive,
  isModifyOtherKeysActive,
} from '../kittyProtocol.js';

/**
 * ProcessTerminal implements the Terminal interface using process.stdin/stdout.
 *
 * This is the main terminal implementation for CLI applications. It handles:
 * - Raw mode management
 * - Kitty keyboard protocol detection and enablement
 * - Bracketed paste mode
 * - Input buffering for escape sequences
 * - Cursor positioning and screen clearing
 * - Input draining on exit
 */
export class ProcessTerminal implements Terminal {
  private stdin: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
  private stdout: NodeJS.WriteStream;
  private stderr: NodeJS.WriteStream;

  private stdinBuffer: StdinBuffer;
  private started = false;
  private _bracketedPasteActive = false;

  // Callbacks
  private onInputCallback?: (data: string) => void;
  private onPasteCallback?: (content: string) => void;
  private onResizeCallback?: () => void;

  // Bound handlers for cleanup
  private boundStdinHandler: (chunk: Buffer | string) => void;
  private boundResizeHandler: () => void;

  constructor(options?: {
    stdin?: NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
  }) {
    this.stdin = options?.stdin ?? (process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void });
    this.stdout = options?.stdout ?? process.stdout;
    this.stderr = options?.stderr ?? process.stderr;

    this.stdinBuffer = new StdinBuffer();

    // Bind handlers once for cleanup
    this.boundStdinHandler = this.handleStdinData.bind(this);
    this.boundResizeHandler = this.handleResize.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------------

  get columns(): number {
    return this.stdout.columns ?? 80;
  }

  get rows(): number {
    return this.stdout.rows ?? 24;
  }

  get kittyProtocolActive(): boolean {
    return isKittyProtocolActive();
  }

  get bracketedPasteActive(): boolean {
    return this._bracketedPasteActive;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(
    onInput: (data: string) => void,
    onPaste?: (content: string) => void,
    onResize?: () => void
  ): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.onInputCallback = onInput;
    this.onPasteCallback = onPaste;
    this.onResizeCallback = onResize;

    // Enable raw mode
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
      this.stdin.setRawMode(true);
    }
    this.stdin.resume();

    // Set up stdin buffer listeners
    this.stdinBuffer.on('data', (data: string) => {
      // Check for Kitty protocol response
      const kittyFlags = parseKittyResponse(data);
      if (kittyFlags !== null) {
        // Terminal supports Kitty protocol - enable it
        enableKittyProtocol(this.stdout, 7);
        return;
      }

      // Pass to input callback
      this.onInputCallback?.(data);
    });

    this.stdinBuffer.on('paste', (content: string) => {
      this.onPasteCallback?.(content);
    });

    // Set up stdin data handler
    this.stdin.on('data', this.boundStdinHandler);

    // Set up resize handler
    if (this.stdout.isTTY) {
      this.stdout.on('resize', this.boundResizeHandler);
    }

    // Query for Kitty protocol support
    queryKittyProtocol(this.stdout);

    // Enable modifyOtherKeys as fallback (for tmux)
    enableModifyOtherKeys(this.stdout);

    // Enable bracketed paste mode
    this.enableBracketedPaste();

    // Hide cursor initially (TUI apps manage cursor manually)
    this.hideCursor();
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;

    // Drain input to prevent key release events from leaking
    await this.drainInput();

    // Disable bracketed paste mode
    this.disableBracketedPaste();

    // Disable Kitty protocol
    if (this.kittyProtocolActive) {
      disableKittyProtocol(this.stdout);
    }

    // Disable modifyOtherKeys
    if (isModifyOtherKeysActive()) {
      disableModifyOtherKeys(this.stdout);
    }

    // Show cursor before exit
    this.showCursor();

    // Remove event listeners
    this.stdin.removeListener('data', this.boundStdinHandler);
    if (this.stdout.isTTY) {
      this.stdout.removeListener('resize', this.boundResizeHandler);
    }

    // Destroy stdin buffer
    this.stdinBuffer.destroy();

    // Disable raw mode
    if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
      this.stdin.setRawMode(false);
    }
    this.stdin.pause();

    // Clear callbacks
    this.onInputCallback = undefined;
    this.onPasteCallback = undefined;
    this.onResizeCallback = undefined;
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  private handleStdinData(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    this.stdinBuffer.process(data);
  }

  private handleResize(): void {
    this.onResizeCallback?.();
  }

  async drainInput(maxMs = 100, idleMs = 20): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastDataTime = startTime;

      const onData = () => {
        lastDataTime = Date.now();
      };

      this.stdin.on('data', onData);

      const checkDrain = () => {
        const now = Date.now();
        const elapsed = now - startTime;
        const idle = now - lastDataTime;

        if (idle >= idleMs || elapsed >= maxMs) {
          this.stdin.removeListener('data', onData);
          resolve();
        } else {
          setTimeout(checkDrain, Math.min(idleMs - idle, maxMs - elapsed));
        }
      };

      setTimeout(checkDrain, idleMs);
    });
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  write(data: string): void {
    this.stdout.write(data);
  }

  // ---------------------------------------------------------------------------
  // Bracketed paste mode
  // ---------------------------------------------------------------------------

  private enableBracketedPaste(): void {
    this.stdout.write('\x1b[?2004h');
    this._bracketedPasteActive = true;
  }

  private disableBracketedPaste(): void {
    this.stdout.write('\x1b[?2004l');
    this._bracketedPasteActive = false;
  }

  // ---------------------------------------------------------------------------
  // Cursor operations
  // ---------------------------------------------------------------------------

  moveBy(lines: number): void {
    if (lines > 0) {
      this.stdout.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.stdout.write(`\x1b[${Math.abs(lines)}A`);
    }
  }

  moveTo(row: number, col: number): void {
    // Terminal uses 1-based coordinates
    this.stdout.write(`\x1b[${row + 1};${col + 1}H`);
  }

  hideCursor(): void {
    this.stdout.write('\x1b[?25l');
  }

  showCursor(): void {
    this.stdout.write('\x1b[?25h');
  }

  // ---------------------------------------------------------------------------
  // Clearing operations
  // ---------------------------------------------------------------------------

  clearLine(): void {
    this.stdout.write('\x1b[2K');
  }

  clearToEndOfLine(): void {
    this.stdout.write('\x1b[0K');
  }

  clearToStartOfLine(): void {
    this.stdout.write('\x1b[1K');
  }

  clearScreen(): void {
    this.stdout.write('\x1b[2J');
  }

  clearScreenAndScrollback(): void {
    // Clear screen, move cursor home, clear scrollback
    this.stdout.write('\x1b[2J\x1b[H\x1b[3J');
  }

  clearToEndOfScreen(): void {
    this.stdout.write('\x1b[0J');
  }

  // ---------------------------------------------------------------------------
  // Synchronized output mode
  // ---------------------------------------------------------------------------

  beginSync(): void {
    this.stdout.write('\x1b[?2026h');
  }

  endSync(): void {
    this.stdout.write('\x1b[?2026l');
  }

  // ---------------------------------------------------------------------------
  // Terminal title
  // ---------------------------------------------------------------------------

  setTitle(title: string): void {
    // OSC 0: Set window title
    this.stdout.write(`\x1b]0;${title}\x07`);
  }

  // ---------------------------------------------------------------------------
  // Alternate screen buffer
  // ---------------------------------------------------------------------------

  enterAlternateScreen(): void {
    this.stdout.write('\x1b[?1049h');
  }

  exitAlternateScreen(): void {
    this.stdout.write('\x1b[?1049l');
  }
}