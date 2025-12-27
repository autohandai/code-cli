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
  'write_file',
  'append_file',
  'apply_patch',
  'search_replace',
  'multi_file_edit'
]);

/** Tools that should show truncated content */
const TRUNCATED_TOOLS = new Set<AgentAction['type']>([
  'search',
  'search_with_context',
  'semantic_search'
]);

export interface ToolOutputDisplay {
  output: string;
  truncated: boolean;
  totalChars: number;
}

export interface FileToolOutputOptions {
  tool: AgentAction['type'];
  content: string;
  charLimit: number;
  /** File path for file operations */
  filePath?: string;
  /** Command for run_command tool */
  command?: string;
  /** Args for run_command tool */
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
 * Format tool output for display - shows file summary for file ops, truncates for search
 */
export function formatToolOutputForDisplay(options: FileToolOutputOptions): ToolOutputDisplay {
  const { tool, content, charLimit, filePath, command, commandArgs } = options;
  const totalChars = content.length;

  // For run_command, show the command being executed
  if (tool === 'run_command' && command) {
    const fullCommand = commandArgs?.length
      ? `${command} ${commandArgs.join(' ')}`
      : command;
    const outputLines = content ? content.split('\n').length : 0;
    const truncatedContent = charLimit > 0 && totalChars > charLimit
      ? `${content.slice(0, charLimit)}\n... (${totalChars} chars)`
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

  // For search tools, show truncated content
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
