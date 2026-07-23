/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Compact sticky panel for todo_write tasks and running sub-agents.
 * Renders above the status line so multi-step / multi-agent work stays visible.
 */
import React, { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

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
  /** Max rows to show before collapsing (default 6). */
  maxVisible?: number;
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

/** Pick visible rows: in-progress first, then pending/failed, then completed. */
export function selectVisibleActivityItems(
  items: ActivityItem[],
  maxVisible = 6,
): { visible: ActivityItem[]; hiddenPending: number; hiddenCompleted: number } {
  const sorted = [...items].sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return a.label.localeCompare(b.label);
  });

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

function TaskActivityPanelComponent({ items, maxVisible = 6 }: TaskActivityPanelProps) {
  const { colors, theme } = useTheme();
  const summary = useMemo(() => summarizeActivity(items), [items]);
  const selection = useMemo(
    () => selectVisibleActivityItems(items, maxVisible),
    [items, maxVisible],
  );

  if (items.length === 0) {
    return null;
  }

  const openCount = summary.open + summary.inProgress;
  const header = `${summary.total} task${summary.total === 1 ? '' : 's'} (${summary.done} done, ${summary.inProgress} in progress, ${openCount} open${summary.failed > 0 ? `, ${summary.failed} failed` : ''})`;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={colors.muted}>{header}</Text>
      {selection.visible.map((item) => {
        const glyph = statusGlyph(item.status);
        const color =
          item.status === 'completed'
            ? colors.success
            : item.status === 'in_progress'
              ? colors.warning
              : item.status === 'failed'
                ? colors.error
                : colors.muted;
        const kindPrefix = item.kind === 'subagent' ? '🤖 ' : '';
        const detail = item.detail ? theme.fg('muted', ` · ${item.detail}`) : '';
        return (
          <Box key={item.id} gap={1}>
            <Text color={color}>{glyph}</Text>
            <Text>
              {kindPrefix}
              {item.label}
              {detail}
            </Text>
          </Box>
        );
      })}
      {(selection.hiddenPending > 0 || selection.hiddenCompleted > 0) && (
        <Text color={colors.dim}>
          {`  … +${selection.hiddenPending} pending, ${selection.hiddenCompleted} completed`}
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
