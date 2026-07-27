/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { MemoryManager } from './MemoryManager.js';
export {
  MemoryEventLog,
  MemoryEventLogCorruptionError,
  mergeMemoryEventLogContents,
} from './MemoryEventLog.js';
export {
  MemorySummaryCorruptionError,
  MemorySummaryTree,
} from './MemorySummaryTree.js';
export { materializeMemoryProjection } from './MemoryProjection.js';
export { assertSafeMemoryId, isSafeMemoryId } from './MemoryPathSafety.js';
export * from './types.js';
export {
  extractAndSaveSessionMemories,
  type ExtractedMemory,
  type ExtractionDeps,
  type TurnMemoryReflectionFailureCategory,
  type TurnMemoryReflectionOutcome,
} from './extractSessionMemories.js';
