/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { memo, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { parsePatch } from 'diff';
import { useTheme } from '../theme/ThemeContext.js';
import type { ResolvedColors } from '../theme/types.js';
import { hexToRgb } from '../theme/Theme.js';
import { renderTerminalMarkdown } from '../../core/immediateCommandRouter.js';
import { stripAnsiCodes } from '../displayUtils.js';
import { parseWorkspaceChangeSet } from '../../core/agent/WorkspaceChangeCapture.js';

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
  colors: ResolvedColors
): string {
  const trimmed = line.trimStart();

  if (trimmed.startsWith('+') && !trimmed.startsWith('+++')) {
    return colors.diffAdded;
  }
  if (trimmed.startsWith('-') && !trimmed.startsWith('---')) {
    return colors.diffRemoved;
  }
  if (
    trimmed.startsWith('@@') ||
    trimmed.startsWith('diff --git') ||
    trimmed.startsWith('index ') ||
    trimmed.startsWith('---') ||
    trimmed.startsWith('+++')
  ) {
    return colors.accent;
  }
  return colors.diffContext;
}

function foregroundAnsi(color: string): string {
  if (!color) {
    return '';
  }

  const rgb = color.startsWith('#') ? hexToRgb(color) : null;
  if (rgb) {
    return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
  }

  const index = Number(color);
  if (Number.isInteger(index) && index >= 0 && index <= 255) {
    return `\x1b[38;5;${index}m`;
  }

  return '';
}

function backgroundAnsi(color: string): string {
  if (!color) return '';
  const rgb = color.startsWith('#') ? hexToRgb(color) : null;
  if (rgb) {
    return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
  }
  const index = Number(color);
  return Number.isInteger(index) && index >= 0 && index <= 255
    ? `\x1b[48;5;${index}m`
    : '';
}

function applyForeground(color: string, text: string): string {
  const ansi = foregroundAnsi(color);
  return ansi ? `${ansi}${text}\x1b[39m` : text;
}

function applyDiffBackground(
  background: string,
  text: string,
  foreground?: 'black' | 'white'
): string {
  const backgroundCode = backgroundAnsi(background);
  if (!backgroundCode) return text;
  const foregroundCode = foreground === 'black'
    ? '\x1b[30m'
    : foreground === 'white'
      ? '\x1b[37m'
      : '';
  return `${backgroundCode}${foregroundCode}${text}\x1b[39m\x1b[49m`;
}

function renderDiffStatsLine(line: string, colors: ResolvedColors): string | null {
  const match = line.trim().match(/^Added (.+), removed (.+)$/);
  if (!match) {
    return null;
  }

  return [
    applyForeground(colors.diffContext, '  Added '),
    applyForeground(colors.diffAdded, match[1]),
    applyForeground(colors.diffContext, ', removed '),
    applyForeground(colors.diffRemoved, match[2]),
  ].join('');
}

function renderDiffGutter(
  marker: string,
  line: string,
  color: string
): string {
  return applyForeground(color, `  ${marker} ${line || ' '}`);
}

function renderThemedDiffLine(line: string, colors: ResolvedColors): string {
  const statsLine = renderDiffStatsLine(line, colors);
  if (statsLine) {
    return statsLine;
  }

  const trimmed = line.trimStart();

  if (trimmed.startsWith('diff --git')) {
    return renderDiffGutter('┌', line, colors.accent);
  }
  if (trimmed.startsWith('@@')) {
    return renderDiffGutter('├', line, colors.accent);
  }
  if (
    trimmed.startsWith('index ') ||
    trimmed.startsWith('new file') ||
    trimmed.startsWith('deleted file') ||
    trimmed.startsWith('---') ||
    trimmed.startsWith('+++')
  ) {
    return renderDiffGutter('│', line, colors.accent);
  }
  if (trimmed.startsWith('+') && !trimmed.startsWith('+++')) {
    return renderDiffGutter('│', line, colors.diffAdded);
  }
  if (trimmed.startsWith('-') && !trimmed.startsWith('---')) {
    return renderDiffGutter('│', line, colors.diffRemoved);
  }

  return renderDiffGutter('│', line, getDiffLineColor(line, colors));
}

export function ThemedDiffOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const plainLines = getLines(stripAnsiCodes(output));

  return (
    <Box flexDirection="column">
      {plainLines.map((line, index) => (
        <Text key={`${index}-${line}`}>{renderThemedDiffLine(line, colors)}</Text>
      ))}
    </Box>
  );
}

function workspaceChangeLabel(kind: 'added' | 'modified' | 'deleted'): string {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'modified':
      return 'Edited';
  }
}

interface NumberedDiffRow {
  type: 'add' | 'remove' | 'context' | 'separator';
  content: string;
  lineNumber?: number;
}

