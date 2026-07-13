/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  MobileHandoffClientLike,
  MobileImageAttachment,
  MobileImageMimeType,
  MobileAction,
  MobileDeliveryStatusSnapshot,
  MobileDeploymentStatus,
  MobileEventPayloadMap,
  MobileEventType,
  MobileKeepAwakeStatus,
  MobilePullRequestReview,
} from './MobileHandoffClient.js';
import { randomUUID } from 'node:crypto';
import type { PermissionPromptResponse, PermissionPromptResult } from '../permissions/types.js';
import { collectMobileDeliveryStatus, mergeMobilePullRequest } from './MobileDeliveryStatus.js';
import type { MobilePullRequestMergeRequest, MobilePullRequestMergeResult } from './MobileDeliveryStatus.js';
import { KeepAwakeController } from './KeepAwakeController.js';
import { collectAndUploadMobileArtifacts } from './MobileArtifacts.js';

export interface MobileChangePreview {
  id: string;
  filePath: string;
  changeType: 'create' | 'modify' | 'delete';
  originalContent: string;
  proposedContent: string;
  description: string;
  toolId: string;
  toolName: string;
}

export type MobileChangesDecision = {
  action: 'accept_all' | 'reject_all' | 'accept_selected';
  selectedChangeIds?: string[];
};

interface MobileRelayOptions {
  client: MobileHandoffClientLike;
  token: string;
  deviceId: string;
  sessionId: string;
  pairingId?: string;
  mode: 'queue' | 'steer';
  pollIntervalMs: number;
  enqueueInstruction: (instruction: string) => void;
  enqueueInstructionWithImages?: (instruction: string, images: MobileImageAttachment[]) => void;
  workspaceRoot?: string;
  deliveryStatusProvider?: () => Promise<MobileDeliveryStatusSnapshot>;
  keepAwakeController?: KeepAwakeController;
  keepAwakeByDefault?: boolean;
  mergePullRequest?: (request: MobilePullRequestMergeRequest) => Promise<MobilePullRequestMergeResult>;
  onError?: (error: Error) => void;
}

export interface MobileRelayController {
  requestPermission(
    message: string,
    context?: { tool?: string; path?: string; command?: string }
  ): Promise<PermissionPromptResponse>;
  requestDirectoryAccess(path: string, reason?: string): Promise<string | undefined>;
  publishEvent<EventType extends MobileEventType>(
    eventType: EventType,
    payload: MobileEventPayloadMap[EventType],
    requestId?: string
  ): Promise<void>;
  publishPullRequestStatus(pullRequest: MobilePullRequestReview): Promise<void>;
  publishDeploymentStatus(deployments: MobileDeploymentStatus[]): Promise<void>;
  refreshDeliveryStatus(): Promise<void>;
  publishArtifactsFromText(text: string): Promise<void>;
  setKeepAwake(enabled: boolean): Promise<MobileKeepAwakeStatus>;
  setSessionControlHandler(handler: (command: 'cancel') => void): void;
  requestChangesDecision(batchId: string, changes: MobileChangePreview[]): Promise<MobileChangesDecision>;
}

const MAX_MOBILE_IMAGE_BASE64_LENGTH = 5_000_000;
const MOBILE_IMAGE_MIME_TYPES: readonly MobileImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

function decodeMobileImages(payload: Record<string, unknown> | null): MobileImageAttachment[] {
  const rawImages = payload?.images;
  if (!Array.isArray(rawImages)) return [];

  return rawImages.flatMap((value): MobileImageAttachment[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const image = value as Record<string, unknown>;
    const data = typeof image.data === 'string' ? image.data : '';
    const mimeType = typeof image.mimeType === 'string' ? image.mimeType : '';
    if (
      !data ||
      data.length > MAX_MOBILE_IMAGE_BASE64_LENGTH ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data) ||
      !MOBILE_IMAGE_MIME_TYPES.includes(mimeType as MobileImageMimeType)
    ) {
      return [];
    }

    return [{
      data,
      mimeType: mimeType as MobileImageMimeType,
      filename: typeof image.filename === 'string' && image.filename.trim()
        ? image.filename.trim()
        : undefined,
    }];
  });
}

