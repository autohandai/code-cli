/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Terminal Regions - Split terminal into scroll and fixed regions
 * Allows spinner/output in top region while keeping input visible at bottom
 */
import chalk from 'chalk';
import {
  drawInputBottomBorder,
  drawInputBox,
  drawInputTopBorder,
  type InputBorderStyle
} from './box.js';
import { getTheme, isThemeInitialized } from './theme/index.js';
import type { ColorToken } from './theme/types.js';
import { getPlanModeManager } from '../commands/plan.js';

// ANSI escape sequences
const ESC = '\x1B';
const CSI = `${ESC}[`;
const PROMPT_PLACEHOLDER = 'Build anything';
const PROMPT_INPUT_PREFIX = '❯ ';
const CONTINUATION_PREFIX = '  ';
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

/** Maximum number of visible input lines in the fixed region. */
const MAX_VISIBLE_INPUT_LINES = 5;

function themedFg(token: ColorToken, text: string, fallback: (value: string) => string): string {
  if (!isThemeInitialized()) {
    return fallback(text);
  }

  try {
    return getTheme().fg(token, text);
  } catch {
    return fallback(text);
  }
}

/**
 * TerminalRegions manages split terminal regions:
 * - Scroll region (top): Normal output, spinner, tool results
 * - Fixed region (bottom): Input field, status line, queue display
 */
export class TerminalRegions {
  private isActive = false;
  private fixedLines = 5; // activity + input top + input line + input bottom + status
  private output: NodeJS.WriteStream;
  private resizeHandler: (() => void) | null = null;
  private currentInput = '';
  private currentQueueCount = 0;
  private currentStatus = '';
  private currentActivity = '';
  private lastHeight = 0;
  private lastWidth = 0;

  constructor(output: NodeJS.WriteStream = process.stdout) {
    this.output = output;
  }

  /**
   * Check if regions are currently active
   */
  isEnabled(): boolean {
    return this.isActive;
  }

  /**
   * Enable split regions - reserves bottom lines for input
   */
  enable(): void {
    if (this.isActive) return;
    if (!this.output.isTTY) return;

    const { height, width } = this.getDimensions();
    const scrollEnd = Math.max(1, height - this.fixedLines);

    // Set scroll region (CSI Ps ; Ps r) - top to scrollEnd
    this.output.write(`${CSI}1;${scrollEnd}r`);

    this.lastHeight = height;
    this.lastWidth = width;
    this.isActive = true;

    // Handle terminal resize
    this.resizeHandler = () => this.handleResize();
    this.output.on('resize', this.resizeHandler);

    // Initial render of fixed region
    this.renderFixedRegion();
  }

