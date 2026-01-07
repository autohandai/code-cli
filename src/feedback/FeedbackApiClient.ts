/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Feedback API Client
 * Handles communication with api.autohand.ai for feedback submission
 */
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import type { FeedbackResponse } from './FeedbackManager.js';
import { AUTOHAND_PATHS } from '../constants.js';

// ============ Types ============

export interface FeedbackApiConfig {
  /** API base URL (default: https://api.autohand.ai) */
  baseUrl: string;
  /** Request timeout in ms (default: 5000) */
  timeout: number;
  /** Max retries for failed submissions (default: 3) */
  maxRetries: number;
  /** Enable offline queue (default: true) */
  offlineQueue: boolean;
  /** CLI version for analytics */
  cliVersion: string;
}

export interface FeedbackSubmission extends FeedbackResponse {
  /** Anonymous device identifier */
  deviceId: string;
  /** CLI version */
  cliVersion: string;
  /** Operating system */
  platform: string;
  /** OS version */
  osVersion: string;
  /** Node.js version */
  nodeVersion: string;
}

export interface ApiResponse {
  success: boolean;
  id?: string;
  error?: string;
}

interface QueuedSubmission {
  feedback: FeedbackSubmission;
  attempts: number;
  lastAttempt: string;
  id: string;
}

// ============ Default Config ============

const DEFAULT_CONFIG: FeedbackApiConfig = {
  baseUrl: 'https://api.autohand.ai',
  timeout: 5000,
  maxRetries: 3,
  offlineQueue: true,
  cliVersion: '0.1.0'
};

// ============ FeedbackApiClient ============

export class FeedbackApiClient {
  private readonly config: FeedbackApiConfig;
  private readonly queuePath: string;
  private readonly deviceIdPath: string;
  private deviceId: string | null = null;

  constructor(configOverrides?: Partial<FeedbackApiConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    const dataDir = AUTOHAND_PATHS.feedback;
    this.queuePath = path.join(dataDir, 'queue.json');
    this.deviceIdPath = path.join(dataDir, '.device-id');
  }

  // ============ Device ID ============

  /**
   * Get or create anonymous device identifier
   * Used for deduplication and analytics, not tracking
   */
  private async getDeviceId(): Promise<string> {
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

  // ============ Submission ============

  /**
   * Submit feedback to the API
   * Automatically queues for retry if offline
   */
  async submit(feedback: FeedbackResponse): Promise<ApiResponse> {
    const submission = await this.enrichFeedback(feedback);

    try {
      const response = await this.sendToApi(submission);

      // If successful, try to flush any queued items
      if (response.success) {
        this.flushQueue().catch(() => {}); // Background flush
      }

      return response;
    } catch (error) {
      // Queue for retry if offline mode enabled
      if (this.config.offlineQueue) {
        await this.addToQueue(submission);
        return {
          success: true, // Queued successfully
          id: `queued_${Date.now()}`
        };
      }

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Enrich feedback with device/environment info
   */
  private async enrichFeedback(feedback: FeedbackResponse): Promise<FeedbackSubmission> {
    return {
      ...feedback,
      deviceId: await this.getDeviceId(),
      cliVersion: this.config.cliVersion,
      platform: process.platform,
      osVersion: os.release(),
      nodeVersion: process.version
    };
  }

  /**
   * Send feedback to API endpoint
   * No authentication required - endpoint is rate-limited instead
   */
  private async sendToApi(submission: FeedbackSubmission): Promise<ApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CLI-Version': this.config.cliVersion,
          'X-Device-ID': submission.deviceId
        },
        body: JSON.stringify(submission),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${errorText}`);
      }

      const data = await response.json() as ApiResponse;
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
   * Add submission to offline queue
   */
  private async addToQueue(submission: FeedbackSubmission): Promise<void> {
    try {
      let queue: QueuedSubmission[] = [];

      if (await fs.pathExists(this.queuePath)) {
        queue = await fs.readJson(this.queuePath);
      }

      queue.push({
        feedback: submission,
        attempts: 0,
        lastAttempt: new Date().toISOString(),
        id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      });

      // Keep queue size manageable (max 50 items)
      if (queue.length > 50) {
        queue = queue.slice(-50);
      }

      await fs.ensureDir(path.dirname(this.queuePath));
      await fs.writeJson(this.queuePath, queue, { spaces: 2 });
    } catch {
      // Silent fail - feedback is non-critical
    }
  }

  /**
   * Attempt to flush queued submissions
   */
  async flushQueue(): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    try {
      if (!await fs.pathExists(this.queuePath)) {
        return { sent, failed };
      }

      const queue: QueuedSubmission[] = await fs.readJson(this.queuePath);
      const remaining: QueuedSubmission[] = [];

      for (const item of queue) {
        if (item.attempts >= this.config.maxRetries) {
          // Max retries exceeded, drop it
          failed++;
          continue;
        }

        try {
          const response = await this.sendToApi(item.feedback);
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
      if (!await fs.pathExists(this.queuePath)) {
        return { pending: 0, oldestItem: null };
      }

      const queue: QueuedSubmission[] = await fs.readJson(this.queuePath);
      return {
        pending: queue.length,
        oldestItem: queue[0]?.lastAttempt || null
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
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${this.config.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// ============ Singleton Export ============

let instance: FeedbackApiClient | null = null;

export function getFeedbackApiClient(config?: Partial<FeedbackApiConfig>): FeedbackApiClient {
  if (!instance) {
    instance = new FeedbackApiClient(config);
  }
  return instance;
}
