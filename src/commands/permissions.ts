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

function renderSection(title: string, section: PermissionScopeSnapshot): string[] {
  const allowList = section.allowList.length === 0
    ? [chalk.gray('  No AllowList entries')]
    : [
        chalk.green('  AllowList'),
        ...section.allowList.map((pattern, index) => chalk.green(`    ${index + 1}. ${pattern}`)),
      ];
  const denyList = section.denyList.length === 0
    ? [chalk.gray('  No DenyList entries')]
    : [
        chalk.red('  DenyList'),
        ...section.denyList.map((pattern, index) => chalk.red(`    ${index + 1}. ${pattern}`)),
      ];

  return [renderBold(title), chalk.gray(section.path), ...allowList, ...denyList];
}

/**
 * Permissions command - reports saved permission state by scope.
 *
 * The report is returned rather than printed: the caller owns the screen, and a full-screen frame
 * repaints over anything written to the console around it.
 */
export async function permissions(ctx: PermissionsCommandContext): Promise<string> {
  const snapshot = ctx.permissionManager.getPermissionSnapshot(ctx.configPath ?? '(user config unknown)');

  const header = [
    chalk.bold.cyan(t('commands.permissions.title')),
    chalk.gray('─'.repeat(50)),
    chalk.gray(t('commands.permissions.mode', { mode: snapshot.mode || 'interactive' })),
    chalk.gray(`Remember session decisions: ${snapshot.rememberSession ? 'Yes' : 'No'}`),
  ];
  const sections = [
    renderSection('Session', snapshot.session),
    renderSection('Project', snapshot.project),
    renderSection('User', snapshot.user),
    renderSection('Effective', snapshot.effective),
  ];

  return [header, ...sections].map(lines => lines.join('\n')).join('\n\n');
}

export const metadata = {
  command: '/permissions',
  description: t('commands.permissions.description'),
  implemented: true
};
