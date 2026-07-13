/**
 * TelemetryManager - High-level telemetry tracking
 * @license Apache-2.0
 */
import os from 'node:os';
import { TelemetryClient } from './TelemetryClient.js';
import type {
  TelemetryConfig,
  TelemetryEventType,
  ToolUseData,
  ErrorData,
  CommandUseData,
  ModelSwitchData,
  ProviderModelMetadata,
  SessionSyncData,
  SkillUseData,
  SessionFailureBugData
} from './types.js';
import packageJson from '../../package.json' with { type: 'json' };

const ORDERLY_TELEMETRY_SYNC_TIMEOUT_MS = 1_500;

export class TelemetryManager {
  private client: TelemetryClient;
  private sessionId: string | null = null;
  private sessionStartTime: Date | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private interactionCount = 0;
  private toolsUsed: Set<string> = new Set();
  private errorsCount = 0;
  private currentModel: string | null = null;
  private currentProvider: string | null = null;
  private currentProviderMetadata: ProviderModelMetadata = {};
  private telemetryEnabled: boolean;
  private readonly heartbeatIntervalMs: number;
  private orderlySyncDeadlineAt: number | null = null;
  private orderlySyncPromise: Promise<void> | null = null;
  private shutdownStarted = false;
  private shutdownPromise: Promise<void> | null = null;
  private readonly shutdownController = new AbortController();

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.client = new TelemetryClient(config);
    this.telemetryEnabled = config.enabled === true;
    this.heartbeatIntervalMs = 60_000;
  }

  /**
   * Get system info for events
   */
  private getSystemInfo() {
    return {
      cliVersion: packageJson.version,
      platform: process.platform,
      osVersion: os.release(),
      nodeVersion: process.version,
      cpuArch: process.arch,
      cpuCores: os.cpus().length,
      memoryTotal: Math.round(os.totalmem() / 1024 / 1024), // MB
      memoryFree: Math.round(os.freemem() / 1024 / 1024) // MB
    };
  }

  /**
   * Track a generic event
   */
  private async trackEvent(
    eventType: TelemetryEventType,
    eventData?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<void> {
    if (this.shutdownStarted || signal?.aborted) return;
    const event = {
      eventType,
      eventData,
      sessionId: this.sessionId || 'unknown',
      ...this.getSystemInfo(),
      interactionCount: this.interactionCount,
      toolsUsed: Array.from(this.toolsUsed),
      errorsCount: this.errorsCount
    };
    if (signal) {
      await this.client.track(event, { signal });
      return;
    }
    await this.client.track(event);
  }

  /**
   * Start a new session
   */
  async startSession(
    sessionId: string,
    model?: string,
    provider?: string,
    startedAt?: number | string | Date,
    providerMetadata: ProviderModelMetadata = {}
  ): Promise<void> {
    if (this.shutdownStarted) return;
    if (this.orderlySyncPromise) {
      await this.orderlySyncPromise;
    }
    if (this.shutdownStarted) return;
    this.orderlySyncDeadlineAt = null;
    this.sessionId = sessionId;
    this.sessionStartTime = this.normalizeSessionStartTime(startedAt);
    this.interactionCount = 0;
    this.toolsUsed.clear();
    this.errorsCount = 0;
    this.currentModel = model || null;
    this.currentProvider = provider || null;
    this.currentProviderMetadata = providerMetadata;
    this.startHeartbeatTimer();

    await this.trackEvent('session_start', {
      model,
      provider,
      ...providerMetadata,
    }, this.shutdownController.signal);
    if (this.shutdownStarted) return;

    // Try to sync any queued sessions from previous offline periods
    await this.client.syncQueuedSessions();
  }

  /**
   * End current session
   */
  async endSession(status: 'completed' | 'crashed' | 'abandoned' = 'completed'): Promise<void> {
    this.stopHeartbeatTimer();
    this.ensureOrderlySyncDeadline();
    const duration = this.getSessionDurationSeconds();
    const deadlineSignal = this.createOrderlyDeadlineSignal();
    try {
      await this.awaitUntilOrderlyAbort(this.trackEvent('session_end', {
        status,
        duration,
        model: this.currentModel,
        provider: this.currentProvider,
        ...this.currentProviderMetadata,
      }, deadlineSignal.signal), deadlineSignal.signal);
    } finally {
      deadlineSignal.dispose();
    }

    await this.syncForOrderlyShutdown();
  }

  /**
   * Track tool usage
   */
  async trackToolUse(data: ToolUseData): Promise<void> {
    this.toolsUsed.add(data.tool);
    if (!data.success) {
      this.errorsCount++;
    }

    await this.trackEvent('tool_use', {
      tool: data.tool,
      success: data.success,
      duration: data.duration,
      error: data.error
    });
  }

  /**
   * Track an error
   */
  async trackError(data: ErrorData): Promise<void> {
    this.errorsCount++;

    // Sanitize stack trace - remove file paths that might contain user info
    const sanitizedStack = data.stack
      ?.replace(/\/Users\/[^/]+/g, '/Users/***')
      .replace(/\/home\/[^/]+/g, '/home/***')
      .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');

    await this.trackEvent('error', {
      type: data.type,
      message: data.message,
      stack: sanitizedStack,
      context: data.context
    });
  }

  /**
   * Track a session failure as a bug report with detailed context.
   * Prefixes the error type with "BUG:" for easy identification.
   */
  async trackSessionFailureBug(data: {
    error: Error;
    retryAttempt: number;
    maxRetries: number;
    conversationLength: number;
    lastToolCalls?: string[];
    iterationCount?: number;
    contextUsage?: number;
    model?: string;
    provider?: string;
  }): Promise<void> {
    this.errorsCount++;

    // Sanitize stack trace
    const sanitizedStack = data.error.stack
      ?.replace(/\/Users\/[^/]+/g, '/Users/***')
      .replace(/\/home\/[^/]+/g, '/home/***')
      .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***');

    const bugData: SessionFailureBugData = {
      type: 'BUG:session_failure',
      errorMessage: data.error.message,
      errorName: data.error.name,
      stack: sanitizedStack,
      retryAttempt: data.retryAttempt,
      maxRetries: data.maxRetries,
      conversationLength: data.conversationLength,
      lastToolCalls: data.lastToolCalls,
      iterationCount: data.iterationCount,
      contextUsage: data.contextUsage,
      model: data.model || this.currentModel || undefined,
      provider: data.provider || this.currentProvider || undefined,
      isRetrying: data.retryAttempt < data.maxRetries
    };

    await this.trackEvent('session_failure_bug', bugData as unknown as Record<string, unknown>);
  }

  /**
   * Track slash command usage
   */
  async trackCommand(data: CommandUseData): Promise<void> {
    this.interactionCount++;

    await this.trackEvent('command_use', {
      command: data.command,
      args: data.args
    });
  }

  /**
   * Track skill activation/usage
   */
  async trackSkillUse(data: SkillUseData): Promise<void> {
    await this.trackEvent('skill_use', {
      skillName: data.skillName,
      source: data.source,
      activationType: data.activationType,
      action: data.action,
    });
  }

  /**
   * Track model switch
   */
  async trackModelSwitch(data: ModelSwitchData): Promise<void> {
    const previousModel = this.currentModel;
    this.currentModel = data.toModel;
    this.currentProvider = data.provider;
    this.currentProviderMetadata = {
      providerDisplayName: data.providerDisplayName,
      providerApiFormat: data.providerApiFormat,
      reasoningEffort: data.reasoningEffort,
      contextWindow: data.contextWindow,
    };

    await this.trackEvent('model_switch', {
      fromModel: previousModel || data.fromModel,
      toModel: data.toModel,
      provider: data.provider,
      ...this.currentProviderMetadata,
    });
  }

  /**
   * Track heartbeat (periodic check-in)
   */
  async trackHeartbeat(): Promise<void> {
    await this.trackEvent('heartbeat', {
      uptime: this.getSessionDurationSeconds()
    });
  }

  /**
   * Record an interaction (user message)
   */
  recordInteraction(): void {
    this.interactionCount++;
  }

  /**
   * Upload session for cloud sync
   */
  async syncSession(data: {
    messages: Array<{ role: string; content: string; timestamp?: string }>;
    metadata?: Omit<SessionSyncData, 'messageCount'> & { totalTokens?: number };
  }): Promise<{ success: boolean; id?: string; error?: string }> {
    if (!this.sessionId) {
      return { success: false, error: 'No active session' };
    }

    const endTimeMs = Date.now();
    const startTime = data.metadata?.startTime ?? this.sessionStartTime?.toISOString();
    const durationSeconds = data.metadata?.durationSeconds ?? this.getSessionDurationSeconds(endTimeMs);

    return this.client.uploadSession({
      sessionId: this.sessionId,
      messages: data.messages,
      metadata: {
        model: this.currentModel || undefined,
        provider: this.currentProvider || undefined,
        ...this.currentProviderMetadata,
        ...data.metadata,
        startTime,
        ...(data.metadata?.endTime ? { endTime: data.metadata.endTime } : {}),
        durationSeconds,
        workspaceRoot: data.metadata?.workspaceRoot,
      }
    });
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return this.client.getDeviceId();
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.client.getStats(),
      sessionId: this.sessionId,
      interactionCount: this.interactionCount,
      toolsUsed: Array.from(this.toolsUsed),
      errorsCount: this.errorsCount,
      sessionDuration: this.getSessionDurationSeconds()
    };
  }

  /**
   * Flush pending events
   */
  async flush(): Promise<{ sent: number; failed: number; queued: number }> {
    return this.client.flush();
  }

  /**
   * Disable telemetry
   */
  disable(): void {
    this.telemetryEnabled = false;
    this.stopHeartbeatTimer();
    this.client.disable();
  }

  /**
   * Enable telemetry
   */
  enable(): void {
    this.telemetryEnabled = true;
    if (this.sessionId) {
      this.startHeartbeatTimer();
    }
    this.client.enable();
  }

  /**
   * Stop and cleanup
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    this.shutdownStarted = true;
    this.shutdownController.abort();
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    this.stopHeartbeatTimer();
    this.client.stopFlushTimer();
    await this.syncForOrderlyShutdown();
  }

  private syncForOrderlyShutdown(): Promise<void> {
    if (this.orderlySyncPromise) {
      return this.orderlySyncPromise;
    }

    const now = Date.now();
    const deadlineAt = this.ensureOrderlySyncDeadline(now);
    const timeoutMs = Math.max(0, deadlineAt - now);
    const syncPromise = this.client.syncAll({ timeoutMs }).then(
      () => undefined,
      () => undefined
    );
    const sharedPromise = syncPromise.finally(() => {
      if (this.orderlySyncPromise === sharedPromise) {
        this.orderlySyncPromise = null;
      }
    });
    this.orderlySyncPromise = sharedPromise;
    return sharedPromise;
  }

  private ensureOrderlySyncDeadline(now = Date.now()): number {
    this.orderlySyncDeadlineAt ??= now + ORDERLY_TELEMETRY_SYNC_TIMEOUT_MS;
    return this.orderlySyncDeadlineAt;
  }

  private createOrderlyDeadlineSignal(): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeoutMs = Math.max(0, (this.orderlySyncDeadlineAt ?? Date.now()) - Date.now());
    if (timeoutMs === 0) {
      controller.abort();
      return { signal: controller.signal, dispose: () => {} };
    }

    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timeout),
    };
  }

  private async awaitUntilOrderlyAbort(
    operation: Promise<void>,
    signal: AbortSignal
  ): Promise<void> {
    if (signal.aborted) {
      operation.catch(() => {});
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => signal.removeEventListener('abort', handleAbort);
      const handleAbort = (): void => {
        cleanup();
        resolve();
      };
      signal.addEventListener('abort', handleAbort, { once: true });
      operation.then(
        () => {
          cleanup();
          resolve();
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        }
      );
    });
  }

  private normalizeSessionStartTime(startedAt?: number | string | Date): Date {
    if (startedAt instanceof Date) {
      return Number.isFinite(startedAt.getTime()) ? startedAt : new Date(Date.now());
    }

    if (typeof startedAt === 'number' || typeof startedAt === 'string') {
      const parsed = new Date(startedAt);
      return Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now());
    }

    return new Date(Date.now());
  }

  private getSessionDurationSeconds(nowMs = Date.now()): number {
    if (!this.sessionStartTime) return 0;
    return Math.max(0, Math.round((nowMs - this.sessionStartTime.getTime()) / 1000));
  }

  private startHeartbeatTimer(): void {
    if (this.shutdownStarted) return;
    this.stopHeartbeatTimer();
    if (!this.telemetryEnabled) return;

    this.heartbeatTimer = setInterval(() => {
      this.trackHeartbeat().catch(() => {});
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeatTimer(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
