/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { renderTerminalMarkdown } from '../../core/immediateCommandRouter.js';

export interface ToolOutputEntry {
  id: string;
  type?: 'single';
  tool: string;
  success: boolean;
  output: string;
  timestamp: number;
  /** Thought/reasoning shown before the tool (what the agent is about to do) */
  thought?: string;
}

/** A single tool call within a batch group */
export interface BatchToolItem {
  tool: string;
  label: string;      // e.g., "src/index.ts" or "npm test"
  detail?: string;    // e.g., "1769 lines • 65.69 KB"
  success: boolean;
}

/** Grouped batch of parallel tool calls */
export interface ToolOutputBatchEntry {
  id: string;
  type: 'batch';
  thought?: string;
  groups: Array<{
    tool: string;
    items: BatchToolItem[];
  }>;
  allSuccess: boolean;
  timestamp: number;
}

/** Union type for Static items */
export type ToolOutputItem = ToolOutputEntry | ToolOutputBatchEntry;

export interface ToolOutputProps {
  entry: ToolOutputEntry;
}

function ToolOutputComponent({ entry }: ToolOutputProps) {
  const { colors } = useTheme();
  const { tool, success, output, thought } = entry;

  // Clean thought - skip if it looks like JSON
  const cleanThought = thought && !thought.trim().startsWith('{') ? thought : undefined;
  const renderedThought = cleanThought ? renderTerminalMarkdown(cleanThought) : undefined;
  const renderedOutput = output ? renderTerminalMarkdown(output) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Show thought/reasoning before tool if present */}
      {renderedThought && (
        <Text color={colors.text}>{renderedThought}</Text>
      )}
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          <Text color={colors.toolOutput}>{renderedOutput}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={colors.error}>┌─ Error ─────────────────────────────────</Text>
            <Text><Text color={colors.error}>│ </Text>{renderedOutput}</Text>
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
  const renderedThought = cleanThought ? renderTerminalMarkdown(cleanThought) : undefined;
  const renderedOutput = output ? renderTerminalMarkdown(output) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderedThought && (
        <Text color={colors.text}>{renderedThought}</Text>
      )}
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          <Text color={colors.toolOutput}>{renderedOutput}</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={colors.error}>┌─ Error ─────────────────────────────────</Text>
            <Text><Text color={colors.error}>│ </Text>{renderedOutput}</Text>
            <Text color={colors.error}>└─────────────────────────────────────────</Text>
          </Box>
        )
      )}
    </Box>
  );
}

/** Max items to show per group before collapsing */
const MAX_VISIBLE_PER_GROUP = 4;

/**
 * Renders a grouped batch of parallel tool calls.
 * Groups same-type tools together with tree-style connectors.
 */
export function ToolOutputBatchStatic({ entry }: { entry: ToolOutputBatchEntry }) {
  const { colors } = useTheme();
  const { thought, groups } = entry;

  const cleanThought = thought && !thought.trim().startsWith('{') ? thought : undefined;
  const renderedThought = cleanThought ? renderTerminalMarkdown(cleanThought) : undefined;
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderedThought && (
        <Text color={colors.text}>{renderedThought}</Text>
      )}

      {groups.map((group, gi) => {
        const isLastGroup = gi === groups.length - 1;
        const visible = group.items.slice(0, MAX_VISIBLE_PER_GROUP);
        const hidden = group.items.length - visible.length;

        return (
          <Box key={`${group.tool}-${gi}`} flexDirection="column">
            {/* Group header: ✔ read_file (3) */}
            <Box>
              <Text color={group.items.every(i => i.success) ? colors.success : colors.error}>
                {group.items.every(i => i.success) ? '✔' : '✖'}
              </Text>
              <Text bold> {group.tool}</Text>
              {group.items.length > 1 && (
                <Text color={colors.muted}> ({group.items.length})</Text>
              )}
            </Box>

            {/* Individual items with tree connectors */}
            {visible.map((item, ii) => {
              const isLast = ii === visible.length - 1 && hidden === 0;
              const connector = isLast && isLastGroup ? '  └ ' : '  ├ ';
              return (
                <Box key={`${item.label}-${ii}`}>
                  <Text color={colors.muted}>{connector}</Text>
                  <Text color={item.success ? colors.toolOutput : colors.error}>
                    {renderTerminalMarkdown(item.label)}
                  </Text>
                  {item.detail && (
                    <Text color={colors.muted}> — {renderTerminalMarkdown(item.detail)}</Text>
                  )}
                </Box>
              );
            })}

            {/* Collapsed indicator */}
            {hidden > 0 && (
              <Box>
                <Text color={colors.muted}>  └ +{hidden} more</Text>
              </Box>
            )}
          </Box>
        );
      })}
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
