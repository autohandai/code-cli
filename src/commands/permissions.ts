/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { PermissionManager } from '../permissions/PermissionManager.js';
import type { PermissionScopeSnapshot } from '../permissions/types.js';

export interface PermissionsCommandContext {
  permissionManager: PermissionManager;
  configPath?: string;
}

function renderBold(text: string): string {
  return typeof chalk.bold === 'function' ? chalk.bold(text) : text;
}

function renderSection(title: string, section: PermissionScopeSnapshot): void {
  console.log(renderBold(title));
  console.log(chalk.gray(section.path));

  if (section.allowList.length === 0) {
    console.log(chalk.gray('  No AllowList entries'));
  } else {
    console.log(chalk.green('  AllowList'));
    section.allowList.forEach((pattern, index) => {
      console.log(chalk.green(`    ${index + 1}. ${pattern}`));
    });
  }

  if (section.denyList.length === 0) {
    console.log(chalk.gray('  No DenyList entries'));
  } else {
    console.log(chalk.red('  DenyList'));
    section.denyList.forEach((pattern, index) => {
      console.log(chalk.red(`    ${index + 1}. ${pattern}`));
    });
  }

  console.log();
}

/**
 * Permissions command - displays saved permission state by scope.
 */
export async function permissions(ctx: PermissionsCommandContext): Promise<string | null> {
  const snapshot = ctx.permissionManager.getPermissionSnapshot(ctx.configPath ?? '(user config unknown)');

  console.log();
  console.log(chalk.bold.cyan(t('commands.permissions.title')));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(t('commands.permissions.mode', { mode: snapshot.mode || 'interactive' })));
  console.log(chalk.gray(`Remember session decisions: ${snapshot.rememberSession ? 'Yes' : 'No'}`));
  console.log();

  renderSection('Session', snapshot.session);
  renderSection('Project', snapshot.project);
  renderSection('User', snapshot.user);
  renderSection('Effective', snapshot.effective);

  return null;
}

export const metadata = {
  command: '/permissions',
  description: t('commands.permissions.description'),
  implemented: true
};
