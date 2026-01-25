/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

/**
 * Context compaction toggle command
 * Toggles automatic context compaction on/off
 *
 * When enabled (default):
 * - 70%: Compresses verbose tool outputs
 * - 80%: Summarizes older conversation turns
 * - 90%+: Aggressive priority-based cropping
 *
 * When disabled:
 * - No auto-compaction
 * - User will get raw 400 errors if context exceeds limits
 */
export async function cc(ctx: {
  toggleContextCompaction?: () => void;
  isContextCompactionEnabled?: () => boolean;
}): Promise<string | null> {
  // Check if context compaction methods are available
  if (!ctx.toggleContextCompaction || !ctx.isContextCompactionEnabled) {
    console.log(chalk.yellow('Context compaction is not available in this mode.'));
    return null;
  }

  // Toggle the state
  ctx.toggleContextCompaction();

  const enabled = ctx.isContextCompactionEnabled();
  const status = enabled ? 'enabled' : 'disabled';
  const color = enabled ? chalk.green : chalk.yellow;

  console.log(color(`Context compaction ${status}`));

  if (!enabled) {
    console.log(chalk.gray('  Note: Without compaction, you may see "context too long" errors.'));
    console.log(chalk.gray('  Use /cc again to re-enable auto-compaction.'));
  } else {
    console.log(chalk.gray('  Auto-compacting context at 70%/80%/90% thresholds.'));
  }

  return null;
}

export const metadata = {
  command: '/cc',
  description: 'toggle context compaction on/off',
  implemented: true,
};
