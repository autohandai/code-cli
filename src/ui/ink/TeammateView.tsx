/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import type { ColorToken } from '../theme/types.js';

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
  const { theme } = useTheme();
  const visibleLogs = logs.slice(-maxLines);

  const statusToken: ColorToken = status === 'working' ? 'warning' :
                                  status === 'idle' ? 'success' :
                                  status === 'shutdown' ? 'error' : 'muted';

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>{name}</Text>
        <Text>{theme.fg(statusToken, status)}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visibleLogs.map((log, i) => {
          const token: ColorToken = log.level === 'error' ? 'error' :
                                    log.level === 'warn' ? 'warning' : 'text';
          return (
            <Text key={`${log.timestamp}-${i}`} wrap="truncate">
              <Text>{theme.fg('muted', `[${log.timestamp}] `)}</Text>
              {theme.fg(token, log.text)}
            </Text>
          );
        })}
        {visibleLogs.length === 0 && <Text>{theme.fg('muted', 'Waiting for output...')}</Text>}
      </Box>
    </Box>
  );
});
TeammateView.displayName = 'TeammateView';
