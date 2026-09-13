/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Helpers shared by the OpenAI-compatible HTTP clients (NVIDIA, LLM Gateway).
 */
import type { NvidiaChatTemplateKwargs } from "../types.js";

/** Render an error payload fragment as a string for a friendly message. */
export function coerceErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}

/** Only forward the chat-template flags the caller actually set. */
export function buildChatTemplateKwargs(kwargs: NvidiaChatTemplateKwargs): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (kwargs.thinking !== undefined) result.thinking = kwargs.thinking;
  if (kwargs.enable_thinking !== undefined) result.enable_thinking = kwargs.enable_thinking;
  if (kwargs.reasoning_effort !== undefined) result.reasoning_effort = kwargs.reasoning_effort;
  if (kwargs.clear_thinking !== undefined) result.clear_thinking = kwargs.clear_thinking;
  return result;
}
