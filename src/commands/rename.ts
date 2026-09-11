/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SessionManager } from '../session/SessionManager.js';
import type { SlashCommand } from '../core/slashCommandTypes.js';

export const metadata: SlashCommand = {
  command: '/rename',
  description: 'name the current session so /sessions and /resume show what it is for',
  implemented: true,
};

export interface RenameContext {
  sessionManager: SessionManager;
}

export async function rename(ctx: RenameContext, args: string[] = []): Promise<string | null> {
  const current = ctx.sessionManager.getCurrentSession();
  if (!current) {
    console.log(chalk.yellow('No active session.'));
    return null;
  }

  const requested = args.join(' ').trim();
  if (!requested) {
    const existing = current.metadata.title;
    console.log(existing
      ? `${chalk.gray('Current session name:')} ${chalk.white(existing)}`
      : chalk.gray('This session has no name yet.'));
    console.log(chalk.gray('Usage: /rename <name>'));
    return null;
  }

  try {
    const renamed = await ctx.sessionManager.renameCurrentSession(requested);
    console.log(chalk.green(`Session renamed to "${renamed.title}".`));
  } catch (error) {
    console.log(chalk.red(error instanceof Error ? error.message : String(error)));
  }
  return null;
}
