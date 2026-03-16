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
import {
  safeEmitKeypressEvents,
  isPlainTabShortcut,
  isShiftTabShortcut,
  isShiftEnterSequence,
  isShiftEnterResidualSequence
} from './inputPrompt.js';
import { enableBracketedPaste, disableBracketedPaste } from './displayUtils.js';
import { TextBuffer } from './textBuffer.js';
import { handleTextBufferKey } from './textBufferKeyHandler.js';
import { safeSetRawMode } from './rawMode.js';
import { getPrimaryShellCommandSuggestion, isImmediateCommand } from './shellCommand.js';
import { getPlanModeManager } from '../commands/plan.js';

export interface QueuedMessage {
  text: string;
  timestamp: number;
}

export interface PersistentInputOptions {
  maxQueueSize?: number;
  statusLine?: string | { left: string; right: string };
  /** Silent mode - queue input without terminal regions UI (works better with ora spinner) */
  silentMode?: boolean;
  /** Base path used for shell path completion. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Optional async LLM resolver for ! command suggestions. */
  resolveShellSuggestion?: (input: string) => Promise<string | null>;
}

function isCtrlQShortcut(str: string, key: readline.Key | undefined): boolean {
  if (!key?.ctrl) {
    return false;
  }
  const sequence = key.sequence ?? str;
  return key.name === 'q' || sequence === '\x11';
}

/**
 * PersistentInput provides an always-visible input field at the bottom
 * of the terminal using scroll regions, so spinner and output stay above.
 */
