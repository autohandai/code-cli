/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ink renderer for `TaskPanelModel`. Borders are deliberately omitted: tool
 * output repeats many times per session, and box drawing costs four columns
 * that narrow terminals cannot spare.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { taskStatusGlyph, type TaskPanelModel, type TaskPanelStatus } from '../taskPanelModel.js';

export interface TaskPanelProps {
  model: TaskPanelModel;
  /** Rendered above the panel, e.g. "Task task-3 updated". */
  headline?: string;
  /** Rendered below the panel, e.g. a filter or truncation note. */
  note?: string;
  /** Rendered below the panel as supplied by the tool, e.g. the todo summary. */
  summary?: string;
}

const STATUS_COLOR_KEY: Record<TaskPanelStatus, 'success' | 'warning' | 'muted' | 'error'> = {
  completed: 'success',
  in_progress: 'warning',
  pending: 'muted',
  failed: 'error',
};

function padId(id: string | undefined, width: number): string {
  if (width === 0) {
    return '';
  }
  return `${(id ?? '').padEnd(width)} `;
}

export function TaskPanel({ model, headline, note, summary }: TaskPanelProps) {
  const { colors } = useTheme();

  if (model.total === 0) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {headline ? <Text color={colors.toolOutput}>{headline}</Text> : null}
        <Text color={colors.muted}> No tasks</Text>
      </Box>
    );
  }

  const idWidth = model.groups
    .flatMap((group) => group.rows)
    .reduce((widest, row) => Math.max(widest, row.id?.length ?? 0), 0);
  // Aligns under the title: two leading spaces + glyph + space, then the id column.
  const subIndent = ' '.repeat(4 + (idWidth ? idWidth + 1 : 0));

  return (
    <Box flexDirection="column" marginBottom={1}>
      {headline ? <Text color={colors.toolOutput}>{headline}</Text> : null}

      <Box>
        <Text bold> Tasks </Text>
        <Text color={colors.muted}>{` ${model.done}/${model.total} done`}</Text>
      </Box>
      <Box>
        <Text> </Text>
        <Text color={colors.success}>{model.bar}</Text>
        <Text color={colors.muted}>{` ${model.percent}%`}</Text>
      </Box>

      {model.groups.map((group) => (
        <Box key={group.status} flexDirection="column" marginTop={1}>
          <Text color={colors.muted}>{` ${group.label} · ${group.rows.length}`}</Text>
          {group.rows.map((row, index) => (
            <Box key={row.id ?? `${group.status}-${index}`} flexDirection="column">
              <Box>
                <Text color={colors[STATUS_COLOR_KEY[row.status]]}>{`  ${taskStatusGlyph(row.status)} `}</Text>
                {idWidth > 0 ? <Text color={colors.muted}>{padId(row.id, idWidth)}</Text> : null}
                <Text
                  color={row.status === 'pending' ? colors.muted : colors.toolOutput}
                  wrap="truncate"
                >
                  {row.title}
                </Text>
              </Box>
              {row.owner ? (
                <Text color={colors.accent}>{`${subIndent}↳ ${row.owner}`}</Text>
              ) : null}
              {row.blockedBy.length > 0 ? (
                <Text color={colors.error}>
                  {`${subIndent}⊘ blocked by ${row.blockedBy.join(', ')}`}
                </Text>
              ) : null}
            </Box>
          ))}
        </Box>
      ))}

      {model.hiddenLabel ? <Text color={colors.muted}>{`  … ${model.hiddenLabel}`}</Text> : null}
      {note ? <Text color={colors.muted}>{` ${note}`}</Text> : null}
      {summary ? <Text color={colors.muted}>{` ${summary}`}</Text> : null}
    </Box>
  );
}
