/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import packageJson from '../../package.json' with { type: 'json' };
import type { LoadedConfig } from '../types.js';
import {
  parseAnnouncementResponse,
  type ApiAnnouncement,
} from './AnnouncementContent.js';

const ANNOUNCEMENT_REQUEST_TIMEOUT_MS = 1500;

type FetchLike = (input: URL | string, init?: RequestInit) => Promise<Response>;

export interface AnnouncementClientOptions {
  fetch?: FetchLike;
  clientVersion?: string;
  platform?: NodeJS.Platform;
  requestTimeoutMs?: number;
}

export class AnnouncementClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImplementation: FetchLike;
  private readonly clientVersion: string;
  private readonly platform: NodeJS.Platform;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly config: LoadedConfig,
    options: AnnouncementClientOptions = {},
  ) {
    this.apiBaseUrl = (
      config.api?.baseUrl
      || config.telemetry?.apiBaseUrl
      || 'https://api.autohand.ai'
    ).replace(/\/+$/u, '');
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.clientVersion = options.clientVersion ?? packageJson.version;
    this.platform = options.platform ?? process.platform;
    this.requestTimeoutMs = options.requestTimeoutMs ?? ANNOUNCEMENT_REQUEST_TIMEOUT_MS;
  }

  async fetchAnnouncements(): Promise<ApiAnnouncement[] | null> {
    const token = this.config.auth?.token?.trim();
    if (!token) {
      return null;
    }

    const url = new URL(`${this.apiBaseUrl}/v1/announcements`);
    url.searchParams.set('clientType', 'cli');
    url.searchParams.set('appVersion', this.clientVersion);
    url.searchParams.set('platform', this.platform);

    const response = await this.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response?.ok) {
      return null;
    }

    try {
      return parseAnnouncementResponse(await response.json());
    } catch {
      return null;
    }
  }

  async postSeen(id: string, lastStep: number | null): Promise<void> {
    const body = lastStep === null ? {} : { lastStep };
    void this.post(id, 'seen', body);
  }

  async postDismiss(id: string): Promise<void> {
    void this.post(id, 'dismiss');
  }

  private async post(
    id: string,
    action: 'seen' | 'dismiss',
    body?: Record<string, unknown>,
  ): Promise<void> {
    const token = this.config.auth?.token?.trim();
    if (!token) {
      return;
    }

    const url = new URL(
      `${this.apiBaseUrl}/v1/announcements/${encodeURIComponent(id)}/${action}`,
    );
    await this.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  private async request(url: URL, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImplementation(url, {
        ...init,
        signal: controller.signal,
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
