/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Share Module
 * Session sharing functionality
 */

// Types
export type {
  ShareVisibility,
  ToolUsageSummary,
  GitDiffSummary,
  ShareClientInfo,
  ShareSessionMetadata,
  ShareUsageStats,
  ShareSessionPayload,
  ShareSessionResponse,
  DeleteShareResponse,
  ShareApiConfig,
} from './types.js';

// Cost estimation
export {
  estimateCost,
  createUsageStats,
  formatCost,
  formatTokens,
  formatDuration,
} from './costEstimator.js';

// Session serialization
export { serializeSession } from './sessionSerializer.js';
export type { SerializeOptions } from './sessionSerializer.js';

// API client
export { ShareApiClient, getShareApiClient } from './ShareApiClient.js';
