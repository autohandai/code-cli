/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { Team, TeamTask } from '../../core/teams/types.js';
import { useTheme } from '../theme/ThemeContext.js';
import type { ColorToken } from '../theme/types.js';

export interface TeamPanelProps {
  team: Team;
  tasks: TeamTask[];
}

const StatusIcon = memo(({ status }: { status: string }) => {
  const { theme } = useTheme();
  const icon = (token: ColorToken, value: string) => <Text>{theme.fg(token, value)}</Text>;

  switch (status) {
    case 'completed': return icon('success', '✓');
    case 'in_progress': return icon('warning', '●');
    case 'working': return icon('warning', '●');
    case 'idle': return icon('success', '○');
    case 'shutdown': return icon('error', '×');
    case 'spawning': return icon('muted', '…');
    default: return icon('muted', '○');
  }
});
StatusIcon.displayName = 'StatusIcon';

export const TeamPanel = memo(({ team, tasks }: TeamPanelProps) => {
  const { theme } = useTheme();
  const done = tasks.filter((t) => t.status === 'completed').length;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Team: {team.name}</Text>
        <Text>{theme.fg(team.status === 'active' ? 'success' : 'muted', team.status === 'active' ? '🟢' : '⚪')}</Text>
      </Box>

      {/* Task list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Tasks [{done}/{tasks.length} done]</Text>
        {tasks.map((task) => (
          <Box key={task.id} gap={1}>
            <StatusIcon status={task.status} />
            <Text>{task.subject}</Text>
            {task.owner && <Text>{theme.fg('accent', ` → ${task.owner}`)}</Text>}
          </Box>
        ))}
        {tasks.length === 0 && <Text>{theme.fg('muted', '  No tasks yet')}</Text>}
      </Box>

      {/* Members list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Teammates</Text>
        {team.members.map((member) => (
          <Box key={member.name} gap={1}>
            <StatusIcon status={member.status} />
            <Text>{member.name}</Text>
            <Text>{theme.fg('muted', `(${member.agentName})`)}</Text>
          </Box>
        ))}
        {team.members.length === 0 && <Text>{theme.fg('muted', '  No teammates yet')}</Text>}
      </Box>
    </Box>
  );
});
TeamPanel.displayName = 'TeamPanel';
