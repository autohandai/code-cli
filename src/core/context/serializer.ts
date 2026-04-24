/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Message → text serialization for summarization prompts.
 * Converts LLMMessage[] into a plain-text conversation log that
 * prevents the LLM from treating it as a conversation to continue.
 */
import type { LLMMessage } from '../../types.js';

/** Maximum length for tool result content in the serialized log (pi-mono style). */
const TOOL_RESULT_MAX_LENGTH = 2000;

/**
 * Serialize an array of LLM messages into a plain-text conversation log
 * suitable for inclusion in a summarization prompt.
 *
 * Format:
 *   [User]: message text
 *   [Assistant thinking]: reasoning
 *   [Assistant]: response
 *   [Assistant tool calls]: read_file(path="..."); write_file(path="...")
 *   [Tool result (read_file)]: output text
 */
export function serializeMessagesForSummary(messages: LLMMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case 'system':
        // Skip system messages — they're boilerplate, not conversation
        break;

      case 'user':
        lines.push(`[User]: ${msg.content ?? ''}`);
        break;

      case 'assistant': {
        // Check for thinking content (some providers include it)
        const content = msg.content ?? '';

        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const callDescriptions = msg.tool_calls.map(tc => {
            const args = tc.function.arguments ?? '{}';
            let shortArgs = args;
            try {
              const parsed = JSON.parse(args);
              // Show just the key params for readability
              const keys = Object.keys(parsed);
              const preview = keys.slice(0, 3).map(k => `${k}="${String(parsed[k]).slice(0, 80)}"`).join(', ');
              shortArgs = keys.length > 3 ? `${preview}, +${keys.length - 3} more` : preview;
            } catch {
              shortArgs = args.slice(0, 100);
            }
            return `${tc.function.name}(${shortArgs})`;
          }).join('; ');

          if (content) {
            lines.push(`[Assistant]: ${content.slice(0, 500)}`);
          }
          lines.push(`[Assistant tool calls]: ${callDescriptions}`);
        } else {
          lines.push(`[Assistant]: ${content.slice(0, 500)}`);
        }
        break;
      }

      case 'tool': {
        const toolName = msg.name ?? 'unknown';
        const rawContent = msg.content ?? '';
        const truncated = rawContent.length > TOOL_RESULT_MAX_LENGTH
          ? rawContent.slice(0, Math.floor(TOOL_RESULT_MAX_LENGTH * 0.6))
            + `\n... [${rawContent.length - TOOL_RESULT_MAX_LENGTH} chars truncated] ...\n`
            + rawContent.slice(-Math.floor(TOOL_RESULT_MAX_LENGTH * 0.3))
          : rawContent;
        lines.push(`[Tool result (${toolName})]: ${truncated}`);
        break;
      }
    }
  }

  return lines.join('\n');
}
