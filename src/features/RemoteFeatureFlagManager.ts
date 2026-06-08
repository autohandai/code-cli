/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { LoadedConfig } from '../types.js';
import { AUTOHAND_FILES } from '../constants.js';
import { isLocalFeatureId } from './featureRegistry.js';
import packageJson from '../../package.json' with { type: 'json' };

export interface RemoteFeatureFlag {
  key: string;
  enabled: boolean;
  reason: string;
  userOverridable: boolean;
  clientTypes?: string[];
}

export interface RemoteFeatureFlagSnapshot {
  success: true;
  environment: string;
  flags: RemoteFeatureFlag[];
  evaluatedAt: string;
  ttlSeconds: number;
}

interface RemoteFeatureFlagResponse {
  success?: boolean;
  environment?: unknown;
  flags?: unknown;
  evaluatedAt?: unknown;
  ttlSeconds?: unknown;
}

export interface FeatureFlagActivationEvent {
  key: string;
  metadata?: Record<string, unknown>;
}

export interface LoadRemoteFeatureFlagsOptions {
  forceRefresh?: boolean;
  allowCachedFallback?: boolean;
}

const FEATURE_FLAG_REQUEST_TIMEOUT_MS = 1500;
const CLI_CLIENT_TYPE = 'cli';

function getApiBaseUrl(config: LoadedConfig): string {
  return (config.api?.baseUrl || config.telemetry?.apiBaseUrl || 'https://api.autohand.ai').replace(/\/+$/, '');
}

