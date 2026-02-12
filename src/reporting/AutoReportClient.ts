/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * AutoReportClient - Low-level HTTP client for error reporting
 * Sends sanitized error reports to the Autohand API for automatic GitHub issue creation
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import type { ErrorReport, ErrorReportPayload, ReportResponse } from './types.js';
import { AUTOHAND_FILES } from '../constants.js';
import packageJson from '../../package.json' with { type: 'json' };

const DEVICE_ID_FILE = AUTOHAND_FILES.deviceId;

export class AutoReportClient {
  private readonly apiBaseUrl: string;

  constructor(apiBaseUrl = 'https://api.autohand.ai') {
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Read device ID from ~/.autohand/device-id (shared with telemetry)
   */
  getDeviceId(): string {
    try {
      if (fs.existsSync(DEVICE_ID_FILE)) {
        return fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
      }
    } catch {
      // Fall through to fallback
    }
    // Generate a random anonymous ID instead of 'unknown' to avoid
    // grouping all missing-device-id reports under the same identifier
    return `anon-${crypto.randomUUID().slice(0, 8)}`;
  }

  /**
   * Sanitize a string by replacing absolute paths with safe equivalents.
   * Removes user home directories and any user-identifying paths.
   */
  sanitizePaths(text: string): string {
    const home = os.homedir();
    let sanitized = text;

    // Replace exact home directory first
    sanitized = sanitized.replaceAll(home, '~');

    // Replace any remaining /Users/<name> or /home/<name> patterns (macOS/Linux)
    sanitized = sanitized.replace(/\/Users\/[^/\s:]+/g, '~/...');
    sanitized = sanitized.replace(/\/home\/[^/\s:]+/g, '~/...');

    // Replace Windows paths with any drive letter + UNC paths
    sanitized = sanitized.replace(/[A-Z]:\\Users\\[^\\\s:]+/gi, '~\\...');
    sanitized = sanitized.replace(/\\\\[^\\]+\\[^\\]+\\[^\\\s:]+/g, '~\\...');

    return sanitized;
  }

  /** @deprecated Use sanitizePaths() instead */
  sanitizeStack(stack: string): string {
    return this.sanitizePaths(stack);
  }

  /**
   * Send an error report to the API
   * NEVER throws - always returns a ReportResponse
   */
  async report(data: ErrorReport): Promise<ReportResponse> {
    try {
      const payload: ErrorReportPayload = {
        ...data,
        deviceId: this.getDeviceId(),
        cliVersion: packageJson.version,
        platform: process.platform,
        osVersion: os.release(),
        timestamp: new Date().toISOString(),
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${this.apiBaseUrl}/v1/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CLI-Version': packageJson.version,
            'X-Device-ID': payload.deviceId,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json() as ReportResponse;
        return result;
      } catch (err) {
        clearTimeout(timeoutId);

        if ((err as Error).name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }

        return { success: false, error: (err as Error).message };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}
