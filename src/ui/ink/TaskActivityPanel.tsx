/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact sticky panel for todo_write tasks and running sub-agents.
 * Renders below the status line and above the composer so multi-step work stays visible.
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
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

const STATUS_ORDER: Record<ActivityItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  failed: 2,
  completed: 3,
};

export function summarizeActivity(items: ActivityItem[]): {
  total: number;
  done: number;
  inProgress: number;
  open: number;
  failed: number;
} {
  let done = 0;
  let inProgress = 0;
  let open = 0;
  let failed = 0;
  for (const item of items) {
    switch (item.status) {
      case 'completed':
        done += 1;
        break;
      case 'in_progress':
        inProgress += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      default:
        open += 1;
    }
  }
  return { total: items.length, done, inProgress, open, failed };
}

/** Pick visible rows: active work first while preserving authored order within each status. */
export function selectVisibleActivityItems(
  items: ActivityItem[],
  maxVisible = 4,
): { visible: ActivityItem[]; hiddenPending: number; hiddenCompleted: number } {
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.index - b.index)
    .map(({ item }) => item);

  if (sorted.length <= maxVisible) {
    return { visible: sorted, hiddenPending: 0, hiddenCompleted: 0 };
  }

  const visible = sorted.slice(0, maxVisible);
  const hidden = sorted.slice(maxVisible);
  return {
    visible,
    hiddenPending: hidden.filter((item) => item.status === 'pending' || item.status === 'in_progress').length,
    hiddenCompleted: hidden.filter((item) => item.status === 'completed' || item.status === 'failed').length,
  };
}

export function statusGlyph(status: ActivityItemStatus): string {
  switch (status) {
    case 'completed':
      return '■';
    case 'in_progress':
      return '▣';
    case 'failed':
      return '✕';
    default:
      return '□';
  }
}

function formatHiddenItems(hiddenPending: number, hiddenCompleted: number): string {
  return [
    hiddenPending > 0 ? `${hiddenPending} pending` : null,
    hiddenCompleted > 0 ? `${hiddenCompleted} completed` : null,
  ].filter((value): value is string => value !== null).join(', ');
}

export function getTaskActivityMaxVisible(terminalRows: number | undefined): number {
  const rows = terminalRows ?? 24;
  return Math.max(1, Math.min(4, rows - 14));
}

function TaskActivityPanelComponent({ items, maxVisible, terminalRows }: TaskActivityPanelProps) {
  const { colors, theme } = useTheme();
  const effectiveMaxVisible = maxVisible ?? getTaskActivityMaxVisible(terminalRows);
  const compactTodos = terminalRows !== undefined && terminalRows < 20;
  const todos = useMemo(() => items.filter((item) => item.kind === 'todo'), [items]);
  const workers = useMemo(() => items.filter((item) => item.kind === 'subagent'), [items]);
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
  const workerSelection = useMemo(() => selectVisibleActivityItems(workers, 2), [workers]);

  if (items.length === 0) {
    return null;
  }

  const workerSummary = summarizeActivity(workers);
  const workerHeader = `Workers · ${workerSummary.inProgress} running${workerSummary.open > 0 ? ` · ${workerSummary.open} queued` : ''}${workerSummary.failed > 0 ? ` · ${workerSummary.failed} failed` : ''}`;
  const todoSummary = todoModel.total > 0 && todoModel.done === todoModel.total
    ? `All ${todoModel.total} tasks completed`
    : undefined;

  const renderItem = (item: ActivityItem) => {
    const glyph = statusGlyph(item.status);
    const color =
      item.status === 'completed'
        ? colors.success
        : item.status === 'in_progress'
          ? colors.warning
          : item.status === 'failed'
            ? colors.error
            : colors.muted;
    const detail = item.detail ? theme.fg('muted', ` · ${item.detail}`) : '';
    return (
      <Box key={item.id} gap={1} width="100%">
        <Text color={color}>{glyph}</Text>
        <Text wrap="truncate">
          {item.kind === 'subagent' ? '🤖 ' : ''}
          {item.label}
          {detail}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={workers.length > 0 ? 1 : 0}>
      {todos.length > 0 && <TaskPanel model={todoModel} compact={compactTodos} summary={todoSummary} />}
      {workers.length > 0 && <Text color={colors.muted}>{workerHeader}</Text>}
      {workerSelection.visible.map(renderItem)}
      {(workerSelection.hiddenPending > 0 || workerSelection.hiddenCompleted > 0) && (
        <Text color={colors.dim}>
          {`  … +${formatHiddenItems(workerSelection.hiddenPending, workerSelection.hiddenCompleted)}`}
        </Text>
      )}
    </Box>
  );
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