  /**
   * Disable split regions - restore full terminal
   */
  disable(): void {
    if (!this.isActive) return;

    const { height } = this.getDimensions();
    const scrollEnd = Math.max(1, height - this.fixedLines);

    // Restore cursor visibility (may have been hidden for empty placeholder)
    this.output.write(`${CSI}?25h`);

    // Reset scroll region to full terminal
    this.output.write(`${CSI}r`);

    // Clear the fixed region area
    this.clearFixedRegion();

    // Move cursor to the last row of the former scroll region so subsequent
    // output continues right after the agent's last printed line rather than
    // staying in the (now-cleared) fixed-region area at the bottom.
    this.output.write(`${CSI}${scrollEnd};1H`);

    // Remove resize handler
    if (this.resizeHandler) {
      this.output.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    this.isActive = false;
  }

  /**
   * Handle terminal resize - update scroll region
   */
  private handleResize(): void {
    if (!this.isActive) return;

    const { height, width } = this.getDimensions();
    const scrollEnd = Math.max(1, height - this.fixedLines);

    // 1. Reset scroll region to full terminal so we can address all rows
    this.output.write(`${CSI}r`);

    // 2. Move to the first row of the new fixed-region area and use
    //    CSI J (Erase in Display — cursor to end) to wipe everything below.
    //    Unlike CSI K (Erase in Line), CSI J handles wrapped/reflowed content
    //    across multiple physical rows in a single operation.
    this.output.write(`${CSI}${scrollEnd + 1};1H`);
    this.output.write(`${CSI}J`);

    // 3. Set the new scroll region
    this.output.write(`${CSI}1;${scrollEnd}r`);

    // 4. Park cursor at the bottom of the scroll area.  We intentionally do
    //    NOT use CSI s/u (save/restore) because the saved position is
    //    meaningless after terminal reflow changes the physical layout.
    this.output.write(`${CSI}${scrollEnd};1H`);

    // Track dimensions for future resize events
    this.lastHeight = height;
    this.lastWidth = width;

    // 5. Re-render the fixed region at the new dimensions
    this.renderFixedRegion(this.currentInput, this.currentQueueCount, this.currentStatus, this.currentActivity);
  }

  /**
   * Render content in the fixed bottom region.
   * Supports multi-line input by splitting on `\n` and rendering
   * each visible line as a separate boxed row.
   */
  renderFixedRegion(input = '', queueCount = 0, status = '', activity = ''): void {
    if (!this.isActive) return;

    this.currentInput = input;
    this.currentQueueCount = queueCount;
    this.currentStatus = status;
    this.currentActivity = activity;

    const inputLines = input ? input.split('\n') : [''];
    const visibleLines = Math.min(inputLines.length, MAX_VISIBLE_INPUT_LINES);
    this.updateFixedLines(visibleLines);

    const { height, width } = this.getDimensions();
    const promptWidth = this.getPromptWidth(width);
    const borderStyle = this.getInputBorderStyle(input);

    // Activity line
    this.output.write(`${CSI}${height - this.fixedLines + 1};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(this.formatActivityLine(activity, promptWidth));

    // Top border
    this.output.write(`${CSI}${height - this.fixedLines + 2};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(drawInputTopBorder(promptWidth, borderStyle));

    // Input lines (first line gets prompt prefix, continuation lines get indent)
    for (let i = 0; i < visibleLines; i++) {
      const row = height - this.fixedLines + 3 + i;
      const lineContent = inputLines[i] ?? '';
      const content = i === 0
        ? this.getInputContent(lineContent)
        : this.getContinuationContent(lineContent);
      this.output.write(`${CSI}${row};1H`);
      this.output.write(`${CSI}K`);
      this.output.write(drawInputBox(content, promptWidth));
    }

    // Bottom border
    this.output.write(`${CSI}${height - 1};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(drawInputBottomBorder(promptWidth, borderStyle));

    // Status
    this.output.write(`${CSI}${height};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(this.formatStatusLine(status, queueCount, promptWidth));
    this.focusInputCursor();
  }

  /**
   * Update just the input text (faster than full render).
   * Handles multi-line input by adjusting the fixed region size and
   * re-rendering all input rows with borders.
   */
  updateInput(input: string): void {
    if (!this.isActive) return;

    this.currentInput = input;

    const inputLines = input ? input.split('\n') : [''];
    const visibleLines = Math.min(inputLines.length, MAX_VISIBLE_INPUT_LINES);
    const oldFixed = this.fixedLines;
    this.updateFixedLines(visibleLines);

    // If fixedLines changed, do a full render to reposition everything
    if (oldFixed !== this.fixedLines) {
      this.renderFixedRegion(input, this.currentQueueCount, this.currentStatus, this.currentActivity);
      return;
    }

    const { height, width } = this.getDimensions();
    const promptWidth = this.getPromptWidth(width);
    const borderStyle = this.getInputBorderStyle(input);

    // Top border
    this.output.write(`${CSI}${height - this.fixedLines + 2};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(drawInputTopBorder(promptWidth, borderStyle));

    // Input lines
    for (let i = 0; i < visibleLines; i++) {
      const row = height - this.fixedLines + 3 + i;
      const lineContent = inputLines[i] ?? '';
      const content = i === 0
        ? this.getInputContent(lineContent)
        : this.getContinuationContent(lineContent);
      this.output.write(`${CSI}${row};1H`);
      this.output.write(`${CSI}K`);
      this.output.write(drawInputBox(content, promptWidth));
    }

    // Bottom border
    this.output.write(`${CSI}${height - 1};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(drawInputBottomBorder(promptWidth, borderStyle));

    this.focusInputCursor();
  }

  /**
   * Update the status line
   */
  updateStatus(status: string, queueCount = 0): void {
    if (!this.isActive) return;

    this.currentStatus = status;
    this.currentQueueCount = queueCount;
    const { height, width } = this.getDimensions();
    const promptWidth = this.getPromptWidth(width);

    this.output.write(`${CSI}${height};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(this.formatStatusLine(status, queueCount, promptWidth));
    this.focusInputCursor();
  }

  updateActivity(activity: string): void {
    if (!this.isActive) return;

    this.currentActivity = activity;
    const { height, width } = this.getDimensions();
    const promptWidth = this.getPromptWidth(width);

    this.output.write(`${CSI}${height - this.fixedLines + 1};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(this.formatActivityLine(activity, promptWidth));
    this.focusInputCursor();
  }

  private getPromptWidth(columns: number): number {
    return Math.max(10, columns - 1);
  }

  /**
   * Dynamically adjust the number of fixed lines based on visible input line count.
   * Re-sets the scroll region if the count changes.
   */
  private updateFixedLines(inputLineCount: number): void {
    // Fixed region = activity + top border + N input lines + bottom border + status
    const newFixed = 4 + Math.max(1, inputLineCount);
    if (newFixed !== this.fixedLines) {
      this.fixedLines = newFixed;
      // Re-set scroll region
      const { height } = this.getDimensions();
      const scrollEnd = Math.max(1, height - this.fixedLines);
      this.output.write(`${CSI}1;${scrollEnd}r`);
    }
  }

  private getInputContent(input: string): string {
    if (!input) {
      return themedFg(
        'muted',
        `${PROMPT_INPUT_PREFIX}${PROMPT_PLACEHOLDER}`,
        (value) => chalk.gray(value)
      );
    }
    const prefix = themedFg('accent', PROMPT_INPUT_PREFIX, (value) => chalk.gray(value));
    return `${prefix}${input}`;
  }

  /** Format a continuation line (lines 2+ in multi-line input). */
  private getContinuationContent(line: string): string {
    const prefix = themedFg('accent', CONTINUATION_PREFIX, (value) => chalk.gray(value));
    return `${prefix}${line}`;
  }

  private getInputBorderStyle(input: string): InputBorderStyle {
    if (/^[\s\u200B-\u200D\uFEFF]*!/u.test(input)) {
      return 'shell';
    }
    if (getPlanModeManager().isEnabled()) {
      return 'plan';
    }
    return 'default';
  }

  private formatStatusLine(status: string, queueCount: number, width: number): string {
    const defaultStatus = 'type to queue · Enter to submit';
    const baseStatus = status || defaultStatus;
    const hasQueuedText = /\bqueued\b/i.test(baseStatus);
    const queueSuffix = queueCount > 0 && !hasQueuedText ? ` · ${queueCount} queued` : '';
    const plain = `${baseStatus}${queueSuffix}`.replace(ANSI_PATTERN, '');
    if (plain.length <= width) {
      return themedFg('muted', plain.padEnd(width), (value) => chalk.gray(value));
    }
    const clipped = width <= 1 ? '…' : `${plain.slice(0, width - 1)}…`;
    return themedFg('muted', clipped, (value) => chalk.gray(value));
  }

  private formatActivityLine(activity: string, width: number): string {
    const plain = (activity || '').replace(ANSI_PATTERN, '');
    if (!plain) {
      return ''.padEnd(width);
    }
    if (plain.length <= width) {
      return themedFg('muted', plain.padEnd(width), (value) => chalk.gray(value));
    }
    const clipped = width <= 1 ? '…' : `${plain.slice(0, width - 1)}…`;
    return themedFg('muted', clipped, (value) => chalk.gray(value));
  }

  private focusInputCursor(): void {
    if (!this.isActive) {
      return;
    }

    const { height, width } = this.getDimensions();
    const promptWidth = this.getPromptWidth(width);

    if (!this.currentInput) {
      // No input — hide cursor so it doesn't blink over the placeholder
      this.output.write(`${CSI}?25l`);
      return;
    }

    // For multi-line input, cursor is placed at the end of the last visible line.
    const inputLines = this.currentInput.split('\n');
    const visibleLines = Math.min(inputLines.length, MAX_VISIBLE_INPUT_LINES);
    const lastLineIndex = visibleLines - 1;
    const lastLine = inputLines[lastLineIndex] ?? '';

    // Prefix width differs for first vs continuation lines
    const prefixColumns = lastLineIndex === 0 ? PROMPT_INPUT_PREFIX.length : CONTINUATION_PREFIX.length;
    const inputColumns = lastLine.length;
    const cursorColumn = Math.max(1, Math.min(promptWidth, 1 + prefixColumns + inputColumns));

    // Cursor row: first input line is at (height - fixedLines + 3), offset by lastLineIndex
    const cursorRow = height - this.fixedLines + 3 + lastLineIndex;

    this.output.write(`${CSI}?25h`); // show cursor
    this.output.write(`${CSI}${cursorRow};${cursorColumn}H`);
  }

  /**
   * Clear the fixed region (used when disabling)
   */
  private clearFixedRegion(): void {
    const { height } = this.getDimensions();
    this.output.write(`${CSI}s`);
    for (let i = 0; i < this.fixedLines; i++) {
      this.output.write(`${CSI}${height - i};1H`);
      this.output.write(`${CSI}K`);
    }
    this.output.write(`${CSI}u`);
  }

  /**
   * Render an overlay at the bottom of the scroll region, overwriting in-place.
   * Unlike writeAbove, this does NOT scroll — it positions the cursor at
   * specific rows and overwrites them. Returns the number of lines rendered.
   * Use clearOverlay() with the returned count to erase when done.
   */
  renderOverlay(lines: string[]): number {
    if (!this.isActive || lines.length === 0) return 0;

    const { height } = this.getDimensions();
    const scrollEnd = height - this.fixedLines;
    const count = Math.min(lines.length, scrollEnd); // Don't exceed scroll region
    const startRow = scrollEnd - count + 1;

    // Save cursor, render each line at a fixed absolute row, restore cursor
    this.output.write(`${CSI}s`);
    for (let i = 0; i < count; i++) {
      this.output.write(`${CSI}${startRow + i};1H`);
      this.output.write(`${CSI}K`); // erase line
      this.output.write(lines[i]);
    }
    this.output.write(`${CSI}u`);
    this.focusInputCursor();
    return count;
  }

  /**
   * Clear a previously rendered overlay at the bottom of the scroll region.
   */
  clearOverlay(lineCount: number): void {
    if (!this.isActive || lineCount <= 0) return;

    const { height } = this.getDimensions();
    const scrollEnd = height - this.fixedLines;
    const startRow = scrollEnd - lineCount + 1;

    this.output.write(`${CSI}s`);
    for (let i = 0; i < lineCount; i++) {
      this.output.write(`${CSI}${startRow + i};1H`);
      this.output.write(`${CSI}K`);
    }
    this.output.write(`${CSI}u`);
    this.focusInputCursor();
  }

  /**
   * Write a message that appears above the fixed region (in scroll area)
   * This is useful for showing queued confirmations
   */
  writeAbove(message: string): void {
    if (!this.isActive) {
      this.output.write(message);
      return;
    }

    const { height } = this.getDimensions();
    const scrollEnd = height - this.fixedLines;
    this.output.write(`${CSI}${scrollEnd};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(message);
    this.focusInputCursor();
  }

  /**
   * Move cursor to the end of the scrollable region.
   * Useful before temporarily disabling regions for modal prompts.
   */
  focusScrollBottom(): void {
    if (!this.isActive) {
      return;
    }

    const { height } = this.getDimensions();
    const scrollEnd = Math.max(1, height - this.fixedLines);
    this.output.write(`${CSI}${scrollEnd};1H`);
  }

  /**
   * Get the number of lines reserved for the fixed region
   */
  getFixedLines(): number {
    return this.fixedLines;
  }

  /**
   * Get the available scroll region height
   */
  getScrollHeight(): number {
    const { height } = this.getDimensions();
    return Math.max(1, height - this.fixedLines);
  }

  private getDimensions(): { width: number; height: number } {
    const stream = this.output as NodeJS.WriteStream & {
      getWindowSize?: () => [number, number];
      columns?: number;
      rows?: number;
    };

    let width = stream.columns ?? 80;
    let height = stream.rows ?? 24;

    // Prefer active terminal dimensions from getWindowSize() when available.
    // Some runtimes can report stale stream.rows values after redraw-heavy flows.
    if (typeof stream.getWindowSize === 'function') {
      try {
        const [w, h] = stream.getWindowSize();
        if (w > 0) {
          width = w;
        }
        if (h > 0) {
          height = h;
        }
      } catch {
        // Ignore terminal query failures and keep stream-provided dimensions.
      }
    }

    return {
      width: Math.max(10, width || 80),
      height: Math.max(this.fixedLines + 2, height || 24),
    };
  }
}

/**
 * Create a terminal regions instance
 */
export function createTerminalRegions(output?: NodeJS.WriteStream): TerminalRegions {
  return new TerminalRegions(output);
}
