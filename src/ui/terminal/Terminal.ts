/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Terminal abstraction interface.
 *
 * Provides a clean API for terminal operations, encapsulating:
 * - Raw mode management
 * - Kitty keyboard protocol
 * - Bracketed paste mode
 * - Cursor positioning
 * - Screen clearing
 * - Input draining on exit
 */
export interface Terminal {
  /**
   * Start the terminal in raw mode with input handling.
   * @param onInput Callback for input data (complete escape sequences)
   * @param onPaste Callback for bracketed paste content (optional)
   * @param onResize Callback for terminal resize events (optional)
   */
  start(
    onInput: (data: string) => void,
    onPaste?: (content: string) => void,
    onResize?: () => void
  ): void;

  /**
   * Stop the terminal and restore original state.
   * Drains input to prevent key release events from leaking.
   */
  stop(): Promise<void>;

  /**
   * Write data to the terminal.
   */
  write(data: string): void;

  /**
   * Drain pending input from stdin.
   * Useful before exiting to prevent key release events from leaking.
   * @param maxMs Maximum time to wait for drain (default 100ms)
   * @param idleMs Time to wait with no input before considering drained (default 20ms)
   */
  drainInput(maxMs?: number, idleMs?: number): Promise<void>;

  /**
   * Get terminal width in columns.
   */
  readonly columns: number;

  /**
   * Get terminal height in rows.
   */
  readonly rows: number;

  /**
   * Check if Kitty keyboard protocol is active.
   */
  readonly kittyProtocolActive: boolean;

  /**
   * Check if bracketed paste mode is active.
   */
  readonly bracketedPasteActive: boolean;

  // Cursor operations

  /**
   * Move cursor by relative lines.
   * Positive = down, negative = up.
   */
  moveBy(lines: number): void;

  /**
   * Move cursor to absolute position.
   */
  moveTo(row: number, col: number): void;

  /**
   * Hide the cursor.
   */
  hideCursor(): void;

  /**
   * Show the cursor.
   */
  showCursor(): void;

  // Clearing operations

  /**
   * Clear the current line.
   */
  clearLine(): void;

  /**
   * Clear from cursor to end of line.
   */
  clearToEndOfLine(): void;

  /**
   * Clear from cursor to start of line.
   */
  clearToStartOfLine(): void;

  /**
   * Clear the entire screen.
   */
  clearScreen(): void;

  /**
   * Clear the entire screen and scrollback buffer.
   */
  clearScreenAndScrollback(): void;

  /**
   * Clear from cursor to end of screen.
   */
  clearToEndOfScreen(): void;

  // Synchronized output mode

  /**
   * Begin synchronized output mode.
   * Prevents flickering during batch updates.
   */
  beginSync(): void;

  /**
   * End synchronized output mode.
   */
  endSync(): void;

  // Terminal title

  /**
   * Set the terminal window title.
   */
  setTitle(title: string): void;

  // Alternate screen buffer

  /**
   * Switch to alternate screen buffer.
   * Useful for full-screen TUI apps.
   */
  enterAlternateScreen(): void;

  /**
   * Switch back to main screen buffer.
   */
  exitAlternateScreen(): void;
}