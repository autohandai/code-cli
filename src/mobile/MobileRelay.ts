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
  MobileModelStatus,
  MobilePermissionMode,
  MobilePermissionModeStatus,
  MobilePullRequestReview,
  MobileSessionTurnState,
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

export interface MobilePermissionModeChange {
  previousMode: MobilePermissionMode;
  appliedMode: MobilePermissionMode;
  rollbackIfCurrent(): boolean;
}

interface MobileRelayOptions {
  client: MobileHandoffClientLike;
  token: string;
  deviceId: string;
  sessionId: string;
  pairingId: string;
  mode: 'queue' | 'steer';
  pollIntervalMs: number;
  enqueueInstruction: (instruction: string, context: MobileClaimedTurnContext) => void;
  enqueueInstructionWithImages?: (
    instruction: string,
    images: MobileImageAttachment[],
    context: MobileClaimedTurnContext
  ) => void;
  workspaceRoot?: string;
  deliveryStatusProvider?: () => Promise<MobileDeliveryStatusSnapshot>;
  keepAwakeController?: KeepAwakeController;
  keepAwakeByDefault?: boolean;
  mergePullRequest?: (request: MobilePullRequestMergeRequest) => Promise<MobilePullRequestMergeResult>;
  applyPermissionMode?: (mode: MobilePermissionMode) => MobilePermissionModeChange;
  onMobileConnected?: (message: string) => void;
  onMobileDisconnected?: (message: string) => void;
  onError?: (error: Error) => void;
}

export interface MobileClaimedTurn {
  workId: string;
  prompt: string;
  startedAt: string;
}

export interface MobileClaimedTurnContext {
  turn: MobileClaimedTurn;
  relay: MobileRelayController;
}

export type MobileClaimedTurnOutcome =
  | { status: 'completed'; output?: string }
  | { status: 'failed'; error: string; output?: string }
  | { status: 'cancelled'; error?: string };

export interface MobileRelayController {
  finishClaimedTurn(turn: MobileClaimedTurn, outcome: MobileClaimedTurnOutcome): Promise<void>;
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
  setPairingClaimHandler(handler: () => void): void;
  requestChangesDecision(batchId: string, changes: MobileChangePreview[]): Promise<MobileChangesDecision>;
  setModelChangeHandler(handler: MobileModelChangeHandler): void;
}

export type MobileModelChangeHandler = (
  provider: string,
  model: string
) => Promise<MobileModelStatus>;