function parseNumberedDiffRows(patch: string): NumberedDiffRow[] | null {
  try {
    const parsed = parsePatch(patch);
    const rows: NumberedDiffRow[] = [];
    let renderedHunks = 0;

    for (const file of parsed) {
      for (const hunk of file.hunks) {
        if (renderedHunks > 0) {
          rows.push({ type: 'separator', content: '' });
        }
        renderedHunks += 1;
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        for (const line of hunk.lines) {
          const marker = line[0];
          const content = line.slice(1);
          if (marker === '+') {
            rows.push({ type: 'add', content, lineNumber: newLine });
            newLine += 1;
          } else if (marker === '-') {
            rows.push({ type: 'remove', content, lineNumber: oldLine });
            oldLine += 1;
          } else if (marker === ' ') {
            rows.push({ type: 'context', content, lineNumber: newLine });
            oldLine += 1;
            newLine += 1;
          }
        }
      }
    }

    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

function dimDiffBackground(color: string, type: 'add' | 'remove'): string {
  const rgb = color.startsWith('#') ? hexToRgb(color) : null;
  if (!rgb) return type === 'add' ? '#1e321e' : '#3c1e1e';
  const factors = type === 'add'
    ? { red: 0.15, green: 0.2, blue: 0.15 }
    : { red: 0.25, green: 0.15, blue: 0.15 };
  const toHex = (value: number) => Math.floor(value).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r * factors.red)}${toHex(rgb.g * factors.green)}${toHex(rgb.b * factors.blue)}`;
}

function NumberedWorkspaceDiff({ patch }: { patch: string }) {
  const { colors } = useTheme();
  const { stdout } = useStdout();
  const rows = useMemo(() => parseNumberedDiffRows(patch), [patch]);

  if (!rows) {
    return <ThemedDiffOutput output={patch} />;
  }

  const lineNumberWidth = Math.max(
    3,
    ...rows.map((row) => String(row.lineNumber ?? '').length)
  );
  const columns = stdout?.columns ?? process.stdout.columns ?? 100;
  const contentWidth = Math.max(20, columns - lineNumberWidth - 6);
  const addedBackground = dimDiffBackground(colors.diffAdded, 'add');
  const removedBackground = dimDiffBackground(colors.diffRemoved, 'remove');

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        if (row.type === 'separator') {
          return <Text key={`separator-${index}`} color={colors.muted}>  {'⋮'.padStart(lineNumberWidth)}</Text>;
        }

        const lineNumber = String(row.lineNumber ?? '').padStart(lineNumberWidth);
        if (row.type === 'context') {
          return (
            <Box key={`context-${index}`}>
              <Text color={colors.diffContext}>{` ${lineNumber}   `}</Text>
              <Text wrap="truncate"> {row.content}</Text>
            </Box>
          );
        }

        const isAdded = row.type === 'add';
        const marker = isAdded ? '+' : '-';
        const markerBackground = isAdded ? colors.diffAdded : colors.diffRemoved;
        const contentBackground = isAdded ? addedBackground : removedBackground;
        const content = ` ${row.content} `.padEnd(contentWidth);
        return (
          <Box key={`${row.type}-${index}`}>
            <Text>{applyDiffBackground(markerBackground, ` ${lineNumber} ${marker} `, isAdded ? 'black' : 'white')}</Text>
            <Text wrap="truncate">{applyDiffBackground(contentBackground, content)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function WorkspaceChangesOutput({ output }: { output: string }) {
  const { colors } = useTheme();
  const changeSet = parseWorkspaceChangeSet(output);

  if (!changeSet) {
    return <Text color={colors.toolOutput}>{renderTerminalMarkdown(output)}</Text>;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {changeSet.files.map((file) => (
        <Box key={`${file.kind}-${file.path}`} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={colors.muted}>• </Text>
            <Text bold>{workspaceChangeLabel(file.kind)} {file.path}</Text>
            {file.binary ? (
              <Text color={colors.muted}> (binary)</Text>
            ) : (
              <>
                <Text color={colors.diffAdded}> (+{file.additions ?? 0}</Text>
                <Text color={colors.diffRemoved}> -{file.deletions ?? 0})</Text>
              </>
            )}
          </Box>
          {file.patch ? <NumberedWorkspaceDiff patch={file.patch} /> : null}
        </Box>
      ))}
      {changeSet.omittedFiles > 0 ? (
        <Text color={colors.muted}>  +{changeSet.omittedFiles} more changed files</Text>
      ) : null}
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

  if (tool === 'workspace_changes') {
    return <WorkspaceChangesOutput output={output} />;
  }

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

  if (tool === 'workspace_changes') {
    return <WorkspaceChangesOutput output={output} />;
  }

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
