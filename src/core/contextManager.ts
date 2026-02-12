/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smart Context Manager
 * Automatically manages conversation context with intelligent compression and summarization.
 * Inspired by Claude Code's "unlimited context through automatic summarization".
 */
import type { LLMMessage, FunctionDefinition, MessagePriority, MessageMetadata } from '../types.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import {
  calculateContextUsage,
  estimateMessageTokens,
  type ContextUsage
} from '../utils/context.js';
import { ConversationManager } from './conversationManager.js';

// Tiered thresholds for progressive context management
const COMPRESSION_THRESHOLD = 0.70;  // Start compressing verbose outputs
const SUMMARIZATION_THRESHOLD = 0.80; // Start summarizing older turns
// CONTEXT_CRITICAL_THRESHOLD (0.90) triggers aggressive cropping

export interface ContextManagerOptions {
  /** Model name for context window lookup */
  model: string;
  /** Conversation manager instance */
  conversationManager: ConversationManager;
  /** LLM provider for intelligent summarization */
  llm?: LLMProvider;
  /** Memory manager for persisting key facts during summarization */
  memoryManager?: MemoryManager;
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
  private llm?: LLMProvider;
  private memoryManager?: MemoryManager;
  private onCrop?: (croppedCount: number, reason: string) => void;
  private onWarning?: (usage: ContextUsage) => void;
  private lastWarningUsage = 0;

