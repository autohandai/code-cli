/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';
import { taskStatusGlyph } from '../ui/taskPanelModel.js';

export const metadata: SlashCommand = {
  command: '/team',
  description: 'Manage agent teams (create, status, shutdown)',
  implemented: true,
  subcommands: [
    { name: 'create', description: 'Create a new team' },
    { name: 'view', description: 'Open the live team activity view' },
    { name: 'status', description: 'Show team status' },
    { name: 'errors', description: 'Inspect failed tasks and their output' },
    { name: 'retry', description: 'Retry one failed task by ID' },
    { name: 'retry-failed', description: 'Retry all failed tasks' },
    { name: 'hide', description: 'Hide the panel without stopping teammates' },
    { name: 'shutdown', description: 'Shut down all teammates' },
  ],
};

interface TeamCommandContext {
  teamManager?: TeamManager;
  onToggleTeamView?: (visible: boolean) => void;
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
      `  ${chalk.cyan('/team create <name>')}  Create a new team`,
      `  ${chalk.cyan('/team view')}           Open the live team activity view`,
      `  ${chalk.cyan('/team status')}         Show current team status`,
      `  ${chalk.cyan('/team errors')}         Inspect failed tasks`,
      `  ${chalk.cyan('/team retry <id>')}     Retry a failed task`,
      `  ${chalk.cyan('/team retry-failed')}   Retry all failed tasks`,
      `  ${chalk.cyan('/team hide')}           Hide the panel; keep workers available`,
      `  ${chalk.cyan('/team shutdown')}       Shut down all teammates`,
      `  ${chalk.cyan('/team')}                Show this help`,
      '',
      `  ${chalk.cyan('/agents view')}         Inspect live agent runs, output, and cancellation`,
    ].join('\n');
  }

  switch (subcommand) {
    case 'view': {
      if (!ctx.teamManager.getTeam()) {
        return chalk.yellow('No active team. Create one first.');
      }
      ctx.onToggleTeamView?.(true);
      return chalk.green('Opened the live team view. Use its recovery controls, or /team hide to hide the panel.');
    }

    case 'hide':
      ctx.onToggleTeamView?.(false);
      return 'Team panel hidden. Workers remain available; /team shutdown stops them.';

    case 'errors': {
      const failures = ctx.teamManager.tasks.listTasks().filter(task => task.status === 'failed');
      if (!failures.length) return 'No failed team tasks.';
      return failures.map(task => [
        `${task.id} · ${task.subject}`,
        task.error ?? 'No error details recorded.',
        ...(task.output ? [task.output] : []),
      ].join('\n')).join('\n\n');
    }

    case 'retry':
    case 'retry-failed': {
      if (ctx.teamManager.getTeam()?.status !== 'active') return 'This team is closed. Create a new team to start work.';
      const failures = ctx.teamManager.tasks.listTasks().filter(task => task.status === 'failed');
      const selected = subcommand === 'retry' ? failures.filter(task => task.id === args[1]) : failures;
      if (subcommand === 'retry' && !selected.length) return 'Only failed tasks can be retried. Use /team errors to choose a task ID.';
      if (!selected.length) return 'No failed team tasks to retry.';
      for (const task of selected) ctx.teamManager.updateTask(task.id, { status: 'pending' });
      return `Retrying ${selected.length} failed task${selected.length === 1 ? '' : 's'}. Successful and cancelled tasks are unchanged. Previous attempts remain in /agents view.`;
    }

    case 'create': {
      const name = args.slice(1).join('-') || 'default';
      const activeTeam = ctx.teamManager.getTeam();
      if (activeTeam?.status === 'active') {
        if (activeTeam.name === name) {
          return chalk.green(`Team "${name}" is already active; reusing it. Use /team status to view.`);
        }
        return chalk.yellow(
          `Team "${activeTeam.name}" is already active. Shut it down with /team shutdown before creating "${name}".`,
        );
      }
      ctx.teamManager.createTeam(name);
      return chalk.green(`Team "${name}" created. Use /team status to view.`);
    }

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
        const provenance = [
          member.requestedRole ? `requested: ${member.requestedRole}` : '',
          member.agentSource ? `source: ${member.agentSource}` : '',
        ].filter(Boolean).join(', ');
        lines.push(`  ${statusColor('●')} ${chalk.white(member.name)} (${member.agentName}) - ${statusColor(member.status)}${provenance ? ` [${provenance}]` : ''}`);
      }

      // List tasks
      const tasks = ctx.teamManager.tasks.listTasks();
      if (tasks.length > 0) {
        lines.push('', chalk.bold('Tasks:'));
        for (const task of tasks) {
          const statusColor = task.status === 'completed' ? chalk.green :
                              task.status === 'in_progress' ? chalk.yellow :
                              task.status === 'failed' ? chalk.red : chalk.gray;
          const icon = statusColor(taskStatusGlyph(task.status));
          const owner = task.owner ? chalk.gray(` [${task.owner}]`) : '';
          lines.push(`  ${icon} ${task.subject} — ${statusColor(task.status)}${owner}`);
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
      ctx.onToggleTeamView?.(false);
      return chalk.green(`Team "${team.name}" has been shut down.`);
    }

    default:
      return chalk.yellow(`Unknown team subcommand: ${subcommand}. Use /team for help.`);
  }
}