let activeRelay: {
  deviceId: string;
  timer: ReturnType<typeof setInterval>;
  polling: boolean;
  actionCursor: number;
  pendingActions: Map<string, {
    kind: 'permission' | 'directory' | 'changes';
    path?: string;
    resolve: (value: PermissionPromptResponse | string | MobileChangesDecision | undefined) => void;
  }>;
  sessionControlHandler?: (command: 'cancel') => void;
  keepAwakeController: KeepAwakeController;
} | null = null;

export function startMobileRelay(options: MobileRelayOptions): MobileRelayController {
  stopMobileRelay();
  const keepAwakeController = options.keepAwakeController ?? new KeepAwakeController();

  activeRelay = {
    deviceId: options.deviceId,
    timer: setInterval(() => {
      void pollOnce(options);
    }, Math.max(options.pollIntervalMs, 1_000)),
    polling: false,
    actionCursor: 0,
    pendingActions: new Map(),
    keepAwakeController,
  };

  activeRelay.timer.unref?.();
  void pollOnce(options);
  if (options.keepAwakeByDefault !== undefined) {
    const keepAwakeState = options.keepAwakeByDefault
      ? keepAwakeController.enable()
      : keepAwakeController.disable();
    void publishKeepAwakeStatus(options, keepAwakeState);
  }

  return {
    requestPermission: (message, context) => requestPermission(options, message, context),
    requestDirectoryAccess: (path, reason) => requestDirectoryAccess(options, path, reason),
    publishEvent: (eventType, payload, requestId) => publishEvent(options, eventType, payload, requestId),
    publishPullRequestStatus: (pullRequest) => publishEvent(options, 'pull_request_status', { pullRequest }),
    publishDeploymentStatus: (deployments) => publishEvent(options, 'deployment_status', { deployments }),
    refreshDeliveryStatus: () => refreshDeliveryStatus(options),
    publishArtifactsFromText: async (text) => {
      if (!options.workspaceRoot) return;
      try {
        const artifacts = await collectAndUploadMobileArtifacts({
          text,
          workspaceRoot: options.workspaceRoot,
          client: options.client,
          token: options.token,
          sessionId: options.sessionId,
          deviceId: options.deviceId,
        });
        if (artifacts.length > 0) await publishEvent(options, 'session_artifacts', { artifacts });
      } catch (error) {
        options.onError?.(error as Error);
      }
    },
    setKeepAwake: (enabled) => setKeepAwake(options, enabled),
    setSessionControlHandler: (handler) => {
      if (activeRelay?.deviceId === options.deviceId) {
        activeRelay.sessionControlHandler = handler;
      }
    },
    requestChangesDecision: (batchId, changes) => requestChangesDecision(options, batchId, changes),
  };
}

export function stopMobileRelay(): void {
  if (!activeRelay) return;
  clearInterval(activeRelay.timer);
  activeRelay.keepAwakeController.dispose();
  for (const pending of activeRelay.pendingActions.values()) {
    pending.resolve(
      pending.kind === 'permission'
        ? { decision: 'deny_once' }
        : pending.kind === 'changes'
          ? { action: 'reject_all' }
          : undefined
    );
  }
  activeRelay.pendingActions.clear();
  activeRelay = null;
}

async function pollOnce(options: MobileRelayOptions): Promise<void> {
  if (!activeRelay || activeRelay.deviceId !== options.deviceId || activeRelay.polling) {
    return;
  }

  activeRelay.polling = true;
  try {
    try {
      await options.client.sendRelayHeartbeat(options.token, {
        sessionId: options.sessionId,
        deviceId: options.deviceId,
        pairingId: options.pairingId,
        mode: options.mode,
      });
    } catch (error) {
      options.onError?.(error as Error);
    }

    const work = await options.client.claimWork(options.token, options.deviceId);
    if (work?.prompt) {
      const images = decodeMobileImages(work.payload);
      if (images.length > 0 && options.enqueueInstructionWithImages) {
        options.enqueueInstructionWithImages(work.prompt, images);
      } else {
        options.enqueueInstruction(work.prompt);
      }
    }

    if (options.client.pollMobileActions) {
      const actions = await options.client.pollMobileActions(
        options.token,
        options.sessionId,
        options.deviceId,
        activeRelay.actionCursor
      );
      activeRelay.actionCursor = Math.max(activeRelay.actionCursor, actions.nextCursor);
      for (const action of actions.actions) {
        await resolveAction(action, options);
      }
    }
  } catch (error) {
    options.onError?.(error as Error);
  } finally {
    if (activeRelay?.deviceId === options.deviceId) {
      activeRelay.polling = false;
    }
  }
}