const MAX_MOBILE_IMAGE_BASE64_LENGTH = 5_000_000;
const MOBILE_CONNECTED_MESSAGE = 'Mobile connected. Live prompts will run in this CLI session.';
const MOBILE_DISCONNECTED_MESSAGE = 'Mobile disconnected. Pairing stopped.';
const TERMINAL_TRANSPORT_ATTEMPTS = 3;
const TERMINAL_RETRY_DELAY_MS = 100;
const MOBILE_IMAGE_MIME_TYPES: readonly MobileImageMimeType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];
const MOBILE_PERMISSION_MODES: readonly MobilePermissionMode[] = [
  'interactive',
  'restricted',
  'unrestricted',
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

function claimedWorkMatchesRelayScope(
  work: { deliveryMode?: string | null; payload: Record<string, unknown> | null },
  options: Pick<MobileRelayOptions, 'sessionId' | 'pairingId'>,
): boolean {
  const payload = work.payload;
  const deliveryMode = work.deliveryMode
    ?? (typeof payload?.deliveryMode === 'string' ? payload.deliveryMode : null);
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
  const pairingId = typeof payload?.pairingId === 'string' ? payload.pairingId : null;

  return deliveryMode === 'steer'
    && sessionId === options.sessionId
    && pairingId === options.pairingId;
}

interface ActiveMobileRelay {
  deviceId: string;
  timer: ReturnType<typeof setInterval>;
  disposed: boolean;
  polling: boolean;
  mobileConnected: boolean;
  actionCursor: number;
  permissionModeActionResults: Map<string, MobilePermissionModeStatus>;
  pendingActions: Map<string, {
    kind: 'permission' | 'directory' | 'changes';
    path?: string;
    resolve: (value: PermissionPromptResponse | string | MobileChangesDecision | undefined) => void;
  }>;
  sessionControlHandler?: (command: 'cancel') => void;
  modelChangeHandler?: MobileModelChangeHandler;
  pairingClaimHandler?: () => void;
  pairingClaimDelivered: boolean;
  keepAwakeController: KeepAwakeController;
}

let activeRelay: ActiveMobileRelay | null = null;

export function startMobileRelay(options: MobileRelayOptions): MobileRelayController {
  stopMobileRelay();
  const keepAwakeController = options.keepAwakeController ?? new KeepAwakeController();

  const relay: ActiveMobileRelay = {
    deviceId: options.deviceId,
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    disposed: false,
    polling: false,
    mobileConnected: false,
    actionCursor: 0,
    permissionModeActionResults: new Map(),
    pendingActions: new Map(),
    pairingClaimDelivered: false,
    keepAwakeController,
  };
  const controller: MobileRelayController = {
    finishClaimedTurn: (turn, outcome) => finishClaimedTurn(options, turn, outcome),
    requestPermission: (message, context) => requestPermission(options, relay, message, context),
    requestDirectoryAccess: (path, reason) => requestDirectoryAccess(options, relay, path, reason),
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
    setKeepAwake: (enabled) => setKeepAwake(options, relay, enabled),
    setSessionControlHandler: (handler) => {
      if (!relay.disposed && activeRelay === relay) relay.sessionControlHandler = handler;
    },
    setPairingClaimHandler: (handler) => {
      if (relay.disposed || activeRelay !== relay) return;
      relay.pairingClaimHandler = handler;
      deliverPairingClaim(options, relay);
    },
    requestChangesDecision: (batchId, changes) =>
      requestChangesDecision(options, relay, batchId, changes),
    setModelChangeHandler: (handler) => {
      if (!relay.disposed && activeRelay === relay) relay.modelChangeHandler = handler;
    },
  };

  relay.timer = setInterval(() => {
    void pollOnce(options, relay, controller);
  }, Math.max(options.pollIntervalMs, 1_000));
  activeRelay = relay;
  relay.timer.unref?.();
  void pollOnce(options, relay, controller);
  if (options.keepAwakeByDefault !== undefined) {
    const keepAwakeState = options.keepAwakeByDefault
      ? keepAwakeController.enable()
      : keepAwakeController.disable();
    void publishKeepAwakeStatus(options, keepAwakeState);
  }

  return controller;
}

export function stopMobileRelay(): void {
  const relay = activeRelay;
  if (!relay) return;
  disposeRelay(relay);
}

function disposeRelay(relay: ActiveMobileRelay): void {
  if (relay.disposed) return;
  relay.disposed = true;
  clearInterval(relay.timer);
  relay.keepAwakeController.dispose();
  relay.sessionControlHandler = undefined;
  relay.modelChangeHandler = undefined;
  relay.pairingClaimHandler = undefined;
  for (const pending of [...relay.pendingActions.values()]) {
    pending.resolve(
      pending.kind === 'permission'
        ? { decision: 'deny_once' }
        : pending.kind === 'changes'
          ? { action: 'reject_all' }
          : undefined
    );
  }
  relay.pendingActions.clear();
  relay.permissionModeActionResults.clear();
  if (activeRelay === relay) activeRelay = null;
}

async function pollOnce(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  controller: MobileRelayController,
): Promise<void> {
  if (activeRelay !== relay || relay.polling) {
    return;
  }

  relay.polling = true;
  try {
    try {
      const heartbeat = await options.client.sendRelayHeartbeat(options.token, {
        sessionId: options.sessionId,
        deviceId: options.deviceId,
        pairingId: options.pairingId,
        mode: options.mode,
      });
      if (activeRelay !== relay) return;
      if (heartbeat?.pairingStatus === 'revoked') {
        disposeRelay(relay);
        options.onMobileDisconnected?.(MOBILE_DISCONNECTED_MESSAGE);
        return;
      }
      if (
        heartbeat?.pairingClaimed === true
        && !relay.mobileConnected
      ) {
        relay.mobileConnected = true;
        deliverPairingClaim(options, relay);
      }
    } catch (error) {
      if (activeRelay !== relay) return;
      options.onError?.(error as Error);
    }

    const work = await options.client.claimWork(options.token, options.deviceId, {
      deliveryMode: 'steer',
      sessionId: options.sessionId,
      pairingId: options.pairingId,
    });
    if (activeRelay !== relay) return;
    if (work && !claimedWorkMatchesRelayScope(work, options)) {
      options.onError?.(new Error('Claimed work did not match the active mobile relay scope.'));
    } else if (work?.prompt) {
      const turn: MobileClaimedTurn = {
        workId: work.id,
        prompt: work.prompt,
        startedAt: work.startedAt ?? new Date().toISOString(),
      };
      let permissionModeApplication: MobilePermissionModeApplication | undefined;
      if (work.payload?.approvalMode !== undefined) {
        permissionModeApplication = applyPermissionMode(
          options,
          relay,
          work.payload.approvalMode,
        );
        try {
          await publishPermissionModeStatus(
            options,
            relay,
            permissionModeApplication.status,
            turn.workId,
          );
        } catch (error) {
          rollbackPermissionModeChange(options, permissionModeApplication.change);
          options.onError?.(error as Error);
          if (activeRelay !== relay) {
            await finishClaimedTurn(options, turn, {
              status: 'cancelled',
              error: 'Mobile relay was replaced before the claimed turn could start.',
            });
          } else {
            await finishClaimedTurn(options, turn, {
              status: 'failed',
              error: 'Failed to acknowledge mobile permission mode change.',
            });
          }
          return;
        }
        if (activeRelay !== relay) {
          rollbackPermissionModeChange(options, permissionModeApplication.change);
          await finishClaimedTurn(options, turn, {
            status: 'cancelled',
            error: 'Mobile relay was replaced before the claimed turn could start.',
          });
          return;
        }
        if (permissionModeApplication.status.status === 'failed') {
          rollbackPermissionModeChange(options, permissionModeApplication.change);
          await finishClaimedTurn(options, turn, {
            status: 'failed',
            error: permissionModeApplication.status.error ?? 'Failed to change permission mode.',
          });
          return;
        }
      }
      await publishTurnState(options, {
        workId: turn.workId,
        status: 'running',
        prompt: turn.prompt,
        startedAt: turn.startedAt,
      });
      if (activeRelay !== relay) {
        rollbackPermissionModeChange(options, permissionModeApplication?.change);
        await finishClaimedTurn(options, turn, {
          status: 'cancelled',
          error: 'Mobile relay was replaced before the claimed turn could start.',
        });
        return;
      }
      const images = decodeMobileImages(work.payload);
      const context: MobileClaimedTurnContext = { turn, relay: controller };
      try {
        if (images.length > 0 && options.enqueueInstructionWithImages) {
          options.enqueueInstructionWithImages(work.prompt, images, context);
        } else {
          options.enqueueInstruction(work.prompt, context);
        }
      } catch (error) {
        rollbackPermissionModeChange(options, permissionModeApplication?.change);
        options.onError?.(error as Error);
        await finishClaimedTurn(options, turn, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to enqueue claimed mobile work.',
        });
        return;
      }
    }

    if (options.client.pollMobileActions) {
      const actions = await options.client.pollMobileActions(
        options.token,
        options.sessionId,
        options.deviceId,
        relay.actionCursor,
        options.pairingId,
      );
      if (activeRelay !== relay) return;
      for (const action of actions.actions) {
        await resolveAction(action, options, relay, controller);
        if (activeRelay !== relay) return;
        relay.actionCursor = Math.max(relay.actionCursor, action.sequence);
        relay.permissionModeActionResults.delete(action.id.trim());
      }
      relay.actionCursor = Math.max(relay.actionCursor, actions.nextCursor);
    }
  } catch (error) {
    if (activeRelay === relay) options.onError?.(error as Error);
  } finally {
    relay.polling = false;
  }
}

