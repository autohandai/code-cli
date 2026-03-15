/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { ToolDefinition } from '../toolManager.js';
import type { AgentAction, ToolCallRequest, ExplorationEvent } from '../../types.js';
import { formatToolOutputForDisplay } from '../../ui/toolOutput.js';

/**
 * AgentFormatter module
 *
 * Extracted formatting utilities from AutohandAgent for better modularity.
 * Handles all text formatting, display formatting, and presentation logic.
 */

/**
 * Format a tool definition as a human-readable signature
 * Example: formatToolSignature({name: 'read_file', parameters: {properties: {path: {type: 'string'}}}})
 *          => "- read_file(path: string) - Read a file from disk"
 */
export function formatToolSignature(def: ToolDefinition): string {
  const params = def.parameters;
  if (!params || !params.properties || Object.keys(params.properties).length === 0) {
    return `- ${def.name}() - ${def.description}`;
  }

  const required = new Set(params.required ?? []);
  const args = Object.entries(params.properties)
    .map(([name, prop]) => {
      const optional = required.has(name) ? '' : '?';
      return `${name}${optional}: ${prop.type}`;
    })
    .join(', ');

  return `- ${def.name}(${args}) - ${def.description}`;
}

/**
 * Format exploration event kind as a display label
 */
export function formatExplorationLabel(kind: ExplorationEvent['kind']): string {
  switch (kind) {
    case 'read':
      return 'Read';
    case 'search':
      return 'Search';
    default:
      return 'List';
  }
}

/** Max items to show per group before collapsing in text output */
const MAX_VISIBLE_PER_GROUP = 4;

/**
 * Extract a short label from a tool call's args for grouped display.
 */
function getToolCallLabel(call?: ToolCallRequest): string {
  if (!call) return call?.tool ?? '';
  const args = call.args ?? {};
  if (args.path) return String(args.path);
  if (args.file_path) return String(args.file_path);
  if (args.command) {
    const cmd = String(args.command);
    const cmdArgs = Array.isArray(args.args) ? (args.args as string[]).join(' ') : '';
    return cmdArgs ? `${cmd} ${cmdArgs}` : cmd;
  }
  if (args.query) return String(args.query);
  if (args.pattern) return String(args.pattern);
  if (args.task) return String(args.task).slice(0, 60);
  for (const val of Object.values(args)) {
    if (typeof val === 'string' && val.length > 0) return val.slice(0, 80);
  }
  return call.tool;
}

/**
 * Format tool results as a single batched output string.
 * For 2+ results, groups same-type tools together with tree connectors.
 * This reduces flicker by consolidating multiple console.log calls into one.
 */
export function formatToolResultsBatch(
  results: Array<{ tool: AgentAction['type']; success: boolean; output?: string; error?: string }>,
  charLimit: number,
  toolCalls?: ToolCallRequest[],
  thought?: string
): string {
  const lines: string[] = [];

  // Show thought before first tool if present
  if (thought) {
    lines.push(chalk.white(thought));
    lines.push('');
  }

  // Single tool — keep original flat format
  if (results.length <= 1) {
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const content = result.success
        ? result.output ?? '(no output)'
        : result.error ?? result.output ?? 'Tool failed without error message';

      const call = toolCalls?.[i];
      const filePath = call?.args?.path as string | undefined;
      const command = call?.args?.command as string | undefined;
      const commandArgs = call?.args?.args as string[] | undefined;

      const display = result.success
        ? formatToolOutputForDisplay({ tool: result.tool, content, charLimit, filePath, command, commandArgs })
        : { output: content, truncated: false, totalChars: content.length };

      const icon = result.success ? chalk.green('✔') : chalk.red('✖');
      lines.push(`${icon} ${chalk.bold(result.tool)}`);

      if (content) {
        if (result.success) {
          lines.push(chalk.gray(display.output));
        } else {
          lines.push(chalk.red('┌─ Error ─────────────────────────────────'));
          lines.push(chalk.red('│ ') + chalk.white(content));
          lines.push(chalk.red('└─────────────────────────────────────────'));
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // Multiple tools — group by tool type with tree connectors
  interface GroupItem {
    label: string;
    detail: string;
    success: boolean;
    error?: string;
  }
  const groups = new Map<string, GroupItem[]>();
  const groupOrder: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const call = toolCalls?.[i];
    const content = result.success
      ? result.output ?? '(no output)'
      : result.error ?? result.output ?? 'Tool failed without error message';

    const filePath = call?.args?.path as string | undefined;
    const command = call?.args?.command as string | undefined;
    const commandArgs = call?.args?.args as string[] | undefined;

    const display = result.success
      ? formatToolOutputForDisplay({ tool: result.tool, content, charLimit, filePath, command, commandArgs })
      : { output: content, truncated: false, totalChars: content.length };

    const item: GroupItem = {
      label: getToolCallLabel(call),
      detail: display.output,
      success: result.success,
      error: result.success ? undefined : content
    };

    if (!groups.has(result.tool)) {
      groups.set(result.tool, []);
      groupOrder.push(result.tool);
    }
    groups.get(result.tool)!.push(item);
  }

  for (let gi = 0; gi < groupOrder.length; gi++) {
    const toolName = groupOrder[gi];
    const items = groups.get(toolName)!;
    const isLastGroup = gi === groupOrder.length - 1;
    const allSuccess = items.every(it => it.success);

    // Group header: ✔ read_file (3)
    const icon = allSuccess ? chalk.green('✔') : chalk.red('✖');
    const count = items.length > 1 ? chalk.dim(` (${items.length})`) : '';
    lines.push(`${icon} ${chalk.bold(toolName)}${count}`);

    const visible = items.slice(0, MAX_VISIBLE_PER_GROUP);
    const hidden = items.length - visible.length;

    for (let ii = 0; ii < visible.length; ii++) {
      const item = visible[ii];
      const isLast = ii === visible.length - 1 && hidden === 0;
      const connector = isLast && isLastGroup ? '  └ ' : '  ├ ';

      if (!item.success) {
        lines.push(chalk.dim(connector) + chalk.red(item.label));
        lines.push(chalk.red('    │ ') + item.error);
      } else {
        lines.push(chalk.dim(connector) + chalk.gray(item.label));
        // Show compact detail (first line only for file ops)
        const firstLine = item.detail.split('\n')[0];
        if (firstLine && firstLine !== item.label) {
          lines.push(chalk.dim('    ') + chalk.gray(firstLine));
        }
      }
    }

    if (hidden > 0) {
      const connector = isLastGroup ? '  └ ' : '  ├ ';
      lines.push(chalk.dim(connector) + chalk.dim(`+${hidden} more`));
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Truncate and normalize instruction text for display
 */
export function describeInstruction(instruction: string): string {
  const normalized = instruction.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return 'work';
  }
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized;
}

/**
 * Format elapsed time in minutes and seconds
 */
export function formatElapsedTime(startedAt: number): string {
  const diff = Date.now() - startedAt;
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/**
 * Format token count with 'k' suffix for thousands
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k tokens`;
  }
  return `${tokens} tokens`;
}
