/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';

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

function ToolOutputComponent({ entry }: ToolOutputProps) {
  const { colors } = useTheme();
  const { tool, success, output, thought } = entry;

  // Clean thought - skip if it looks like JSON
  const cleanThought = thought && !thought.trim().startsWith('{') ? thought : undefined;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Show thought/reasoning before tool if present */}
      {cleanThought && (
        <Text color={colors.text}>{cleanThought}</Text>
      )}
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          <Text color={colors.toolOutput}>{output}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={colors.error}>┌─ Error ─────────────────────────────────</Text>
            <Text><Text color={colors.error}>│ </Text>{output}</Text>
            <Text color={colors.error}>└─────────────────────────────────────────</Text>
          </Box>
        )
      )}
    </Box>
  );
}

/**
 * Memoized ToolOutput - only re-renders when entry content changes
 */
export const ToolOutput = memo(ToolOutputComponent, (prev, next) => {
  return prev.entry.id === next.entry.id &&
         prev.entry.success === next.entry.success &&
         prev.entry.output === next.entry.output &&
         prev.entry.thought === next.entry.thought;
});

/**
 * Static version of ToolOutput for use in Ink's <Static> component.
 * Renders completed tool outputs that never need to update.
 */
export function ToolOutputStatic({ entry }: ToolOutputProps) {
  const { colors } = useTheme();
  const { tool, success, output, thought } = entry;

  // Clean thought - skip if it looks like JSON
  const cleanThought = thought && !thought.trim().startsWith('{') ? thought : undefined;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {cleanThought && (
        <Text color={colors.text}>{cleanThought}</Text>
      )}
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          <Text color={colors.toolOutput}>{output}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={colors.error}>┌─ Error ─────────────────────────────────</Text>
            <Text><Text color={colors.error}>│ </Text>{output}</Text>
            <Text color={colors.error}>└─────────────────────────────────────────</Text>
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

/**
 * @deprecated Use <Static> with ToolOutputStatic in AgentUI instead
 */
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
