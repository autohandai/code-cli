/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Domain types for the context-compaction module.
 */
import type { LLMMessage, FunctionDefinition, MessagePriority, MessageMetadata } from '../../types.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import type { MemoryManager } from '../../memory/MemoryManager.js';
import type { ConversationManager } from '../conversationManager.js';
import type { ContextUsage } from './tokenizer.js';

// ── Compaction Entry ──────────────────────────────────────────────────────────

/** Tracks a single compaction event for auditing and cumulative file tracking. */
export interface CompactionEntry {
  /** Unique identifier for this compaction event. */
  id: string;
  /** Timestamp (ms since epoch). */
  timestamp: number;
  /** Summary text injected into the conversation. */
  summary: string;
  /** Index of the first message kept after compaction. */
  firstKeptMessageIndex: number;
  /** Token count before compaction. */
  tokensBefore: number;
  /** Token count after compaction. */
  tokensAfter: number;
  /** Number of messages removed. */
  croppedCount: number;
  /** Reason for compaction (e.g. "Summarized 12 older messages"). */
  reason: string;
  /** Files read across all compacted messages (cumulative). */
  readFiles: string[];
  /** Files modified across all compacted messages (cumulative). */
  modifiedFiles: string[];
}

// ── Compaction Result ────────────────────────────────────────────────────────

/** Return type from the compactor's `compact()` method. */
export interface CompactionResult {
  /** Messages to send (may be cropped). */
  messages: LLMMessage[];
  /** Tools to send (may be filtered). */
  tools: FunctionDefinition[];
  /** Context usage after compaction. */
  usage: ContextUsage;
  /** Whether any cropping was performed. */
  wasCropped: boolean;
  /** Number of messages cropped. */
  croppedCount: number;
  /** Summary of cropped content (if any). */
  summary?: string;
  /** Compaction entry for the history log (only when compaction occurred). */
  entry?: CompactionEntry;
}

// ── Structured Summary (pi-mono inspired) ────────────────────────────────────

/** Structured summary format for rich context preservation across compactions. */
export interface StructuredSummary {
  /** The user's original goal / intent. */
  goal: string;
  /** Constraints discovered during the session. */
  constraints: string[];
  /** What has been accomplished so far. */
  progress: string[];
  /** Key decisions made. */
  keyDecisions: string[];
  /** What remains to be done. */
  nextSteps: string[];
  /** Critical context that must not be lost. */
  criticalContext: string[];
  /** Files read across compactions (cumulative). */
  readFiles: string[];
  /** Files modified across compactions (cumulative). */
  modifiedFiles: string[];
}

// ── Orchestrator Options ─────────────────────────────────────────────────────

/** Options for constructing a ContextOrchestrator. */
export interface ContextOrchestratorOptions {
  /** Initial model name for context window lookup. */
  model: string;
  /** Exact context window from provider metadata or user config. */
  contextWindow?: number;
  /** Conversation manager instance. */
  conversationManager: ConversationManager;
  /** LLM provider for intelligent summarization. */
  llm?: LLMProvider;
  /** Memory manager for persisting key facts during summarization. */
  memoryManager?: MemoryManager;
  /** Whether compaction is enabled (default: true). */
  enabled?: boolean;
  /** Callback when context is cropped. */
  onCrop?: (croppedCount: number, reason: string) => void;
  /** Callback when approaching warning threshold. */
  onWarning?: (usage: ContextUsage) => void;
  /** Callback when context overflow is detected. */
  onOverflow?: (usage: ContextUsage) => void;
}

// ── Hook Context Types ───────────────────────────────────────────────────────

/** Hook context for context:compact events. */
export interface ContextCompactHookContext {
  event: 'context:compact';
  croppedCount: number;
  summary?: string;
  usagePercent: number;
  reason: string;
}

/** Hook context for context:overflow events. */
export interface ContextOverflowHookContext {
  event: 'context:overflow';
  tokensBefore: number;
  tokensAfter: number;
  croppedCount: number;
  usagePercent: number;
}

/** Hook context for context:warning events. */
export interface ContextWarningHookContext {
  event: 'context:warning';
  usagePercent: number;
  remainingTokens: number;
}

/** Hook context for context:critical events. */
export interface ContextCriticalHookContext {
  event: 'context:critical';
  usagePercent: number;
  remainingTokens: number;
}

/** Union of all context hook contexts. */
export type ContextHookContext =
  | ContextCompactHookContext
  | ContextOverflowHookContext
  | ContextWarningHookContext
  | ContextCriticalHookContext;

// ── RPC Types ────────────────────────────────────────────────────────────────

/** Request params for autohand.setContextCompact RPC method. */
export interface SetContextCompactRequest {
  enabled: boolean;
}

/** Response for autohand.setContextCompact RPC method. */
export interface SetContextCompactResponse {
  enabled: boolean;
}

/** Extended context usage result with all fields needed by RPC. */
export interface ExtendedContextUsageResult {
  systemPrompt: number;
  tools: number;
  messages: number;
  mcpTools: number;
  memoryFiles: number;
  total: number;
  contextWindow: number;
  usagePercent: number;
  isWarning: boolean;
  isCritical: boolean;
}

// ── Environment Variable Keys ────────────────────────────────────────────────

/** Environment variable names for context management configuration. */
export const CONTEXT_ENV_VARS = {
  /** Enable/disable context compaction ('true' | 'false'). */
  CONTEXT_COMPACT: 'AUTOHAND_CONTEXT_COMPACT',
  /** Override context window size (number). */
  CONTEXT_WINDOW: 'AUTOHAND_CONTEXT_WINDOW',
  /** Tokens to reserve for model output (number). */
  RESERVE_TOKENS: 'AUTOHAND_RESERVE_TOKENS',
} as const;

// ── Re-exports for convenience ───────────────────────────────────────────────

export type {
  LLMMessage,
  FunctionDefinition,
  MessagePriority,
  MessageMetadata,
  LLMProvider,
  MemoryManager,
  ConversationManager,
  ContextUsage,
};
