/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';

export const metadata: SlashCommand = {
  command: '/message',
  description: 'Send a direct message to a teammate',
  implemented: true,
};

interface MessageCommandContext {
  teamManager?: TeamManager;
}

export async function message(ctx: MessageCommandContext, args: string[]): Promise<string | null> {
  if (!ctx.teamManager) {
    return chalk.yellow('Team manager not available.');
  }

  const team = ctx.teamManager.getTeam();
  if (!team) {
    return chalk.yellow('No active team.');
  }

  if (args.length < 2) {
    return [
      chalk.bold('Usage:'),
      `  ${chalk.cyan('/message <name> <text>')}`,
      '',
      chalk.gray('Example: /message hunter also check src/legacy/'),
    ].join('\n');
  }

  const [targetName, ...rest] = args;
  const content = rest.join(' ');

  try {
    ctx.teamManager.sendMessageTo(targetName, 'lead', content);
    return chalk.green(`Message sent to ${targetName}.`);
  } catch (err) {
    return chalk.red((err as Error).message);
  }
}
