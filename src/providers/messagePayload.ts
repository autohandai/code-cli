/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Outbound message normalization for OpenAI-compatible chat endpoints.
 *
 * Aggregators forward conversation history to the upstream provider largely
 * unchanged, so shapes OpenAI tolerates but Anthropic rejects surface as an
 * opaque `400 Provider returned error`. Context compaction, cropping, and
 * interrupted turns all leave history in one of those shapes, so it is repaired
 * on the way out rather than depended upon upstream.
 */

import type { LLMMessage } from "../types.js";

export const EMPTY_TOOL_RESULT_PLACEHOLDER = "(no output)";
export const UNANSWERED_TOOL_CALL_PLACEHOLDER =
  "Tool result unavailable — this call was dropped from the conversation history.";

export interface NormalizeOutboundMessagesOptions {
  /**
   * Convert message content for this transport, e.g. flattening multimodal
   * parts to text when the target model has no image input. Defaults to
   * passing content through unchanged.
   */
  transformContent?: (content: LLMMessage["content"]) => unknown;
  /**
   * How to handle a tool result whose tool call is no longer in history.
   * `drop` (default) removes it; `recover` re-homes it so its content survives.
   */
  orphanedToolResults?: "drop" | "recover";
  /** Builds the replacement message when `orphanedToolResults` is `recover`. */
  recoverOrphanedToolResult?: (message: LLMMessage) => Record<string, unknown>;
}

export function isBlankContent(content: unknown): boolean {
  if (typeof content === "string") {
    return !content.trim();
  }
  if (Array.isArray(content)) {
    return content.length === 0;
  }
  return content === null || content === undefined;
}

function toOutboundMessage(
  message: LLMMessage,
  transformContent: (content: LLMMessage["content"]) => unknown,
): Record<string, unknown> {
  const outbound: Record<string, unknown> = {
    role: message.role,
    content: transformContent(message.content),
  };

  if (message.role === "tool" && message.tool_call_id) {
    outbound.tool_call_id = message.tool_call_id;
  }

  if (message.role === "assistant" && message.tool_calls?.length) {
    outbound.tool_calls = message.tool_calls;
    // OpenAI-shaped clients send `null`, not `""`, for a tool-only assistant
    // turn. Aggregators translate an empty string into an empty text block,
    // which Anthropic rejects as a malformed request.
    if (isBlankContent(outbound.content)) {
      outbound.content = null;
    }
  }

  if (message.role === "tool" && isBlankContent(outbound.content)) {
    outbound.content = EMPTY_TOOL_RESULT_PLACEHOLDER;
  }

  // Some providers use `name` for tool/function context.
  if (message.name) {
    outbound.name = message.name;
  }

  return outbound;
}

/**
 * Repair conversation history into a payload every upstream provider accepts:
 *
 * - blank turns that carry neither text nor tool calls are dropped
 * - blank tool results become a placeholder rather than an empty content block
 * - tool results with no matching tool call are dropped (or recovered)
 * - tool calls whose results were cropped away get a synthetic result
 * - the conversation never opens on an assistant turn
 */
export function normalizeOutboundMessages(
  messages: LLMMessage[],
  options: NormalizeOutboundMessagesOptions = {},
): Record<string, unknown>[] {
  const transformContent = options.transformContent ?? ((content) => content);
  const knownToolCallIds = new Set<string>();
  const answeredToolCallIds = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        if (call.id) knownToolCallIds.add(call.id);
      }
    }
    if (message.role === "tool" && message.tool_call_id) {
      answeredToolCallIds.add(message.tool_call_id);
    }
  }

  const outbound: Record<string, unknown>[] = [];
  const emittedToolCallIds = new Set<string>();
  // Synthetic results are appended after the turn's real results so the
  // recovered history still reads in the order the tools actually ran.
  let backfill: Record<string, unknown>[] = [];
  const flushBackfill = (): void => {
    if (backfill.length) {
      outbound.push(...backfill);
      backfill = [];
    }
  };

  for (const message of messages) {
    if (message.role === "tool") {
      const isOrphaned = !message.tool_call_id || !knownToolCallIds.has(message.tool_call_id);
      if (!isOrphaned) {
        outbound.push(toOutboundMessage(message, transformContent));
        continue;
      }
      if (options.orphanedToolResults !== "recover" || isBlankContent(message.content)) {
        continue;
      }
      flushBackfill();
      outbound.push(
        options.recoverOrphanedToolResult?.(message) ?? {
          role: "system",
          content: String(message.content),
        },
      );
      continue;
    }

    flushBackfill();

    const hasToolCalls = message.role === "assistant" && Boolean(message.tool_calls?.length);
    if (!hasToolCalls && isBlankContent(message.content)) {
      continue;
    }

    outbound.push(toOutboundMessage(message, transformContent));

    if (!hasToolCalls) {
      continue;
    }
    for (const call of message.tool_calls ?? []) {
      if (!call.id || emittedToolCallIds.has(call.id)) continue;
      emittedToolCallIds.add(call.id);
      if (answeredToolCallIds.has(call.id)) continue;
      backfill.push({
        role: "tool",
        tool_call_id: call.id,
        content: UNANSWERED_TOOL_CALL_PLACEHOLDER,
      });
    }
  }
  flushBackfill();

  // An assistant turn cannot open a conversation.
  while (outbound.length && outbound[0]?.role !== "user" && outbound[0]?.role !== "system") {
    outbound.shift();
  }

  return outbound;
}
