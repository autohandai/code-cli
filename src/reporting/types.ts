/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ErrorReport {
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
