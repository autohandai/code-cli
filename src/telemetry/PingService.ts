/**
 * PingService - Periodic device ping for usage tracking
 * Runs independently of telemetry opt-in (anonymous usage counting)
 * @license Apache-2.0
 */
import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { AUTOHAND_HOME, AUTOHAND_FILES } from '../constants.js';
import { atomicWriteJson } from '../utils/atomicFile.js';

const PING_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const PING_CACHE_FILE = path.join(AUTOHAND_HOME, 'last-ping.json');
const API_BASE_URL = process.env.AUTOHAND_API_URL || 'https://api.autohand.ai';
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2500;

interface PingCache {
  lastPing: string;
  pingDate: string;
}

export class PingService {
  private deviceId: string;
  private cliVersion: string;
  private platform: string;
  private clientType: string;
  private pingTimer: NodeJS.Timeout | null = null;
  private isPinging = false;
  private started = false;
  private stopped = false;
  private generation = 0;
  private requestController: AbortController | null = null;
  private activePingPromise: Promise<{
    success: boolean;
    updateAvailable?: boolean;
    latestVersion?: string;
  }> | null = null;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: {
    cliVersion: string;
    clientType?: 'cli' | 'vscode' | 'zed' | 'unknown';
  }) {
    this.cliVersion = options.cliVersion;
    this.clientType = options.clientType || 'cli';
    this.platform = `${os.platform()}-${os.arch()}`;
    this.deviceId = this.getOrCreateDeviceId();
  }

  /**
   * Get or create a persistent device ID (shared with TelemetryClient)
   */
  private getOrCreateDeviceId(): string {
    try {
      fs.ensureDirSync(path.dirname(AUTOHAND_FILES.deviceId));
      if (fs.existsSync(AUTOHAND_FILES.deviceId)) {
        return fs.readFileSync(AUTOHAND_FILES.deviceId, 'utf8').trim();
      }
      const id = crypto.randomUUID();
      fs.writeFileSync(AUTOHAND_FILES.deviceId, id);
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  /**
   * Check if we already pinged today
   */
  private async shouldPing(): Promise<boolean> {
    try {
      if (await fs.pathExists(PING_CACHE_FILE)) {
        const cache: PingCache = await fs.readJson(PING_CACHE_FILE);
        const today = new Date().toISOString().split('T')[0];
        const lastPingTime = new Date(cache.lastPing).getTime();
        const now = Date.now();

        // Skip if pinged within interval AND same day
        if (cache.pingDate === today && (now - lastPingTime) < PING_INTERVAL_MS) {
          return false;
        }
      }
    } catch {
      // If cache read fails, proceed with ping
    }
    return true;
  }

  /**
   * Update the ping cache
   */
  private async updateCache(generation: number): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(PING_CACHE_FILE));
      this.assertActive(generation);
      const cache: PingCache = {
        lastPing: new Date().toISOString(),
        pingDate: new Date().toISOString().split('T')[0],
      };
      await atomicWriteJson(PING_CACHE_FILE, cache, {
        beforeCommit: () => this.assertActive(generation),
      });
    } catch {
      // Silently fail - ping should never break the CLI
    }
  }

  /**
   * Send a ping to the API
   */
  async ping(): Promise<{ success: boolean; updateAvailable?: boolean; latestVersion?: string }> {
    if (this.isPinging || this.stopped) {
      return { success: false };
    }

    // Skip if disabled via environment variable
    if (process.env.AUTOHAND_SKIP_PING === '1') {
      return { success: false };
    }

    this.isPinging = true;
    const generation = this.generation;
    const activePing = this.performPing(generation);
    this.activePingPromise = activePing;

    try {
      return await activePing;
    } finally {
      this.isPinging = false;
      if (this.activePingPromise === activePing) {
        this.activePingPromise = null;
      }
    }
  }

  /**
   * Start periodic ping timer (every 45 minutes)
   */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    // Ping immediately on start
    this.ping().catch(() => {});

    // Then ping every 45 minutes
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.pingTimer = setInterval(() => {
      this.ping().catch(() => {});
    }, PING_INTERVAL_MS);

    // Ensure timer doesn't prevent Node from exiting
    if (this.pingTimer.unref) {
      this.pingTimer.unref();
    }
  }

  /**
   * Stop periodic ping timer
   */
  stop(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.generation++;
      this.requestController?.abort();
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.started = false;
  }

  shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.performShutdown(
        options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      );
    }
    return this.shutdownPromise;
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return this.deviceId;
  }

  private async performPing(generation: number): Promise<{
    success: boolean;
    updateAvailable?: boolean;
    latestVersion?: string;
  }> {
    try {
      const shouldPing = await this.shouldPing();
      this.assertActive(generation);
      if (!shouldPing) {
        return { success: true };
      }

      const controller = new AbortController();
      this.requestController = controller;
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      try {
        const response = await fetch(`${API_BASE_URL}/v1/version/check`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CLI-Version': this.cliVersion,
            'X-Device-ID': this.deviceId,
          },
          body: JSON.stringify({
            deviceId: this.deviceId,
            currentVersion: this.cliVersion,
            platform: this.platform,
            clientType: this.clientType,
          }),
          signal: controller.signal,
        });
        this.assertActive(generation);

        if (response.ok) {
          const data = await response.json() as {
            success: boolean;
            updateAvailable?: boolean;
            latestVersion?: string;
          };
          this.assertActive(generation);
          await this.updateCache(generation);
          this.assertActive(generation);
          return {
            success: true,
            updateAvailable: data.updateAvailable,
            latestVersion: data.latestVersion,
          };
        }
      } finally {
        clearTimeout(timeout);
        if (this.requestController === controller) {
          this.requestController = null;
        }
      }
    } catch {
      // Network error, timeout, lifecycle cancellation, or cache failure.
    }

    return { success: false };
  }

  private assertActive(generation: number): void {
    if (this.stopped || generation !== this.generation) {
      throw new DOMException('Ping service stopped', 'AbortError');
    }
  }

  private async performShutdown(timeoutMs: number): Promise<void> {
    this.stop();
    const activePing = this.activePingPromise;
    if (!activePing) return;

    let deadline: ReturnType<typeof setTimeout> | null = null;
    const timedOut = new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, timeoutMs);
      deadline.unref?.();
    });
    try {
      await Promise.race([
        activePing.then(() => undefined, () => undefined),
        timedOut,
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }
}

// Singleton instance for easy access
let pingServiceInstance: PingService | null = null;

/**
 * Initialize the ping service (call once at startup)
 */
export function initPingService(options: {
  cliVersion: string;
  clientType?: 'cli' | 'vscode' | 'zed' | 'unknown';
}): PingService {
  if (!pingServiceInstance) {
    pingServiceInstance = new PingService(options);
  }
  return pingServiceInstance;
}

/**
 * Get the ping service instance
 */
export function getPingService(): PingService | null {
  return pingServiceInstance;
}

/**
 * Start the ping service if initialized
 */
export function startPingService(): void {
  pingServiceInstance?.start();
}

/**
 * Stop the ping service
 */
export function stopPingService(): void {
  pingServiceInstance?.stop();
}

export async function shutdownPingService(
  options?: { timeoutMs?: number },
): Promise<void> {
  await pingServiceInstance?.shutdown(options);
}
