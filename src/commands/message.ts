/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';
import type { SquadConnection } from '../squad/SquadConnection.js';

export const metadata: SlashCommand = {
  command: '/message',
  description: 'Message a local teammate or a selected Squad agent',
  implemented: true,
};

interface MessageCommandContext {
  teamManager?: Pick<TeamManager, 'getTeam' | 'sendMessageTo'>;
  squadConnection?: SquadConnection;
}

export async function message(ctx: MessageCommandContext, args: string[]): Promise<string | null> {
  if (args[0] === 'squad' || (ctx.squadConnection?.selectedMemberId && args[0] !== 'team')) {
    try {
      if (!ctx.squadConnection) return 'Squad connection unavailable.';
      return await sendSquadMessage(ctx.squadConnection, args);
    } catch (error) { return chalk.red(error instanceof Error ? error.message : String(error)); }
  }
  if (args[0] === 'team') args = args.slice(1);
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

export async function sendSquadMessage(connection: SquadConnection, args: string[]): Promise<string> {
  const explicit = args[0] === 'squad';
  const target = explicit ? args[1] : undefined;
  const text = (explicit ? args.slice(2) : args).join(' ').trim();
  if (!text || (explicit && !target)) throw new Error('Usage: /message squad <agent-id> <text>, or select an agent with /squad select then /message <text>.');
  const receipt = target ? await connection.sendTo(target, text) : await connection.send(text);
  return `Message queued for Squad agent ${receipt.member_id}. Receipt: ${receipt.message_id}.${receipt.paused ? ` Queue paused: ${receipt.pauseReason} Resume it in Squad when ready.` : ''}`;
}
