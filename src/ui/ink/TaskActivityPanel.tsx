/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact sticky panel for todo_write tasks.
 */
import React, { memo, useMemo } from 'react';
import { buildTaskPanelModel, type TaskPanelRow } from '../taskPanelModel.js';
import { TaskPanel } from './TaskPanel.js';

export type ActivityItemStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type ActivityItemKind = 'todo' | 'subagent';

export interface ActivityItem {
  id: string;
  kind: ActivityItemKind;
  /** Display label (task title or "agent: task summary") */
  label: string;
  status: ActivityItemStatus;
  /** Optional secondary detail (agent type, duration, error) */
  detail?: string;
}

export interface TaskActivityPanelProps {
  items: ActivityItem[];
  /** Max plan rows to show before collapsing (default 4). */
  maxVisible?: number;
  /** Current terminal height so small viewports retain the plan summary and active row. */
  terminalRows?: number;
}

export function getTaskActivityMaxVisible(terminalRows: number | undefined): number {
  const rows = terminalRows ?? 24;
  return Math.max(1, Math.min(4, rows - 14));
}

function TaskActivityPanelComponent({ items, maxVisible, terminalRows }: TaskActivityPanelProps) {
  const effectiveMaxVisible = maxVisible ?? getTaskActivityMaxVisible(terminalRows);
  const compactTodos = terminalRows !== undefined && terminalRows < 20;
  const todos = useMemo(() => items.filter((item) => item.kind === 'todo'), [items]);
  const todoModel = useMemo(
    () => buildTaskPanelModel(
      todos.map((item): TaskPanelRow => ({
        title: item.label,
        status: item.status,
        blockedBy: [],
      })),
      { maxRows: effectiveMaxVisible },
    ),
    [todos, effectiveMaxVisible],
  );
  if (todos.length === 0) {
    return null;
  }

  const todoSummary = todoModel.total > 0 && todoModel.done === todoModel.total
    ? `All ${todoModel.total} tasks completed`
    : undefined;

  return <TaskPanel model={todoModel} compact={compactTodos} summary={todoSummary} />;
}

export const TaskActivityPanel = memo(TaskActivityPanelComponent);
TaskActivityPanel.displayName = 'TaskActivityPanel';

/** Convert todo_write normalized tasks into activity items. */
export function activityItemsFromTodos(
  todos: Array<{
    id?: string;
    title?: string;
    content?: string;
    status?: string;
    activeForm?: string;
  }>,
): ActivityItem[] {
  return todos.map((todo, index) => {
    const statusRaw = (todo.status ?? 'pending').toLowerCase();
    const status: ActivityItemStatus =
      statusRaw === 'completed' || statusRaw === 'done'
        ? 'completed'
        : statusRaw === 'in_progress' || statusRaw === 'in-progress' || statusRaw === 'active'
          ? 'in_progress'
          : statusRaw === 'failed' || statusRaw === 'error'
            ? 'failed'
            : 'pending';

    const label =
      (typeof todo.activeForm === 'string' && todo.activeForm.trim())
      || (typeof todo.content === 'string' && todo.content.trim())
      || (typeof todo.title === 'string' && todo.title.trim())
      || 'Untitled task';

    return {
      id: todo.id || `todo-${index}`,
      kind: 'todo',
      label,
      status,
    };
  });
}

export function formatSubAgentActivityLabel(agentName: string, task: string): string {
  const compact = task.replace(/\s+/g, ' ').trim();
  const clipped = compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
  return `${agentName}: ${clipped || 'working'}`;
}
