/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';

/**
 * StdinBuffer accumulates stdin data and emits complete escape sequences.
 *
 * Problem: Terminal escape sequences can arrive in partial chunks across
 * multiple stdin 'data' events. For example, a Kitty key event like
 * \x1b[97;1:1u might arrive as \x1b[97 in one chunk and ;1:1u in another.
 *
 * Solution: Buffer incoming data and flush when:
 * 1. A complete sequence is detected (ends with known terminator)
 * 2. A timeout expires (incomplete sequence is flushed anyway)
 * 3. Bracketed paste mode is detected (special handling)
 *
 * Events:
 * - 'data': (sequence: string) => void - Complete escape sequence or printable text
 * - 'paste': (content: string) => void - Bracketed paste content (without wrapper)
 */
export class StdinBuffer extends EventEmitter {
  private buffer: string = '';
  private timeout: number;
  private timer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  /** Regex matching start of bracketed paste: \x1b[200~ */
  private static readonly BRACKETED_PASTE_START = '\x1b[200~';
  /** Regex matching end of bracketed paste: \x1b[201~ */
  private static readonly BRACKETED_PASTE_END = '\x1b[201~';
  /** Regex matching CSI sequence start: ESC [ */
  private static readonly CSI_START = '\x1b[';
  /** Regex matching CSI sequence terminator: @A-Za-z] */
  private static readonly CSI_TERMINATOR = /[@A-Za-z]$/;
  /** Regex matching OSC sequence start: ESC ] */
  private static readonly OSC_START = '\x1b]';
  /** Regex matching OSC terminator: BEL or ST (ESC \) */
  private static readonly OSC_TERMINATOR = /(?:\x07|\x1b\\)$/;

  constructor(options?: { timeout?: number }) {
    super();
    this.timeout = options?.timeout ?? 10; // Default 10ms timeout
  }

  /**
   * Process incoming stdin data. Sequences are buffered and emitted
   * when complete or on timeout.
   */
  process(data: string): void {
    if (this.destroyed) return;

    this.buffer += data;

    // Clear any pending flush timer - we'll set a new one if needed
    this.clearTimer();

    // Try to emit complete sequences
    this.tryFlush();
  }

  /**
   * Attempt to flush complete sequences from the buffer.
   * If incomplete sequences remain, schedule a timeout flush.
   */
  private tryFlush(): void {
    while (this.buffer.length > 0) {
      // Check for bracketed paste mode
      if (this.buffer.startsWith(StdinBuffer.BRACKETED_PASTE_START)) {
        this.handleBracketedPaste();
        return;
      }

      // Check for CSI sequence (ESC [ ... terminator)
      if (this.buffer.startsWith(StdinBuffer.CSI_START)) {
        const result = this.extractCSISequence();
        if (result === null) {
          // Incomplete sequence - wait for more data or timeout
          this.scheduleTimeout();
          return;
        }
        this.emit('data', result);
        continue;
      }

      // Check for OSC sequence (ESC ] ... terminator)
      if (this.buffer.startsWith(StdinBuffer.OSC_START)) {
        const result = this.extractOSCSequence();
        if (result === null) {
          // Incomplete sequence - wait for more data or timeout
          this.scheduleTimeout();
          return;
        }
        this.emit('data', result);
        continue;
      }

      // Not an escape sequence - emit printable character(s)
      // Find the next escape sequence start or emit all printable chars
      const nextEscape = this.buffer.indexOf('\x1b');
      if (nextEscape === -1) {
        // No escape sequences - emit all
        this.emit('data', this.buffer);
        this.buffer = '';
      } else if (nextEscape === 0) {
        // Buffer starts with escape but didn't match known patterns
        // This shouldn't happen, but handle gracefully
        this.scheduleTimeout();
        return;
      } else {
        // Emit printable chars before the escape
        this.emit('data', this.buffer.slice(0, nextEscape));
        this.buffer = this.buffer.slice(nextEscape);
      }
    }
  }

  /**
   * Handle bracketed paste mode content.
   * Emits 'paste' event with the content (without wrapper sequences).
   */
  private handleBracketedPaste(): void {
    const startIndex = StdinBuffer.BRACKETED_PASTE_START.length;
    const endIndex = this.buffer.indexOf(StdinBuffer.BRACKETED_PASTE_END);

    if (endIndex === -1) {
      // Incomplete paste - wait for more data
      this.scheduleTimeout();
      return;
    }

    // Extract paste content (between start and end markers)
    const content = this.buffer.slice(startIndex, endIndex);
    this.buffer = this.buffer.slice(endIndex + StdinBuffer.BRACKETED_PASTE_END.length);

    // Emit paste event
    this.emit('paste', content);

    // Continue processing remaining buffer
    this.tryFlush();
  }

  /**
   * Extract a complete CSI sequence from the buffer.
   * Returns the sequence if complete, null if incomplete.
   */
  private extractCSISequence(): string | null {
    // CSI format: ESC [ <params> <terminator>
    // Terminator is a single letter @A-Za-z
    for (let i = 2; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char === undefined) continue;

      // Check for terminator
      if (StdinBuffer.CSI_TERMINATOR.test(char)) {
        const sequence = this.buffer.slice(0, i + 1);
        this.buffer = this.buffer.slice(i + 1);
        return sequence;
      }
    }

    // No terminator found - incomplete sequence
    return null;
  }

  /**
   * Extract a complete OSC sequence from the buffer.
   * Returns the sequence if complete, null if incomplete.
   */
  private extractOSCSequence(): string | null {
    // OSC format: ESC ] <params> <terminator>
    // Terminator is BEL (\x07) or ST (ESC \)
    for (let i = 2; i < this.buffer.length; i++) {
      const char = this.buffer[i];
      if (char === undefined) continue;

      // Check for BEL terminator
      if (char === '\x07') {
        const sequence = this.buffer.slice(0, i + 1);
        this.buffer = this.buffer.slice(i + 1);
        return sequence;
      }

      // Check for ST terminator (ESC \)
      if (char === '\x1b' && this.buffer[i + 1] === '\\') {
        const sequence = this.buffer.slice(0, i + 2);
        this.buffer = this.buffer.slice(i + 2);
        return sequence;
      }
    }

    // No terminator found - incomplete sequence
    return null;
  }

  /**
   * Schedule a timeout to flush incomplete sequences.
   */
  private scheduleTimeout(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flushOnTimeout(), this.timeout);
  }

  /**
   * Clear the timeout timer.
   */
  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Flush remaining buffer on timeout.
   * This handles incomplete sequences that never completed.
   */
  private flushOnTimeout(): void {
    this.timer = undefined;
    if (this.buffer.length > 0) {
      this.emit('data', this.buffer);
      this.buffer = '';
    }
  }

  /**
   * Destroy the buffer and clean up resources.
   */
  destroy(): void {
    this.destroyed = true;
    this.clearTimer();
    this.buffer = '';
    this.removeAllListeners();
  }

  /**
   * Get the current buffer content (for debugging).
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Check if the buffer is empty.
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }
}