/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The 3-tier compaction engine.
 * Stripped of agent-specific I/O — purely functional.
 *
 * Tiers:
 *   1. 70%+: Compress verbose tool outputs (head/tail truncation)
 *   2. 80%+: Summarize older conversation turns (LLM or static)
 *   3. 90%+: Aggressive priority-based cropping
 */
import type { LLMMessage, FunctionDefinition } from '../../types.js';
import type { CompactionResult } from './types.js';
import type { ConversationManager } from '../conversationManager.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { ContextUsage } from './tokenizer.js';
import {
  calculateContextUsage,
  estimateMessageTokens,
} from './tokenizer.js';
import { compressToolOutput } from './compressor.js';
import { sortMessagesByPriority, determineMessagePriority, findCoherentRemovalIndices } from './priority.js';
import { summarizeWithLLM, summarizeMessagesStatic } from './summarizer.js';

// Tiered thresholds for progressive context management
const COMPRESSION_THRESHOLD = 0.70;
const SUMMARIZATION_THRESHOLD = 0.80;
// CONTEXT_CRITICAL_THRESHOLD (0.90) triggers aggressive cropping

export interface ContextCompactorOptions {
  conversationManager: ConversationManager;
  llm?: LLMProvider;
  memoryManager?: MemoryManager;
}

/**
 * The 3-tier compaction engine — purely functional, no agent I/O.
 */
export class ContextCompactor {
  private conversationManager: ConversationManager;
  private llm?: LLMProvider;
  private memoryManager?: MemoryManager;
  private lastWarningUsage = 0;

  constructor(options: ContextCompactorOptions) {
    this.conversationManager = options.conversationManager;
    this.llm = options.llm;
    this.memoryManager = options.memoryManager;
  }

  /**
   * Run the 3-tier compaction engine.
   * Returns the compaction result with optional summary.
   */
  async compact(
    model: string,
    tools: FunctionDefinition[],
    onCrop?: (croppedCount: number, reason: string) => void,
    onWarning?: (usage: ContextUsage) => void,
    contextWindow?: number,
  ): Promise<CompactionResult> {
    let messages = this.conversationManager.history();
    let usage = calculateContextUsage(messages, tools, model, undefined, contextWindow);
    let wasCropped = false;
    let croppedCount = 0;
    let summary: string | undefined;

    // Tier 1: At 70%+, compress verbose tool outputs
    if (usage.usagePercent >= COMPRESSION_THRESHOLD && !usage.isCritical) {
      const compressed = this.compressVerboseOutputs();
      if (compressed > 0) {
        messages = this.conversationManager.history();
        usage = calculateContextUsage(messages, tools, model, undefined, contextWindow);
      }
    }

    // Tier 2: At 80%+, summarize older turns with LLM-powered summarization
    if (usage.usagePercent >= SUMMARIZATION_THRESHOLD && !usage.isCritical) {
      const summarized = await this.summarizeOlderTurns(tools, model, contextWindow);
      if (summarized > 0) {
        messages = this.conversationManager.history();
        usage = calculateContextUsage(messages, tools, model, undefined, contextWindow);
        wasCropped = true;
        croppedCount = summarized;
      }
    }

    // Check if we need to warn
    if (usage.isWarning && usage.usagePercent > this.lastWarningUsage + 0.05) {
      this.lastWarningUsage = usage.usagePercent;
      onWarning?.(usage);
    }

    // Tier 3: At 90%+ (critical), aggressive priority-based cropping
    if (usage.isCritical || usage.isExceeded) {
      const result = await this.autoCrop(tools, model, usage, onCrop, contextWindow);
      messages = result.messages;
      usage = result.usage;
      if (result.croppedCount > 0) {
        wasCropped = true;
        croppedCount += result.croppedCount;
        summary = result.summary;
      }
    }

    return {
      messages,
      tools,
      usage,
      wasCropped,
      croppedCount,
      summary,
    };
  }

