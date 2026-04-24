/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Barrel exports for the context-compaction module.
 * Public API surface for src/core/context/.
 */

// Types
export type {
  CompactionEntry,
  CompactionResult,
  StructuredSummary,
  ContextOrchestratorOptions,
  ContextCompactHookContext,
  ContextOverflowHookContext,
  ContextWarningHookContext,
  ContextCriticalHookContext,
  ContextHookContext,
  SetContextCompactRequest,
  SetContextCompactResponse,
  ExtendedContextUsageResult,
} from './types.js';
export { CONTEXT_ENV_VARS } from './types.js';

// Tokenizer
export {
  getContextWindow,
  getSafeContextWindow,
  getModelFamily,
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateToolsTokens,
  calculateContextUsage,
  estimateRemainingCapacity,
  findCroppableMessages,
  calculateTokensToCrop,
  CONTEXT_WARNING_THRESHOLD,
  CONTEXT_CRITICAL_THRESHOLD,
} from './tokenizer.js';
export type { ContextUsage } from './tokenizer.js';

// Serializer
export { serializeMessagesForSummary } from './serializer.js';

// Priority
export {
  extractMessageMetadata,
  determineMessagePriority,
  sortMessagesByPriority,
  findCoherentRemovalIndices,
} from './priority.js';

// Compressor
export { compressToolOutput } from './compressor.js';

// Summarizer
export {
  summarizeMessagesStatic,
  summarizeWithLLM,
  buildStructuredSummary,
  extractFileOperations,
  persistKeyFacts,
  summarizeMessages,
} from './summarizer.js';

// Compactor
export { ContextCompactor } from './compactor.js';
export type { ContextCompactorOptions } from './compactor.js';

// Orchestrator
export { ContextOrchestrator } from './orchestrator.js';

// Backward-compatible re-exports from the old ContextManager location
// These are used by existing code that imports from contextManager.ts
export {
  estimatePayloadSize,
  MAX_PAYLOAD_SIZE,
  validatePayloadSize,
} from '../contextManager.js';