async function publishTurnState(
  options: MobileRelayOptions,
  state: MobileSessionTurnState
): Promise<void> {
  if (!options.client.publishMobileEvent) return;
  try {
    await publishEvent(options, 'session_turn_state', state, state.workId);
  } catch (error) {
    options.onError?.(error as Error);
  }
}

async function finishClaimedTurn(
  options: MobileRelayOptions,
  turn: MobileClaimedTurn,
  outcome: MobileClaimedTurnOutcome
): Promise<void> {
  const completedAt = new Date().toISOString();
  const terminalState = {
    workId: turn.workId,
    status: outcome.status,
    prompt: turn.prompt,
    startedAt: turn.startedAt,
    completedAt,
    ...('output' in outcome && outcome.output ? { output: outcome.output } : {}),
    ...('error' in outcome && outcome.error ? { error: outcome.error } : {}),
  } satisfies MobileSessionTurnState;

  const updateWork = options.client.updateWork?.bind(options.client);
  if (updateWork) {
    await retryTerminalTransport(options, async () => {
      await updateWork(options.token, options.deviceId, turn.workId, {
        status: outcome.status,
        completedAt,
        ...('error' in outcome && outcome.error ? { error: outcome.error } : {}),
        payload: {
          deliveryState: outcome.status,
          executionState: outcome.status,
        },
      });
    });
  }

  await retryTerminalTransport(options, () =>
    publishEvent(options, 'session_turn_state', terminalState, terminalState.workId));
}

