/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Token estimation, context window lookup, and usage calculation.
 * Moved from src/utils/context.ts — this is the canonical location.
 * The old barrel re-exports for backward compatibility.
 */
import type { LLMMessage, FunctionDefinition } from '../../types.js';
import { CONTEXT_ENV_VARS } from './types.js';

/** Known model context windows */
const MODEL_CONTEXT: Record<string, number> = {
  "anthropic/claude-4-sonnet": 200_000,
  "anthropic/claude-3-opus": 200_000,
  "anthropic/claude-3-haiku": 200_000,
  "anthropic/claude-opus-4": 200_000,
  "anthropic/claude-opus-4-7": 1_000_000,
  "openai/gpt-4o-mini": 128_000,
  "openai/gpt-4o": 128_000,
  "openai/gpt-4.1": 200_000,
  "openai/o1": 200_000,
  "openai/o1-mini": 128_000,
  "tencent/hy3-preview:free": 262_144,
  "tencent/hy3-preview-20260421:free": 262_144,
  "deepseek/deepseek-r1": 64_000,
  "deepseek/deepseek-r1-0528-qwen3-8b:free": 8_000,
  "deepseek/deepseek-coder": 16_000,
};

/** Safety margin to prevent hitting exact limits (10% reserved) */
const SAFETY_MARGIN = 0.9;

/** Warning threshold for context usage */
export const CONTEXT_WARNING_THRESHOLD = 0.8;

/** Critical threshold for auto-cropping */
export const CONTEXT_CRITICAL_THRESHOLD = 0.9;

function parseContextWindowOverride(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/^openai\//, '').replace(/^google\//, '').replace(/^deepseek\//, '');
}

function inferContextWindow(model: string): number | undefined {
  const normalized = normalizeModelId(model);

  if (normalized.startsWith('gpt-5.5')) return 1_050_000;
  if (normalized.startsWith('gpt-5.4') && !normalized.includes('mini') && !normalized.includes('nano')) return 1_050_000;
  if (
    normalized.startsWith('gpt-5.4-mini') ||
    normalized.startsWith('gpt-5.4-nano') ||
    normalized.startsWith('gpt-5.3-codex') ||
    normalized === 'gpt-5' ||
    normalized.startsWith('gpt-5-mini') ||
    normalized.startsWith('gpt-5-nano')
  ) {
    return 400_000;
  }
  if (normalized.startsWith('gpt-5.3-chat')) return 128_000;

  if (normalized.startsWith('gemini-3.1-flash-image')) return 128_000;
  if (normalized.startsWith('gemini-3-pro-image')) return 65_000;
  if (normalized.startsWith('gemini-3.1-pro') || normalized.startsWith('gemini-3.1-flash-lite') || normalized.startsWith('gemini-3-flash')) {
    return 1_000_000;
  }

  if (normalized.startsWith('deepseek-v4')) return 1_000_000;

  return undefined;
}

/**
 * Get context window size for a model.
 * Respects AUTOHAND_CONTEXT_WINDOW env var override.
 */