async function publishEvent<EventType extends MobileEventType>(
  options: MobileRelayOptions,
  eventType: EventType,
  payload: MobileEventPayloadMap[EventType],
  requestId?: string
): Promise<void> {
  if (!options.client.publishMobileEvent) {
    throw new Error('Mobile event transport is unavailable in this CLI client');
  }

  await options.client.publishMobileEvent(options.token, {
    sessionId: options.sessionId,
    deviceId: options.deviceId,
    pairingId: options.pairingId,
    eventType,
    requestId,
    payload,
  });
}

async function refreshDeliveryStatus(options: MobileRelayOptions): Promise<void> {
  if (!options.client.publishMobileEvent) return;

  try {
    let snapshot: MobileDeliveryStatusSnapshot;
    if (options.deliveryStatusProvider) {
      snapshot = await options.deliveryStatusProvider();
    } else if (options.workspaceRoot) {
      snapshot = await collectMobileDeliveryStatus(options.workspaceRoot);
    } else {
      return;
    }
    if (snapshot.pullRequest) {
      await publishEvent(options, 'pull_request_status', { pullRequest: snapshot.pullRequest });
    }
    if (snapshot.deployments.length > 0) {
      await publishEvent(options, 'deployment_status', { deployments: snapshot.deployments });
    }
  } catch (error) {
    options.onError?.(error as Error);
  }
}

async function publishKeepAwakeStatus(
  options: MobileRelayOptions,
  status: MobileKeepAwakeStatus
): Promise<void> {
  if (!options.client.publishMobileEvent) return;
  try {
    await publishEvent(options, 'keep_awake_status', status);
  } catch (error) {
    options.onError?.(error as Error);
  }
}

async function setKeepAwake(
  options: MobileRelayOptions,
  enabled: boolean
): Promise<MobileKeepAwakeStatus> {
  const controller = activeRelay?.deviceId === options.deviceId
    ? activeRelay.keepAwakeController
    : options.keepAwakeController ?? new KeepAwakeController();
  const status = enabled ? controller.enable() : controller.disable();
  await publishKeepAwakeStatus(options, status);
  return status;
}

function waitForAction<T extends PermissionPromptResponse | string | MobileChangesDecision | undefined>(
  options: MobileRelayOptions,
  requestId: string,
  pending: { kind: 'permission' | 'directory' | 'changes'; path?: string },
  fallback: T
): Promise<T> {
  const relay = activeRelay;
  if (!relay || relay.deviceId !== options.deviceId || !options.client.publishMobileEvent || !options.client.pollMobileActions) {
    return Promise.resolve(fallback);
  }

  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      relay.pendingActions.delete(requestId);
      resolve(fallback);
    }, 60 * 60 * 1000);
    relay.pendingActions.set(requestId, {
      ...pending,
      resolve: (value) => {
        clearTimeout(timer);
        relay.pendingActions.delete(requestId);
        resolve(value as T);
      },
    });
  });
}

function cancelAction(requestId: string): void {
  activeRelay?.pendingActions.delete(requestId);
}

