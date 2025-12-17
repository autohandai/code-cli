/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { LLMMessage, FunctionDefinition } from '../types.js';

/** Known model context windows */
const MODEL_CONTEXT: Record<string, number> = {
  'anthropic/claude-3.5-sonnet': 200_000,
  'anthropic/claude-3-opus': 200_000,
  'anthropic/claude-3-haiku': 200_000,
  'anthropic/claude-sonnet-4': 200_000,
  'anthropic/claude-opus-4': 200_000,
  'openai/gpt-4o-mini': 128_000,
  'openai/gpt-4o': 128_000,
  'openai/gpt-4.1': 200_000,
  'openai/o1': 200_000,
  'openai/o1-mini': 128_000,
  'google/gemini-pro': 128_000,
  'google/gemini-2.0-flash': 1_000_000,
  'google/gemini-2.5-pro': 1_000_000,
  'deepseek/deepseek-r1': 64_000,
  'deepseek/deepseek-r1-0528-qwen3-8b:free': 8_000,
  'deepseek/deepseek-coder': 16_000
};

/** Safety margin to prevent hitting exact limits (10% reserved) */
const SAFETY_MARGIN = 0.9;

/** Warning threshold for context usage */
export const CONTEXT_WARNING_THRESHOLD = 0.8;

/** Critical threshold for auto-cropping */
export const CONTEXT_CRITICAL_THRESHOLD = 0.9;

/**
 * Get context window size for a model
 */
export function getContextWindow(model: string): number {
  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT[normalized]) {
    return MODEL_CONTEXT[normalized];
  }
  // Fuzzy match for model variants
  const fuzzy = Object.entries(MODEL_CONTEXT).find(([name]) =>
    normalized.includes(name) || name.includes(normalized.split('/').pop() ?? '')
  );
  return fuzzy ? fuzzy[1] : 128_000;
}

/**
 * Get safe context window (with safety margin)
 */
export function getSafeContextWindow(model: string): number {
  return Math.floor(getContextWindow(model) * SAFETY_MARGIN);
}

/**
 * Estimate tokens for a text string
 * Uses character count / 4 as a rough approximation
 * This is conservative for English text (actual is ~3.5-4 chars/token)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a single message including role overhead
 */
export function estimateMessageTokens(message: LLMMessage): number {
  // Base overhead for message structure (role, separators, etc.)
  const structureOverhead = 10;

  let tokens = structureOverhead;
  tokens += estimateTokens(message.content ?? '');

  // Add tokens for tool calls if present
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += 5; // ID and type overhead
      tokens += estimateTokens(call.function.name);
      tokens += estimateTokens(call.function.arguments);
    }
  }

  return tokens;
}

/**
 * Estimate tokens for all messages in conversation
 */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((acc, message) => acc + estimateMessageTokens(message), 0);
}

/**
 * Estimate tokens for tool definitions
 * This is critical - tool definitions add significant overhead
 */
export function estimateToolsTokens(tools: FunctionDefinition[]): number {
  if (!tools || tools.length === 0) return 0;

  let tokens = 0;
  for (const tool of tools) {
    // Name and description
    tokens += estimateTokens(tool.name);
    tokens += estimateTokens(tool.description);

    // Parameters schema - serialize and estimate
    if (tool.parameters) {
      const paramJson = JSON.stringify(tool.parameters);
      tokens += estimateTokens(paramJson);
    }

    // Overhead per tool (type: function wrapper, structure)
    tokens += 15;
  }

  return tokens;
}

/**
 * Calculate total context usage including all components
 */
export interface ContextUsage {
  /** Total estimated tokens */
  totalTokens: number;
  /** Messages tokens */
  messagesTokens: number;
  /** Tools tokens */
  toolsTokens: number;
  /** Context window size for model */
  contextWindow: number;
  /** Safe context window (with margin) */
  safeWindow: number;
  /** Usage percentage (0-1) */
  usagePercent: number;
  /** Whether we're at warning threshold */
  isWarning: boolean;
  /** Whether we're at critical threshold */
  isCritical: boolean;
  /** Whether context is exceeded */
  isExceeded: boolean;
  /** Remaining safe tokens */
  remainingTokens: number;
}

/**
 * Calculate comprehensive context usage
 */
export function calculateContextUsage(
  messages: LLMMessage[],
  tools: FunctionDefinition[],
  model: string
): ContextUsage {
  const messagesTokens = estimateMessagesTokens(messages);
  const toolsTokens = estimateToolsTokens(tools);
  const totalTokens = messagesTokens + toolsTokens;

  const contextWindow = getContextWindow(model);
  const safeWindow = getSafeContextWindow(model);
  const usagePercent = totalTokens / contextWindow;

  return {
    totalTokens,
    messagesTokens,
    toolsTokens,
    contextWindow,
    safeWindow,
    usagePercent,
    isWarning: usagePercent >= CONTEXT_WARNING_THRESHOLD,
    isCritical: usagePercent >= CONTEXT_CRITICAL_THRESHOLD,
    isExceeded: totalTokens >= safeWindow,
    remainingTokens: Math.max(0, safeWindow - totalTokens)
  };
}

/**
 * Estimate how many messages can be safely added
 */
export function estimateRemainingCapacity(
  messages: LLMMessage[],
  tools: FunctionDefinition[],
  model: string,
  averageMessageSize = 500
): number {
  const usage = calculateContextUsage(messages, tools, model);
  return Math.floor(usage.remainingTokens / averageMessageSize);
}

/**
 * Find messages that can be safely cropped (not system, not last user message)
 */
export function findCroppableMessages(messages: LLMMessage[]): number[] {
  const indices: number[] = [];

  // Find last user message index (must be preserved)
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    // Skip system messages (index 0 usually)
    if (msg.role === 'system') continue;
    // Skip the last user message
    if (i === lastUserIndex) continue;
    // Everything else can be cropped
    indices.push(i);
  }

  return indices;
}

/**
 * Calculate tokens to crop to reach target usage
 */
export function calculateTokensToCrop(
  currentTokens: number,
  contextWindow: number,
  targetUsage = 0.7
): number {
  const targetTokens = Math.floor(contextWindow * targetUsage);
  return Math.max(0, currentTokens - targetTokens);
}
