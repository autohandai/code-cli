/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AutoReportManager - High-level manager for automatic error reporting
 * Handles deduplication, retries, and config-based enable/disable
 */
import crypto from 'node:crypto';
import type { AutohandConfig } from '../types.js';
import type { ErrorReport } from './types.js';
import { AutoReportClient } from './AutoReportClient.js';
import { ApiError } from '../providers/errors.js';
import type { ApiErrorCode } from '../providers/errors.js';

const isDebug = () => process.env.AUTOHAND_DEBUG === '1';

export class AutoReportManager {
  private readonly client: AutoReportClient;
  private readonly reportedHashes: Set<string> = new Set();
  private readonly enabled: boolean;

  constructor(config: AutohandConfig, _cliVersion: string) {
    const apiBaseUrl = config.api?.baseUrl || 'https://api.autohand.ai';
    this.client = new AutoReportClient(apiBaseUrl);
    this.enabled = config.autoReport?.enabled !== false;
  }

  /**
   * Check if auto-reporting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * API error codes that represent expected operational conditions, NOT bugs.
   * These should never be auto-reported as GitHub issues.
   */
  private static readonly OPERATIONAL_API_ERROR_CODES: ReadonlySet<ApiErrorCode> = new Set([
    'rate_limited',     // User hit rate limits — expected, handled by retry
    'cancelled',        // User cancelled the request
    'timeout',          // Provider too slow — expected for local inference
    'network_error',    // Can't reach provider — user's network
    'server_error',     // Provider is down — not our bug
    'auth_failed',      // Bad API key — user config issue
    'payment_required', // Account billing issue
    'access_denied',    // API key lacks permissions
    'model_not_found',  // Wrong model name — user config issue
  ]);

  /**
   * Check if an error represents an expected operational condition
   * that should NOT be auto-reported as a bug.
   */
  isOperationalError(error: Error): boolean {
    if (error instanceof ApiError) {
      return AutoReportManager.OPERATIONAL_API_ERROR_CODES.has(error.code);
    }
    return false;
  }

  /**
   * Compute a simple hash from error name + message for in-session deduplication
   */
  computeHash(error: Error): string {
    const key = `${error.name}:${error.message.slice(0, 200)}`;
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
   * Report an error to the API
   * NEVER throws - silently handles all failures
   */
  async reportError(error: Error, context?: Partial<ErrorReport>): Promise<void> {
    try {
      if (!this.enabled) return;

      // Skip expected operational errors — they are not bugs
      if (this.isOperationalError(error)) {
        if (isDebug()) {
          process.stderr.write(`[autohand:report] Skipping operational error: ${(error as ApiError).code}\n`);
        }
        return;
      }

      const hash = this.computeHash(error);
      if (this.reportedHashes.has(hash)) {
        if (isDebug()) {
          process.stderr.write(`[autohand:report] Skipping duplicate error: ${hash}\n`);
        }
        return;
      }

      this.reportedHashes.add(hash);

      const report: ErrorReport = {
        errorType: context?.errorType || error.name,
        errorMessage: this.client.sanitizePaths(error.message.slice(0, 500)),
        sanitizedStack: error.stack ? this.client.sanitizePaths(error.stack) : undefined,
        ...context,
      };

      // First attempt
      const result = await this.client.report(report);

      if (result.success) {
        if (isDebug()) {
          process.stderr.write(`[autohand:report] Reported: issue=${result.issueNumber ?? 'n/a'} dedup=${result.deduplicated ?? false}\n`);
        }
        return;
      }

      if (isDebug()) {
        process.stderr.write(`[autohand:report] First attempt failed: ${result.error}, retrying...\n`);
      }

      // Wait 2s then retry once
      await new Promise(resolve => setTimeout(resolve, 2000));
      const retryResult = await this.client.report(report);

      if (isDebug()) {
        if (retryResult.success) {
          process.stderr.write(`[autohand:report] Retry succeeded: issue=${retryResult.issueNumber ?? 'n/a'}\n`);
        } else {
          process.stderr.write(`[autohand:report] Retry failed: ${retryResult.error}, giving up\n`);
        }
      }
    } catch {
      // NEVER throw - silently give up
      if (isDebug()) {
        process.stderr.write(`[autohand:report] Unexpected error in reportError, giving up\n`);
      }
    }
  }
}
