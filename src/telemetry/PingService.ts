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

const PING_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const PING_CACHE_FILE = path.join(AUTOHAND_HOME, 'last-ping.json');
const API_BASE_URL = process.env.AUTOHAND_API_URL || 'https://api.autohand.ai';
const REQUEST_TIMEOUT_MS = 5000;

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
  private async updateCache(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(PING_CACHE_FILE));
      const cache: PingCache = {
        lastPing: new Date().toISOString(),
        pingDate: new Date().toISOString().split('T')[0],
      };
      await fs.writeJson(PING_CACHE_FILE, cache, { spaces: 2 });
    } catch {
      // Silently fail - ping should never break the CLI
    }
  }

  /**
   * Send a ping to the API
   */
  async ping(): Promise<{ success: boolean; updateAvailable?: boolean; latestVersion?: string }> {
    if (this.isPinging) {
      return { success: false };
    }

    // Skip if disabled via environment variable
    if (process.env.AUTOHAND_SKIP_PING === '1') {
      return { success: false };
    }

    // Check cache to avoid excessive pings
    const shouldPing = await this.shouldPing();
    if (!shouldPing) {
      return { success: true };
    }

    this.isPinging = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

      clearTimeout(timeout);

      if (response.ok) {
        await this.updateCache();
        const data = await response.json() as {
          success: boolean;
          updateAvailable?: boolean;
          latestVersion?: string;
        };
        return {
          success: true,
          updateAvailable: data.updateAvailable,
          latestVersion: data.latestVersion,
        };
      }
    } catch {
      // Network error, timeout, or abort - silently fail
    } finally {
      this.isPinging = false;
    }

    return { success: false };
  }

  /**
   * Start periodic ping timer (every 45 minutes)
   */
  start(): void {
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
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Get device ID
   */
  getDeviceId(): string {
    return this.deviceId;
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
