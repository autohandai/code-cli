/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Share API Client
 * Handles communication with autohand.link for session sharing
 */

import fs from 'fs-extra';
import path from 'node:path';
import type {
  ShareSessionPayload,
  ShareSessionResponse,
  DeleteShareResponse,
  ShareApiConfig,
} from './types.js';
import { AUTOHAND_PATHS } from '../constants.js';
import packageJson from '../../package.json' with { type: 'json' };

// ============ Types ============

interface QueuedShare {
  payload: ShareSessionPayload;
  attempts: number;
  lastAttempt: string;
  id: string;
}

// ============ Default Config ============

/**
 * Get share API base URL from environment or default
 * Supports AUTOHAND_SHARE_URL for local development
 */
function getBaseUrl(): string {
  return process.env.AUTOHAND_SHARE_URL || 'https://autohand.link/api';
}

const DEFAULT_CONFIG: ShareApiConfig = {
  baseUrl: getBaseUrl(),
  timeout: 30000, // 30s for large payloads
  maxRetries: 3,
  offlineQueue: true,
  cliVersion: packageJson.version,
};

// ============ ShareApiClient ============

export class ShareApiClient {
  private readonly config: ShareApiConfig;
  private readonly queuePath: string;
  private readonly deviceIdPath: string;
  private deviceId: string | null = null;

  constructor(configOverrides?: Partial<ShareApiConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    const dataDir = path.join(AUTOHAND_PATHS.config, 'share');
    this.queuePath = path.join(dataDir, 'queue.json');
    this.deviceIdPath = path.join(AUTOHAND_PATHS.feedback, '.device-id');
  }

  // ============ Device ID ============

  /**
   * Get or create anonymous device identifier
   * Shared with FeedbackApiClient for consistency
   */
  async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;

    try {
      if (await fs.pathExists(this.deviceIdPath)) {
        this.deviceId = (await fs.readFile(this.deviceIdPath, 'utf8')).trim();
        return this.deviceId;
      }
    } catch {
      // Generate new ID
    }

    // Generate anonymous ID (not tied to user identity)
    this.deviceId = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    try {
      await fs.ensureDir(path.dirname(this.deviceIdPath));
      await fs.writeFile(this.deviceIdPath, this.deviceId);
    } catch {
      // Non-critical, continue with in-memory ID
    }

    return this.deviceId;
  }

  // ============ Create Share ============

  /**
   * Upload a session to create a shareable link
   */
  async createShare(payload: ShareSessionPayload): Promise<ShareSessionResponse> {
    try {
      const response = await this.sendToApi('POST', '/share', payload);

      // If successful, try to flush any queued items
      if (response.success) {
        this.flushQueue().catch(() => {}); // Background flush
      }

      return response;
    } catch (error) {
      // Queue for retry if offline mode enabled
      if (this.config.offlineQueue) {
        await this.addToQueue(payload);
        return {
          success: false,
          error: `Queued for retry: ${(error as Error).message}`,
        };
      }

      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============ Delete Share ============

  /**
   * Delete a shared session (owner only)
   */
  async deleteShare(shareId: string): Promise<DeleteShareResponse> {
    const deviceId = await this.getDeviceId();

    try {
      const response = await this.sendToApi<DeleteShareResponse>(
        'DELETE',
        `/share/${shareId}`,
        undefined,
        { 'X-Device-ID': deviceId }
      );
      return response;
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  // ============ API Communication ============

  /**
   * Send request to API endpoint
   */
  private async sendToApi<T = ShareSessionResponse>(
    method: 'POST' | 'DELETE' | 'GET',
    endpoint: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-CLI-Version': this.config.cliVersion,
        ...extraHeaders,
      };

      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as T;
      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  // ============ Offline Queue ============

  /**
   * Add share to offline queue
   */
  private async addToQueue(payload: ShareSessionPayload): Promise<void> {
    try {
      let queue: QueuedShare[] = [];

      if (await fs.pathExists(this.queuePath)) {
        queue = await fs.readJson(this.queuePath);
      }

      queue.push({
        payload,
        attempts: 0,
        lastAttempt: new Date().toISOString(),
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });

      // Keep queue size manageable (max 10 shares)
      if (queue.length > 10) {
        queue = queue.slice(-10);
      }

      await fs.ensureDir(path.dirname(this.queuePath));
      await fs.writeJson(this.queuePath, queue, { spaces: 2 });
    } catch {
      // Silent fail - sharing is non-critical
    }
  }

  /**
   * Attempt to flush queued shares
   */
  async flushQueue(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    try {
      if (!(await fs.pathExists(this.queuePath))) {
        return { sent, failed };
      }

      const queue: QueuedShare[] = await fs.readJson(this.queuePath);
      const remaining: QueuedShare[] = [];

      for (const item of queue) {
        if (item.attempts >= this.config.maxRetries) {
          // Max retries exceeded, drop it
          failed++;
          continue;
        }

        try {
          const response = await this.sendToApi('POST', '/share', item.payload);
          if (response.success) {
            sent++;
          } else {
            item.attempts++;
            item.lastAttempt = new Date().toISOString();
            remaining.push(item);
            failed++;
          }
        } catch {
          item.attempts++;
          item.lastAttempt = new Date().toISOString();
          remaining.push(item);
          failed++;
        }
      }

      // Update queue with remaining items
      if (remaining.length > 0) {
        await fs.writeJson(this.queuePath, remaining, { spaces: 2 });
      } else {
        await fs.remove(this.queuePath);
      }
    } catch {
      // Silent fail
    }

    return { sent, failed };
  }

  /**
   * Get queue status
   */
  async getQueueStatus(): Promise<{ pending: number; oldestItem: string | null }> {
    try {
      if (!(await fs.pathExists(this.queuePath))) {
        return { pending: 0, oldestItem: null };
      }

      const queue: QueuedShare[] = await fs.readJson(this.queuePath);
      return {
        pending: queue.length,
        oldestItem: queue[0]?.lastAttempt || null,
      };
    } catch {
      return { pending: 0, oldestItem: null };
    }
  }

  // ============ Health Check ============

  /**
   * Check if API is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============ Singleton Export ============

let instance: ShareApiClient | null = null;
let instanceBaseUrl: string | null = null;

export function getShareApiClient(
  config?: Partial<ShareApiConfig>
): ShareApiClient {
  const currentBaseUrl = config?.baseUrl || getBaseUrl();

  // Reset instance if base URL changed (e.g., env var changed)
  if (instance && instanceBaseUrl !== currentBaseUrl) {
    instance = null;
  }

  if (!instance) {
    instance = new ShareApiClient(config);
    instanceBaseUrl = currentBaseUrl;
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetShareApiClient(): void {
  instance = null;
  instanceBaseUrl = null;
}
