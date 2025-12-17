/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smart Context Manager
 * Automatically manages conversation context to prevent "malformed request" errors
 */
import type { LLMMessage, FunctionDefinition } from '../types.js';
import {
  calculateContextUsage,
  estimateMessageTokens,
  estimateToolsTokens,
  CONTEXT_WARNING_THRESHOLD,
  CONTEXT_CRITICAL_THRESHOLD,
  type ContextUsage
} from '../utils/context.js';
import { ConversationManager } from './conversationManager.js';

export interface ContextManagerOptions {
  /** Model name for context window lookup */
  model: string;
  /** Conversation manager instance */
  conversationManager: ConversationManager;
  /** Callback when context is cropped */
  onCrop?: (croppedCount: number, reason: string) => void;
  /** Callback when approaching warning threshold */
  onWarning?: (usage: ContextUsage) => void;
}

export interface PrepareRequestResult {
  /** Messages to send (may be cropped) */
  messages: LLMMessage[];
  /** Tools to send (may be filtered) */
  tools: FunctionDefinition[];
  /** Context usage after preparation */
  usage: ContextUsage;
  /** Whether any cropping was performed */
  wasCropped: boolean;
  /** Number of messages cropped */
  croppedCount: number;
  /** Summary of cropped content (if any) */
  summary?: string;
}

/**
 * Smart Context Manager
 * Monitors and automatically manages context to prevent request failures
 */
export class ContextManager {
  private model: string;
  private conversationManager: ConversationManager;
  private onCrop?: (croppedCount: number, reason: string) => void;
  private onWarning?: (usage: ContextUsage) => void;
  private lastWarningUsage = 0;

  constructor(options: ContextManagerOptions) {
    this.model = options.model;
    this.conversationManager = options.conversationManager;
    this.onCrop = options.onCrop;
    this.onWarning = options.onWarning;
  }

  /**
   * Update the model (affects context window calculations)
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Get current context usage
   */
  getUsage(tools: FunctionDefinition[]): ContextUsage {
    return calculateContextUsage(
      this.conversationManager.history(),
      tools,
      this.model
    );
  }

  /**
   * Prepare a request by ensuring context fits within limits
   * This is the main entry point - call before each LLM request
   */
  prepareRequest(tools: FunctionDefinition[]): PrepareRequestResult {
    let messages = this.conversationManager.history();
    let usage = calculateContextUsage(messages, tools, this.model);
    let wasCropped = false;
    let croppedCount = 0;
    let summary: string | undefined;

    // Check if we need to warn
    if (usage.isWarning && usage.usagePercent > this.lastWarningUsage + 0.05) {
      this.lastWarningUsage = usage.usagePercent;
      this.onWarning?.(usage);
    }

    // Auto-crop if at critical threshold
    if (usage.isCritical || usage.isExceeded) {
      const result = this.autoCrop(tools, usage);
      messages = result.messages;
      usage = result.usage;
      wasCropped = result.croppedCount > 0;
      croppedCount = result.croppedCount;
      summary = result.summary;
    }

    return {
      messages,
      tools,
      usage,
      wasCropped,
      croppedCount,
      summary
    };
  }

  /**
   * Automatically crop conversation to fit within limits
   */
  private autoCrop(
    tools: FunctionDefinition[],
    currentUsage: ContextUsage
  ): { messages: LLMMessage[]; usage: ContextUsage; croppedCount: number; summary?: string } {
    // Target 70% usage after cropping (leaves room for response)
    const targetUsage = 0.7;
    const targetTokens = Math.floor(currentUsage.contextWindow * targetUsage);
    const tokensToRemove = currentUsage.totalTokens - targetTokens;

    if (tokensToRemove <= 0) {
      return {
        messages: this.conversationManager.history(),
        usage: currentUsage,
        croppedCount: 0
      };
    }

    // Calculate how many messages to remove (from oldest first)
    const messages = this.conversationManager.history();
    let removedTokens = 0;
    let removeCount = 0;

    // Find messages we can safely remove (skip system and last user message)
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];

