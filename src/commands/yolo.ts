/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';

/**
 * Toggle YOLO mode — auto-approve all non-blacklisted tool calls.
 * If already active, disables it.
 */
export async function toggleYolo(ctx: SlashCommandContext): Promise<string | null> {
  if (!ctx.setYoloMode) {
    return 'YOLO mode toggle not available in this context.';
  }

  const isActive = ctx.permissionManager.getMode() === 'unrestricted';

  if (isActive) {
    ctx.setYoloMode(undefined);
    console.log();
    console.log(chalk.cyan('YOLO mode deactivated. Returning to interactive approval.'));
    console.log();
  } else {
    ctx.setYoloMode('allow:*');
    console.log();
    console.log(chalk.yellow.bold('🚀 YOLO MODE ACTIVATED'));
    console.log(chalk.gray('You only live once! All actions will be auto-approved.'));
    console.log(chalk.gray('Security blacklist still applies for sensitive files.'));
    console.log();
  }

  return null;
}

export const metadata = {
  command: '/yolo',
  description: 'Toggle YOLO mode — auto-approve all actions',
  implemented: true,
};