export function getContextWindow(model: string, configuredContextWindow?: number): number {
  const envOverride = process.env[CONTEXT_ENV_VARS.CONTEXT_WINDOW];
  if (envOverride) {
    const parsed = parseInt(envOverride, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  const configured = parseContextWindowOverride(configuredContextWindow);
  if (configured) return configured;

  const normalized = model.toLowerCase();
  if (MODEL_CONTEXT[normalized]) {
    return MODEL_CONTEXT[normalized];
  }

  const inferred = inferContextWindow(model);
  if (inferred) return inferred;

  // Fuzzy match for model variants
  const fuzzy = Object.entries(MODEL_CONTEXT).find(
    ([name]) =>
      normalized.includes(name) ||
      name.includes(normalized.split("/").pop() ?? ""),
  );
  return fuzzy ? fuzzy[1] : 128_000;
}

/**
 * Get safe context window (with safety margin)
 */
export function getSafeContextWindow(model: string, configuredContextWindow?: number): number {
  return Math.floor(getContextWindow(model, configuredContextWindow) * SAFETY_MARGIN);
}

/**
 * Determine the model family from a model identifier.
 * Used to pick the right token-estimation heuristic.
 */
export function getModelFamily(model: string): string {
  const normalized = model.toLowerCase();
  if (normalized.includes('claude')) return 'claude';
  if (normalized.includes('gpt-4') || normalized.includes('gpt-5') || normalized.includes('o1') || normalized.includes('o3')) return 'openai';
  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('deepseek')) return 'deepseek';
  return 'default';
}

/**
 * Estimate tokens for a text string.
 *
 * Uses character-count heuristics tuned per model family:
 * - OpenAI (GPT-4, o1, o3): ~4 chars/token for English, ~2.5 for code/JSON
 * - Claude: ~3.5 chars/token for English, ~2.5 for code/JSON
 * - Gemini: ~4 chars/token
 * - DeepSeek: ~3 chars/token
 */
export function estimateTokens(text: string, modelFamily?: string): number {
  if (!text) return 0;

  const codeLikeChars = text.match(/[{}[\]":\\]/g)?.length ?? 0;
  const codeLikeRatio =
    text.length > 200 && codeLikeChars >= 4
      ? 0.65
      : 1.0;

  const baseRatio: Record<string, number> = {
    openai: 4,
    claude: 3.5,
    gemini: 4,
    deepseek: 3,
    default: 3.5,
  };

  const ratio = (baseRatio[modelFamily ?? 'default'] ?? 3.5) * codeLikeRatio;
  return Math.ceil(text.length / ratio);
}

/**
 * Estimate tokens for a single message including role overhead
 */
export function estimateMessageTokens(message: LLMMessage, modelFamily?: string): number {
  const structureOverhead = 10;
  let tokens = structureOverhead;
  tokens += estimateTokens(message.content ?? '', modelFamily);

  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      tokens += 5;
      tokens += estimateTokens(call.function.name, modelFamily);
      tokens += estimateTokens(call.function.arguments, modelFamily);
    }
  }

  return tokens;
}

/**
 * Estimate tokens for all messages in conversation
 */
export function estimateMessagesTokens(messages: LLMMessage[], modelFamily?: string): number {
  return messages.reduce(
    (acc, message) => acc + estimateMessageTokens(message, modelFamily),
    0,
  );
}

/**
 * Estimate tokens for tool definitions
 */
export function estimateToolsTokens(tools: FunctionDefinition[], modelFamily?: string): number {
  if (!tools || tools.length === 0) return 0;

  let tokens = 0;
  for (const tool of tools) {
    tokens += estimateTokens(tool.name, modelFamily);
    tokens += estimateTokens(tool.description, modelFamily);
    if (tool.parameters) {
      const paramJson = JSON.stringify(tool.parameters);
      tokens += estimateTokens(paramJson, modelFamily);
    }
    tokens += 35;
  }

  return tokens;
}

/**
 * Calculate total context usage including all components.
 * @param outputBudget Tokens reserved for model output (subtracted from effective window).
 *   Respects AUTOHAND_RESERVE_TOKENS env var override.
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

export function calculateContextUsage(
  messages: LLMMessage[],
  tools: FunctionDefinition[],
  model: string,
  outputBudget = 16000,
  configuredContextWindow?: number,
): ContextUsage {
  const envReserve = process.env[CONTEXT_ENV_VARS.RESERVE_TOKENS];
  if (envReserve) {
    const parsed = parseInt(envReserve, 10);
    if (!isNaN(parsed) && parsed > 0) outputBudget = parsed;
  }

  const modelFamily = getModelFamily(model);
  const messagesTokens = estimateMessagesTokens(messages, modelFamily);
  const toolsTokens = estimateToolsTokens(tools, modelFamily);
  const totalTokens = messagesTokens + toolsTokens;

  const contextWindow = getContextWindow(model, configuredContextWindow);
  const cappedOutputBudget = Math.min(outputBudget, Math.floor(contextWindow * 0.25));
  const effectiveWindow = contextWindow - cappedOutputBudget;
  const safeWindow = Math.floor(effectiveWindow * SAFETY_MARGIN);
  const usagePercent = totalTokens / effectiveWindow;

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
    remainingTokens: Math.max(0, safeWindow - totalTokens),
  };
}

/**
 * Estimate how many messages can be safely added
 */
export function estimateRemainingCapacity(
  messages: LLMMessage[],
  tools: FunctionDefinition[],
  model: string,
  averageMessageSize = 500,
): number {
  const usage = calculateContextUsage(messages, tools, model);
  return Math.floor(usage.remainingTokens / averageMessageSize);
}

/**
 * Find messages that can be safely cropped (not system, not last user message)
 */
export function findCroppableMessages(messages: LLMMessage[]): number[] {
  const indices: number[] = [];

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;
    if (i === lastUserIndex) continue;
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
  targetUsage = 0.7,
): number {
  const targetTokens = Math.floor(contextWindow * targetUsage);
  return Math.max(0, currentTokens - targetTokens);
}
