/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentAction } from '../types.js';
import * as path from 'path';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

/** Tools that should show file summary instead of content */
const FILE_SUMMARY_TOOLS = new Set<AgentAction['type']>([
  'read_file',
]);

/** Tools that should show truncated content */
const TRUNCATED_TOOLS = new Set<AgentAction['type']>([
  'find',
  'glob'
]);

const MAX_EXPANDED_TOOL_OUTPUT_CHARS = 64 * 1024;

/** How tool results are shown in the transcript: a short preview, or everything. */
export type ToolOutputMode = 'compact' | 'full';
export const TOOL_OUTPUT_MODES: readonly ToolOutputMode[] = ['compact', 'full'];
export const DEFAULT_TOOL_OUTPUT_MODE: ToolOutputMode = 'compact';

export const COMPACT_PREVIEW_LINES = 3;
/** A failure is previewed from its end, where the error usually is, and gets a little more room. */
export const COMPACT_FAILURE_PREVIEW_LINES = 5;
export const COMPACT_LINE_CHARS = 160;

function boundExpandedOutput(content: string): string {
  if (content.length <= MAX_EXPANDED_TOOL_OUTPUT_CHARS) return content;
  const marker = `\n... (details truncated, ${content.length} total characters)`;
  return `${content.slice(0, MAX_EXPANDED_TOOL_OUTPUT_CHARS - marker.length)}${marker}`;
}

function formatAskFollowupAnswer(content: string): string {
  const trimmed = content.trim();
  const answerMatch = trimmed.match(/^<answer>([\s\S]*)<\/answer>$/);
  const answer = (answerMatch?.[1] ?? trimmed).trim() || 'No answer provided';
  return `Answer: ${answer}`;
}

export interface ToolOutputDisplay {
  output: string;
  truncated: boolean;
  totalChars: number;
  /** Bounded detail retained for an explicit user expansion gesture. */
  expandedOutput?: string;
}

export interface FileToolOutputOptions {
  tool: AgentAction['type'];
  content: string;
  charLimit: number;
  /** `compact` shows a few lines and keeps the rest for expansion. Defaults to `full`. */
  mode?: ToolOutputMode;
  /** The tool failed: `content` is its error, previewed from the end. */
  failed?: boolean;
  /** File path for file operations */
  filePath?: string;
  /** Command for run_command or shell tool */
  command?: string;
  /** Args for run_command or shell tool */
  commandArgs?: string[];
}

/**
 * Format file size in human readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Count lines in content
 */
function countLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

function contentLines(content: string): string[] {
  return content.replace(/^(?:[ \t]*\r?\n)+/u, '').trimEnd().split(/\r?\n/u);
}

/**
 * How many lines of the expanded text a preview leaves out. Only a preview made
 * of the expanded text's own lines counts; a summary written about the detail
 * ("3 matching tools") hides nothing that can be counted, so the answer is 0.
 */
export function hiddenLineCount(shown: string, expanded: string): number {
  if (!shown) return 0;
  const expandedLines = contentLines(expanded);
  const available = new Set(expandedLines);
  const shownLines = shown.split(/\r?\n/u);
  if (!shownLines.every((line) => available.has(line))) return 0;
  return Math.max(0, expandedLines.length - shownLines.length);
}

function clipLine(line: string): string {
  if (stringWidth(line) <= COMPACT_LINE_CHARS) return line;
  const firstLine = wrapAnsi(line, COMPACT_LINE_CHARS - 1, { hard: true, wordWrap: false, trim: false }).split('\n')[0];
  return `${firstLine}…`;
}

/**
 * Cuts content down to a few lines for the transcript. `kept` is what stays
 * visible; `complete` says whether that is everything there was.
 */
function previewLines(content: string, from: 'head' | 'tail'): { kept: string[]; complete: boolean } {
  const lines = contentLines(content);
  const kept = from === 'head'
    ? lines.slice(0, COMPACT_PREVIEW_LINES)
    : lines.slice(-COMPACT_FAILURE_PREVIEW_LINES);
  const clipped = kept.map(clipLine);
  return {
    kept: clipped,
    complete: kept.length === lines.length && clipped.every((line, index) => line === kept[index]),
  };
}

function compactDisplay(content: string, header: string | undefined, from: 'head' | 'tail'): ToolOutputDisplay {
  const totalChars = content.length;
  const body = header && content.startsWith(header) ? content.slice(header.length) : content;
  const preview = previewLines(body, from);
  const backgroundPidLine = body.match(/(?:^|\n)(\[Background PID: \d+\])\s*$/)?.[1];
  const shown = [
    ...(header ? [header] : []),
    ...preview.kept.filter((line) => line.length > 0 || preview.kept.length > 1),
    ...(backgroundPidLine && !preview.kept.includes(backgroundPidLine) ? [backgroundPidLine] : []),
  ];
  return {
    output: shown.join('\n'),
    truncated: !preview.complete,
    totalChars,
    ...(preview.complete ? {} : { expandedOutput: boundExpandedOutput(content) }),
  };
}

interface ScriptReport {
  result: unknown;
  logs: string;
  calls: { total: number; failed: number; byTool: Record<string, number> };
  durationMs: number;
}

