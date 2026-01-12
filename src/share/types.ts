/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Share Session Types
 * Types for session sharing functionality
 */

import type { SessionMessage } from '../session/types.js';

// ============ Visibility ============

/** Visibility options for shared sessions */
export type ShareVisibility = 'public' | 'private';

// ============ Tool Usage ============

/** Tool usage summary for the session */
export interface ToolUsageSummary {
  /** Tool name */
  name: string;
  /** Number of times used */
  count: number;
  /** Success rate (0-1) */
  successRate?: number;
}

// ============ Git Diff ============

/** Git diff summary for the session */
export interface GitDiffSummary {
  /** Files changed */
  filesChanged: string[];
  /** Lines added */
  linesAdded: number;
  /** Lines removed */
  linesRemoved: number;
  /** Full diff content (if included) */
  diffContent?: string;
}

// ============ Client Info ============

/** Client information for analytics */
export interface ShareClientInfo {
  /** CLI version */
  cliVersion: string;
  /** Operating system */
  platform: string;
  /** Anonymous device identifier */
  deviceId: string;
}

// ============ Session Metadata ============

/** Metadata about the session being shared */
export interface ShareSessionMetadata {
  /** Session ID from SessionManager */
  sessionId: string;
  /** Project name */
  projectName: string;
  /** Model used (e.g., "anthropic/claude-3.5-sonnet") */
  model: string;
  /** Provider name */
  provider: string;
  /** Session start time (ISO 8601) */
  startedAt: string;
  /** Session end/share time (ISO 8601) */
  endedAt: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Total message count */
  messageCount: number;
  /** Session status when shared */
  status: 'active' | 'completed' | 'crashed';
  /** Optional session summary */
  summary?: string;
}

// ============ Usage Stats ============

/** Token and cost information */
export interface ShareUsageStats {
  /** Total tokens used */
  totalTokens: number;
  /** Input/prompt tokens */
  inputTokens: number;
  /** Output/completion tokens */
  outputTokens: number;
  /** Estimated cost in USD */
  estimatedCost: number;
}

// ============ Share Payload ============

/**
 * Session share request payload sent from CLI to API
 */
export interface ShareSessionPayload {
  /** Session metadata */
  metadata: ShareSessionMetadata;

  /** Token and cost information */
  usage: ShareUsageStats;

  /** Tool usage statistics */
  toolUsage: ToolUsageSummary[];

  /** Git diff summary (optional) */
  gitDiff?: GitDiffSummary;

  /** Full conversation messages */
  messages: SessionMessage[];

  /** Visibility setting */
  visibility: ShareVisibility;

  /** Device/client info for analytics */
  client: ShareClientInfo;

  /** Optional authenticated user ID (if logged in) */
  userId?: string;
}

// ============ API Response ============

/**
 * API response when creating a share
 */
export interface ShareSessionResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Share ID (used in URL) - format: asid-XXXXXXXX */
  shareId?: string;
  /** Full shareable URL */
  url?: string;
  /** OTP-style passcode for private shares (format: XXXX-XXXX) */
  passcode?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * API response when deleting a share
 */
export interface DeleteShareResponse {
  /** Whether the deletion succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

// ============ Share API Config ============

/** Configuration for ShareApiClient */
export interface ShareApiConfig {
  /** API base URL (default: https://autohand.link/api) */
  baseUrl: string;
  /** Request timeout in ms (default: 30000) */
  timeout: number;
  /** Max retries for failed submissions (default: 3) */
  maxRetries: number;
  /** Enable offline queue (default: true) */
  offlineQueue: boolean;
  /** CLI version for analytics */
  cliVersion: string;
}
