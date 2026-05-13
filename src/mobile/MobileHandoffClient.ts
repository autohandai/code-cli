/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_FILES } from '../constants.js';
import type { LoadedConfig, ProviderName } from '../types.js';
import packageJson from '../../package.json' with { type: 'json' };

const DEFAULT_API_BASE_URL = 'https://api.autohand.ai';
const DEFAULT_TIMEOUT_MS = 10_000;

export interface CreateMobilePairingPayload {
  deviceId: string;
  sessionId: string;
  workspacePath: string;
  projectName: string;
  model?: string;
  provider?: ProviderName;
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisterMobileDevicePayload {
  deviceId: string;
  clientType?: string;
  agentName?: string;
  metadata?: Record<string, unknown>;
}

export interface MobilePairing {
  id: string;
  pairingUrl: string;
  expiresAt: string;
  pollIntervalMs: number;
  session: {
    id: string;
    deviceId: string;
    workspacePath: string;
    projectName: string;
    model: string | null;
    provider: string | null;
  };
}

export interface MobilePairingResponse {
  success: true;
  pairing: MobilePairing;
}

export interface ClaimedWorkItem {
  id: string;
  repo: string;
  branch: string;
  prompt: string;
  priority: number;
  status: string;
  agentId: string | null;
  deviceId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
}

export interface WorkClaimResponse {
  success: boolean;
  work?: ClaimedWorkItem;
  error?: string;
}

export interface MobileHandoffClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface MobileHandoffClientLike {
  getDeviceId(): Promise<string>;
  registerDevice(token: string, payload: RegisterMobileDevicePayload): Promise<void>;
  createPairing(token: string, payload: CreateMobilePairingPayload): Promise<MobilePairing>;
  claimWork(token: string, deviceId: string): Promise<ClaimedWorkItem | null>;
}

export function getMobileApiBaseUrl(config?: LoadedConfig): string {
  return (
    config?.api?.baseUrl ||
    process.env.AUTOHAND_API_URL ||
    DEFAULT_API_BASE_URL
  ).replace(/\/+$/, '');
}

export class MobileHandoffClient implements MobileHandoffClientLike {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: MobileHandoffClientConfig = {}) {
    this.baseUrl = (config.baseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getDeviceId(): Promise<string> {
    try {
      await fs.ensureDir(path.dirname(AUTOHAND_FILES.deviceId));
      if (await fs.pathExists(AUTOHAND_FILES.deviceId)) {
        const existing = (await fs.readFile(AUTOHAND_FILES.deviceId, 'utf8')).trim();
        if (existing) return existing;
      }

      const next = crypto.randomUUID();
      await fs.writeFile(AUTOHAND_FILES.deviceId, next);
      return next;
    } catch {
      return crypto.randomUUID();
    }
  }

  async registerDevice(token: string, payload: RegisterMobileDevicePayload): Promise<void> {
    await this.request('/v1/devices/register', token, {
      method: 'POST',
      body: JSON.stringify({
        deviceId: payload.deviceId,
        clientType: payload.clientType ?? 'cli',
        agentName: payload.agentName,
        metadata: payload.metadata,
      }),
      headers: {
        'X-Device-ID': payload.deviceId,
      },
    });
  }

  async createPairing(token: string, payload: CreateMobilePairingPayload): Promise<MobilePairing> {
    const data = await this.request<Partial<MobilePairingResponse> & { error?: string }>(
      '/v1/mobile/pairings',
      token,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'X-CLI-Version': packageJson.version,
          'X-Device-ID': payload.deviceId,
        },
      }
    );

    if (data.success !== true || !data.pairing?.pairingUrl) {
      throw new Error(data.error || 'Invalid mobile pairing response');
    }

    return data.pairing;
  }

  async claimWork(token: string, deviceId: string): Promise<ClaimedWorkItem | null> {
    const data = await this.request<WorkClaimResponse>(
      '/v1/work/claim',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ deviceId }),
        headers: {
          'X-Device-ID': deviceId,
        },
        allowNotFound: true,
      }
    );

    if (data.success === false && data.error === 'No work available') {
      return null;
    }

    if (!data.success || !data.work) {
      throw new Error(data.error || 'Invalid work claim response');
    }

    return data.work;
  }

  private async request<T = unknown>(
    path: string,
    token: string,
    options: {
      method: string;
      body?: string;
      headers?: Record<string, string>;
      allowNotFound?: boolean;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      });

      if (options.allowNotFound && response.status === 404) {
        const data = await response.json().catch(() => ({ success: false, error: 'No work available' }));
        return data as T;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new Error(`API error: ${response.status} ${text}`);
      }

      return await response.json() as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
