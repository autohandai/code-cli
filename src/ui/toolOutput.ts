/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AgentAction } from '../types.js';
import * as path from 'path';

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

/**
 * Format tool output for display - shows file summary for file ops, truncates for find/search
 */
export function formatToolOutputForDisplay(options: FileToolOutputOptions): ToolOutputDisplay {
  const { tool, content, charLimit, filePath, command, commandArgs } = options;
  const totalChars = content.length;

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
