/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chalk renderer for `TaskPanelModel`, used by non-Ink surfaces such as the
 * `/tasks` slash command. Mirrors `src/ui/ink/TaskPanel.tsx` line for line so
 * the two never drift apart visually.
 */

import chalk from 'chalk';
import { themedFg } from './theme/Theme.js';
import { taskStatusGlyph, type TaskPanelModel, type TaskPanelStatus } from './taskPanelModel.js';

type ChalkFn = (value: string) => string;

const STATUS_STYLE: Record<TaskPanelStatus, { token: 'success' | 'warning' | 'muted' | 'error'; fallback: ChalkFn }> = {
  completed: { token: 'success', fallback: chalk.green },
  in_progress: { token: 'warning', fallback: chalk.yellow },
  pending: { token: 'muted', fallback: chalk.gray },
  failed: { token: 'error', fallback: chalk.red },
};

export interface RenderTaskPanelTextOptions {
  headline?: string;
  note?: string;
}

export function renderTaskPanelText(model: TaskPanelModel, options: RenderTaskPanelTextOptions = {}): string {
  const lines: string[] = [];

  if (options.headline) {
    lines.push(options.headline);
  }

  if (model.total === 0) {
    lines.push(themedFg('muted', ' No tasks', chalk.gray));
    return lines.join('\n');
  }

  const idWidth = model.groups
    .flatMap((group) => group.rows)
    .reduce((widest, row) => Math.max(widest, row.id?.length ?? 0), 0);
  // Aligns under the title: two leading spaces + glyph + space, then the id column.
  const subIndent = ' '.repeat(4 + (idWidth ? idWidth + 1 : 0));

  lines.push(`${chalk.bold(' Tasks ')}${themedFg('muted', ` ${model.done}/${model.total} done`, chalk.gray)}`);
  lines.push(
    ` ${themedFg('success', model.bar, chalk.green)}${themedFg('muted', ` ${model.percent}%`, chalk.gray)}`,
  );

  for (const group of model.groups) {
    lines.push('');
    lines.push(themedFg('muted', ` ${group.label} · ${group.rows.length}`, chalk.gray));

    for (const row of group.rows) {
      const style = STATUS_STYLE[row.status];
      const glyph = themedFg(style.token, `  ${taskStatusGlyph(row.status)} `, style.fallback);
      const id = idWidth > 0 ? themedFg('muted', `${(row.id ?? '').padEnd(idWidth)} `, chalk.gray) : '';
      const title = row.status === 'pending' ? themedFg('muted', row.title, chalk.gray) : row.title;
      lines.push(`${glyph}${id}${title}`);

      if (row.owner) {
        lines.push(themedFg('accent', `${subIndent}↳ ${row.owner}`, chalk.cyan));
      }
      if (row.blockedBy.length > 0) {
        lines.push(themedFg('error', `${subIndent}⊘ blocked by ${row.blockedBy.join(', ')}`, chalk.red));
      }
    }
  }

  if (model.hiddenLabel) {
    lines.push(themedFg('muted', `  … ${model.hiddenLabel}`, chalk.gray));
  }
  if (options.note) {
    lines.push(themedFg('muted', ` ${options.note}`, chalk.gray));
  }

  return lines.join('\n');
}
