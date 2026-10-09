/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GitHubIdentitySource } from '../feedback/githubIdentity.js';
import type { FeedbackTranscript } from '../feedback/sessionTranscript.js';

/** Who filed a user bug report. `accountId` is stored privately and never published. */
export interface ReportReporter {
  githubLogin?: string;
  githubSource?: GitHubIdentitySource;
  accountId?: string;
}

export interface ErrorReport {
  /** `user` for reports filed with /bug; absent for automatic error reports. */
  reportKind?: 'auto' | 'user';
  reporter?: ReportReporter;
  environment?: Record<string, string>;
  transcript?: FeedbackTranscript;
  errorType: string;
  errorMessage: string;
  sanitizedStack?: string;
  context?: Record<string, unknown>;
  model?: string;
  provider?: string;
  sessionId?: string;
  conversationLength?: number;
  lastToolCalls?: string[];
  contextUsagePercent?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export interface ErrorReportPayload extends ErrorReport {
  deviceId: string;
  cliVersion: string;
  platform: string;
  osVersion: string;
  timestamp: string;
}

export interface ReportResponse {
  success: boolean;
  issueUrl?: string;
  issueNumber?: number;
  deduplicated?: boolean;
  error?: string;
}
