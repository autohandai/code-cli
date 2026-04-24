/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEPRECATED: This barrel re-exports from src/core/context/tokenizer.ts.
 * New code should import directly from src/core/context/index.ts.
 * Existing imports are preserved for backward compatibility.
 *
 * @deprecated Import from '../core/context/index.js' instead.
 */

// Re-export everything from the canonical location
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
} from '../core/context/tokenizer.js';

// Re-export the ContextUsage type
export type { ContextUsage } from '../core/context/tokenizer.js';
