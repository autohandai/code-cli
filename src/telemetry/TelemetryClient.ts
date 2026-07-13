/**
 * TelemetryClient - Low-level API client with offline batching
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SessionSyncData, TelemetryEvent, TelemetryConfig } from './types.js';
import { AUTOHAND_PATHS, AUTOHAND_FILES } from '../constants.js';
import { atomicWriteJson } from '../utils/atomicFile.js';

const TELEMETRY_DIR = AUTOHAND_PATHS.telemetry;
const QUEUE_FILE = AUTOHAND_FILES.telemetryQueue;
const SESSION_SYNC_QUEUE_FILE = AUTOHAND_FILES.sessionSyncQueue;
const DEVICE_ID_FILE = AUTOHAND_FILES.deviceId;
const HEALTH_REQUEST_TIMEOUT_MS = 3_000;
const TELEMETRY_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_SYNC_TIMEOUT_MS = 1_500;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const MAX_SESSION_SYNC_QUEUE_SIZE = 10;
const TELEMETRY_EVENT_TYPES = new Set<TelemetryEvent['eventType']>([
  'session_start',
  'session_end',
  'tool_use',
  'error',
  'model_switch',
  'command_use',
  'heartbeat',
  'session_sync',
  'skill_use',
  'session_failure_bug',
]);
const TELEMETRY_CLIENT_TYPES = new Set<TelemetryEvent['clientType']>([
  'cli',
  'vscode',
  'zed',
  'unknown',
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isOptionalSessionUsageMetadata(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return typeof value.totalTokens === 'number'
    && Number.isFinite(value.totalTokens)
    && typeof value.turnCount === 'number'
    && Number.isSafeInteger(value.turnCount)
    && value.turnCount >= 0
    && (value.tokenUsageStatus === 'actual' || value.tokenUsageStatus === 'unavailable')
    && typeof value.updatedAt === 'string'
    && isOptionalFiniteNumber(value.promptTokens)
    && isOptionalFiniteNumber(value.completionTokens)
    && isOptionalFiniteNumber(value.longestTurnDurationMs);
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.eventType !== 'string'
    || !TELEMETRY_EVENT_TYPES.has(value.eventType as TelemetryEvent['eventType'])
    || typeof value.deviceId !== 'string'
    || value.deviceId.length === 0
    || typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || typeof value.clientType !== 'string'
    || !TELEMETRY_CLIENT_TYPES.has(value.clientType as TelemetryEvent['clientType'])
    || typeof value.cliVersion !== 'string'
    || typeof value.platform !== 'string'
    || typeof value.timestamp !== 'string'
    || Number.isNaN(Date.parse(value.timestamp))
  ) {
    return false;
  }

  if (value.eventData !== undefined && !isRecord(value.eventData)) return false;
  if (
    !isOptionalString(value.clientVersion)
    || !isOptionalString(value.osVersion)
    || !isOptionalString(value.nodeVersion)
    || !isOptionalString(value.cpuArch)
  ) {
    return false;
  }
  if (
    !isOptionalFiniteNumber(value.cpuCores)
    || !isOptionalFiniteNumber(value.memoryTotal)
    || !isOptionalFiniteNumber(value.memoryFree)
    || !isOptionalFiniteNumber(value.sessionDuration)
    || !isOptionalFiniteNumber(value.interactionCount)
    || !isOptionalFiniteNumber(value.errorsCount)
  ) {
    return false;
  }
  return value.toolsUsed === undefined || (
    Array.isArray(value.toolsUsed)
    && value.toolsUsed.every((tool) => typeof tool === 'string')
  );
}

interface SessionSyncQueueEntry {
  sessionId: string;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  metadata?: Omit<SessionSyncData, 'messageCount'> & {
    model?: string;
    provider?: string;
  };
}

function isSessionSyncQueueEntry(value: unknown): value is SessionSyncQueueEntry {
  if (
    !isRecord(value)
    || typeof value.sessionId !== 'string'
    || value.sessionId.length === 0
    || !Array.isArray(value.messages)
    || !value.messages.every((message) => (
      isRecord(message)
      && typeof message.role === 'string'
      && typeof message.content === 'string'
      && isOptionalString(message.timestamp)
    ))
  ) {
    return false;
  }
  if (value.metadata === undefined) return true;
  if (!isRecord(value.metadata)) return false;
  return isOptionalString(value.metadata.model)
    && isOptionalString(value.metadata.provider)
    && isOptionalFiniteNumber(value.metadata.totalTokens)
    && isOptionalString(value.metadata.startTime)
    && isOptionalString(value.metadata.endTime)
    && isOptionalFiniteNumber(value.metadata.durationSeconds)
    && isOptionalString(value.metadata.workspaceRoot)
    && isOptionalString(value.metadata.projectName)
    && isOptionalString(value.metadata.status)
    && isOptionalString(value.metadata.summary)
    && isOptionalString(value.metadata.client)
    && isOptionalString(value.metadata.clientVersion)
    && isOptionalSessionUsageMetadata(value.metadata.usage);
}

interface TelemetryFlushOptions {
  signal?: AbortSignal;
}

interface TelemetryTrackOptions {
  signal?: AbortSignal;
}

interface TelemetrySyncOptions {
  timeoutMs?: number;
}

interface TelemetryFlushResult {
  sent: number;
  failed: number;
  queued: number;
}

interface ActiveFlush {
  controller: AbortController;
  promise: Promise<TelemetryFlushResult>;
}

export class TelemetryClient {
  private config: TelemetryConfig;
  private queue: TelemetryEvent[] = [];
  private deviceId: string;
  private flushTimer: NodeJS.Timeout | null = null;
  private activeFlush: ActiveFlush | null = null;
  private queueWritePromise: Promise<void> = Promise.resolve();

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = {
      enabled: false,
      apiBaseUrl: 'https://api.autohand.ai',
      batchSize: 20,
      flushIntervalMs: 60000, // 1 minute
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
      maxRetries: 3,
      enableSessionSync: true,
      companySecret: '',
      clientType: 'cli',
      clientVersion: undefined,
      ...config
    };
    if (!Number.isSafeInteger(this.config.maxQueueSize) || this.config.maxQueueSize <= 0) {
      this.config.maxQueueSize = DEFAULT_MAX_QUEUE_SIZE;
    }

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
        const parsed = JSON.parse(data) as unknown;
        if (!Array.isArray(parsed) || !parsed.every(isTelemetryEvent)) {
          throw new Error('Invalid telemetry queue structure');
        }
        const eventIds = new Set(parsed.map((event) => event.id));
        if (eventIds.size !== parsed.length) {
          throw new Error('Invalid telemetry queue: duplicate event identifiers');
        }
        this.queue = parsed.slice(-this.config.maxQueueSize);
      }
    } catch {
      this.queue = [];
      this.backupMalformedQueue(QUEUE_FILE);
    }
  }

  private backupMalformedQueue(queueFile: string): void {
    if (!fs.existsSync(queueFile)) return;
    const backupPath = `${queueFile}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
    try {
      fs.renameSync(queueFile, backupPath);
    } catch {
      // Telemetry recovery is best-effort; retaining the source is safer than deleting it.
    }
  }

  private loadSessionSyncQueue(): SessionSyncQueueEntry[] | null {
    if (!fs.existsSync(SESSION_SYNC_QUEUE_FILE)) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(SESSION_SYNC_QUEUE_FILE, 'utf8')) as unknown;
      if (!Array.isArray(parsed) || !parsed.every(isSessionSyncQueueEntry)) {
        throw new Error('Invalid session sync queue structure');
      }
      return parsed.slice(-MAX_SESSION_SYNC_QUEUE_SIZE);
    } catch {
      this.backupMalformedQueue(SESSION_SYNC_QUEUE_FILE);
      return [];
    }
  }

  /**
   * Persist queue to disk for offline support
   */
  private saveQueue(signal?: AbortSignal): Promise<void> {
    let queueSnapshot: TelemetryEvent[];
    try {
      queueSnapshot = JSON.parse(JSON.stringify(this.queue)) as TelemetryEvent[];
    } catch {
      return Promise.resolve();
    }

    const writePromise = this.queueWritePromise
      .then(() => atomicWriteJson(QUEUE_FILE, queueSnapshot))
      .catch(() => {});
    this.queueWritePromise = writePromise;
    if (!signal) {
      return writePromise;
    }
    return this.awaitWithAbort(writePromise, signal).catch(() => {});
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
    this.flushTimer.unref?.();
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
  private async isOnline(signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.config.apiBaseUrl}/health`,
        { method: 'GET' },
        HEALTH_REQUEST_TIMEOUT_MS,
        signal
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Queue an event for sending
   */
  async track(
    event: Omit<TelemetryEvent, 'id' | 'deviceId' | 'timestamp' | 'clientType' | 'clientVersion'>,
    options: TelemetryTrackOptions = {}
  ): Promise<void> {
    if (!this.config.enabled) return;

    const fullEvent: TelemetryEvent = {
      ...event,
      id: crypto.randomUUID(),
      deviceId: this.deviceId,
      clientType: this.config.clientType,
      clientVersion: this.config.clientVersion,
      timestamp: new Date().toISOString()
    };

    this.queue.push(fullEvent);

    // Trim queue if too large
    if (this.queue.length > this.config.maxQueueSize) {
      this.queue = this.queue.slice(-this.config.maxQueueSize);
    }

    await this.saveQueue(options.signal);

    // Auto-flush if batch size reached
    if (!options.signal?.aborted && this.queue.length >= this.config.batchSize) {
      this.flush().catch(() => {});
    }
  }

  /**
   * Flush queued events to the server
   */
  async flush(options: TelemetryFlushOptions = {}): Promise<TelemetryFlushResult> {
    if (!this.config.enabled || this.queue.length === 0) {
      return { sent: 0, failed: 0, queued: this.queue.length };
    }

    if (this.activeFlush) {
      const removeAbortForwarder = this.forwardAbort(options.signal, this.activeFlush.controller);
      try {
        return await this.activeFlush.promise;
      } finally {
        removeAbortForwarder();
      }
    }

    const controller = new AbortController();
    const removeAbortForwarder = this.forwardAbort(options.signal, controller);
    const promise = this.performFlush(controller.signal);
    const activeFlush: ActiveFlush = { controller, promise };
    this.activeFlush = activeFlush;

    try {
      return await promise;
    } finally {
      removeAbortForwarder();
      if (this.activeFlush === activeFlush) {
        this.activeFlush = null;
      }
    }
  }

  private async performFlush(signal: AbortSignal): Promise<TelemetryFlushResult> {
    const online = await this.isOnline(signal);
    if (!online || signal.aborted) {
      return { sent: 0, failed: 0, queued: this.queue.length };
    }

    const eventsToSend = this.queue.slice(0, this.config.batchSize);
    let sent = 0;
    let failed = 0;

    for (let attempt = 0; attempt < this.config.maxRetries && !signal.aborted; attempt++) {
      try {
        const authToken = `${this.deviceId}.${this.config.companySecret}`;
        const response = await this.fetchWithTimeout(
          `${this.config.apiBaseUrl}/v1/telemetry`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`,
              'X-CLI-Version': eventsToSend[0]?.cliVersion || 'unknown'
            },
            body: JSON.stringify({ events: eventsToSend })
          },
          TELEMETRY_REQUEST_TIMEOUT_MS,
          signal
        );

        if (response.ok) {
          const acknowledgedIds = new Set(eventsToSend.map((event) => event.id));
          this.queue = this.queue.filter((event) => !acknowledgedIds.has(event.id));
          sent = eventsToSend.length;
          await this.saveQueue(signal);
          break;
        }

        failed = eventsToSend.length;
      } catch {
        failed = eventsToSend.length;
        if (signal.aborted || attempt === this.config.maxRetries - 1) {
          break;
        }
        await this.waitForRetry(1_000 * (attempt + 1), signal);
      }
    }

    if (sent === 0 && eventsToSend.length > 0) {
      failed = eventsToSend.length;
      await this.saveQueue(signal);
    }

    return { sent, failed, queued: this.queue.length };
  }

  /**
   * Force sync all queued events (called on graceful shutdown)
   */
  async syncAll(options: TelemetrySyncOptions = {}): Promise<{ sent: number; failed: number }> {
    if (!this.config.enabled || this.queue.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const timeoutMs = this.normalizeTimeout(options.timeoutMs);
    const controller = new AbortController();
    const timeout = timeoutMs === 0
      ? null
      : setTimeout(() => controller.abort(), timeoutMs);
    timeout?.unref?.();
    if (timeoutMs === 0) {
      controller.abort();
    }
    let totalSent = 0;

    try {
      while (this.queue.length > 0 && !controller.signal.aborted) {
        const result = await this.flush({ signal: controller.signal });
        totalSent += result.sent;
        if (result.sent === 0) {
          break;
        }
      }
    } catch {
      // Telemetry remains best-effort; unsent events are persisted below.
    } finally {
      try {
        await this.saveQueue(controller.signal);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }

    return { sent: totalSent, failed: this.queue.length };
  }

  private normalizeTimeout(timeoutMs: number | undefined): number {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
      return DEFAULT_SYNC_TIMEOUT_MS;
    }
    return Math.max(0, timeoutMs);
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const removeAbortForwarder = this.forwardAbort(signal, controller);
    if (controller.signal.aborted) {
      removeAbortForwarder();
      throw this.createAbortError();
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    try {
      const request = fetch(input, { ...init, signal: controller.signal });
      return await this.awaitWithAbort(request, controller.signal);
    } finally {
      clearTimeout(timeout);
      removeAbortForwarder();
    }
  }

  private async waitForRetry(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    await new Promise<void>((resolve) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', handleAbort);
      };
      const finish = (): void => {
        cleanup();
        resolve();
      };
      const handleAbort = (): void => finish();
      const timeout = setTimeout(finish, timeoutMs);
      timeout.unref?.();
      signal.addEventListener('abort', handleAbort, { once: true });
    });
  }

  private awaitWithAbort<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(this.createAbortError());
    }

    return new Promise<T>((resolve, reject) => {
      const cleanup = (): void => signal.removeEventListener('abort', handleAbort);
      const handleAbort = (): void => {
        cleanup();
        reject(this.createAbortError());
      };

      signal.addEventListener('abort', handleAbort, { once: true });
      request.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        }
      );
    });
  }

  private forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
    if (!signal) return () => {};

    const handleAbort = (): void => controller.abort();
    if (signal.aborted) {
      handleAbort();
      return () => {};
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    return () => signal.removeEventListener('abort', handleAbort);
  }

  private createAbortError(): Error {
    const error = new Error('Telemetry operation aborted');
    error.name = 'AbortError';
    return error;
  }

  /**
   * Upload session data for cloud sync
   */
  async uploadSession(
    sessionData: SessionSyncQueueEntry
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!this.config.enableSessionSync) {
      return { success: false, error: 'Session sync disabled' };
    }

    if (!this.config.authToken) {
      return { success: false, error: 'Login required for session sync' };
    }

    const online = await this.isOnline();
    if (!online) {
      // Queue for later - store in a separate file
      try {
        let syncQueue = this.loadSessionSyncQueue() ?? [];
        syncQueue.push(sessionData);
        if (syncQueue.length > MAX_SESSION_SYNC_QUEUE_SIZE) {
          syncQueue = syncQueue.slice(-MAX_SESSION_SYNC_QUEUE_SIZE);
        }
        await atomicWriteJson(SESSION_SYNC_QUEUE_FILE, syncQueue);
        return { success: false, error: 'Offline - queued for sync' };
      } catch {
        return { success: false, error: 'Failed to queue session' };
      }
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/v1/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.authToken}`,
          'X-CLI-Version': this.config.clientVersion || 'unknown'
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
    if (!this.config.enableSessionSync || !this.config.authToken) {
      return { synced: 0, failed: 0 };
    }

    const syncQueue = this.loadSessionSyncQueue();
    if (syncQueue === null) {
      return { synced: 0, failed: 0 };
    }

    try {
      let synced = 0;
      let failed = 0;
      const remaining: SessionSyncQueueEntry[] = [];

      for (const session of syncQueue) {
        const result = await this.uploadSession(session);
        if (result.success) {
          synced++;
        } else {
          if (result.error !== 'Offline - queued for sync') {
            failed++;
          }
          remaining.push(session);
        }
      }

      // Update queue with remaining sessions
      if (remaining.length > 0) {
        await atomicWriteJson(SESSION_SYNC_QUEUE_FILE, remaining);
      } else {
        await fs.remove(SESSION_SYNC_QUEUE_FILE);
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