async function retryTerminalTransport(
  options: MobileRelayOptions,
  operation: () => Promise<void>,
): Promise<boolean> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= TERMINAL_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      await operation();
      return true;
    } catch (error) {
      lastError = error as Error;
    }

    if (attempt < TERMINAL_TRANSPORT_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, TERMINAL_RETRY_DELAY_MS * attempt);
      });
    }
  }

  if (lastError) options.onError?.(lastError);
  return false;
}

function deliverPairingClaim(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
): void {
  if (
    relay.disposed ||
    activeRelay !== relay ||
    !relay.mobileConnected ||
    relay.pairingClaimDelivered ||
    (!relay.pairingClaimHandler && !options.onMobileConnected)
  ) {
    return;
  }

  relay.pairingClaimDelivered = true;
  try {
    if (relay.pairingClaimHandler) {
      relay.pairingClaimHandler();
    } else {
      options.onMobileConnected?.(MOBILE_CONNECTED_MESSAGE);
    }
  } catch (error) {
    options.onError?.(error as Error);
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
  relay: ActiveMobileRelay,
  enabled: boolean
): Promise<MobileKeepAwakeStatus> {
  if (relay.disposed || activeRelay !== relay) return relay.keepAwakeController.currentState();
  const controller = relay.keepAwakeController;
  const status = enabled ? controller.enable() : controller.disable();
  await publishKeepAwakeStatus(options, status);
  return status;
}

interface MobilePermissionModeApplication {
  status: MobilePermissionModeStatus;
  change?: MobilePermissionModeChange;
}

function applyPermissionMode(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  requestedMode: unknown,
): MobilePermissionModeApplication {
  const requestedModeLabel = typeof requestedMode === 'string' ? requestedMode : '';
  const mode = MOBILE_PERMISSION_MODES.includes(requestedModeLabel as MobilePermissionMode)
    ? requestedModeLabel as MobilePermissionMode
    : undefined;

  if (relay.disposed || activeRelay !== relay) {
    return { status: {
      requestedMode: requestedModeLabel,
      status: 'failed',
      error: 'Mobile relay is no longer active.',
    } };
  }
  if (!relay.mobileConnected) {
    return { status: {
      requestedMode: requestedModeLabel,
      status: 'failed',
      error: 'Mobile pairing must be claimed before changing permission mode.',
    } };
  }
  if (!mode) {
    return { status: {
      requestedMode: requestedModeLabel,
      status: 'failed',
      error: 'Unsupported mobile permission mode.',
    } };
  }
  if (!options.applyPermissionMode) {
    return { status: {
      requestedMode: mode,
      status: 'failed',
      error: 'This CLI session does not support changing permission mode remotely.',
    } };
  }

  try {
    const change = options.applyPermissionMode(mode);
    if (relay.disposed || activeRelay !== relay) {
      return {
        status: {
          requestedMode: mode,
          status: 'failed',
          error: 'Mobile relay is no longer active.',
        },
        change,
      };
    }
    if (change.appliedMode !== mode) {
      return {
        status: {
          requestedMode: mode,
          status: 'failed',
          error: 'Permission mode application did not complete synchronously.',
        },
        change,
      };
    }
    return {
      status: {
        requestedMode: mode,
        appliedMode: mode,
        status: 'applied',
      },
      change,
    };
  } catch (error) {
    return { status: {
        requestedMode: mode,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to change permission mode.',
      } };
  }
}

function rollbackPermissionModeChange(
  options: MobileRelayOptions,
  change: MobilePermissionModeChange | undefined,
): void {
  if (!change) return;
  try {
    change.rollbackIfCurrent();
  } catch (error) {
    options.onError?.(error as Error);
  }
}

async function publishPermissionModeStatus(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  status: MobilePermissionModeStatus,
  requestId?: string,
): Promise<void> {
  if (relay.disposed || activeRelay !== relay) return;
  await publishEvent(options, 'permission_mode_status', status, requestId);
}

function waitForAction<T extends PermissionPromptResponse | string | MobileChangesDecision | undefined>(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  requestId: string,
  pending: { kind: 'permission' | 'directory' | 'changes'; path?: string },
  fallback: T
): Promise<T> {
  if (
    relay.disposed
    || activeRelay !== relay
    || !options.client.publishMobileEvent
    || !options.client.pollMobileActions
  ) {
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

function cancelAction(relay: ActiveMobileRelay, requestId: string): void {
  relay.pendingActions.delete(requestId);
}

async function requestPermission(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  message: string,
  context?: { tool?: string; path?: string; command?: string }
): Promise<PermissionPromptResponse> {
  const requestId = `mobile-perm-${randomUUID()}`;
  const fallback: PermissionPromptResult = { decision: 'deny_once' };
  const response = waitForAction<PermissionPromptResponse>(options, relay, requestId, {
    kind: 'permission',
  }, fallback);

  try {
    if (relay.disposed || activeRelay !== relay) return fallback;
    await publishEvent(options, 'permission_request', {
      message,
      tool: context?.tool,
      context: context || {},
      options: ['allow_once', 'deny_once', 'allow_session', 'deny_session', 'alternative'],
    }, requestId);
  } catch (error) {
    cancelAction(relay, requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function requestDirectoryAccess(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  path: string,
  reason?: string
): Promise<string | undefined> {
  const requestId = `mobile-dir-${randomUUID()}`;
  const fallback = undefined;
  const response = waitForAction<string | undefined>(options, relay, requestId, {
    kind: 'directory',
    path,
  }, fallback);

  try {
    if (relay.disposed || activeRelay !== relay) return fallback;
    await publishEvent(options, 'directory_access_request', { path, reason }, requestId);
  } catch (error) {
    cancelAction(relay, requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function requestChangesDecision(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  batchId: string,
  changes: MobileChangePreview[]
): Promise<MobileChangesDecision> {
  const requestId = `mobile-changes-${randomUUID()}`;
  const fallback: MobileChangesDecision = { action: 'reject_all' };
  const response = waitForAction<MobileChangesDecision>(options, relay, requestId, {
    kind: 'changes',
  }, fallback);

  try {
    if (relay.disposed || activeRelay !== relay) return fallback;
    await publishEvent(options, 'changes_batch', { batchId, changes }, requestId);
  } catch (error) {
    cancelAction(relay, requestId);
    options.onError?.(error as Error);
    return fallback;
  }

  return response;
}

async function resolveAction(
  action: MobileAction,
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  controller: MobileRelayController,
): Promise<void> {
  if (relay.disposed || activeRelay !== relay) return;

  if (action.actionType === 'keep_awake_control' && typeof action.payload.enabled === 'boolean') {
    await setKeepAwake(options, relay, action.payload.enabled);
    return;
  }

  if (action.actionType === 'session_control' && action.payload.command === 'cancel') {
    relay.sessionControlHandler?.('cancel');
    return;
  }

  if (action.actionType === 'retry_turn') {
    const prompt = action.payload.prompt;
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      const turn: MobileClaimedTurn = {
        workId: `retry-${randomUUID()}`,
        prompt,
        startedAt: new Date().toISOString(),
      };
      await publishTurnState(options, {
        workId: turn.workId,
        status: 'running',
        prompt: turn.prompt,
        startedAt: turn.startedAt,
      });
      if (relay.disposed || activeRelay !== relay) return;
      const context: MobileClaimedTurnContext = { turn, relay: controller };
      options.enqueueInstruction(prompt, context);
    }
    return;
  }

  if (action.actionType === 'set_permission_mode') {
    const actionId = action.id.trim();
    const requestId = action.requestId?.trim() || actionId;
    if (!actionId || !requestId) {
      options.onError?.(new Error('Mobile permission-mode action is missing a stable identifier.'));
      return;
    }

    let status = relay.permissionModeActionResults.get(actionId);
    if (!status) {
      const application = applyPermissionMode(options, relay, action.payload.mode);
      status = application.status;
      if (status.status === 'failed') {
        rollbackPermissionModeChange(options, application.change);
      }
      relay.permissionModeActionResults.set(actionId, status);
    }
    await publishPermissionModeStatus(options, relay, status, requestId);
    return;
  }

  if (action.actionType === 'set_model') {
    const provider = action.payload.provider;
    const model = action.payload.model;
    if (typeof provider === 'string' && typeof model === 'string') {
      if (!relay.modelChangeHandler) {
        await publishEvent(options, 'model_status', {
          provider,
          model,
          status: 'failed',
          error: 'This CLI session does not support switching models remotely yet.',
        });
        return;
      }

      let result: MobileModelStatus;
      try {
        result = await relay.modelChangeHandler(provider, model);
      } catch (error) {
        result = {
          provider,
          model,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to switch model.',
        };
      }

      if (relay.disposed || activeRelay !== relay) return;
      await publishEvent(options, 'model_status', result);
    }
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
