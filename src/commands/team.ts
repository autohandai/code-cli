/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';

export const metadata: SlashCommand = {
  command: '/team',
  description: 'Manage agent teams (status, shutdown)',
  implemented: true,
};

interface TeamCommandContext {
  teamManager?: TeamManager;
}

export async function team(ctx: TeamCommandContext, args: string[]): Promise<string | null> {
  if (!ctx.teamManager) {
    return chalk.yellow('Team manager not available.');
  }

  const subcommand = args[0]?.toLowerCase();

  if (!subcommand || subcommand === 'help') {
    return [
      chalk.bold('Team Commands:'),
      '',
      `  ${chalk.cyan('/team status')}    Show current team status`,
      `  ${chalk.cyan('/team shutdown')}  Shut down all teammates`,
      `  ${chalk.cyan('/team')}           Show this help`,
      '',
      chalk.gray('To create a team, describe the task and ask autohand to form a team.'),
    ].join('\n');
  }

  switch (subcommand) {
    case 'status': {
      const team = ctx.teamManager.getTeam();
      if (!team) {
        return chalk.yellow('No active team.');
      }

      const status = ctx.teamManager.getStatus();
      const lines = [
        chalk.bold(`Team: ${team.name}`),
        `${chalk.gray('Status:')} ${team.status === 'active' ? chalk.green('active') : chalk.gray('completed')}`,
        `${chalk.gray('Members:')} ${status.memberCount}`,
        `${chalk.gray('Tasks:')} ${status.tasksDone}/${status.tasksTotal} completed`,
        '',
      ];

      // List members
      for (const member of team.members) {
        const statusColor = member.status === 'working' ? chalk.yellow :
                           member.status === 'idle' ? chalk.green :
                           member.status === 'shutdown' ? chalk.red : chalk.gray;
        lines.push(`  ${statusColor('●')} ${chalk.white(member.name)} (${member.agentName}) - ${statusColor(member.status)}`);
      }

      // List tasks
      const tasks = ctx.teamManager.tasks.listTasks();
      if (tasks.length > 0) {
        lines.push('', chalk.bold('Tasks:'));
        for (const task of tasks) {
          const icon = task.status === 'completed' ? chalk.green('✓') :
                      task.status === 'in_progress' ? chalk.yellow('●') : chalk.gray('○');
          const owner = task.owner ? chalk.gray(` [${task.owner}]`) : '';
          lines.push(`  ${icon} ${task.subject}${owner}`);
        }
      }

      return lines.join('\n');
    }

    case 'shutdown': {
      const team = ctx.teamManager.getTeam();
      if (!team) {
        return chalk.yellow('No active team to shut down.');
      }
      await ctx.teamManager.shutdown();
      return chalk.green(`Team "${team.name}" has been shut down.`);
    }

    default:
      return chalk.yellow(`Unknown team subcommand: ${subcommand}. Use /team for help.`);
  }
}
