/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { Box, Text } from 'ink';

export interface ToolOutputEntry {
  id: string;
  tool: string;
  success: boolean;
  output: string;
  timestamp: number;
  /** Thought/reasoning shown before the tool (what the agent is about to do) */
  thought?: string;
}

export interface ToolOutputProps {
  entry: ToolOutputEntry;
}

export function ToolOutput({ entry }: ToolOutputProps) {
  const { tool, success, output, thought } = entry;

  // Clean thought - skip if it looks like JSON
  const cleanThought = thought && !thought.trim().startsWith('{') ? thought : undefined;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Show thought/reasoning before tool if present */}
      {cleanThought && (
        <Text color="white">{cleanThought}</Text>
      )}
      <Box>
        <Text color={success ? 'green' : 'red'}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          <Text color="gray">{output}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color="red">┌─ Error ─────────────────────────────────</Text>
            <Text><Text color="red">│ </Text>{output}</Text>
            <Text color="red">└─────────────────────────────────────────</Text>
          </Box>
        )
      )}
    </Box>
  );
}

export interface ToolOutputListProps {
  entries: ToolOutputEntry[];
  maxVisible?: number;
}

export function ToolOutputList({ entries, maxVisible = 50 }: ToolOutputListProps) {
  const visible = entries.slice(-maxVisible);

  return (
    <Box flexDirection="column">
      {visible.map((entry) => (
        <ToolOutput key={entry.id} entry={entry} />
      ))}
    </Box>
  );
}
