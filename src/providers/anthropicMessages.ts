/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Translation from Autohand's OpenAI-shaped history into the Anthropic
 * Messages API contract.
 *
 * Shared by the native Anthropic provider and by Vertex AI's native Claude
 * endpoint, which speaks the same wire format. The Messages API rejects blank
 * content blocks, empty content arrays, and conversations that do not open on
 * a user turn, so those are repaired here rather than depended upon upstream.
 */

import type {
  ContentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolChoice as AnthropicToolChoice,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  FunctionDefinition,
  LLMMessage,
  ProviderReasoningBlock,
  ToolChoice,
} from "../types.js";

const EMPTY_TOOL_RESULT_PLACEHOLDER = "(no output)";

export interface ConvertedConversation {
  messages: MessageParam[];
  system?: string;
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson) as unknown;
  } catch {
    return {};
  }
}

function toImageBlock(url: string): ImageBlockParam | undefined {
  const dataUrl = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/u.exec(url);
  if (dataUrl) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: dataUrl[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: dataUrl[2] ?? "",
      },
    };
  }

  if (/^https?:\/\//u.test(url)) {
    return {
      type: "image",
      source: { type: "url", url },
    };
  }

  return undefined;
}

/**
 * Convert Autohand content into Anthropic blocks. Empty text is dropped: the
 * Messages API rejects blank text blocks and empty content arrays.
 */
function toContentBlocks(content: unknown): ContentBlockParam[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: ContentBlockParam[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      continue;
    }

    if (part.type === "text" && "text" in part && typeof part.text === "string") {
      if (part.text.trim()) {
        blocks.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (
      part.type === "image_url" &&
      "image_url" in part &&
      part.image_url &&
      typeof part.image_url === "object" &&
      "url" in part.image_url &&
      typeof part.image_url.url === "string"
    ) {
      const image = toImageBlock(part.image_url.url);
      if (image) {
        blocks.push(image);
      }
    }
  }

  return blocks;
}

function toSystemText(content: unknown): string {
  return toContentBlocks(content)
    .filter((block): block is TextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export const REASONING_BLOCK_TYPES = new Set(["thinking", "redacted_thinking"]);

function isReasoningBlock(value: unknown): value is ProviderReasoningBlock {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    REASONING_BLOCK_TYPES.has((value as { type?: unknown }).type as string)
  );
}

/**
 * Replay reasoning blocks unchanged. Anthropic validates thinking-block
 * signatures and ordering, so blocks are emitted first and never rewritten.
 */
function toReplayedReasoningBlocks(message: LLMMessage): ContentBlockParam[] {
  if (!message.reasoningBlocks?.length) {
    return [];
  }
  return message.reasoningBlocks.filter(isReasoningBlock) as unknown as ContentBlockParam[];
}

function toToolResultBlock(message: LLMMessage): ToolResultBlockParam {
  const content = String(message.content ?? "");
  return {
    type: "tool_result",
    tool_use_id: message.tool_call_id as string,
    content: content.trim() ? content : EMPTY_TOOL_RESULT_PLACEHOLDER,
  };
}

/**
 * Anthropic requires `tool_result` blocks to lead the user turn that answers a
 * tool call, so merging is stable except for hoisting those blocks.
 */
function mergeAdjacentTurns(turns: MessageParam[]): MessageParam[] {
  const merged: MessageParam[] = [];

  for (const turn of turns) {
    const previous = merged[merged.length - 1];
    if (!previous || previous.role !== turn.role) {
      merged.push({ role: turn.role, content: [...asBlocks(turn.content)] });
      continue;
    }
    previous.content = [...asBlocks(previous.content), ...asBlocks(turn.content)];
  }

  return merged.map((turn) => {
    const blocks = asBlocks(turn.content);
    if (turn.role !== "user") {
      return { role: turn.role, content: collapseBlocks(blocks) };
    }
    const toolResults = blocks.filter((block) => block.type === "tool_result");
    if (!toolResults.length) {
      return { role: turn.role, content: collapseBlocks(blocks) };
    }
    const rest = blocks.filter((block) => block.type !== "tool_result");
    return { role: turn.role, content: [...toolResults, ...rest] };
  });
}

function asBlocks(content: MessageParam["content"]): ContentBlockParam[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : [...content];
}

/** Single text blocks travel as plain strings, matching Anthropic's shorthand. */
function collapseBlocks(blocks: ContentBlockParam[]): MessageParam["content"] {
  const [first] = blocks;
  return blocks.length === 1 && first?.type === "text" ? first.text : blocks;
}

/**
 * Translate Autohand's OpenAI-shaped history into the Messages API contract.
 *
 * Only the leading system messages become the top-level `system` prompt —
 * hoisting later notes would reorder the conversation and invalidate the
 * cached prefix on every turn, so they stay in place as tagged user content.
 */
export function toAnthropicMessages(messages: LLMMessage[]): ConvertedConversation {
  const systemParts: string[] = [];
  const turns: MessageParam[] = [];
  let seenConversationTurn = false;

  for (const message of messages) {
    if (message.role === "system") {
      const systemText = toSystemText(message.content);
      if (!systemText) {
        continue;
      }
      if (!seenConversationTurn) {
        systemParts.push(systemText);
        continue;
      }
      turns.push({
        role: "user",
        content: [{
          type: "text",
          text: `<system-reminder>\n${systemText}\n</system-reminder>`,
        }],
      });
      continue;
    }

    seenConversationTurn = true;

    if (message.role === "tool") {
      if (!message.tool_call_id) {
        const blocks = toContentBlocks(message.content);
        if (blocks.length) {
          turns.push({ role: "user", content: blocks });
        }
        continue;
      }
      turns.push({ role: "user", content: [toToolResultBlock(message)] });
      continue;
    }

    const blocks =
      message.role === "assistant"
        ? [...toReplayedReasoningBlocks(message), ...toContentBlocks(message.content)]
        : toContentBlocks(message.content);

    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const toolCall of message.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        });
      }
    }

    if (!blocks.length) {
      continue;
    }

    turns.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: blocks,
    });
  }

  // A conversation must open on a user turn; an orphaned assistant prefix
  // (resumed or cropped history) is a 400.
  while (turns.length && turns[0]?.role !== "user") {
    turns.shift();
  }

  return {
    messages: mergeAdjacentTurns(turns),
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
  };
}

export function toAnthropicTools(tools: FunctionDefinition[]): Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters ?? { type: "object", properties: {} },
  }));
}

export function toAnthropicToolChoice(toolChoice: ToolChoice | undefined): AnthropicToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }
  if (toolChoice === "auto") {
    return { type: "auto" };
  }
  if (toolChoice === "required") {
    return { type: "any" };
  }
  if (toolChoice === "none") {
    return { type: "none" };
  }
  return { type: "tool", name: toolChoice.function.name };
}
