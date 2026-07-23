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

export interface MobileSessionSnapshotMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface MobileSessionSnapshot {
  title: string;
  summary?: string;
  messageCount: number;
  lastActivity?: string;
  messages: MobileSessionSnapshotMessage[];
}

export interface RegisterMobileDevicePayload {
  deviceId: string;
  clientType?: string;
  agentName?: string;
  metadata?: Record<string, unknown>;
}

export interface MobileRelayHeartbeatPayload {
  sessionId: string;
  deviceId: string;
  pairingId?: string;
  mode: 'queue' | 'steer';
}

export interface MobileRelayHeartbeatResult {
  pairingClaimed: boolean;
  pairingStatus?: MobilePairingStatus;
}

export type MobilePairingStatus = 'pending' | 'claimed' | 'expired' | 'revoked';

const MOBILE_PAIRING_STATUSES = new Set<MobilePairingStatus>([
  'pending',
  'claimed',
  'expired',
  'revoked',
]);

export type MobileEventType =
  | 'permission_request'
  | 'permission_mode_status'
  | 'directory_access_request'
  | 'changes_batch'
  | 'session_turn_state'
  | 'pull_request_status'
  | 'deployment_status'
  | 'pull_request_merge_result'
  | 'session_artifacts'
  | 'keep_awake_status'
  | 'model_status';

export interface MobileKeepAwakeStatus {
  supported: boolean;
  enabled: boolean;
  reason?: string;
}

export interface MobileModelStatus {
  model: string;
  provider: string;
  status: 'applied' | 'failed';
  error?: string;
}

export type MobilePermissionMode = 'interactive' | 'restricted' | 'unrestricted';

export type MobilePermissionModeStatus =
  | {
    requestedMode: string;
    appliedMode: MobilePermissionMode;
    status: 'applied';
  }
  | {
    requestedMode: string;
    status: 'failed';
    error: string;
  };

