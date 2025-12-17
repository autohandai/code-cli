/**
 * TelemetryClient - Low-level API client with offline batching
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type { TelemetryEvent, TelemetryConfig } from './types.js';
import { AUTOHAND_PATHS, AUTOHAND_FILES } from '../constants.js';

const TELEMETRY_DIR = AUTOHAND_PATHS.telemetry;
const QUEUE_FILE = AUTOHAND_FILES.telemetryQueue;
const DEVICE_ID_FILE = AUTOHAND_FILES.deviceId;

export class TelemetryClient {
  private config: TelemetryConfig;
  private queue: TelemetryEvent[] = [];
  private deviceId: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = {
      enabled: true,
      apiBaseUrl: 'https://api.autohand.ai',
      batchSize: 20,
      flushIntervalMs: 60000, // 1 minute
      maxQueueSize: 500,
      maxRetries: 3,
      enableSessionSync: true,
      companySecret: '',
      ...config
    };

    this.deviceId = this.getOrCreateDeviceId();
    this.loadQueue();
    this.startFlushTimer();
  }

  /**
   * Get or create a persistent device ID
   */
  private getOrCreateDeviceId(): string {
    try {
      fs.ensureDirSync(path.dirname(DEVICE_ID_FILE));
      if (fs.existsSync(DEVICE_ID_FILE)) {
        return fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
      }
      const id = crypto.randomUUID();
      fs.writeFileSync(DEVICE_ID_FILE, id);
      return id;
    } catch {
      // Fallback to session-based ID if file operations fail
      return crypto.randomUUID();
    }
  }

  /**
   * Load queued events from disk (for offline support)
   */
  private loadQueue(): void {
    try {
      fs.ensureDirSync(TELEMETRY_DIR);
      if (fs.existsSync(QUEUE_FILE)) {
        const data = fs.readFileSync(QUEUE_FILE, 'utf8');
        this.queue = JSON.parse(data);
      }
    } catch {
      this.queue = [];
    }
  }

  /**
   * Persist queue to disk for offline support
   */
  private saveQueue(): void {
    try {
      fs.ensureDirSync(TELEMETRY_DIR);
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2));
    } catch {
      // Silently fail - telemetry should never break the CLI
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop flush timer
   */
  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  /**
   * Check if online
   */
  private async isOnline(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${this.config.apiBaseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Queue an event for sending
   */
  async track(event: Omit<TelemetryEvent, 'id' | 'deviceId' | 'timestamp'>): Promise<void> {
    if (!this.config.enabled) return;

    const fullEvent: TelemetryEvent = {
      ...event,
      id: crypto.randomUUID(),
      deviceId: this.deviceId,
      timestamp: new Date().toISOString()
    };

    this.queue.push(fullEvent);

    // Trim queue if too large
    if (this.queue.length > this.config.maxQueueSize) {
      this.queue = this.queue.slice(-this.config.maxQueueSize);
    }

    this.saveQueue();

    // Auto-flush if batch size reached
    if (this.queue.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush queued events to the server
   */
  async flush(): Promise<{ sent: number; failed: number; queued: number }> {
    if (!this.config.enabled || this.isFlushing || this.queue.length === 0) {
      return { sent: 0, failed: 0, queued: this.queue.length };
    }

    // Check if online first
    const online = await this.isOnline();
    if (!online) {
      return { sent: 0, failed: 0, queued: this.queue.length };
    }

    this.isFlushing = true;

    try {
      // Take events to send
      const eventsToSend = this.queue.slice(0, this.config.batchSize);
      let sent = 0;
      let failed = 0;

      for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
        try {
          // Build auth token: {device_id}.{company_secret}
          const authToken = `${this.deviceId}.${this.config.companySecret}`;

          const response = await fetch(`${this.config.apiBaseUrl}/v1/telemetry`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
              'X-CLI-Version': eventsToSend[0]?.cliVersion || 'unknown'
            },
            body: JSON.stringify({ events: eventsToSend })
          });

          if (response.ok) {
            // Remove sent events from queue
            this.queue = this.queue.slice(eventsToSend.length);
            sent = eventsToSend.length;
            this.saveQueue();
            break;
          } else {
            failed = eventsToSend.length;
          }
        } catch {
          failed = eventsToSend.length;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }

      return { sent, failed, queued: this.queue.length };
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Force sync all queued events (called on graceful shutdown)
   */
  async syncAll(): Promise<{ sent: number; failed: number }> {
    if (!this.config.enabled || this.queue.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const online = await this.isOnline();
    if (!online) {
      this.saveQueue();
      return { sent: 0, failed: this.queue.length };
    }

    let totalSent = 0;
    let totalFailed = 0;

    // Flush in batches
    while (this.queue.length > 0) {
      const result = await this.flush();
      totalSent += result.sent;
      if (result.sent === 0) {
        totalFailed += result.queued;
        break;
      }
    }

    return { sent: totalSent, failed: totalFailed };
  }

  /**
   * Upload session data for cloud sync
   */
  async uploadSession(sessionData: {
    sessionId: string;
    messages: Array<{ role: string; content: string; timestamp?: string }>;
    metadata?: {
      model?: string;
      provider?: string;
      totalTokens?: number;
      startTime?: string;
      endTime?: string;
      workspaceRoot?: string;
    };
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!this.config.enabled || !this.config.enableSessionSync) {
      return { success: false, error: 'Session sync disabled' };
    }

    const online = await this.isOnline();
    if (!online) {
      // Queue for later - store in a separate file
      try {
        const syncQueueFile = path.join(TELEMETRY_DIR, 'session-sync-queue.json');
        let syncQueue: typeof sessionData[] = [];
        if (fs.existsSync(syncQueueFile)) {
          syncQueue = JSON.parse(fs.readFileSync(syncQueueFile, 'utf8'));
        }
        syncQueue.push(sessionData);
        // Keep only last 10 sessions in queue
        if (syncQueue.length > 10) {
          syncQueue = syncQueue.slice(-10);
        }
        fs.writeFileSync(syncQueueFile, JSON.stringify(syncQueue, null, 2));
        return { success: false, error: 'Offline - queued for sync' };
      } catch {
        return { success: false, error: 'Failed to queue session' };
      }
    }

    try {
      // Build auth token: {device_id}.{company_secret}
      const authToken = `${this.deviceId}.${this.config.companySecret}`;

      const response = await fetch(`${this.config.apiBaseUrl}/v1/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          deviceId: this.deviceId,
          sessionId: sessionData.sessionId,
          messages: sessionData.messages,
          metadata: sessionData.metadata
        })
      });

      if (response.ok) {
        const data = await response.json() as { id?: string };
        return { success: true, id: data.id };
      } else {
        return { success: false, error: `HTTP ${response.status}` };
      }
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Sync queued sessions (call when back online)
   */
  async syncQueuedSessions(): Promise<{ synced: number; failed: number }> {
    const syncQueueFile = path.join(TELEMETRY_DIR, 'session-sync-queue.json');
    if (!fs.existsSync(syncQueueFile)) {
      return { synced: 0, failed: 0 };
    }

    try {
      const syncQueue = JSON.parse(fs.readFileSync(syncQueueFile, 'utf8'));
      let synced = 0;
      let failed = 0;
      const remaining: typeof syncQueue = [];

      for (const session of syncQueue) {
        const result = await this.uploadSession(session);
        if (result.success) {
          synced++;
        } else if (result.error !== 'Offline - queued for sync') {
          failed++;
        } else {
          remaining.push(session);
        }
      }

      // Update queue with remaining sessions
      if (remaining.length > 0) {
        fs.writeFileSync(syncQueueFile, JSON.stringify(remaining, null, 2));
      } else {
        fs.removeSync(syncQueueFile);
      }

      return { synced, failed };
    } catch {
      return { synced: 0, failed: 0 };
    }
  }

  /**
   * Get queue stats
   */
  getStats(): { queued: number; deviceId: string } {
    return {
      queued: this.queue.length,
      deviceId: this.deviceId
    };
  }

  /**
   * Disable telemetry
   */
  disable(): void {
    this.config.enabled = false;
    this.stopFlushTimer();
  }

  /**
   * Enable telemetry
   */
  enable(): void {
    this.config.enabled = true;
    this.startFlushTimer();
  }
}