/** Bracketed paste escape sequences */
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** How long to wait after a rapid Enter before treating it as a real submit (ms) */
const RAPID_ENTER_DEBOUNCE_MS = 50;
const MAX_PERSISTENT_NEWLINES = 9;
export class PersistentInput extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private textBuffer: TextBuffer;
  private isActive = false;
  private maxQueueSize: number;
  private statusLine: string | { left: string; right: string };
  private output: NodeJS.WriteStream;
  private input: NodeJS.ReadStream;
  private isPaused = false;
  private regions: TerminalRegions;
  private silentMode: boolean;
  private activityLine = '';
  private workspaceRoot: string;
  private resolveShellSuggestion?: (input: string) => Promise<string | null>;
  private shellSuggestionRequestId = 0;
  private queueShortcutSelectionIndex: number | null = null;
  private queueOverlayLineCount = 0;

  // ── Paste state ──
  private isInPaste = false;
  private pasteBuffer: string[] = [];
  private currentPasteLine = '';
  private rapidEnterTimer: ReturnType<typeof setTimeout> | null = null;
  private rapidEnterLines: string[] = [];

  constructor(options: PersistentInputOptions = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize ?? 10;
    this.statusLine = options.statusLine ?? '';
    this.output = process.stdout;
    this.input = process.stdin;
    this.silentMode = options.silentMode ?? false;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.resolveShellSuggestion = options.resolveShellSuggestion;
    this.regions = createTerminalRegions(this.output);
    this.textBuffer = new TextBuffer(80, 5);
  }

  /** Compatibility getter: returns the full text content from TextBuffer. */
  get currentInput(): string {
    return this.textBuffer.getText();
  }

  /**
   * Rebind stdin/stdout streams, used when process stdin is swapped
   * (for example, pipe -> /dev/tty handoff before interactive mode).
   */
  rebindStreams(
    input: NodeJS.ReadStream = process.stdin,
    output: NodeJS.WriteStream = process.stdout
  ): void {
    if (this.isActive) {
      return;
    }
    this.input = input;
    this.output = output;
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
    this.textBuffer.setText('');
    this.isPaused = false;

    // Resize TextBuffer to match terminal width
    const width = this.output.columns ?? 80;
    this.textBuffer.setViewport(Math.max(10, width - 3), 5);

    try {
      this.input.resume();
    } catch {
      // Best effort only.
    }

    // Enable bracketed paste so multi-line pastes are detected
    enableBracketedPaste(this.output);

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
    disableBracketedPaste(this.output);
    this.clearRapidEnterTimer();

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

    this.textBuffer.setText('');
    this.queueShortcutSelectionIndex = null;
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
    if (this.queueShortcutSelectionIndex !== null && this.queue.length === 0) {
      this.queueShortcutSelectionIndex = null;
    } else if (this.queueShortcutSelectionIndex !== null && this.queue.length > 0) {
      this.queueShortcutSelectionIndex = this.clampQueueSelection(this.queueShortcutSelectionIndex - 1);
    }
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
    this.queueShortcutSelectionIndex = null;
  }

  /**
   * Get current input (for external display)
   */
  getCurrentInput(): string {
    return this.textBuffer.getText();
  }

  /**
   * Replace the current draft input text.
   */
  setCurrentInput(value: string): void {
    this.textBuffer.setText(value);
    if (this.isActive && !this.isPaused && !this.silentMode) {
      this.regions.updateInput(this.textBuffer.getText());
    }
    this.emitInputChange();
  }

  private emitInputChange(): void {
    this.emit('input-change', this.textBuffer.getText());
  }

  /**
   * Handle keypress events — routes through TextBuffer key handler.
   */
  private handleKeypress = (_str: string, key: readline.Key): void => {
    if (!this.isActive || this.isPaused) {
      return;
    }

    // Queue browser has priority while active.
    if (this.queueShortcutSelectionIndex !== null) {
      const consumed = this.handleQueueShortcutKeypress(_str, key);
      if (consumed) {
        return;
      }
      // Any non-queue-browser key closes it and continues normal handling.
      this.closeQueueShortcut(false);
    }

    // ── Bracketed paste detection ──
    const seq = key?.sequence ?? _str;
    if (seq?.includes(PASTE_START) || _str?.includes(PASTE_START)) {
      this.isInPaste = true;
      this.pasteBuffer = [];
      this.currentPasteLine = '';
      return;
    }
    if (seq?.includes(PASTE_END) || _str?.includes(PASTE_END)) {
      this.finalizePaste();
      return;
    }

    // While in bracketed paste, buffer everything without queuing
    if (this.isInPaste) {
      if (key?.name === 'return' || key?.name === 'enter') {
        this.pasteBuffer.push(this.currentPasteLine);
        this.currentPasteLine = '';
      } else if (_str) {
        const printable = _str.replace(/[\x00-\x1F\x7F]/g, '');
        if (printable) {
          this.currentPasteLine += printable;
        }
      }
      return;
    }

    // Shift+Tab toggles plan mode while the agent is actively working.
    if (isShiftTabShortcut(_str, key)) {
      const planModeManager = getPlanModeManager();
      planModeManager.handleShiftTab();
      this.emit('plan-mode-toggled', planModeManager.isEnabled());
      return;
    }

    // Show shortcut help when user types "?" on an empty draft.
    if (_str === '?' && !key?.ctrl && !key?.meta && this.textBuffer.getText().trim().length === 0) {
      this.showShortcutHelp();
      return;
    }

    if (isPlainTabShortcut(_str, key)) {
      const currentText = this.textBuffer.getText();
      if (currentText.trim().startsWith('!') && this.resolveShellSuggestion) {
        const requestId = ++this.shellSuggestionRequestId;
        const immediateFallback = getPrimaryShellCommandSuggestion(currentText, {
          cwd: this.workspaceRoot,
        });
        let expectedInputAtResponse = currentText;

        if (immediateFallback) {
          this.textBuffer.setText(immediateFallback);
          expectedInputAtResponse = immediateFallback;
          this.updateDisplay();
          this.emitInputChange();
        }

        this.resolveShellSuggestion(currentText)
          .then((llmSuggestion) => {
            if (!this.isActive || this.isPaused || requestId !== this.shellSuggestionRequestId) {
              return;
            }
            if (this.textBuffer.getText() !== expectedInputAtResponse) {
              return;
            }

            if (llmSuggestion) {
              this.textBuffer.setText(llmSuggestion);
            }

            this.updateDisplay();
            this.emitInputChange();
          })
          .catch(() => {
            // Ignore LLM errors: immediate local fallback already applied above.
          });
        return;
      }

      const suggestion = getPrimaryShellCommandSuggestion(this.textBuffer.getText(), {
        cwd: this.workspaceRoot,
      });
      if (suggestion) {
        this.textBuffer.setText(suggestion);
        this.updateDisplay();
        this.emitInputChange();
      }
      return;
    }

    // Ctrl+Q opens queue browser.
    if (isCtrlQShortcut(_str, key)) {
      this.openQueueShortcut();
      return;
    }

    // Shift+Enter / Alt+Enter inserts a real newline via TextBuffer.
    // The key handler handles the standard readline-parsed case
    // (key.name='return' + shift/meta), but modern terminals using CSI u
    // protocol send raw ESC[13;Xu sequences that readline doesn't parse.
    // We also catch residual fragments where readline strips the ESC[ prefix.
    const rawSeq = key?.sequence ?? _str ?? '';
    if (isShiftEnterSequence(_str, key) || isShiftEnterResidualSequence(rawSeq)) {
      if (this.textBuffer.getLineCount() - 1 < MAX_PERSISTENT_NEWLINES) {
        this.textBuffer.insert('\n');
        this.updateDisplay();
        this.emitInputChange();
      }
      return;
    }

    // Route through TextBuffer key handler for all standard editing keys
    const result = handleTextBufferKey(this.textBuffer, _str, key);

    if (result === 'submit') {
      const text = this.textBuffer.getText().trim();
      if (text) {
        // Shell commands (!) and slash commands (/) execute immediately, never queued
        if (isImmediateCommand(text)) {
          this.textBuffer.setText('');
          this.updateDisplay();
          this.emitInputChange();
          this.emit('immediate-command', text);
          return;
        }

        // Rapid-Enter debounce: coalesce fast consecutive Enters (raw paste fallback)
        this.rapidEnterLines.push(text);
        this.textBuffer.setText('');
        this.updateDisplay();
        this.emitInputChange();
        this.scheduleRapidEnterFlush();
      }
      return;
    }

    if (result === 'handled') {
      this.updateDisplay();
      this.emitInputChange();
      return;
    }

    // 'unhandled' — Escape, Ctrl+C, etc.
    if (key?.name === 'escape') {
      this.emit('escape');
      return;
    }
    if (key?.name === 'c' && key.ctrl) {
      this.emit('ctrl-c');
      return;
    }
  };

  // ── Display helpers ──

  private updateDisplay(): void {
    if (!this.silentMode) {
      this.regions.updateInput(this.textBuffer.getText());
    }
  }

  // ── Paste helpers ──

  private finalizePaste(): void {
    // Push the last line being accumulated
    if (this.currentPasteLine) {
      this.pasteBuffer.push(this.currentPasteLine);
    }
    this.isInPaste = false;

    const lines = this.pasteBuffer;
    this.pasteBuffer = [];
    this.currentPasteLine = '';

    if (lines.length === 0) return;

    if (lines.length === 1) {
      // Single-line paste: insert into TextBuffer (user may want to edit before submitting)
      this.textBuffer.insert(lines[0]!);
      this.updateDisplay();
      this.emitInputChange();
    } else {
      // Multi-line paste: coalesce into a single queue entry
      const content = lines.join('\n');
      const entry = `[Pasted: ${lines.length} lines]\n${content}`;
      this.addToQueue(entry);
    }
  }

  private scheduleRapidEnterFlush(): void {
    if (this.rapidEnterTimer !== null) {
      clearTimeout(this.rapidEnterTimer);
    }
    this.rapidEnterTimer = setTimeout(() => {
      this.flushRapidEnterLines();
    }, RAPID_ENTER_DEBOUNCE_MS);
  }

  private flushRapidEnterLines(): void {
    this.rapidEnterTimer = null;
    const lines = this.rapidEnterLines.splice(0);
    if (lines.length === 0) return;

    if (lines.length === 1) {
      // Single Enter — normal queue behavior
      this.addToQueue(lines[0]);
    } else {
      // Multiple rapid Enters — coalesce (likely raw paste without bracketed paste)
      const content = lines.join('\n');
      const entry = `[Pasted: ${lines.length} lines]\n${content}`;
      this.addToQueue(entry);
    }
  }

  private clearRapidEnterTimer(): void {
    if (this.rapidEnterTimer !== null) {
      clearTimeout(this.rapidEnterTimer);
      this.rapidEnterTimer = null;
    }
    // Flush any pending rapid-enter lines
    if (this.rapidEnterLines.length > 0) {
      this.flushRapidEnterLines();
    }
  }

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

    // Queue changed: keep queue-browser selection stable and in range.
    this.queueShortcutSelectionIndex = null;

    // Show confirmation
    const preview = text.length > 40 ? text.slice(0, 37) + '...' : text;
    if (!this.silentMode) {
      this.regions.writeAbove(chalk.cyan(`\n✓ Queued: "${preview}" (${this.queue.length} pending)\n`));
      if (this.queue.length === 1) {
        this.regions.writeAbove(chalk.gray('  Tip: press Ctrl+Q to review and edit queued items\n'));
      }
      this.regions.updateStatus(this.getStatusText(), this.queue.length);
    }

    this.emit('queued', text, this.queue.length);
  }

  private openQueueShortcut(): void {
    if (this.queue.length === 0) {
      if (!this.silentMode) {
        this.regions.writeAbove(chalk.gray('\nQueue is empty.\n'));
      }
      this.queueShortcutSelectionIndex = null;
      return;
    }
    if (this.queueShortcutSelectionIndex === null) {
      this.queueShortcutSelectionIndex = this.queue.length - 1;
    } else {
      this.queueShortcutSelectionIndex = this.clampQueueSelection(this.queueShortcutSelectionIndex);
    }
    this.renderQueueShortcutSnapshot();
  }

  private handleQueueShortcutKeypress(_str: string, key: readline.Key): boolean {
    if (this.queueShortcutSelectionIndex === null) {
      return false;
    }

    if (key?.name === 'up') {
      this.moveQueueSelection(-1);
      return true;
    }
    if (key?.name === 'down') {
      this.moveQueueSelection(1);
      return true;
    }
    if (isCtrlQShortcut(_str, key)) {
      this.moveQueueSelection(-1);
      return true;
    }
    if (key?.name === 'return' || key?.name === 'enter') {
      this.pullSelectedQueueItemForEdit();
      return true;
    }
    if (key?.name === 'backspace' || key?.name === 'delete') {
      this.removeSelectedQueueItem();
      return true;
    }
    if (key?.name === 'escape') {
      this.closeQueueShortcut(true);
      return true;
    }

    return false;
  }

  private moveQueueSelection(delta: number): void {
    if (this.queue.length === 0) {
      this.closeQueueShortcut(false);
      return;
    }
    const current = this.clampQueueSelection(this.queueShortcutSelectionIndex ?? (this.queue.length - 1));
    const next = ((current + delta) % this.queue.length + this.queue.length) % this.queue.length;
    this.queueShortcutSelectionIndex = next;
    this.renderQueueShortcutSnapshot();
  }

  private pullSelectedQueueItemForEdit(): void {
    if (this.queue.length === 0) {
      this.closeQueueShortcut(false);
      return;
    }
    // Clear overlay before modifying queue
    if (this.queueOverlayLineCount > 0) {
      this.regions.clearOverlay(this.queueOverlayLineCount);
      this.queueOverlayLineCount = 0;
    }
    const selectedIndex = this.clampQueueSelection(this.queueShortcutSelectionIndex ?? (this.queue.length - 1));
    const [pulled] = this.queue.splice(selectedIndex, 1);
    this.queueShortcutSelectionIndex = null;
    if (!pulled) {
      return;
    }

    const pulledPreview = this.getQueuePreview(pulled.text);
    this.textBuffer.setText(pulled.text);
    if (!this.silentMode) {
      this.regions.writeAbove(chalk.cyan(`\nPulled #${selectedIndex + 1} for edit: "${pulledPreview}"\n`));
      this.regions.writeAbove(chalk.gray('Press Enter to re-queue after editing.\n'));
      this.regions.updateInput(this.textBuffer.getText());
      this.regions.updateStatus(this.getStatusText(), this.queue.length);
    }
    this.emitInputChange();
    this.emit('queue-shortcut', {
      action: 'edit',
      pulled: pulled.text,
      remaining: this.queue.length,
    });
  }

  private removeSelectedQueueItem(): void {
    if (this.queue.length === 0) {
      this.closeQueueShortcut(false);
      return;
    }
    // Clear overlay before modifying queue
    if (this.queueOverlayLineCount > 0) {
      this.regions.clearOverlay(this.queueOverlayLineCount);
      this.queueOverlayLineCount = 0;
    }
    const selectedIndex = this.clampQueueSelection(this.queueShortcutSelectionIndex ?? (this.queue.length - 1));
    const [removed] = this.queue.splice(selectedIndex, 1);
    if (!removed) {
      return;
    }

    if (this.queue.length === 0) {
      this.queueShortcutSelectionIndex = null;
      if (!this.silentMode) {
        this.regions.writeAbove(chalk.gray('\nRemoved queued request. Queue is now empty.\n'));
        this.regions.updateStatus(this.getStatusText(), 0);
      }
    } else {
      this.queueShortcutSelectionIndex = Math.min(selectedIndex, this.queue.length - 1);
      this.renderQueueShortcutSnapshot();
      if (!this.silentMode) {
        this.regions.updateStatus(this.getStatusText(), this.queue.length);
      }
    }

    this.emit('queue-shortcut', {
      action: 'remove',
      removed: removed.text,
      remaining: this.queue.length,
    });
  }

  private closeQueueShortcut(announce: boolean): void {
    if (this.queueShortcutSelectionIndex === null) {
      return;
    }
    this.queueShortcutSelectionIndex = null;
    // Clear the in-place overlay before closing
    if (this.queueOverlayLineCount > 0) {
      this.regions.clearOverlay(this.queueOverlayLineCount);
      this.queueOverlayLineCount = 0;
    }
    if (announce && !this.silentMode) {
      this.regions.writeAbove(chalk.gray('\nQueue browser closed.\n'));
    }
  }

  private renderQueueShortcutSnapshot(): void {
    if (this.silentMode || this.queue.length === 0) {
      return;
    }
    const selectedIndex = this.clampQueueSelection(this.queueShortcutSelectionIndex ?? (this.queue.length - 1));
    const maxVisible = 6;
    const start = Math.max(0, selectedIndex - (maxVisible - 1));
    const end = Math.min(this.queue.length, start + maxVisible);
    const lines: string[] = [];
    lines.push(chalk.cyan(`Queued requests (${this.queue.length})`));
    if (start > 0) {
      lines.push(chalk.gray(`  ... ${start} older request(s)`));
    }
    for (let i = start; i < end; i++) {
      const marker = i === selectedIndex ? '>' : ' ';
      const preview = this.getQueuePreview(this.queue[i].text);
      const row = `${marker} ${i + 1}. "${preview}"`;
      lines.push(i === selectedIndex ? chalk.cyan(row) : chalk.gray(row));
    }
    if (end < this.queue.length) {
      lines.push(chalk.gray(`  ... ${this.queue.length - end} newer request(s)`));
    }
    lines.push(chalk.gray('Up/Down to select · Enter to edit · Backspace to remove · Esc to close'));

    // Clear previous overlay before rendering new one (prevents stacking)
    if (this.queueOverlayLineCount > 0) {
      this.regions.clearOverlay(this.queueOverlayLineCount);
    }
    this.queueOverlayLineCount = this.regions.renderOverlay(lines);
  }

  private clampQueueSelection(index: number): number {
    if (this.queue.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(this.queue.length - 1, index));
  }

  private getQueuePreview(text: string): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > 58 ? `${singleLine.slice(0, 55)}...` : singleLine;
  }

  private showShortcutHelp(): void {
    if (this.silentMode) {
      return;
    }

    const lines = [
      chalk.cyan('\nShortcuts'),
      chalk.gray('  / commands · @ mention files · ! shell commands'),
      chalk.gray('  Enter submit · Tab autocomplete · Shift+Tab plan mode'),
      chalk.gray('  Shift+Enter newline · Ctrl+Q queue browser'),
      chalk.gray('  Esc interrupt · Ctrl+C twice to exit'),
    ];
    this.regions.writeAbove(`${lines.join('\n')}\n`);
  }

  /**
   * Render the fixed input region
   */
  render(): void {
    if (!this.isActive || this.isPaused) {
      return;
    }

    this.regions.renderFixedRegion(
      this.textBuffer.getText(),
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