      // Don't remove the last user message
      if (msg.role === 'user' && this.isLastUserMessage(messages, i)) {
        continue;
      }

      const msgTokens = estimateMessageTokens(msg);
      removedTokens += msgTokens;
      removeCount++;

      if (removedTokens >= tokensToRemove) {
        break;
      }
    }

    if (removeCount === 0) {
      return {
        messages,
        usage: currentUsage,
        croppedCount: 0
      };
    }

    // Create a summary of what was removed
    const removed = this.conversationManager.cropHistory('top', removeCount);
    const summaryParts: string[] = [];

    for (const msg of removed) {
      const preview = (msg.content ?? '').slice(0, 100);
      summaryParts.push(`[${msg.role}]: ${preview}${preview.length < (msg.content?.length ?? 0) ? '...' : ''}`);
    }

    const summary = `Context auto-cropped: removed ${removeCount} messages to free up tokens.\nSummary of removed content:\n${summaryParts.join('\n')}`;

    // Add a system note about the cropping
    this.conversationManager.addSystemNote(
      `[Context Management] Older messages were automatically summarized to maintain context limits. ` +
      `${removeCount} messages were condensed.`
    );

    // Notify callback
    this.onCrop?.(removeCount, `Removed ${removeCount} messages to fit context limits`);

    // Recalculate usage
    const newMessages = this.conversationManager.history();
    const newUsage = calculateContextUsage(newMessages, tools, this.model);

    return {
      messages: newMessages,
      usage: newUsage,
      croppedCount: removeCount,
      summary
    };
  }

  /**
   * Check if a message at index is the last user message
   */
  private isLastUserMessage(messages: LLMMessage[], index: number): boolean {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i === index;
      }
    }
    return false;
  }

  /**
   * Validate that a request payload is within safe limits
   * Returns error message if invalid, undefined if OK
   */
  validatePayload(messages: LLMMessage[], tools: FunctionDefinition[]): string | undefined {
    const usage = calculateContextUsage(messages, tools, this.model);

    if (usage.isExceeded) {
      return `Request would exceed context window. ` +
        `Current: ${usage.totalTokens} tokens, ` +
        `Limit: ${usage.safeWindow} tokens (${Math.round(usage.usagePercent * 100)}% usage). ` +
        `Consider using /undo to remove old turns or start a /new session.`;
    }

    return undefined;
  }

  /**
   * Get a human-readable context status
   */
  getStatusMessage(tools: FunctionDefinition[]): string {
    const usage = this.getUsage(tools);
    const percent = Math.round(usage.usagePercent * 100);

    if (usage.isExceeded) {
      return `Context EXCEEDED: ${percent}% (${usage.totalTokens}/${usage.contextWindow} tokens)`;
    }
    if (usage.isCritical) {
      return `Context CRITICAL: ${percent}% - auto-cropping may occur`;
    }
    if (usage.isWarning) {
      return `Context HIGH: ${percent}% - approaching limit`;
    }
    return `Context: ${percent}% (${usage.remainingTokens} tokens remaining)`;
  }
}

/**
 * Estimate the maximum payload size in bytes for safety validation
 */
export function estimatePayloadSize(messages: LLMMessage[], tools: FunctionDefinition[]): number {
  const payload = {
    messages,
    tools: tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }))
  };
  return JSON.stringify(payload).length;
}

/**
 * Maximum recommended payload size (10MB is typical API limit, we use 5MB for safety)
 */
export const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024;

/**
 * Validate payload doesn't exceed size limits
 */
export function validatePayloadSize(messages: LLMMessage[], tools: FunctionDefinition[]): string | undefined {
  const size = estimatePayloadSize(messages, tools);
  if (size > MAX_PAYLOAD_SIZE) {
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    const limitMB = (MAX_PAYLOAD_SIZE / (1024 * 1024)).toFixed(0);
    return `Request payload too large: ${sizeMB}MB exceeds ${limitMB}MB limit. ` +
      `Try reducing conversation history or starting a new session.`;
  }
  return undefined;
}
