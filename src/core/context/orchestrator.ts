/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContextOrchestrator — encapsulates all agent-level context management.
 * Replaces the ~80 lines of context-management glue in agent.ts.
 *
 * Key behaviors preserved:
 * - If enabled === true: tiered compaction (70/80/90 thresholds)
 * - If enabled === false: legacy manual path (critical → crop to 70%, warn at 80%)
 * - Mid-turn compaction after tool results when critical
 * - Console output for crop/warning events (spinner handling included)
 * - Summary injection via conversationManager.addSystemNote()
 */
import type { LLMMessage, FunctionDefinition } from '../../types.js';
import type {
  ContextOrchestratorOptions,
  CompactionEntry,
  ExtendedContextUsageResult,
} from './types.js';
import type { ContextUsage } from './tokenizer.js';
import { CONTEXT_ENV_VARS } from './types.js';
import {
  calculateContextUsage,
  estimateMessageTokens,
} from './tokenizer.js';
import { ContextCompactor } from './compactor.js';
import { summarizeWithLLM } from './summarizer.js';
import { ConversationManager } from '../conversationManager.js';

export class ContextOrchestrator {
  private enabled: boolean;
  private compactor: ContextCompactor;
  private conversationManager: ConversationManager;
  private model: string;
  private contextWindow?: number;
  private history: CompactionEntry[] = [];
  private onCrop?: (croppedCount: number, reason: string) => void;
  private onWarning?: (usage: ContextUsage) => void;
  private onOverflow?: (usage: ContextUsage) => void;

  constructor(options: ContextOrchestratorOptions) {
    // Respect env var override for enabled state
    const envCompact = process.env[CONTEXT_ENV_VARS.CONTEXT_COMPACT];
    if (envCompact !== undefined) {
      this.enabled = envCompact === 'true';
    } else {
      this.enabled = options.enabled !== false;
    }

    this.model = options.model;
    this.contextWindow = options.contextWindow;
    this.conversationManager = options.conversationManager;
    this.onCrop = options.onCrop;
    this.onWarning = options.onWarning;
    this.onOverflow = options.onOverflow;

    this.compactor = new ContextCompactor({
      conversationManager: options.conversationManager,
      llm: options.llm,
      memoryManager: options.memoryManager,
    });
  }

  /**
   * Update the model (affects context window calculations)
   */
  setModel(model: string): void {
    this.model = model;
  }

  setContextWindow(contextWindow?: number): void {
    this.contextWindow = contextWindow;
  }

  private calculateUsage(messages: LLMMessage[], tools: FunctionDefinition[]): ContextUsage {
    return calculateContextUsage(messages, tools, this.model, undefined, this.contextWindow);
  }

  /**
   * Called once per LLM request. Replaces the 50-line block in agent.ts.
   *
   * When enabled: runs tiered compaction (70/80/90 thresholds).
   * When disabled: runs legacy manual path (crop at critical, warn at 80%).
   */
  async prepareRequest(
    tools: FunctionDefinition[],
    iteration = 0,
    spinner?: { stop: () => void },
  ): Promise<{ messages: LLMMessage[]; tools: FunctionDefinition[]; usage: ContextUsage; wasCropped: boolean; croppedCount: number; summary?: string }> {
    if (this.enabled) {
      // Use tiered context management (70% compress, 80% summarize, 90%+ crop)
      const prepared = await this.compactor.compact(
        this.model,
        tools,
        (count, reason) => {
          if (count > 0) {
            this.onCrop?.(count, reason);
          }
        },
        (usage) => {
          this.onWarning?.(usage);
        },
        this.contextWindow,
      );

      if (prepared.wasCropped) {
        spinner?.stop();
        this.recordCompaction(prepared.croppedCount, prepared.summary, 'tiered-compaction', prepared.usage);
      }

      return prepared;
    }

    // Legacy manual path (compaction disabled)
    const messages = this.conversationManager.history();
    const contextUsage = this.calculateUsage(messages, tools);

    // Auto-crop if at critical threshold (90%+)
    if (contextUsage.isCritical) {
      spinner?.stop();
      this.onWarning?.(contextUsage);

      // Target 70% usage after cropping
      const targetTokens = Math.floor(contextUsage.contextWindow * 0.7);
      const tokensToRemove = contextUsage.totalTokens - targetTokens;
      const avgMessageTokens = 200;
      const messagesToRemove = Math.ceil(tokensToRemove / avgMessageTokens);

      const removed = this.conversationManager.cropHistory('top', messagesToRemove);
      if (removed.length > 0) {
        const summary = await summarizeWithLLM(removed);
        this.conversationManager.addSystemNote(
          `[Context Management] ${removed.length} older messages were summarized to maintain context limits.\n` +
          `Summary of removed content:\n${summary}`
        );
        this.onCrop?.(removed.length, `Removed ${removed.length} messages to free up context space`);
        this.recordCompaction(removed.length, summary, 'legacy-critical', contextUsage);
      }

      const newMessages = this.conversationManager.history();
      const newUsage = this.calculateUsage(newMessages, tools);
      return {
        messages: newMessages,
        tools,
        usage: newUsage,
        wasCropped: removed.length > 0,
        croppedCount: removed.length,
        summary: undefined,
      };
    }

    if (contextUsage.isWarning && iteration === 0) {
      this.onWarning?.(contextUsage);
    }

    return {
      messages,
      tools,
      usage: contextUsage,
      wasCropped: false,
      croppedCount: 0,
    };
  }

