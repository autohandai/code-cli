/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Renders the team task tools (`task_list`, `task_get`, `create_task`,
 * `task_update`, `task_stop`, `task_output`) as a panel instead of the raw
 * JSON those tools put on the wire for the model.
 */
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { parseTeamTaskPayload, type TeamTaskPayload } from '../../core/teams/taskPayload.js';
import { buildTaskPanelModel, normalizeTaskPanelRows } from '../taskPanelModel.js';
import { TaskPanel } from './TaskPanel.js';

function describeFilter(filter: TeamTaskPayload['filter']): string | null {
  if (!filter) {
    return null;
  }
  const parts = [filter.status, filter.owner].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `filter: ${parts.join(' · ')}` : null;
}

function describeNote(payload: TeamTaskPayload): string | undefined {
  const notes = [describeFilter(payload.filter)];
  if (payload.descriptionsTruncated) {
    notes.push('descriptions truncated — use task_get for full detail');
  }
  const joined = notes.filter((note): note is string => Boolean(note)).join('  ·  ');
  return joined.length > 0 ? joined : undefined;
}

export function TeamTaskListOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const payload = useMemo(() => parseTeamTaskPayload(output), [output]);
  const model = useMemo(
    () => (payload ? buildTaskPanelModel(normalizeTaskPanelRows(payload.tasks)) : null),
    [payload],
  );

  if (!payload || !model) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.toolOutput}>{output}</Text>
      </Box>
    );
  }

  return <TaskPanel model={model} headline={payload.headline} note={describeNote(payload)} />;
}