export type MobileSessionTurnStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface MobileSessionTurnState {
  workId: string;
  status: MobileSessionTurnStatus;
  prompt?: string;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MobilePullRequestMergeResult {
  pullRequestNumber: number;
  status: 'merged' | 'rejected' | 'failed';
  message: string;
}

export type MobileArtifactKind = 'image' | 'video' | 'log';
export type MobileArtifactMimeType = 'image/png' | 'image/jpeg' | 'video/mp4' | 'text/plain' | 'application/json';

export interface MobileArtifact {
  id: string;
  name: string;
  kind: MobileArtifactKind;
  mimeType: MobileArtifactMimeType;
  byteSize: number;
  downloadPath: string;
}

export interface MobileArtifactUpload {
  deviceId: string;
  name: string;
  kind: MobileArtifactKind;
  mimeType: MobileArtifactMimeType;
  data: string;
}

export interface MobilePullRequestCheck {
  id: string;
  name: string;
  status: string;
  detail?: string;
  url?: string;
}

export interface MobilePullRequestReview {
  id: string;
  number?: number;
  title: string;
  url?: string;
  headBranch: string;
  baseBranch: string;
  status: string;
  mergeable?: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: MobilePullRequestCheck[];
  updatedAt?: string;
}

export interface MobileDeploymentStatus {
  id: string;
  name: string;
  environment?: string;
  status: string;
  detail?: string;
  previewURL?: string;
  logsURL?: string;
  updatedAt?: string;
}

export interface MobileDeliveryStatusSnapshot {
  pullRequest: MobilePullRequestReview | null;
  deployments: MobileDeploymentStatus[];
}

export interface MobileEventPayloadMap {
  permission_request: Record<string, unknown>;
  permission_mode_status: MobilePermissionModeStatus;
  directory_access_request: Record<string, unknown>;
  changes_batch: Record<string, unknown>;
  session_turn_state: MobileSessionTurnState;
  pull_request_status: { pullRequest: MobilePullRequestReview };
  deployment_status: { deployments: MobileDeploymentStatus[] };
  pull_request_merge_result: MobilePullRequestMergeResult;
  session_artifacts: { artifacts: MobileArtifact[] };
  keep_awake_status: MobileKeepAwakeStatus;
  model_status: MobileModelStatus;
}

interface MobileEventEnvelope {
  sessionId: string;
  deviceId: string;
  pairingId?: string;
  requestId?: string;
}

export type PublishMobileEventPayload<EventType extends MobileEventType = MobileEventType> =
  MobileEventEnvelope & {
    eventType: EventType;
    payload: MobileEventPayloadMap[EventType];
  };

export type MobileActionType =
  | 'permission_response'
  | 'set_permission_mode'
  | 'directory_access_response'
  | 'changes_decision'
  | 'session_control'
  | 'pull_request_merge'
  | 'keep_awake_control'
  | 'retry_turn'
  | 'set_model';

export interface MobileAction {
  id: string;
  sequence: number;
  actionType: MobileActionType;
  requestId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface MobileActionPollResponse {
  actions: MobileAction[];
  nextCursor: number;
}

export type MobileImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface MobileImageAttachment {
  data: string;
  mimeType: MobileImageMimeType;
  filename?: string;
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
  deliveryMode?: string | null;
}

export interface MobileWorkClaimScope {
  deliveryMode: 'steer';
  sessionId: string;
  pairingId: string;
}

export interface WorkClaimResponse {
  success: boolean;
  work?: ClaimedWorkItem;
  error?: string;
}

export interface MobileWorkUpdatePayload {
  status: 'completed' | 'failed' | 'cancelled';
  completedAt: string;
  error?: string;
  payload?: {
    deliveryState?: 'completed' | 'failed' | 'cancelled';
    executionState?: 'completed' | 'failed' | 'cancelled';
  };
}

export interface MobileHandoffClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface MobileHandoffClientLike {
  getDeviceId(): Promise<string>;
  registerDevice(token: string, payload: RegisterMobileDevicePayload): Promise<void>;
  createPairing(token: string, payload: CreateMobilePairingPayload): Promise<MobilePairing>;
  sendRelayHeartbeat(token: string, payload: MobileRelayHeartbeatPayload): Promise<MobileRelayHeartbeatResult>;
  claimWork(
    token: string,
    deviceId: string,
    scope?: MobileWorkClaimScope
  ): Promise<ClaimedWorkItem | null>;
  updateWork?(
    token: string,
    deviceId: string,
    workId: string,
    payload: MobileWorkUpdatePayload
  ): Promise<ClaimedWorkItem>;
  publishMobileEvent?<EventType extends MobileEventType>(
    token: string,
    payload: PublishMobileEventPayload<EventType>
  ): Promise<void>;
  pollMobileActions?(
    token: string,
    sessionId: string,
    deviceId: string,
    after: number,
    pairingId?: string
  ): Promise<MobileActionPollResponse>;
  uploadMobileArtifact?(token: string, sessionId: string, artifact: MobileArtifactUpload): Promise<MobileArtifact>;
}

export function getMobileApiBaseUrl(config?: LoadedConfig): string {
  const baseUrl = (
    process.env.AUTOHAND_API_URL?.trim() ||
    config?.api?.baseUrl?.trim() ||
    DEFAULT_API_BASE_URL
  );
  return baseUrl.replace(/\/+$/, '');
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

  async sendRelayHeartbeat(
    token: string,
    payload: MobileRelayHeartbeatPayload
  ): Promise<MobileRelayHeartbeatResult> {
    const data = await this.request<{
      success?: boolean;
      pairing?: { status?: string } | null;
    }>(`/v1/mobile/sessions/${encodeURIComponent(payload.sessionId)}/heartbeat`, token, {
      method: 'POST',
      body: JSON.stringify({
        deviceId: payload.deviceId,
        pairingId: payload.pairingId,
        mode: payload.mode,
      }),
      headers: {
        'X-Device-ID': payload.deviceId,
      },
    });

    const pairingStatus = data.pairing?.status;
    const typedPairingStatus = pairingStatus && MOBILE_PAIRING_STATUSES.has(pairingStatus as MobilePairingStatus)
      ? pairingStatus as MobilePairingStatus
      : undefined;

    return {
      pairingClaimed: data.success === true && typedPairingStatus === 'claimed',
      ...(typedPairingStatus ? { pairingStatus: typedPairingStatus } : {}),
    };
  }

  async claimWork(
    token: string,
    deviceId: string,
    scope?: MobileWorkClaimScope
  ): Promise<ClaimedWorkItem | null> {
    const data = await this.request<WorkClaimResponse>(
      '/v1/work/claim',
      token,
      {
        method: 'POST',
        body: JSON.stringify({ deviceId, ...scope }),
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

  async updateWork(
    token: string,
    deviceId: string,
    workId: string,
    payload: MobileWorkUpdatePayload
  ): Promise<ClaimedWorkItem> {
    const data = await this.request<WorkClaimResponse>(
      `/v1/work/${encodeURIComponent(workId)}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
        headers: {
          'X-Device-ID': deviceId,
        },
      }
    );

    if (!data.success || !data.work) {
      throw new Error(data.error || 'Invalid work update response');
    }

    return data.work;
  }

  async publishMobileEvent<EventType extends MobileEventType>(
    token: string,
    payload: PublishMobileEventPayload<EventType>
  ): Promise<void> {
    await this.request(`/v1/mobile/sessions/${encodeURIComponent(payload.sessionId)}/events`, token, {
      method: 'POST',
      body: JSON.stringify({
        deviceId: payload.deviceId,
        pairingId: payload.pairingId,
        eventType: payload.eventType,
        requestId: payload.requestId,
        payload: payload.payload,
      }),
      headers: {
        'X-Device-ID': payload.deviceId,
      },
    });
  }

  async pollMobileActions(
    token: string,
    sessionId: string,
    deviceId: string,
    after: number,
    pairingId?: string
  ): Promise<MobileActionPollResponse> {
    const query = new URLSearchParams({ after: String(Math.max(after, 0)) });
    if (pairingId) query.set('pairingId', pairingId);
    const data = await this.request<MobileActionPollResponse>(
      `/v1/mobile/sessions/${encodeURIComponent(sessionId)}/actions?${query.toString()}`,
      token,
      {
        method: 'GET',
        headers: {
          'X-Device-ID': deviceId,
        },
      }
    );
    return data;
  }

  async uploadMobileArtifact(
    token: string,
    sessionId: string,
    artifact: MobileArtifactUpload
  ): Promise<MobileArtifact> {
    const data = await this.request<{ success: boolean; artifact?: MobileArtifact; error?: string }>(
      `/v1/mobile/sessions/${encodeURIComponent(sessionId)}/artifacts`,
      token,
      {
        method: 'POST',
        body: JSON.stringify(artifact),
        headers: { 'X-Device-ID': artifact.deviceId },
      }
    );
    if (!data.success || !data.artifact) throw new Error(data.error || 'Invalid artifact upload response');
    return data.artifact;
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