  /**
   * Mid-turn compaction check. Replaces lines 3324–3343 in agent.ts.
   * Returns true if compaction occurred.
   */
  async checkMidTurnCompaction(
    tools: FunctionDefinition[],
    iteration: number,
  ): Promise<boolean> {
    if (!this.enabled || iteration <= 0) {
      return false;
    }

    const midTurnUsage = this.calculateUsage(this.conversationManager.history(), tools);

    if (!midTurnUsage.isCritical) {
      return false;
    }

    const prepared = await this.compactor.compact(
      this.model,
      tools,
      (count, reason) => {
        if (count > 0) {
          this.onCrop?.(count, reason);
        }
      },
      undefined,
      this.contextWindow,
    );

    if (prepared.wasCropped) {
      this.recordCompaction(prepared.croppedCount, prepared.summary, 'mid-turn', midTurnUsage);
      return true;
    }

    return false;
  }

  /**
   * Handle context overflow from an API 400 error.
   * Aggressive token-budget crop to ~55% usage.
   */
  async handleOverflow(
    tools: FunctionDefinition[],
  ): Promise<{ messages: LLMMessage[]; usage: ContextUsage; croppedCount: number; summary?: string }> {
    const messages = this.conversationManager.history();
    const usage = this.calculateUsage(messages, tools);

    this.onOverflow?.(usage);

    // Provider-side limits can be lower than the locally configured context window.
    // Always remove a meaningful share so a provider-reported overflow makes progress.
    const targetTokens = Math.floor(usage.contextWindow * 0.55);
    const minimumTokensToRemove = Math.ceil(usage.totalTokens * 0.25);
    const tokensToRemove = Math.max(
      usage.totalTokens - targetTokens,
      minimumTokensToRemove,
    );
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 1; i--) {
      if (messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    // Walk oldest-first by tokens
    const indicesToRemove: number[] = [];
    let removedTokens = 0;

    for (let i = 1; i < messages.length; i++) {
      // Never remove the last user message
      if (i === lastUserIndex) continue;

      indicesToRemove.push(i);
      removedTokens += estimateMessageTokens(messages[i]);
      if (removedTokens >= tokensToRemove) break;
    }

    if (indicesToRemove.length === 0) {
      return { messages, usage, croppedCount: 0 };
    }

    const removed = this.conversationManager.removeIndices(indicesToRemove);
    if (removed.length === 0) {
      return { messages, usage, croppedCount: 0 };
    }

    const summary = await summarizeWithLLM(removed);
    this.conversationManager.addSystemNote(
      `[Auto-Recovery] ${removed.length} messages compacted after context overflow.\nSummary: ${summary}`,
      '[Auto-Recovery]',
    );

    this.onCrop?.(removed.length, `Overflow recovery: cropped ${removed.length} messages`);
    this.recordCompaction(removed.length, summary, 'overflow', usage);

    const newMessages = this.conversationManager.history();
    const newUsage = this.calculateUsage(newMessages, tools);
    return { messages: newMessages, usage: newUsage, croppedCount: removed.length, summary };
  }

  // ── Toggle / Query ────────────────────────────────────────────────────────

  toggle(): void {
    this.enabled = !this.enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  // ── ACP Integration ────────────────────────────────────────────────────────

  /**
   * Apply ACP config option changes.
   * Returns true if the configId was handled.
   */
  applyAcpConfig(configId: string, value: string): boolean {
    if (configId === 'context_compact') {
      this.setEnabled(value === 'on');
      return true;
    }
    return false;
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  /**
   * Get current context usage.
   */
  getUsage(tools: FunctionDefinition[]): ContextUsage {
    return this.calculateUsage(this.conversationManager.history(), tools);
  }

  /**
   * Get extended context usage for RPC responses.
   */
  getExtendedUsage(tools: FunctionDefinition[]): ExtendedContextUsageResult {
    const usage = this.getUsage(tools);
    return {
      systemPrompt: 0, // Not tracked separately in current implementation
      tools: usage.toolsTokens,
      messages: usage.messagesTokens,
      mcpTools: 0, // Not tracked separately
      memoryFiles: 0, // Not tracked separately
      total: usage.totalTokens,
      contextWindow: usage.contextWindow,
      usagePercent: Math.round(usage.usagePercent * 100) / 100,
      isWarning: usage.isWarning,
      isCritical: usage.isCritical,
    };
  }

  /**
   * Get a human-readable context status message.
   */
  getStatus(tools: FunctionDefinition[]): string {
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

  /**
   * Get the compaction history.
   */
  getHistory(): CompactionEntry[] {
    return [...this.history];
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private recordCompaction(
    croppedCount: number,
    summary: string | undefined,
    reason: string,
    usageBefore: ContextUsage,
  ): void {
    const entry: CompactionEntry = {
      id: `compact-${Date.now()}-${this.history.length}`,
      timestamp: Date.now(),
      summary: summary ?? '',
      firstKeptMessageIndex: 1,
      tokensBefore: usageBefore.totalTokens,
      tokensAfter: 0, // Will be recalculated on next usage check
      croppedCount,
      reason,
      readFiles: [],
      modifiedFiles: [],
    };
    this.history.push(entry);
  }
}
