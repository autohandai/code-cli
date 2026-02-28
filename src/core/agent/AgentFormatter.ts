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

/**
 * Format tool results as a single batched output string.
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
  // (parseAssistantReactPayload already extracted clean text from JSON)
  if (thought) {
    lines.push(chalk.white(thought));
    lines.push('');
  }

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const content = result.success
      ? result.output ?? '(no output)'
      : result.error ?? result.output ?? 'Tool failed without error message';

    // Extract args from tool call
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
        // Error box
        lines.push(chalk.red('┌─ Error ─────────────────────────────────'));
        lines.push(chalk.red('│ ') + chalk.white(content));
        lines.push(chalk.red('└─────────────────────────────────────────'));
      }
    }
    lines.push(''); // blank line between tools
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
