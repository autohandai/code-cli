/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { Team, TeamTask } from '../../core/teams/types.js';

export interface TeamPanelProps {
  team: Team;
  tasks: TeamTask[];
}

const StatusIcon = memo(({ status }: { status: string }) => {
  switch (status) {
    case 'completed': return <Text color="green">✓</Text>;
    case 'in_progress': return <Text color="yellow">●</Text>;
    case 'working': return <Text color="yellow">●</Text>;
    case 'idle': return <Text color="green">○</Text>;
    case 'shutdown': return <Text color="red">×</Text>;
    case 'spawning': return <Text color="gray">…</Text>;
    default: return <Text color="gray">○</Text>;
  }
});
StatusIcon.displayName = 'StatusIcon';

export const TeamPanel = memo(({ team, tasks }: TeamPanelProps) => {
  const done = tasks.filter((t) => t.status === 'completed').length;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>Team: {team.name}</Text>
        <Text color="gray">{team.status === 'active' ? '🟢' : '⚪'}</Text>
      </Box>

      {/* Task list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Tasks [{done}/{tasks.length} done]</Text>
        {tasks.map((task) => (
          <Box key={task.id} gap={1}>
            <StatusIcon status={task.status} />
            <Text>{task.subject}</Text>
            {task.owner && <Text color="cyan"> → {task.owner}</Text>}
          </Box>
        ))}
        {tasks.length === 0 && <Text color="gray">  No tasks yet</Text>}
      </Box>

      {/* Members list */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Teammates</Text>
        {team.members.map((member) => (
          <Box key={member.name} gap={1}>
            <StatusIcon status={member.status} />
            <Text>{member.name}</Text>
            <Text color="gray">({member.agentName})</Text>
          </Box>
        ))}
        {team.members.length === 0 && <Text color="gray">  No teammates yet</Text>}
      </Box>
    </Box>
  );
});
TeamPanel.displayName = 'TeamPanel';
