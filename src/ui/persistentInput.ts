/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistent Input - Always-visible input field at the bottom of the terminal
 * Uses terminal scroll regions to separate spinner output from input area
 */
import chalk from 'chalk';
import readline from 'node:readline';
import EventEmitter from 'node:events';
import { TerminalRegions, createTerminalRegions } from './terminalRegions.js';
import { safeEmitKeypressEvents } from './inputPrompt.js';
import { safeSetRawMode } from './rawMode.js';
import { isImmediateCommand } from './shellCommand.js';

export interface QueuedMessage {
  text: string;
  timestamp: number;
}

export interface PersistentInputOptions {
  maxQueueSize?: number;
  statusLine?: string | { left: string; right: string };
  /** Silent mode - queue input without terminal regions UI (works better with ora spinner) */
  silentMode?: boolean;
}

/**
 * PersistentInput provides an always-visible input field at the bottom
 * of the terminal using scroll regions, so spinner and output stay above.
 */
export class PersistentInput extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private currentInput = '';
  private isActive = false;
  private maxQueueSize: number;
  private statusLine: string | { left: string; right: string };
  private output: NodeJS.WriteStream;
  private input: NodeJS.ReadStream;
  private isPaused = false;
  private regions: TerminalRegions;
  private silentMode: boolean;
  private activityLine = '';

  constructor(options: PersistentInputOptions = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize ?? 10;
    this.statusLine = options.statusLine ?? '';
    this.output = process.stdout;
    this.input = process.stdin;
    this.silentMode = options.silentMode ?? false;
    this.regions = createTerminalRegions(this.output);
  }

  /**
   * Start the persistent input (call when agent starts working)
   */
  start(): void {
    if (this.isActive || !this.input.isTTY) {
      return;
    }

    this.isActive = true;
    this.currentInput = '';
    this.isPaused = false;
    try {
      this.input.resume();
    } catch {
      // Best effort only.
    }

    if (this.silentMode) {
      // Silent mode: use readline keypress events (same as ESC listener)
      // This ensures compatibility with other stdin handlers
      // Use safe version to prevent duplicate listener registration
      safeEmitKeypressEvents(this.input as NodeJS.ReadStream);
      const supportsRaw = typeof this.input.setRawMode === 'function';
      const wasRaw = (this.input as any).isRaw;
      if (!wasRaw && supportsRaw) {
        safeSetRawMode(this.input, true);
      }
      (this as any)._supportsRaw = supportsRaw;
      (this as any)._wasRaw = wasRaw;
      this.input.on('keypress', this.handleKeypress);
    } else {
      // Full mode: use terminal regions
      this.regions.enable();
      // Use safe version to prevent duplicate listener registration
      safeEmitKeypressEvents(this.input as NodeJS.ReadStream);
      const supportsRaw = typeof this.input.setRawMode === 'function';
      if (supportsRaw) {
        safeSetRawMode(this.input, true);
      }
      this.input.on('keypress', this.handleKeypress);
      (this as any)._supportsRaw = supportsRaw;
      this.render();
    }
  }

  /**
   * Stop the persistent input (call when agent finishes)
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    this.input.off('keypress', this.handleKeypress);

    if (this.silentMode) {
      // Restore terminal state only if we changed it
      const supportsRaw = (this as any)._supportsRaw;
      const wasRaw = (this as any)._wasRaw;
      if (!wasRaw && supportsRaw && this.input.isTTY) {
        safeSetRawMode(this.input, false);
      }
    } else {
      // Disable terminal regions
      this.regions.disable();
      const supportsRaw = (this as any)._supportsRaw;
      if (supportsRaw && this.input.isTTY) {
        safeSetRawMode(this.input, false);
      }
    }

    this.currentInput = '';
  }

  /**
   * Pause input handling temporarily (for confirmations)
   */
  pause(): void {
    if (!this.isActive) return;

    this.isPaused = true;

    if (!this.silentMode) {
      // Temporarily disable regions so Modal prompts can work
      this.regions.focusScrollBottom();
      this.regions.disable();
    }

    // Restore terminal for Modal prompts
    const supportsRaw = (this as any)._supportsRaw;
    if (supportsRaw && this.input.isTTY) {
      safeSetRawMode(this.input, false);
    }
  }

  /**
   * Resume input handling after confirmations
   */
  resume(): void {
    if (!this.isActive) return;

    this.isPaused = false;
    try {
      this.input.resume();
    } catch {
      // Best effort only.
    }

    if (!this.silentMode) {
      // Re-enable regions
      this.regions.enable();
    }

    // Re-enable raw mode
    const supportsRaw = (this as any)._supportsRaw;
    if (supportsRaw && this.input.isTTY) {
      safeSetRawMode(this.input, true);
    }

    if (!this.silentMode) {
      this.render();
    }
  }

  /**
   * Update the status line
   */
  setStatusLine(status: string | { left: string; right: string }): void {
    this.statusLine = status;
    if (this.isActive && !this.isPaused) {
      this.regions.updateStatus(this.getStatusText(status), this.queue.length);
    }
  }

  setActivityLine(status: string): void {
    this.activityLine = status;
    if (this.isActive && !this.isPaused && !this.silentMode) {
      this.regions.updateActivity(status);
    }
  }

  /**
   * Check if there are queued messages
   */
  hasQueued(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Get the queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Get the next queued message
   */
  dequeue(): QueuedMessage | undefined {
    const msg = this.queue.shift();
    if (this.isActive && !this.isPaused) {
      this.render();
    }
    return msg;
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Get current input (for external display)
   */
  getCurrentInput(): string {
    return this.currentInput;
  }

  /**
   * Replace the current draft input text.
   */
  setCurrentInput(value: string): void {
    this.currentInput = value;
    if (this.isActive && !this.isPaused && !this.silentMode) {
      this.regions.updateInput(this.currentInput);
    }
    this.emitInputChange();
  }

  private emitInputChange(): void {
    this.emit('input-change', this.currentInput);
  }

  /**
   * Handle keypress events
   */
  private handleKeypress = (_str: string, key: readline.Key): void => {
    if (!this.isActive || this.isPaused) {
      return;
    }

    // Handle Enter - execute immediate commands or submit to queue
    if (key?.name === 'return' || key?.name === 'enter') {
      if (this.currentInput.trim()) {
        const text = this.currentInput.trim();

        // Shell commands (!) and slash commands (/) execute immediately, never queued
        if (isImmediateCommand(text)) {
          this.currentInput = '';
          if (!this.silentMode) {
            this.regions.updateInput('');
          }
          this.emitInputChange();
          this.emit('immediate-command', text);
          return;
        }

        this.addToQueue(text);
        this.currentInput = '';
        if (!this.silentMode) {
          this.regions.updateInput('');
        }
        this.emitInputChange();
      }
      return;
    }

    // Handle Backspace
    if (key?.name === 'backspace') {
      if (this.currentInput.length > 0) {
        this.currentInput = this.currentInput.slice(0, -1);
        if (!this.silentMode) {
          this.regions.updateInput(this.currentInput);
        }
        this.emitInputChange();
      }
      return;
    }

    // Handle Escape - emit for agent to handle cancellation
    if (key?.name === 'escape') {
      this.emit('escape');
      return;
    }

    // Handle Ctrl+C
    if (key?.name === 'c' && key.ctrl) {
      this.emit('ctrl-c');
      return;
    }

    // Ignore other control keys
    if (key?.ctrl || key?.meta) {
      return;
    }

    // Add printable characters
    if (_str) {
      const printable = _str.replace(/[\x00-\x1F\x7F]/g, '');
      if (printable) {
        this.currentInput += printable;
        if (!this.silentMode) {
          this.regions.updateInput(this.currentInput);
        }
        this.emitInputChange();
      }
    }
  };

  /**
   * Add a message to the queue
   */
  private addToQueue(text: string): void {
    if (this.queue.length >= this.maxQueueSize) {
      // Show warning
      if (this.silentMode) {
        // In silent mode, just emit - the agent will handle feedback
        this.emit('queue-full', this.maxQueueSize);
      } else {
        this.regions.writeAbove(chalk.yellow(`\n⚠ Queue full (max ${this.maxQueueSize})\n`));
      }
      return;
    }

    this.queue.push({
      text,
      timestamp: Date.now()
    });

    // Show confirmation
    const preview = text.length > 40 ? text.slice(0, 37) + '...' : text;
    if (!this.silentMode) {
      this.regions.writeAbove(chalk.cyan(`\n✓ Queued: "${preview}" (${this.queue.length} pending)\n`));
      this.regions.updateStatus(this.getStatusText(), this.queue.length);
    }

    this.emit('queued', text, this.queue.length);
  }

  /**
   * Render the fixed input region
   */
  render(): void {
    if (!this.isActive || this.isPaused) {
      return;
    }

    this.regions.renderFixedRegion(
      this.currentInput,
      this.queue.length,
      this.getStatusText(),
      this.activityLine
    );
  }

  /**
   * Write output above the input area (in scroll region)
   */
  writeAbove(text: string): void {
    this.regions.writeAbove(text);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stop();
    this.queue = [];
  }

  private getStatusText(status: string | { left: string; right: string } = this.statusLine): string {
    if (typeof status === 'string') {
      return status;
    }
    const left = status.left ?? '';
    const right = status.right ?? '';
    if (!right) {
      return left;
    }
    return `${left} · ${right}`;
  }
}

/**
 * Create a persistent input instance
 */
export function createPersistentInput(options?: PersistentInputOptions): PersistentInput {
  return new PersistentInput(options);
}