  /**
   * Compress verbose tool outputs in the conversation (Tier 1: 70%+)
   * Returns number of messages compressed
   */
  private compressVerboseOutputs(): number {
    const messages = this.conversationManager.history();
    let compressedCount = 0;

    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'tool' && msg.content && msg.content.length > 2000) {
        const compressed = compressToolOutput(msg, 1000);
        if (compressed.content !== msg.content) {
          this.conversationManager.replaceMessage(i, compressed);
          compressedCount++;
        }
      }
    }

    return compressedCount;
  }

  /**
   * Summarize older conversation turns (Tier 2: 80%+)
   * Returns number of messages summarized
   */
  private async summarizeOlderTurns(_tools: FunctionDefinition[], model: string, contextWindow?: number): Promise<number> {
    const messages = this.conversationManager.history();
    const lastUserIndex = this.findLastUserMessageIndex(messages);

    if (lastUserIndex <= 1) {
      return 0;
    }

    const keepRecent = 10;
    const olderMessageCount = lastUserIndex - 1;
    if (olderMessageCount <= keepRecent) {
      return 0;
    }

    const summarizeCount = olderMessageCount - keepRecent;
    const toSummarize = messages.slice(1, 1 + summarizeCount);
    if (toSummarize.length < 3) {
      return 0;
    }

    const currentUsage = calculateContextUsage(
      this.conversationManager.history(),
      _tools,
      model,
      undefined,
      contextWindow
    );
    const summary = currentUsage.usagePercent > 0.85
      ? summarizeMessagesStatic(toSummarize)
      : await summarizeWithLLM(toSummarize, this.llm, this.memoryManager);

    const removed = this.conversationManager.cropHistory('top', summarizeCount);
    if (removed.length === 0) {
      return 0;
    }

    this.conversationManager.addSystemNote(summary, '[Context Summary]');

    return removed.length;
  }

  /**
   * Automatically crop conversation to fit within limits (Tier 3: 90%+)
   */
  private async autoCrop(
    tools: FunctionDefinition[],
    model: string,
    currentUsage: ContextUsage,
    onCrop?: (croppedCount: number, reason: string) => void,
    contextWindow?: number,
  ): Promise<{ messages: LLMMessage[]; usage: ContextUsage; croppedCount: number; summary?: string }> {
    const targetUsage = 0.65;
    const targetTokens = Math.floor(currentUsage.contextWindow * targetUsage);
    const tokensToRemove = currentUsage.totalTokens - targetTokens;

    if (tokensToRemove <= 0) {
      return {
        messages: this.conversationManager.history(),
        usage: currentUsage,
        croppedCount: 0,
      };
    }

    const messages = this.conversationManager.history();
    const priorityOrder = sortMessagesByPriority(messages);

    const toRemoveIndices: number[] = [];
    let removedTokens = 0;

    for (const idx of priorityOrder) {
      if (idx === 0) continue;

      const msg = messages[idx];
      if (msg.role === 'user' && this.isLastUserMessage(messages, idx)) {
        continue;
      }

      const priority = msg.priority ?? determineMessagePriority(msg);
      if (priority === 'critical' && removedTokens < tokensToRemove * 0.8) {
        continue;
      }

      const msgTokens = estimateMessageTokens(msg);
      toRemoveIndices.push(idx);
      removedTokens += msgTokens;

      if (removedTokens >= tokensToRemove) {
        break;
      }
    }

    if (toRemoveIndices.length === 0) {
      return {
        messages,
        usage: currentUsage,
        croppedCount: 0,
      };
    }

    const coherentIndices = findCoherentRemovalIndices(messages, toRemoveIndices);
    const removedMessages = coherentIndices.map(i => messages[i]);

    const summary = currentUsage.usagePercent > 0.92
      ? summarizeMessagesStatic(removedMessages)
      : await summarizeWithLLM(removedMessages, this.llm, this.memoryManager);

    const removed = this.conversationManager.removeIndices(coherentIndices);
    if (removed.length === 0) {
      return {
        messages,
        usage: currentUsage,
        croppedCount: 0,
      };
    }

    this.conversationManager.addSystemNote(summary, '[Auto-Recovery]');

    onCrop?.(removed.length, `Cropped ${removed.length} messages (priority-based)`);

    const newMessages = this.conversationManager.history();
    const newUsage = calculateContextUsage(newMessages, tools, model, undefined, contextWindow);

    return {
      messages: newMessages,
      usage: newUsage,
      croppedCount: removed.length,
      summary,
    };
  }

  private isLastUserMessage(messages: LLMMessage[], index: number): boolean {
    return this.findLastUserMessageIndex(messages) === index;
  }

  private findLastUserMessageIndex(messages: LLMMessage[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }
}
