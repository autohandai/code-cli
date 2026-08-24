/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Renders `todo_write` results. Shares its layout with the team task panel so
 * both surfaces group, collapse, and mark status identically.
 */
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { buildTaskPanelModel, normalizeTaskPanelRows, type TaskPanelRow } from '../taskPanelModel.js';
import { TaskPanel } from './TaskPanel.js';

export interface TodoTaskView {
  title: string;
  status: string;
}

interface TodoPayload {
  tasks?: unknown;
  summary?: unknown;
}

function parseTodoPayload(output: string): { rows: TaskPanelRow[]; summary: string | null } | null {
  try {
    const parsed = JSON.parse(output) as TodoPayload;
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return null;
    }
    return {
      rows: normalizeTaskPanelRows(parsed.tasks),
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
    };
  } catch {
    return null;
  }
}

export function TodoListOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const payload = useMemo(() => parseTodoPayload(output), [output]);
  const model = useMemo(() => (payload ? buildTaskPanelModel(payload.rows) : null), [payload]);

  if (!payload || !model) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.toolOutput}>{output}</Text>
      </Box>
    );
  }

  return <TaskPanel model={model} summary={payload.summary ?? undefined} />;
}
