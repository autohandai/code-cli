/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';

export const metadata: SlashCommand = {
  command: '/tasks',
  description: 'Show team task list with status and owners',
  implemented: true,
};

interface TasksCommandContext {
  teamManager?: TeamManager;
}

export async function tasks(ctx: TasksCommandContext): Promise<string | null> {
  if (!ctx.teamManager) {
    return chalk.yellow('Team manager not available.');
  }

  const team = ctx.teamManager.getTeam();
  if (!team) {
    return chalk.yellow('No active team. Create one first.');
  }

  const allTasks = ctx.teamManager.tasks.listTasks();
  if (allTasks.length === 0) {
    return chalk.gray('No tasks in the current team.');
  }

  const done = allTasks.filter(t => t.status === 'completed').length;
  const lines = [
    chalk.bold(`Tasks [${done}/${allTasks.length} done]`),
    '',
  ];

  for (const task of allTasks) {
    const icon = task.status === 'completed' ? chalk.green('✓') :
                task.status === 'in_progress' ? chalk.yellow('●') : chalk.gray('○');
    const owner = task.owner ? chalk.cyan(` → ${task.owner}`) : '';
    const blocked = task.blockedBy.length > 0 ? chalk.red(` (blocked by: ${task.blockedBy.join(', ')})`) : '';
    lines.push(`  ${icon} ${chalk.white(task.id)} ${task.subject}${owner}${blocked}`);
  }

  return lines.join('\n');
}
