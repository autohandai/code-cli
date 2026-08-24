/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommand } from '../core/slashCommandTypes.js';
import type { TeamManager } from '../core/teams/TeamManager.js';
import { buildTaskPanelModel, normalizeTaskPanelRows } from '../ui/taskPanelModel.js';
import { renderTaskPanelText } from '../ui/taskPanelText.js';

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

  const model = buildTaskPanelModel(normalizeTaskPanelRows(ctx.teamManager.tasks.listTasks()), {
    maxRows: Number.MAX_SAFE_INTEGER,
  });

  return renderTaskPanelText(model);
}
