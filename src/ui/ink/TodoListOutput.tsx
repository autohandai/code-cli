/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

export interface TodoTaskView {
  title: string;
  status: string;
}

interface TodoPayload {
  tasks?: unknown;
  summary?: unknown;
}

function parseTodoPayload(output: string): { tasks: TodoTaskView[]; summary: string | null } | null {
  try {
    const parsed = JSON.parse(output) as TodoPayload;
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return null;
    }
    const tasks = parsed.tasks
      .filter((task): task is Record<string, unknown> => Boolean(task) && typeof task === 'object')
      .map((task) => ({
        title: typeof task.title === 'string' && task.title.trim().length > 0 ? task.title : 'Untitled task',
        status: typeof task.status === 'string' ? task.status : 'pending',
      }));
    const summary = typeof parsed.summary === 'string' ? parsed.summary : null;
    return { tasks, summary };
  } catch {
    return null;
  }
}

const STATUS_MARKER: Record<string, { marker: string; colorKey: 'success' | 'warning' | 'muted' }> = {
  completed: { marker: '✓', colorKey: 'success' },
  in_progress: { marker: '•', colorKey: 'warning' },
  pending: { marker: '○', colorKey: 'muted' },
};

export function TodoListOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const payload = useMemo(() => parseTodoPayload(output), [output]);

  if (!payload) {
    return <Text color={colors.toolOutput}>{output}</Text>;
  }

  const { tasks, summary } = payload;

  if (tasks.length === 0) {
    return <Text color={colors.muted}>No tasks</Text>;
  }

  const completed = tasks.filter((task) => task.status === 'completed').length;
  const percent = Math.round((completed / tasks.length) * 100);
  const barWidth = 20;
  const filled = Math.round((barWidth * percent) / 100);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold> Tasks </Text>
        <Text color={colors.muted}>{`${completed}/${tasks.length} done`}</Text>
      </Box>
      <Box>
        <Text color={colors.success}>{bar}</Text>
        <Text color={colors.muted}>{` ${percent}%`}</Text>
      </Box>
      {tasks.map((task, index) => {
        const style = STATUS_MARKER[task.status] ?? STATUS_MARKER.pending!;
        return (
          <Box key={`${index}-${task.title}`} gap={1}>
            <Text color={colors[style.colorKey]}>{style.marker}</Text>
            <Text color={task.status === 'pending' ? colors.muted : colors.toolOutput} wrap="truncate">
              {task.title}
            </Text>
          </Box>
        );
      })}
      {summary ? <Text color={colors.muted}>{summary}</Text> : null}
    </Box>
  );
}
