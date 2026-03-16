/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

// ANSI slow blink: \x1b[5m ... \x1b[25m (supported by iTerm2 and many modern terminals)
const BLINK_ON = '\x1b[5m';
const BLINK_OFF = '\x1b[25m';

/**
 * Renders multi-step progress using console.log so output is compatible with
 * terminal regions (the console bridge routes through writeAbove()).
 *
 * Each step prints once when it starts with a blinking ◌ indicator.
 * When a step completes (via advance/finish), it's not reprinted — the next
 * step simply appears below it. The blinking circle signals active work.
 *
 * Usage:
 *   const progress = new StepProgress();
 *   progress.start('Analyzing your project...');
 *   await doWork();
 *   progress.advance('Loading community skills...');
 *   await doMoreWork();
 *   progress.advance('Evaluating skill matches...');
 *   await doFinalWork();
 *   progress.finish();
 */
export class StepProgress {
  private currentLabel = '';
  private stepCount = 0;

  /**
   * Start the progress display with the first step.
   */
  start(label: string): void {
    this.currentLabel = label;
    this.stepCount = 1;
    console.log(`  ${BLINK_ON}${chalk.cyan('◌')}${BLINK_OFF} ${chalk.cyan(label)}`);
  }

  /**
   * Mark the current step as done and start a new one.
   */
  advance(label: string): void {
    this.currentLabel = label;
    this.stepCount++;
    console.log(`  ${BLINK_ON}${chalk.cyan('◌')}${BLINK_OFF} ${chalk.cyan(label)}`);
  }

  /**
   * Mark the final step as done.
   */
  finish(): void {
    this.currentLabel = '';
  }

  /**
   * Clean up (no-op in console.log mode, kept for API compat).
   */
  clear(): void {
    this.currentLabel = '';
  }
}
