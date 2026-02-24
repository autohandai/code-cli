/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';

export interface TeammateLogEntry {
  level: string;
  text: string;
  timestamp: string;
}

export interface TeammateViewProps {
  name: string;
  status: string;
  logs: TeammateLogEntry[];
  maxLines?: number;
}

export const TeammateView = memo(({ name, status, logs, maxLines = 10 }: TeammateViewProps) => {
  const visibleLogs = logs.slice(-maxLines);

  const statusColor = status === 'working' ? 'yellow' :
                      status === 'idle' ? 'green' :
                      status === 'shutdown' ? 'red' : 'gray';

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>{name}</Text>
        <Text color={statusColor}>{status}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visibleLogs.map((log, i) => {
          const color = log.level === 'error' ? 'red' :
                       log.level === 'warn' ? 'yellow' : undefined;
          return (
            <Text key={i} color={color} wrap="truncate">
              <Text color="gray">[{log.timestamp}] </Text>
              {log.text}
            </Text>
          );
        })}
        {visibleLogs.length === 0 && <Text color="gray">Waiting for output...</Text>}
      </Box>
    </Box>
  );
});
TeammateView.displayName = 'TeammateView';