function parseScriptReport(content: string): ScriptReport | null {
  try {
    const parsed = JSON.parse(content) as Partial<ScriptReport> | null;
    const calls = parsed?.calls;
    if (!parsed || typeof calls?.total !== 'number' || typeof calls.byTool !== 'object' || calls.byTool === null) {
      return null;
    }
    return {
      result: parsed.result,
      logs: typeof parsed.logs === 'string' ? parsed.logs : '',
      calls: { total: calls.total, failed: typeof calls.failed === 'number' ? calls.failed : 0, byTool: calls.byTool },
      durationMs: typeof parsed.durationMs === 'number' ? parsed.durationMs : 0,
    };
  } catch {
    return null;
  }
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

/** A script's result is a report about many tool calls: lead with what it did, then what it returned. */
function scriptReportDisplay(report: ScriptReport, totalChars: number, compact: boolean): ToolOutputDisplay {
  const { total, failed, byTool } = report.calls;
  const breakdown = Object.entries(byTool)
    .sort(([, left], [, right]) => right - left)
    .map(([tool, count]) => `${tool} ×${count}`)
    .join(', ');
  const header = [
    total === 0 ? 'no tool calls' : `${total} tool ${total === 1 ? 'call' : 'calls'} (${breakdown})${failed > 0 ? `, ${failed} failed` : ''}`,
    formatDuration(report.durationMs),
  ].join(' · ');
  const answer = typeof report.result === 'string' ? report.result : JSON.stringify(report.result, null, 2) ?? 'null';
  const everything = [header, answer, ...(report.logs ? ['', 'Logs:', report.logs] : [])].join('\n');

  if (!compact) {
    return { output: everything, truncated: false, totalChars };
  }
  const preview = previewLines(answer, 'head');
  const complete = preview.complete && !report.logs;
  return {
    output: [header, ...preview.kept].join('\n'),
    truncated: !complete,
    totalChars,
    ...(complete ? {} : { expandedOutput: boundExpandedOutput(everything) }),
  };
}

/**
 * Format tool output for display - shows file summary for file ops, truncates for find/search
 */
export function formatToolOutputForDisplay(options: FileToolOutputOptions): ToolOutputDisplay {
  const { tool, content, charLimit, filePath, command, commandArgs } = options;
  const totalChars = content.length;
  const compact = options.mode === 'compact';

  if (compact && options.failed) {
    return compactDisplay(content, undefined, 'tail');
  }

  if (tool === 'run_tool_script' && !options.failed) {
    const report = parseScriptReport(content);
    if (report) {
      return scriptReportDisplay(report, totalChars, compact);
    }
  }

  if (tool === 'ask_followup_question') {
    return {
      output: formatAskFollowupAnswer(content),
      truncated: false,
      totalChars
    };
  }

  // For run_command and shell, show the command being executed
  if ((tool === 'run_command' || tool === 'shell') && command) {
    const fullCommand = commandArgs?.length
      ? `${command} ${commandArgs.join(' ')}`
      : command;
    if (compact) {
      return compactDisplay(content, `$ ${fullCommand}`, 'head');
    }
    const outputLines = content ? content.split('\n').length : 0;
    const backgroundPidLine = content.match(/(?:^|\n)(\[Background PID: \d+\])\s*$/)?.[1];
    const truncatedContent = charLimit > 0 && totalChars > charLimit
      ? [
          `${content.slice(0, charLimit)}\n... (${totalChars} chars)`,
          backgroundPidLine && !content.slice(0, charLimit).includes(backgroundPidLine)
            ? backgroundPidLine
            : '',
        ].filter(Boolean).join('\n')
      : content;

    return {
      output: `$ ${fullCommand}${truncatedContent ? `\n${truncatedContent}` : outputLines > 0 ? `\n(${outputLines} lines)` : ''}`,
      truncated: totalChars > charLimit,
      totalChars
    };
  }

  // For file operations, show summary (filename, lines, size)
  if (FILE_SUMMARY_TOOLS.has(tool) && filePath) {
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath);
    const displayPath = dirName === '.' ? fileName : `${path.basename(dirName)}/${fileName}`;
    const lines = countLines(content);
    const size = formatFileSize(Buffer.byteLength(content, 'utf8'));

    return {
      output: `${displayPath}\n  ${lines} lines - ${size}`,
      truncated: false,
      totalChars
    };
  }

  // Discovery payloads are useful on demand, but overwhelm the transcript by default.
  if (tool === 'tools_registry' || tool === 'tool_search') {
    try {
      const parsed = JSON.parse(content) as Array<{ source?: string }>;
      if (!Array.isArray(parsed)) throw new TypeError('Expected a tool array');
      const total = parsed.length;
      if (tool === 'tool_search') {
        return {
          output: `${total} matching ${total === 1 ? 'tool' : 'tools'}`,
          truncated: false,
          totalChars,
          expandedOutput: boundExpandedOutput(content),
        };
      }
      const builtin = parsed.filter(t => t.source === 'builtin').length;
      const meta = total - builtin;
      const parts = [`${total} tools`];
      if (builtin > 0) parts.push(`${builtin} builtin`);
      if (meta > 0) parts.push(`${meta} meta`);
      return {
        output: parts.join(', '),
        truncated: false,
        totalChars,
        expandedOutput: boundExpandedOutput(content),
      };
    } catch {
      // Malformed JSON — fall through to default
    }
  }

  if (compact) {
    return compactDisplay(content, undefined, 'head');
  }

  // For find/search tools, show truncated content
  if (TRUNCATED_TOOLS.has(tool) && charLimit > 0 && totalChars > charLimit) {
    return {
      output: `${content.slice(0, charLimit)}\n... (truncated, ${totalChars} total characters)`,
      truncated: true,
      totalChars
    };
  }

  // Default: show full content
  return { output: content, truncated: false, totalChars };
}