function readDeviceId(): string {
  try {
    fs.ensureDirSync(path.dirname(AUTOHAND_FILES.deviceId));
    if (fs.existsSync(AUTOHAND_FILES.deviceId)) {
      const existing = fs.readFileSync(AUTOHAND_FILES.deviceId, 'utf8').trim();
      if (existing) return existing;
    }
    const next = crypto.randomUUID();
    fs.writeFileSync(AUTOHAND_FILES.deviceId, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function parseSnapshot(value: RemoteFeatureFlagResponse): RemoteFeatureFlagSnapshot | null {
  if (value.success !== true || !Array.isArray(value.flags)) return null;
  const flags: RemoteFeatureFlag[] = [];

  for (const flag of value.flags) {
    if (!flag || typeof flag !== 'object') continue;
    const candidate = flag as Record<string, unknown>;
    if (typeof candidate.key !== 'string' || typeof candidate.enabled !== 'boolean') continue;
    const clientTypes = parseClientTypes(candidate);
    if (!isCliFeatureFlag(candidate, clientTypes)) continue;
    flags.push({
      key: candidate.key,
      enabled: candidate.enabled,
      reason: typeof candidate.reason === 'string' ? candidate.reason : 'unknown',
      userOverridable: candidate.userOverridable !== false,
      ...(clientTypes.length > 0 ? { clientTypes } : {}),
    });
  }

  return {
    success: true,
    environment: typeof value.environment === 'string' ? value.environment : 'production',
    flags,
    evaluatedAt: typeof value.evaluatedAt === 'string' ? value.evaluatedAt : new Date().toISOString(),
    ttlSeconds: typeof value.ttlSeconds === 'number' ? value.ttlSeconds : 300,
  };
}

function parseClientTypes(candidate: Record<string, unknown>): string[] {
  const values = [
    candidate.clientType,
    candidate.clientTypes,
    candidate.client_type,
    candidate.client_types,
    candidate.clients,
    candidate.targetClients,
    candidate.target_clients,
  ];
  const clientTypes = new Set<string>();

  for (const value of values) {
    if (typeof value === 'string') {
      for (const item of value.split(',')) {
        const clientType = item.trim();
        if (clientType) clientTypes.add(clientType);
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          clientTypes.add(item);
        }
      }
    }
  }

  return [...clientTypes].map((clientType) => clientType.toLowerCase());
}

function isCliFeatureFlag(candidate: Record<string, unknown>, clientTypes: string[]): boolean {
  if (isArchivedFeatureFlag(candidate)) {
    return false;
  }

  const reason = typeof candidate.reason === 'string' ? candidate.reason.toLowerCase() : '';
  if (reason.includes('client_type mismatch') || reason.includes('client type mismatch')) {
    return false;
  }

  if (clientTypes.length > 0) {
    return clientTypes.includes(CLI_CLIENT_TYPE);
  }

  const platforms = candidate.platforms ?? candidate.targetPlatforms;
  if (Array.isArray(platforms)) {
    const platformValues = platforms.filter((platform): platform is string => typeof platform === 'string');
    return platformValues.length === 0 || platformValues.includes(process.platform);
  }

  return true;
}

function isArchivedFeatureFlag(candidate: Record<string, unknown>): boolean {
  if (candidate.archived === true || candidate.deleted === true) {
    return true;
  }

  const archivalFields = [
    candidate.status,
    candidate.state,
    candidate.lifecycle,
    candidate.reason,
  ];

  return archivalFields.some((value) => typeof value === 'string' && value.toLowerCase().includes('archived'));
}

function isSnapshotFresh(snapshot: RemoteFeatureFlagSnapshot): boolean {
  const evaluatedAt = Date.parse(snapshot.evaluatedAt);
  if (Number.isNaN(evaluatedAt)) return false;
  const ttlMs = Math.max(0, snapshot.ttlSeconds) * 1000;
  return Date.now() - evaluatedAt < ttlMs;
}

function createEvaluationUrl(config: LoadedConfig, deviceId: string, clientVersion: string): URL {
  const environment = config.features?.environment || 'production';
  const url = new URL(`${getApiBaseUrl(config)}/v1/feature-flags/evaluate`);
  url.searchParams.set('environment', environment);
  url.searchParams.set('clientType', CLI_CLIENT_TYPE);
  url.searchParams.set('deviceId', deviceId);
  url.searchParams.set('cliVersion', clientVersion);
  url.searchParams.set('platform', process.platform);
  return url;
}

async function downloadRemoteFeatureFlags(
  config: LoadedConfig,
  deviceId: string,
  clientVersion: string
): Promise<RemoteFeatureFlagSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FEATURE_FLAG_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(createEvaluationUrl(config, deviceId, clientVersion), { signal: controller.signal });
    if (!response.ok) return null;
    return parseSnapshot(await response.json() as RemoteFeatureFlagResponse);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function writeRemoteFeatureFlagCache(snapshot: RemoteFeatureFlagSnapshot): Promise<void> {
  await fs.ensureDir(path.dirname(AUTOHAND_FILES.featureFlagsCache));
  await fs.writeJson(AUTOHAND_FILES.featureFlagsCache, snapshot, { spaces: 2 });
}

export async function loadCachedRemoteFeatureFlags(): Promise<RemoteFeatureFlagSnapshot | null> {
  try {
    if (!await fs.pathExists(AUTOHAND_FILES.featureFlagsCache)) {
      return null;
    }
    const data = await fs.readJson(AUTOHAND_FILES.featureFlagsCache) as RemoteFeatureFlagResponse;
    return parseSnapshot(data);
  } catch {
    return null;
  }
}

export async function loadRemoteFeatureFlags(
  config: LoadedConfig,
  options: LoadRemoteFeatureFlagsOptions = {}
): Promise<RemoteFeatureFlagSnapshot | null> {
  const cached = await loadCachedRemoteFeatureFlags();
  if (!options.forceRefresh && cached && isSnapshotFresh(cached)) {
    return cached;
  }

  const downloaded = await downloadRemoteFeatureFlags(config, readDeviceId(), packageJson.version);
  if (downloaded) {
    await writeRemoteFeatureFlagCache(downloaded);
    return downloaded;
  }

  return options.allowCachedFallback === false ? null : cached;
}

export class RemoteFeatureFlagManager {
  private snapshot: RemoteFeatureFlagSnapshot | null = null;
  private readonly deviceId = readDeviceId();
  private readonly apiBaseUrl: string;
  private readonly environment: string;
  private readonly clientVersion: string;

  constructor(private readonly config: LoadedConfig) {
    this.apiBaseUrl = getApiBaseUrl(config);
    this.environment = config.features?.environment || 'production';
    this.clientVersion = packageJson.version;
  }

  async refreshFeatureFlags(): Promise<void> {
    const downloaded = await downloadRemoteFeatureFlags(this.config, this.deviceId, this.clientVersion);
    if (downloaded) {
      this.snapshot = downloaded;
      await writeRemoteFeatureFlagCache(downloaded);
      return;
    }

    this.snapshot = await loadCachedRemoteFeatureFlags();
  }

  getSnapshot(): RemoteFeatureFlagSnapshot | null {
    return this.snapshot;
  }

  isFeatureEnabled(key: string, localDefault = false): boolean {
    if (isLocalFeatureId(key)) {
      return localDefault;
    }

    const flag = this.snapshot?.flags.find((item) => item.key === key);
    if (!flag) return localDefault;
    if (!flag.enabled) return false;
    return this.config.features?.remoteOverrides?.[key] !== 'off';
  }

  async trackFeatureActivation(key: string, metadata?: Record<string, unknown>): Promise<void> {
    void metadata;
    const flag = this.snapshot?.flags.find((item) => item.key === key);
    if (!flag || !this.isFeatureEnabled(key)) return;

    try {
      await fetch(`${this.apiBaseUrl}/v1/feature-flags/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [{
            key,
            environment: this.environment,
            eventType: 'activation',
            enabled: true,
            reason: flag.reason,
            deviceId: this.deviceId,
            clientType: 'cli',
            cliVersion: this.clientVersion,
            platform: process.platform,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch {
      // Remote flag telemetry should never affect CLI behavior.
    }
  }

  getStatus() {
    return {
      apiBaseUrl: this.apiBaseUrl,
      environment: this.environment,
      deviceId: this.deviceId,
      platform: process.platform,
      osVersion: os.release(),
      evaluatedAt: this.snapshot?.evaluatedAt || null,
    };
  }
}
