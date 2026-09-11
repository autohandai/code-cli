/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface InlineThinkingSplit {
  /** The answer with any leading think block removed. */
  content: string;
  /** The think block's text, when the content opened with one. */
  reasoning?: string;
}

/**
 * Reasoning models such as moa emit their thinking inline as
 * `<think>…</think>` ahead of the answer instead of a separate reasoning
 * field. Splitting it out lets the show-thinking setting decide whether the
 * user sees it; otherwise the tags and the draft print as part of the reply.
 * A block cut off by the output budget is still thinking, so it never leaks.
 */
const LEADING_THINK_BLOCK = /^\s*<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)([\s\S]*)$/i;

export function splitInlineThinking(content: string): InlineThinkingSplit {
  const match = LEADING_THINK_BLOCK.exec(content);
  if (!match) {
    return { content };
  }
  const reasoning = match[2].trim();
  return {
    content: match[3].trim(),
    ...(reasoning ? { reasoning } : {}),
  };
}

export function joinReasoning(...parts: Array<string | undefined>): string | undefined {
  const joined = parts.map((part) => part?.trim()).filter(Boolean).join('\n\n');
  return joined || undefined;
}
