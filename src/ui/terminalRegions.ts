/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Terminal Regions - Split terminal into scroll and fixed regions
 * Allows spinner/output in top region while keeping input visible at bottom
 */
import chalk from 'chalk';

// ANSI escape sequences
const ESC = '\x1B';
const CSI = `${ESC}[`;

/**
 * TerminalRegions manages split terminal regions:
 * - Scroll region (top): Normal output, spinner, tool results
 * - Fixed region (bottom): Input field, status line, queue display
 */
export class TerminalRegions {
  private isActive = false;
  private fixedLines = 3; // separator + status + input
  private output: NodeJS.WriteStream;
  private resizeHandler: (() => void) | null = null;

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

    const height = this.output.rows || 24;
    const scrollEnd = Math.max(1, height - this.fixedLines);

    // Set scroll region (CSI Ps ; Ps r) - top to scrollEnd
    this.output.write(`${CSI}1;${scrollEnd}r`);

    // Move cursor to top of scroll region
    this.output.write(`${CSI}1;1H`);

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

    // Reset scroll region to full terminal
    this.output.write(`${CSI}r`);

    // Clear the fixed region area
    this.clearFixedRegion();

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

    const height = this.output.rows || 24;
    const scrollEnd = Math.max(1, height - this.fixedLines);

    // Update scroll region
    this.output.write(`${CSI}1;${scrollEnd}r`);

    // Re-render fixed region
    this.renderFixedRegion();
  }

  /**
   * Render content in the fixed bottom region
   */
  renderFixedRegion(input = '', queueCount = 0, status = ''): void {
    if (!this.isActive) return;

    const height = this.output.rows || 24;
    const width = this.output.columns || 80;

    // Save cursor position
    this.output.write(`${CSI}s`);

    // Move to separator line (height - 2)
    this.output.write(`${CSI}${height - 2};1H`);
    this.output.write(`${CSI}K`); // Clear line
    this.output.write(chalk.gray('─'.repeat(width)));

    // Move to status line (height - 1)
    this.output.write(`${CSI}${height - 1};1H`);
    this.output.write(`${CSI}K`); // Clear line
    const queueStatus = queueCount > 0 ? chalk.cyan(` [${queueCount} queued]`) : '';
    const statusText = status || 'type to queue · Enter to submit';
    this.output.write(chalk.gray(statusText) + queueStatus);

    // Move to input line (height)
    this.output.write(`${CSI}${height};1H`);
    this.output.write(`${CSI}K`); // Clear line
    this.output.write(chalk.gray('›') + ' ' + input);

    // Restore cursor position to scroll region
    this.output.write(`${CSI}u`);
  }

  /**
   * Update just the input text (faster than full render)
   */
  updateInput(input: string): void {
    if (!this.isActive) return;

    const height = this.output.rows || 24;

    // Save cursor
    this.output.write(`${CSI}s`);

    // Move to input line and clear it
    this.output.write(`${CSI}${height};1H`);
    this.output.write(`${CSI}K`);
    this.output.write(chalk.gray('›') + ' ' + input);

    // Restore cursor
    this.output.write(`${CSI}u`);
  }

  /**
   * Update the status line
   */
  updateStatus(status: string, queueCount = 0): void {
    if (!this.isActive) return;

    const height = this.output.rows || 24;

    // Save cursor
    this.output.write(`${CSI}s`);

    // Move to status line
    this.output.write(`${CSI}${height - 1};1H`);
    this.output.write(`${CSI}K`);
    const queueStatus = queueCount > 0 ? chalk.cyan(` [${queueCount} queued]`) : '';
    this.output.write(chalk.gray(status) + queueStatus);

    // Restore cursor
    this.output.write(`${CSI}u`);
  }

  /**
   * Clear the fixed region (used when disabling)
   */
  private clearFixedRegion(): void {
    const height = this.output.rows || 24;

    // Clear each line of the fixed region
    for (let i = 0; i < this.fixedLines; i++) {
      this.output.write(`${CSI}${height - i};1H`);
      this.output.write(`${CSI}K`);
    }

    // Move cursor back to a reasonable position
    this.output.write(`${CSI}${height - this.fixedLines};1H`);
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

    // Save cursor
    this.output.write(`${CSI}s`);

    // Move to bottom of scroll region
    const height = this.output.rows || 24;
    const scrollEnd = height - this.fixedLines;
    this.output.write(`${CSI}${scrollEnd};1H`);

    // Write message (will scroll if needed)
    this.output.write(message);

    // Restore cursor
    this.output.write(`${CSI}u`);
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
    const height = this.output.rows || 24;
    return Math.max(1, height - this.fixedLines);
  }
}

/**
 * Create a terminal regions instance
 */
export function createTerminalRegions(output?: NodeJS.WriteStream): TerminalRegions {
  return new TerminalRegions(output);
}