  constructor(options: ContextManagerOptions) {
    this.model = options.model;
    this.conversationManager = options.conversationManager;
    this.llm = options.llm;
    this.memoryManager = options.memoryManager;
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
   *
   * Uses a tiered approach:
   * - 70%: Compress verbose tool outputs
   * - 80%: Summarize older conversation turns
   * - 90%: Aggressive cropping with priority-based selection
   */
  async prepareRequest(tools: FunctionDefinition[]): Promise<PrepareRequestResult> {
    let messages = this.conversationManager.history();
    let usage = calculateContextUsage(messages, tools, this.model);
    let wasCropped = false;
    let croppedCount = 0;
    let summary: string | undefined;

    // Tier 1: At 70%+, compress verbose tool outputs
    if (usage.usagePercent >= COMPRESSION_THRESHOLD && !usage.isCritical) {
      const compressed = this.compressVerboseOutputs();
      if (compressed > 0) {
        messages = this.conversationManager.history();
        usage = calculateContextUsage(messages, tools, this.model);
      }
    }

    // Tier 2: At 80%+, summarize older turns with LLM-powered summarization
    if (usage.usagePercent >= SUMMARIZATION_THRESHOLD && !usage.isCritical) {
      const summarized = await this.summarizeOlderTurns(tools);
      if (summarized > 0) {
        messages = this.conversationManager.history();
        usage = calculateContextUsage(messages, tools, this.model);
        wasCropped = true;
        croppedCount = summarized;
      }
    }

    // Check if we need to warn
    if (usage.isWarning && usage.usagePercent > this.lastWarningUsage + 0.05) {
      this.lastWarningUsage = usage.usagePercent;
      this.onWarning?.(usage);
    }

    // Tier 3: At 90%+ (critical), aggressive priority-based cropping
    if (usage.isCritical || usage.isExceeded) {
      const result = await this.autoCrop(tools, usage);
      messages = result.messages;
      usage = result.usage;
      wasCropped = result.croppedCount > 0;
      croppedCount += result.croppedCount;
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
   * Compress verbose tool outputs in the conversation (Tier 1: 70%+)
   * Returns number of messages compressed
   */
  private compressVerboseOutputs(): number {
    const messages = this.conversationManager.history();
    let compressedCount = 0;

    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'tool' && msg.content && msg.content.length > 2000) {
        // Skip if already compressed
        if (msg.metadata?.isCompressed) continue;

        const compressed = compressToolOutput(msg, 1000);
        if (compressed.content !== msg.content) {
          // Update in place
          messages[i] = compressed;
          compressedCount++;
        }
      }
    }

    return compressedCount;
  }

  /**
   * Summarize older conversation turns (Tier 2: 80%+)
   * Keeps recent turns, summarizes older ones using LLM when available
   * Returns number of messages summarized
   */
  private async summarizeOlderTurns(_tools: FunctionDefinition[]): Promise<number> {
    const messages = this.conversationManager.history();

    // Keep system prompt + last N turns (approximately 10 messages)
    const keepRecent = 10;
    if (messages.length <= keepRecent + 1) {
      return 0;  // Not enough messages to summarize
    }

    // Find messages to summarize (skip system, keep recent)
    const toSummarize = messages.slice(1, messages.length - keepRecent);
    if (toSummarize.length < 3) {
      return 0;  // Not worth summarizing
    }

    // Use LLM-powered summarization when available, fall back to static
    const summary = await this.summarizeWithLLM(toSummarize);

    // Remove the old messages and add summary
    const removed = this.conversationManager.cropHistory('top', toSummarize.length);

    // Add summary as system note
    this.conversationManager.addSystemNote(summary);

    // Notify callback
    this.onCrop?.(removed.length, `Summarized ${removed.length} older messages`);

    return removed.length;
  }

  /**
   * Automatically crop conversation to fit within limits (Tier 3: 90%+)
   * Uses priority-based selection to remove low-priority messages first
   */
  private async autoCrop(
    tools: FunctionDefinition[],
    currentUsage: ContextUsage
  ): Promise<{ messages: LLMMessage[]; usage: ContextUsage; croppedCount: number; summary?: string }> {
    // Target 65% usage after aggressive cropping (more headroom than normal)
    const targetUsage = 0.65;
    const targetTokens = Math.floor(currentUsage.contextWindow * targetUsage);
    const tokensToRemove = currentUsage.totalTokens - targetTokens;

    if (tokensToRemove <= 0) {
      return {
        messages: this.conversationManager.history(),
        usage: currentUsage,
        croppedCount: 0
      };
    }

    const messages = this.conversationManager.history();

    // Get messages sorted by priority (lowest first)
    const priorityOrder = sortMessagesByPriority(messages);

    // Find messages to remove based on priority
    const toRemoveIndices: number[] = [];
    let removedTokens = 0;

    for (const idx of priorityOrder) {
      // Never remove system message (index 0)
      if (idx === 0) continue;

      const msg = messages[idx];

      // Never remove the last user message
      if (msg.role === 'user' && this.isLastUserMessage(messages, idx)) {
        continue;
      }

      // Skip critical messages unless absolutely necessary
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
        croppedCount: 0
      };
    }

    // Collect messages before removal for summary
    const removedMessages = toRemoveIndices.map(i => messages[i]);

    // Create intelligent summary using LLM when available
    const summary = await this.summarizeWithLLM(removedMessages);

    // Sort indices descending to remove from end first (preserves indices)
    toRemoveIndices.sort((a, b) => b - a);

    // Remove messages by cropping (simplified: crop from top based on count)
    // Note: This is a simplification - ideally we'd remove specific indices
    const removeCount = toRemoveIndices.length;
    this.conversationManager.cropHistory('top', removeCount);

    // Add intelligent summary as system note
    this.conversationManager.addSystemNote(summary);

    // Notify callback
    this.onCrop?.(removeCount, `Cropped ${removeCount} messages (priority-based)`);

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
   * Summarize messages using the LLM for rich, context-preserving summaries.
   * Falls back to static summarization if LLM is unavailable or fails.
   */
  async summarizeWithLLM(messages: LLMMessage[]): Promise<string> {
    if (!this.llm || messages.length === 0) {
      return summarizeMessagesStatic(messages);
    }

    try {
      // Build a compact representation of the messages for the summarization prompt
      const messageSnippets = messages.map(msg => {
        const role = msg.role;
        const content = (msg.content ?? '').slice(0, 300);
        const toolInfo = msg.tool_calls?.map(tc => tc.function.name).join(', ') ?? '';
        const toolName = msg.name ? ` (${msg.name})` : '';
        return `[${role}${toolName}]${toolInfo ? ` tools: ${toolInfo}` : ''} ${content}${(msg.content?.length ?? 0) > 300 ? '...' : ''}`;
      }).join('\n');

      const summarizationPrompt = [
        'Summarize the following conversation for context preservation. Include:',
        '1. The user\'s original request and intent',
        '2. What has been accomplished so far (files created/modified, commands run)',
        '3. What remains to be done',
        '4. Any key decisions or constraints discovered',
        '5. Any user preferences or project-relevant points worth remembering',
        '',
        'Keep it concise (under 500 words). This summary replaces the removed messages.',
        '',
        '--- Conversation ---',
        messageSnippets,
      ].join('\n');

      const response = await this.llm.complete({
        messages: [
          { role: 'system', content: 'You are a context summarization assistant. Produce concise, factual summaries that preserve task continuity.' },
          { role: 'user', content: summarizationPrompt },
        ],
        temperature: 0.1,
        maxTokens: 1000,
      });

      const summaryText = response.content?.trim();
      if (!summaryText) {
        return summarizeMessagesStatic(messages);
      }

      // Persist key facts to memory if MemoryManager is available
      if (this.memoryManager) {
        await this.persistKeyFacts(summaryText).catch(() => {
          // Silently ignore memory persistence failures
        });
      }

      return `[LLM Context Summary - ${messages.length} messages condensed]\n${summaryText}`;
    } catch {
      // LLM call failed — fall back to static summarization
      return summarizeMessagesStatic(messages);
    }
  }

  /**
   * Extract and persist key facts from a summary to project memory.
   */
  private async persistKeyFacts(summary: string): Promise<void> {
    if (!this.memoryManager) return;

    // Extract lines that look like key facts/decisions/preferences
    const factPatterns = [
      /(?:chose|decided|selected|using|preference|prefer)\s+.{10,100}/gi,
      /(?:constraint|requirement|must|should)\s+.{10,100}/gi,
    ];

    const facts = new Set<string>();
    for (const pattern of factPatterns) {
      let match;
      while ((match = pattern.exec(summary)) !== null) {
        facts.add(match[0].trim());
      }
    }

    // Store each unique fact as project-level memory
    for (const fact of [...facts].slice(0, 5)) {
      await this.memoryManager.store(fact, 'project', ['context-summary'], 'context-summarization');
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// SMART CONTEXT EXTRACTION & SUMMARIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract critical context from a message (files, decisions, errors)
 */
export function extractMessageMetadata(message: LLMMessage): MessageMetadata {
  const content = message.content ?? '';
  const metadata: MessageMetadata = {};

  // Extract file paths (common patterns)
  const filePatterns = [
    /(?:^|\s)([\/\w.-]+\.[a-zA-Z]{1,5})(?:\s|$|:|\()/gm,  // path/to/file.ext
    /`([^`]+\.[a-zA-Z]{1,5})`/g,  // `file.ext` in backticks
    /["']([^"']+\.[a-zA-Z]{1,5})["']/g,  // "file.ext" or 'file.ext'
  ];

  const files = new Set<string>();
  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const file = match[1];
      if (file && !file.startsWith('http') && !file.includes('://')) {
        files.add(file);
      }
    }
  }
  if (files.size > 0) {
    metadata.files = [...files];
  }

  // Extract tool names from tool messages
  if (message.name) {
    metadata.tools = [message.name];
  }

  // Extract tool calls from assistant messages
  if (message.tool_calls && message.tool_calls.length > 0) {
    metadata.tools = message.tool_calls.map(tc => tc.function.name);
  }

  // Detect decision patterns
  const decisionPatterns = [
    /I('ll| will|'m going to| chose| decided| picked| selected)/i,
    /let's (use|go with|implement|create)/i,
    /we should (use|implement|create|add)/i,
    /the (best|better|recommended) (approach|option|choice)/i,
  ];
  metadata.isDecision = decisionPatterns.some(p => p.test(content));

  // Detect error patterns
  const errorPatterns = [
    /error:|failed:|exception:|crash|bug|issue:|problem:/i,
    /TypeError|SyntaxError|ReferenceError|Error:/,
    /❌|✗|FAIL|FAILED/,
  ];
  metadata.isError = errorPatterns.some(p => p.test(content));

  return metadata;
}

/**
 * Determine message priority based on content and role
 */
export function determineMessagePriority(message: LLMMessage): MessagePriority {
  const content = message.content ?? '';
  const metadata = message.metadata ?? extractMessageMetadata(message);

  // System messages are always critical
  if (message.role === 'system') {
    return 'critical';
  }

  // User messages with decisions/preferences are critical
  if (message.role === 'user') {
    if (metadata.isDecision) return 'critical';
    if (content.length < 100) return 'high';  // Short user messages are important
    return 'high';
  }

  // Errors are high priority
  if (metadata.isError) {
    return 'high';
  }

  // Tool messages with file reads are medium-high
  if (message.role === 'tool' && metadata.files && metadata.files.length > 0) {
    return 'medium';
  }

  // Long tool outputs are lower priority (can be compressed)
  if (message.role === 'tool' && content.length > 2000) {
    return 'low';
  }

  // Assistant decisions are high
  if (message.role === 'assistant' && metadata.isDecision) {
    return 'high';
  }

  return 'medium';
}

/**
 * Compress a verbose tool output while preserving key information
 */
export function compressToolOutput(message: LLMMessage, maxLength = 500): LLMMessage {
  if (message.role !== 'tool' || !message.content) {
    return message;
  }

  const content = message.content;
  if (content.length <= maxLength) {
    return message;
  }

  const metadata = extractMessageMetadata(message);
  const originalTokens = estimateMessageTokens(message);

  // For file reads, keep first and last parts
  const headLength = Math.floor(maxLength * 0.6);
  const tailLength = Math.floor(maxLength * 0.3);
  const head = content.slice(0, headLength);
  const tail = content.slice(-tailLength);

  const compressedContent = [
    head,
    `\n\n... [${content.length - headLength - tailLength} characters compressed] ...\n\n`,
    tail,
    metadata.files ? `\n\n[Files: ${metadata.files.join(', ')}]` : '',
  ].join('');

  return {
    ...message,
    content: compressedContent,
    metadata: {
      ...metadata,
      originalTokens,
      isCompressed: true,
    },
  };
}

/**
 * Create a summary of multiple messages for context preservation (static/fallback version).
 * Use ContextManager.summarizeWithLLM() for richer LLM-powered summaries.
 */
export function summarizeMessagesStatic(messages: LLMMessage[]): string {
  const files = new Set<string>();
  const tools = new Set<string>();
  const decisions: string[] = [];
  const errors: string[] = [];
  const userRequests: string[] = [];

  for (const msg of messages) {
    const metadata = msg.metadata ?? extractMessageMetadata(msg);

    // Collect files
    if (metadata.files) {
      metadata.files.forEach(f => files.add(f));
    }

    // Collect tools
    if (metadata.tools) {
      metadata.tools.forEach(t => tools.add(t));
    }

    // Collect user requests (first 100 chars)
    if (msg.role === 'user') {
      const preview = (msg.content ?? '').slice(0, 100);
      userRequests.push(preview + (preview.length < (msg.content?.length ?? 0) ? '...' : ''));
    }

    // Collect decisions
    if (metadata.isDecision && msg.role === 'assistant') {
      const preview = (msg.content ?? '').slice(0, 150);
      decisions.push(preview);
    }

    // Collect errors
    if (metadata.isError) {
      const preview = (msg.content ?? '').slice(0, 150);
      errors.push(preview);
    }
  }

  const parts: string[] = [
    `[Context Summary - ${messages.length} messages condensed]`,
  ];

  if (userRequests.length > 0) {
    parts.push(`User requests: ${userRequests.slice(0, 3).join(' | ')}`);
  }

  if (files.size > 0) {
    parts.push(`Files touched: ${[...files].slice(0, 10).join(', ')}${files.size > 10 ? ` (+${files.size - 10} more)` : ''}`);
  }

  if (tools.size > 0) {
    parts.push(`Tools used: ${[...tools].join(', ')}`);
  }

  if (decisions.length > 0) {
    parts.push(`Key decisions: ${decisions.slice(0, 2).join(' | ')}`);
  }

  if (errors.length > 0) {
    parts.push(`Errors encountered: ${errors.slice(0, 2).join(' | ')}`);
  }

  return parts.join('\n');
}

/**
 * Sort messages by priority for selective removal
 * Returns indices of messages sorted from lowest to highest priority
 */
export function sortMessagesByPriority(messages: LLMMessage[]): number[] {
  const priorityOrder: Record<MessagePriority, number> = {
    'low': 0,
    'medium': 1,
    'high': 2,
    'critical': 3,
  };

  const indices = messages.map((msg, i) => ({
    index: i,
    priority: msg.priority ?? determineMessagePriority(msg),
    age: i,  // Lower index = older
  }));

  // Sort by priority (low first), then by age (older first)
  indices.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.age - b.age;  // Older messages removed first at same priority
  });

  return indices.map(i => i.index);
}

/**
 * Backward-compatible alias for summarizeMessagesStatic.
 * @deprecated Use summarizeMessagesStatic or ContextManager.summarizeWithLLM instead.
 */
export const summarizeMessages = summarizeMessagesStatic;
