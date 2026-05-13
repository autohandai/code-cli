/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext.js';
import { renderTerminalMarkdown } from '../../core/immediateCommandRouter.js';
import { stripAnsiCodes } from '../displayUtils.js';

export interface ToolOutputEntry {
  id: string;
  type?: 'single';
  tool: string;
  success: boolean;
  output: string;
  timestamp: number;
  /** Internal model reasoning captured with the tool call; not rendered in completed history. */
  thought?: string;
}

export interface LiveCommandEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  startedAt: number;
  isExpanded: boolean;
}

const LIVE_COMMAND_COLLAPSED_LINES = 5;

function getVisibleTail(text: string, maxLines: number): { lines: string[]; hiddenLineCount: number } {
  const normalized = text.trimEnd();
  if (!normalized) {
    return { lines: [], hiddenLineCount: 0 };
  }

  const lines = normalized.split('\n');
  if (lines.length <= maxLines) {
    return { lines, hiddenLineCount: 0 };
  }

  return {
    lines: lines.slice(-maxLines),
    hiddenLineCount: lines.length - maxLines,
  };
}

function getLines(text: string): string[] {
  const normalized = text.trimEnd();
  return normalized ? normalized.split('\n') : [];
}

function isDiffTool(tool: string): boolean {
  return tool === 'git_diff' || tool === 'git_diff_range';
}

function getDiffLineColor(
  line: string,
  colors: ReturnType<typeof useTheme>['colors']
): string {
  const trimmed = line.trimStart();

  if (trimmed.startsWith('+') && !trimmed.startsWith('+++')) {
    return colors.diffAdded;
  }
  if (trimmed.startsWith('-') && !trimmed.startsWith('---')) {
    return colors.diffRemoved;
  }
  if (trimmed.startsWith('@@') || trimmed.startsWith('diff --git')) {
    return colors.accent;
  }
  return colors.diffContext;
}

function ThemedDiffOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const plainLines = getLines(stripAnsiCodes(output));

  return (
    <Box flexDirection="column">
      {plainLines.map((line, index) => (
        <Text key={`${index}-${line}`} color={getDiffLineColor(line, colors)}>
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

function getCollapsedLiveCommandViews(
  stdout: string,
  stderr: string,
  maxLines: number
): {
  stdoutView: { lines: string[]; hiddenLineCount: number };
  stderrView: { lines: string[]; hiddenLineCount: number };
} {
  const stdoutLines = getLines(stdout);
  const stderrLines = getLines(stderr);
  const totalLines = stdoutLines.length + stderrLines.length;

  if (totalLines <= maxLines) {
    return {
      stdoutView: { lines: stdoutLines, hiddenLineCount: 0 },
      stderrView: { lines: stderrLines, hiddenLineCount: 0 },
    };
  }

  if (stdoutLines.length === 0) {
    return {
      stdoutView: { lines: [], hiddenLineCount: 0 },
      stderrView: getVisibleTail(stderr, maxLines),
    };
  }

  if (stderrLines.length > 0) {
    return {
      stdoutView: { lines: [], hiddenLineCount: stdoutLines.length },
      stderrView: getVisibleTail(stderr, maxLines),
    };
  }

  return {
    stdoutView: getVisibleTail(stdout, maxLines),
    stderrView: { lines: [], hiddenLineCount: 0 },
  };
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
  const { tool, success, output } = entry;

  const renderedOutput = output ? renderTerminalMarkdown(output) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          isDiffTool(tool)
            ? <ThemedDiffOutput output={output} />
            : <Text color={colors.toolOutput}>{renderedOutput}</Text>
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
 *
 * Memoized so it does not re-execute when parent re-renders on resize.
 */
function ToolOutputStaticComponent({ entry }: ToolOutputProps) {
  const { colors } = useTheme();
  const { tool, success, output } = entry;

  const renderedOutput = output ? renderTerminalMarkdown(output) : '';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={success ? colors.success : colors.error}>{success ? '✔' : '✖'}</Text>
        <Text bold> {tool}</Text>
      </Box>
      {output && (
        success ? (
          isDiffTool(tool)
            ? <ThemedDiffOutput output={output} />
            : <Text color={colors.toolOutput}>{renderedOutput}</Text>
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

export const ToolOutputStatic = memo(ToolOutputStaticComponent, (prev, next) =>
  prev.entry.id === next.entry.id &&
  prev.entry.output === next.entry.output &&
  prev.entry.thought === next.entry.thought
);

/** Max items to show per group before collapsing */
const MAX_VISIBLE_PER_GROUP = 4;

/**
 * Renders a grouped batch of parallel tool calls.
 * Groups same-type tools together with tree-style connectors.
 *
 * Memoized so it does not re-execute when parent re-renders on resize.
 */
function ToolOutputBatchStaticComponent({ entry }: { entry: ToolOutputBatchEntry }) {
  const { colors } = useTheme();
  const { groups } = entry;

  return (
    <Box flexDirection="column" marginBottom={1}>
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
              const shouldRenderDiffDetail = item.detail && isDiffTool(item.tool);
              return (
                <Box key={`${item.label}-${ii}`} flexDirection="column">
                  <Box>
                    <Text color={colors.muted}>{connector}</Text>
                    <Text color={item.success ? colors.toolOutput : colors.error}>
                      {renderTerminalMarkdown(item.label)}
                    </Text>
                    {item.detail && !shouldRenderDiffDetail && (
                      <Text color={colors.muted}> — {renderTerminalMarkdown(item.detail)}</Text>
                    )}
                  </Box>
                  {shouldRenderDiffDetail && (
                    <Box marginLeft={4}>
                      <ThemedDiffOutput output={item.detail ?? ''} />
                    </Box>
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

export const ToolOutputBatchStatic = memo(ToolOutputBatchStaticComponent, (prev, next) =>
  prev.entry.id === next.entry.id &&
  prev.entry.thought === next.entry.thought &&
  prev.entry.groups.length === next.entry.groups.length
);

export interface ToolOutputListProps {
  entries: ToolOutputEntry[];
  maxVisible?: number;
}

/**
 * @deprecated Use ToolOutputStatic directly in AgentUI instead
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

export function LiveCommandBlock({ entry }: { entry: LiveCommandEntry }) {
  const { colors } = useTheme();
  const { stdoutView, stderrView } = entry.isExpanded
    ? {
      stdoutView: { lines: getLines(entry.stdout), hiddenLineCount: 0 },
      stderrView: { lines: getLines(entry.stderr), hiddenLineCount: 0 },
    }
    : getCollapsedLiveCommandViews(entry.stdout, entry.stderr, LIVE_COMMAND_COLLAPSED_LINES);
  const hiddenLineCount = stdoutView.hiddenLineCount + stderrView.hiddenLineCount;
  const hint = entry.isExpanded ? 'Ctrl+O collapse' : 'Ctrl+O expand';
  const hasVisibleOutput = stdoutView.lines.length > 0 || stderrView.lines.length > 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={colors.accent}>●</Text>
        <Text bold> Running {entry.command}</Text>
      </Box>
      {hiddenLineCount > 0 ? (
        <Text color={colors.muted}>showing last {stdoutView.lines.length + stderrView.lines.length} lines · {hint}</Text>
      ) : (
        <Text color={colors.muted}>{hint}</Text>
      )}
      <Box flexDirection="column" borderStyle="single" borderColor={colors.borderMuted} paddingX={1}>
        {hasVisibleOutput ? (
          <>
            {stdoutView.lines.length > 0 ? (
              <Text color={colors.toolOutput}>{renderTerminalMarkdown(stdoutView.lines.join('\n'))}</Text>
            ) : null}
            {stderrView.lines.length > 0 ? (
              <Box flexDirection="column">
                <Text color={colors.error}>stderr</Text>
                <Text color={colors.error}>{renderTerminalMarkdown(stderrView.lines.join('\n'))}</Text>
              </Box>
            ) : null}
          </>
        ) : (
          <Text color={colors.muted}>No output yet</Text>
        )}
      </Box>
    </Box>
  );
}
