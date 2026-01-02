/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import type { PermissionManager } from '../permissions/PermissionManager.js';

export interface PermissionsCommandContext {
  permissionManager: PermissionManager;
}

/**
 * Permissions command - displays and manages tool/command approvals
 */
export async function permissions(ctx: PermissionsCommandContext): Promise<string | null> {
  const whitelist = ctx.permissionManager.getWhitelist();
  const blacklist = ctx.permissionManager.getBlacklist();
  const settings = ctx.permissionManager.getSettings();

  console.log();
  console.log(chalk.bold.cyan('Permissions'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`Mode: ${settings.mode || 'interactive'}`));
  console.log();

  if (whitelist.length === 0 && blacklist.length === 0) {
    console.log(chalk.gray('No saved permissions yet.'));
    console.log();
    console.log(chalk.gray('When you approve or deny a tool/command, it will be saved here.'));
    console.log(chalk.gray('Approved items are auto-allowed; denied items are auto-blocked.'));
    return null;
  }

  if (whitelist.length > 0) {
    console.log(chalk.bold.green('Approved (Whitelist)'));
    console.log();
    whitelist.forEach((pattern, index) => {
      console.log(chalk.green(`  ${index + 1}. ${pattern}`));
    });
    console.log();
  }

  if (blacklist.length > 0) {
    console.log(chalk.bold.red('Denied (Blacklist)'));
    console.log();
    blacklist.forEach((pattern, index) => {
      console.log(chalk.red(`  ${index + 1}. ${pattern}`));
    });
    console.log();
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`Total: ${whitelist.length} approved, ${blacklist.length} denied`));
  console.log();

  // Offer management options
  const actionResult = await safePrompt<{ action: string }>({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: 'done', message: 'Done' },
      { name: 'remove_approved', message: 'Remove an approved item' },
      { name: 'remove_denied', message: 'Remove a denied item' },
      { name: 'clear_all', message: 'Clear all permissions' }
    ]
  });

  if (!actionResult || actionResult.action === 'done') {
    return null;
  }

  const { action } = actionResult;

  if (action === 'remove_approved' && whitelist.length > 0) {
    const result = await safePrompt<{ pattern: string }>({
      type: 'select',
      name: 'pattern',
      message: 'Select item to remove from approved list:',
      choices: whitelist.map(p => ({ name: p, message: p }))
    });
    if (result) {
      await ctx.permissionManager.removeFromWhitelist(result.pattern);
      console.log(chalk.yellow(`Removed "${result.pattern}" from approved list.`));
    }
  } else if (action === 'remove_denied' && blacklist.length > 0) {
    const result = await safePrompt<{ pattern: string }>({
      type: 'select',
      name: 'pattern',
      message: 'Select item to remove from denied list:',
      choices: blacklist.map(p => ({ name: p, message: p }))
    });
    if (result) {
      await ctx.permissionManager.removeFromBlacklist(result.pattern);
      console.log(chalk.yellow(`Removed "${result.pattern}" from denied list.`));
    }
  } else if (action === 'clear_all') {
    const result = await safePrompt<{ confirm: boolean }>({
      type: 'confirm',
      name: 'confirm',
      message: 'Clear all saved permissions? This cannot be undone.',
      initial: false
    });
    if (result?.confirm) {
      // Remove all items
      for (const pattern of [...whitelist]) {
        await ctx.permissionManager.removeFromWhitelist(pattern);
      }
      for (const pattern of [...blacklist]) {
        await ctx.permissionManager.removeFromBlacklist(pattern);
      }
      console.log(chalk.yellow('All permissions cleared.'));
    }
  }

  return null;
}

export const metadata = {
  command: '/permissions',
  description: 'view and manage tool/command approvals',
  implemented: true
};