async function requestPermission(
  options: MobileRelayOptions,
  message: string,
  context?: { tool?: string; path?: string; command?: string }
): Promise<PermissionPromptResponse> {
  const requestId = `mobile-perm-${randomUUID()}`;
  const fallback: PermissionPromptResult = { decision: 'deny_once' };
  const response = waitForAction<PermissionPromptResponse>(options, requestId, {
    kind: 'permission',
  }, fallback);

  try {
    await publishEvent(options, 'permission_request', {
      message,
      tool: context?.tool,
      context: context || {},
      options: ['allow_once', 'deny_once', 'allow_session', 'deny_session', 'alternative'],
    }, requestId);
  } catch (error) {
    cancelAction(requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function requestDirectoryAccess(
  options: MobileRelayOptions,
  path: string,
  reason?: string
): Promise<string | undefined> {
  const requestId = `mobile-dir-${randomUUID()}`;
  const fallback = undefined;
  const response = waitForAction<string | undefined>(options, requestId, {
    kind: 'directory',
    path,
  }, fallback);

  try {
    await publishEvent(options, 'directory_access_request', { path, reason }, requestId);
  } catch (error) {
    cancelAction(requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function requestChangesDecision(
  options: MobileRelayOptions,
  batchId: string,
  changes: MobileChangePreview[]
): Promise<MobileChangesDecision> {
  const requestId = `mobile-changes-${randomUUID()}`;
  const fallback: MobileChangesDecision = { action: 'reject_all' };
  const response = waitForAction<MobileChangesDecision>(options, requestId, {
    kind: 'changes',
  }, fallback);

  try {
    await publishEvent(options, 'changes_batch', { batchId, changes }, requestId);
  } catch (error) {
    cancelAction(requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function resolveAction(action: MobileAction, options: MobileRelayOptions): Promise<void> {
  const relay = activeRelay;
  if (!relay) return;

  if (action.actionType === 'keep_awake_control' && typeof action.payload.enabled === 'boolean') {
    await setKeepAwake(options, action.payload.enabled);
    return;
  }

  if (action.actionType === 'session_control' && action.payload.command === 'cancel') {
    relay.sessionControlHandler?.('cancel');
    return;
  }

  if (action.actionType === 'pull_request_merge') {
    const pullRequestNumber = action.payload.pullRequestNumber;
    const expectedHeadBranch = action.payload.expectedHeadBranch;
    if (
      Number.isInteger(pullRequestNumber)
      && Number(pullRequestNumber) > 0
      && typeof expectedHeadBranch === 'string'
      && expectedHeadBranch.length > 0
      && action.payload.method === 'squash'
    ) {
      const request: MobilePullRequestMergeRequest = {
        pullRequestNumber: Number(pullRequestNumber),
        expectedHeadBranch,
        method: 'squash',
      };
      const result = options.mergePullRequest
        ? await options.mergePullRequest(request)
        : options.workspaceRoot
          ? await mergeMobilePullRequest(options.workspaceRoot, request)
          : {
              pullRequestNumber: request.pullRequestNumber,
              status: 'failed' as const,
              message: 'The relay has no workspace root for GitHub operations.',
            };
      await publishEvent(options, 'pull_request_merge_result', result);
      await refreshDeliveryStatus(options);
    }
    return;
  }

  if (!action.requestId) return;
  const pending = relay.pendingActions.get(action.requestId);
  if (!pending) return;

  if (pending.kind === 'directory' && action.actionType === 'directory_access_response') {
    pending.resolve(action.payload.granted === true ? pending.path : undefined);
    return;
  }

  if (pending.kind === 'permission' && action.actionType === 'permission_response') {
    const decision = action.payload.decision;
    if (typeof decision === 'string' && [
      'allow_once', 'deny_once', 'allow_session', 'deny_session', 'alternative',
    ].includes(decision)) {
      pending.resolve({
        decision: decision as PermissionPromptResult['decision'],
        alternative: typeof action.payload.alternative === 'string' ? action.payload.alternative : undefined,
      });
      return;
    }
    pending.resolve({ decision: action.payload.allowed === true ? 'allow_once' : 'deny_once' });
    return;
  }

  if (pending.kind === 'changes' && action.actionType === 'changes_decision') {
    const decision = action.payload.action;
    if (decision === 'accept_all' || decision === 'reject_all' || decision === 'accept_selected') {
      pending.resolve({
        action: decision,
        selectedChangeIds: Array.isArray(action.payload.selectedChangeIds)
          ? action.payload.selectedChangeIds.filter((value): value is string => typeof value === 'string')
          : undefined,
      });
    }
  }
}
