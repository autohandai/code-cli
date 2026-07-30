/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  MobileHandoffRequestError,
  MobileHandoffTransportError,
  type MobileHandoffClientLike,
  type MobileImageAttachment,
  type MobileImageMimeType,
  type MobileAction,
  type MobileAgentContext,
  type MobileComposerCommandExecutionOutcome,
  type MobileComposerCommandResult,
  type MobileDeliveryStatusSnapshot,
  type MobileDeploymentStatus,
  type MobileEventPayloadMap,
  type MobileEventType,
  type MobileKeepAwakeStatus,
  type MobileModelStatus,
  type MobilePermissionMode,
  type MobilePermissionModeStatus,
  type MobilePullRequestReview,
  type MobileRequestScopedEventType,
  type MobileSessionTurnState,
  type PublishMobileEventPayload,
} from './MobileHandoffClient.js';
import { randomUUID } from 'node:crypto';
import stripAnsi from 'strip-ansi';
import type { PermissionPromptResponse, PermissionPromptResult } from '../permissions/types.js';
import {
  WorkspaceFileCollector,
  isSafeMobileWorkspaceRelativePath,
} from '../core/agent/WorkspaceFileCollector.js';
import type { MobileWorkspaceFileQueryResult } from '../core/agent/WorkspaceFileCollector.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { collectMobileDeliveryStatus, mergeMobilePullRequest } from './MobileDeliveryStatus.js';
import type { MobilePullRequestMergeRequest, MobilePullRequestMergeResult } from './MobileDeliveryStatus.js';
import { KeepAwakeController } from './KeepAwakeController.js';
import { collectAndUploadMobileArtifacts } from './MobileArtifacts.js';
import {
  buildCanonicalMobileComposerCatalog,
  type MobileComposerCatalog,
} from './MobileComposerCatalog.js';
import {
  isMobileCommandPermitted,
  validateMobileCommandInvocationForWorkspace,
  type MobileComposerExecutableCommand,
} from './MobileCommandPolicy.js';
import type { MobileTerminalReporterLike } from './MobileTerminalReporter.js';

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

export type MobileComposerCommandCompletion = (
  outcome: MobileComposerCommandExecutionOutcome,
) => void | Promise<void>;

export type MobileComposerCommandDispatcher = (
  command: MobileComposerExecutableCommand,
  args: readonly string[],
  completion: MobileComposerCommandCompletion,
) => void;

export type MobileComposerCommandAvailability = (
  command: MobileComposerExecutableCommand,
) => boolean;

interface MobileRelayOptions {
  client: MobileHandoffClientLike;
  token: string;
  deviceId: string;
  sessionId: string;
  pairingId: string;
  mode: 'queue' | 'steer';
  pollIntervalMs: number;
  responseTimeoutMs?: number;
  enqueueInstruction: (instruction: string, context: MobileClaimedTurnContext) => void;
  enqueueInstructionWithImages?: (
    instruction: string,
    images: MobileImageAttachment[],
    context: MobileClaimedTurnContext
  ) => void;
  workspaceRoot?: string;
  workspaceFileCollector?: Pick<WorkspaceFileCollector, 'queryWorkspaceFiles'>;
  workspaceFileQueryTimeoutMs?: number;
  composerCatalogProvider?: () => Promise<MobileComposerCatalog>;
  dispatchComposerCommand?: MobileComposerCommandDispatcher;
  isComposerCommandAvailable?: MobileComposerCommandAvailability;
  deliveryStatusProvider?: () => Promise<MobileDeliveryStatusSnapshot>;
  keepAwakeController?: KeepAwakeController;
  keepAwakeByDefault?: boolean;
  mergePullRequest?: (request: MobilePullRequestMergeRequest) => Promise<MobilePullRequestMergeResult>;
  applyPermissionMode?: (mode: MobilePermissionMode) => MobilePermissionModeChange;
  onMobileConnected?: (message: string) => void;
  onMobileDisconnected?: (message: string) => void;
  onError?: (error: Error) => void;
  terminalReporter?: MobileTerminalReporterLike;
}

export interface MobileClaimedTurn {
  workId: string;
  prompt: string;
  startedAt: string;
  agentContext?: MobileAgentContext;
  resumeSessionId?: string;
  agentSessionId?: string;
  updateClaimedWork?: boolean;
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
  publishClaimedTurnSession(turn: MobileClaimedTurn): Promise<void>;
  requestPermission(
    message: string,
    context?: { tool?: string; path?: string; command?: string }
  ): Promise<PermissionPromptResponse>;
  requestDirectoryAccess(path: string, reason?: string): Promise<string | undefined>;
  requestFollowupQuestion(message: string, options?: string[]): Promise<string | undefined>;
  publishEvent<EventType extends MobileEventType>(
    eventType: EventType,
    payload: MobileEventPayloadMap[EventType],
    ...requestId: EventType extends MobileRequestScopedEventType
      ? [requestId: string]
      : [requestId?: string]
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
const MAX_MOBILE_WORKSPACE_FILE_QUERY_LENGTH = 200;
const MAX_MOBILE_WORKSPACE_FILE_QUERY_RESULTS = 20;
const MAX_MOBILE_WORKSPACE_FILE_QUERY_TIMEOUT_MS = 2_000;
const DEFAULT_MOBILE_WORKSPACE_FILE_QUERY_TIMEOUT_MS = 750;
const MOBILE_CONNECTED_MESSAGE = 'Mobile connected. Live prompts will run in this CLI session.';
const MOBILE_DISCONNECTED_MESSAGE = 'Mobile disconnected. Pairing stopped.';
const TERMINAL_TRANSPORT_ATTEMPTS = 3;
const TERMINAL_RETRY_DELAY_MS = 100;
const MAX_COMPOSER_RESULT_RETRY_DELAY_MS = 2_000;
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

function claimedWorkDeliveryMode(
  work: { deliveryMode?: string | null; payload: Record<string, unknown> | null },
): string | null {
  return work.deliveryMode
    ?? (typeof work.payload?.deliveryMode === 'string' ? work.payload.deliveryMode : null);
}

function claimedWorkAgentContext(
  payload: Record<string, unknown> | null,
): MobileAgentContext | undefined {
  return payload?.agentContext === 'fresh'
    || payload?.agentContext === 'continue'
    || payload?.agentContext === 'resume'
    ? payload.agentContext
    : undefined;
}

function claimedWorkResumeSessionId(
  payload: Record<string, unknown> | null,
): string | undefined {
  return typeof payload?.resumeSessionId === 'string'
    ? payload.resumeSessionId
    : undefined;
}

function claimedSteerWorkMatchesRelayScope(
  work: { deliveryMode?: string | null; payload: Record<string, unknown> | null },
  options: Pick<MobileRelayOptions, 'sessionId' | 'pairingId'>,
): boolean {
  const payload = work.payload;
  const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : null;
  const pairingId = typeof payload?.pairingId === 'string' ? payload.pairingId : null;

  return claimedWorkDeliveryMode(work) === 'steer'
    && sessionId === options.sessionId
    && pairingId === options.pairingId;
}

function claimedQueueWorkMatchesRelayScope(
  work: {
    repo: string;
    deviceId: string | null;
    deliveryMode?: string | null;
    payload: Record<string, unknown> | null;
  },
  options: Pick<MobileRelayOptions, 'deviceId' | 'workspaceRoot'>,
): boolean {
  return claimedWorkDeliveryMode(work) === 'queue'
    && work.repo === options.workspaceRoot
    && work.deviceId === options.deviceId;
}

interface ActiveMobileRelay {
  deviceId: string;
  timer: ReturnType<typeof setInterval>;
  disposed: boolean;
  polling: boolean;
  mobileConnected: boolean;
  composerCatalogPublished: boolean;
  composerCatalogPublishInFlight?: Promise<boolean>;
  composerCatalog?: MobileComposerCatalog;
  composerCommandDispatcher?: MobileComposerCommandDispatcher;
  composerResultAbortControllers: Set<AbortController>;
  workspaceFileCollector?: Pick<WorkspaceFileCollector, 'queryWorkspaceFiles'>;
  actionCursor: number;
  permissionModeActionResults: Map<string, MobilePermissionModeStatus>;
  pendingActions: Map<string, {
    kind: 'permission' | 'directory' | 'changes' | 'followup';
    path?: string;
    resolve: (value: PermissionPromptResponse | string | MobileChangesDecision | undefined) => void;
    cancel: () => void;
  }>;
  sessionControlHandler?: (command: 'cancel') => void;
  modelChangeHandler?: MobileModelChangeHandler;
  pairingClaimHandler?: () => void;
  pairingClaimDelivered: boolean;
  keepAwakeController: KeepAwakeController;
}

let activeRelay: ActiveMobileRelay | null = null;
let durableQueueWorkInFlightId: string | undefined;

export function startMobileRelay(options: MobileRelayOptions): MobileRelayController {
  stopMobileRelay();
  const keepAwakeController = options.keepAwakeController ?? new KeepAwakeController();
  const workspaceFileCollector = options.workspaceFileCollector
    ?? (options.workspaceRoot
      ? new WorkspaceFileCollector(
        options.workspaceRoot,
        new GitIgnoreParser(options.workspaceRoot),
      )
      : undefined);

  const relay: ActiveMobileRelay = {
    deviceId: options.deviceId,
    timer: undefined as unknown as ReturnType<typeof setInterval>,
    disposed: false,
    polling: false,
    mobileConnected: false,
    composerCatalogPublished: false,
    composerCommandDispatcher: options.dispatchComposerCommand,
    composerResultAbortControllers: new Set(),
    workspaceFileCollector,
    actionCursor: 0,
    permissionModeActionResults: new Map(),
    pendingActions: new Map(),
    pairingClaimDelivered: false,
    keepAwakeController,
  };
  const controller: MobileRelayController = {
    finishClaimedTurn: async (turn, outcome) => {
      try {
        await finishClaimedTurn(options, turn, outcome);
      } finally {
        if (durableQueueWorkInFlightId === turn.workId) {
          durableQueueWorkInFlightId = undefined;
        }
      }
    },
    publishClaimedTurnSession: (turn) =>
      publishClaimedTurnSession(options, relay, turn),
    requestPermission: (message, context) => requestPermission(options, relay, message, context),
    requestDirectoryAccess: (path, reason) => requestDirectoryAccess(options, relay, path, reason),
    requestFollowupQuestion: (message, suggestedOptions) =>
      requestFollowupQuestion(options, relay, message, suggestedOptions),
    publishEvent: (eventType, payload, ...requestId) =>
      publishEvent(options, eventType, payload, ...requestId),
    publishPullRequestStatus: (pullRequest) => publishEvent(options, 'pull_request_status', { pullRequest }),
    publishDeploymentStatus: (deployments) => publishEvent(options, 'deployment_status', { deployments }),
    refreshDeliveryStatus: async () => {
      await publishComposerCatalog(options, relay, true);
      await refreshDeliveryStatus(options);
    },
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
  void flushTerminalReporter(options, true);
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
  for (const controller of relay.composerResultAbortControllers) controller.abort();
  relay.composerResultAbortControllers.clear();
  for (const pending of [...relay.pendingActions.values()]) pending.cancel();
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
    void flushTerminalReporter(options, false);
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
      if (relay.mobileConnected && !relay.composerCatalogPublished) {
        void publishComposerCatalog(options, relay);
      }
    } catch (error) {
      if (activeRelay !== relay) return;
      options.onError?.(error as Error);
    }

    let claimedScope: 'steer' | 'queue' = 'steer';
    let work = await options.client.claimWork(options.token, options.deviceId, {
      deliveryMode: 'steer',
      sessionId: options.sessionId,
      pairingId: options.pairingId,
    });
    if (activeRelay !== relay) {
      if (work && claimedSteerWorkMatchesRelayScope(work, options)) {
        await finishClaimedTurn(options, {
          workId: work.id,
          prompt: work.prompt,
          startedAt: work.startedAt ?? new Date().toISOString(),
          updateClaimedWork: true,
        }, {
          status: 'cancelled',
          error: 'Mobile relay was replaced before the claimed turn could start.',
        });
      }
      return;
    }

    if (!work && options.workspaceRoot && !durableQueueWorkInFlightId) {
      claimedScope = 'queue';
      work = await options.client.claimWork(options.token, options.deviceId, {
        deliveryMode: 'queue',
        workspaceRoot: options.workspaceRoot,
      });
      if (activeRelay !== relay) {
        if (work && claimedQueueWorkMatchesRelayScope(work, options)) {
          await finishClaimedTurn(options, {
            workId: work.id,
            prompt: work.prompt,
            startedAt: work.startedAt ?? new Date().toISOString(),
            updateClaimedWork: true,
          }, {
            status: 'cancelled',
            error: 'Mobile relay was replaced before the claimed turn could start.',
          });
        }
        return;
      }
    }

    const claimedWorkMatchesScope = work
      ? claimedScope === 'steer'
        ? claimedSteerWorkMatchesRelayScope(work, options)
        : claimedQueueWorkMatchesRelayScope(work, options)
      : true;
    if (work && !claimedWorkMatchesScope) {
      options.onError?.(new Error(
        claimedScope === 'steer'
          ? 'Claimed work did not match the active mobile relay scope.'
          : 'Claimed durable queue work did not match the active relay workspace and device.',
      ));
    } else if (work?.prompt) {
      if (claimedScope === 'queue') {
        durableQueueWorkInFlightId = work.id;
      }
      const agentContext = claimedWorkAgentContext(work.payload);
      const resumeSessionId = agentContext === 'resume'
        ? claimedWorkResumeSessionId(work.payload)
        : undefined;
      const turn: MobileClaimedTurn = {
        workId: work.id,
        prompt: work.prompt,
        startedAt: work.startedAt ?? new Date().toISOString(),
        ...(agentContext ? { agentContext } : {}),
        ...(resumeSessionId ? { resumeSessionId } : {}),
        updateClaimedWork: true,
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
            await controller.finishClaimedTurn(turn, {
              status: 'cancelled',
              error: 'Mobile relay was replaced before the claimed turn could start.',
            });
          } else {
            await controller.finishClaimedTurn(turn, {
              status: 'failed',
              error: 'Failed to acknowledge mobile permission mode change.',
            });
          }
          return;
        }
        if (activeRelay !== relay) {
          rollbackPermissionModeChange(options, permissionModeApplication.change);
          await controller.finishClaimedTurn(turn, {
            status: 'cancelled',
            error: 'Mobile relay was replaced before the claimed turn could start.',
          });
          return;
        }
        if (permissionModeApplication.status.status === 'failed') {
          rollbackPermissionModeChange(options, permissionModeApplication.change);
          await controller.finishClaimedTurn(turn, {
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
        await controller.finishClaimedTurn(turn, {
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
        await controller.finishClaimedTurn(turn, {
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

async function publishClaimedTurnSession(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  turn: MobileClaimedTurn,
): Promise<void> {
  if (relay.disposed || activeRelay !== relay) return;
  const agentSessionId = typeof turn.agentSessionId === 'string'
    ? turn.agentSessionId.trim()
    : '';
  if (!agentSessionId || agentSessionId.length > 200) {
    options.onError?.(new Error(
      'A claimed mobile turn requires a valid agent session ID after session preparation.',
    ));
    return;
  }

  if (turn.updateClaimedWork !== false && options.client.updateWork) {
    try {
      await options.client.updateWork(options.token, options.deviceId, turn.workId, {
        payload: { agentSessionId },
      });
    } catch (error) {
      options.onError?.(error as Error);
    }
  }
  if (relay.disposed || activeRelay !== relay) return;
  await publishTurnState(options, {
    workId: turn.workId,
    agentSessionId,
    status: 'running',
    prompt: turn.prompt,
    startedAt: turn.startedAt,
  });
}

async function finishClaimedTurn(
  options: MobileRelayOptions,
  turn: MobileClaimedTurn,
  outcome: MobileClaimedTurnOutcome
): Promise<void> {
  const completedAt = new Date().toISOString();
  const agentSessionId = typeof turn.agentSessionId === 'string' && turn.agentSessionId.trim()
    ? turn.agentSessionId.trim()
    : undefined;
  const terminalState = {
    workId: turn.workId,
    ...(agentSessionId ? { agentSessionId } : {}),
    status: outcome.status,
    prompt: turn.prompt,
    startedAt: turn.startedAt,
    completedAt,
    ...('output' in outcome && outcome.output ? { output: outcome.output } : {}),
    ...('error' in outcome && outcome.error ? { error: outcome.error } : {}),
  } satisfies MobileSessionTurnState;

  if (options.terminalReporter) {
    try {
      await options.terminalReporter.report({
        workId: turn.workId,
        ...(agentSessionId ? { agentSessionId } : {}),
        status: outcome.status,
        startedAt: turn.startedAt,
        completedAt,
        updateClaimedWork: turn.updateClaimedWork !== false,
        prompt: turn.prompt,
        ...('output' in outcome && outcome.output ? { output: outcome.output } : {}),
        ...('error' in outcome && outcome.error ? { error: outcome.error } : {}),
      });
      return;
    } catch (error) {
      options.onError?.(error as Error);
    }
  }

  const updateWork = options.client.updateWork?.bind(options.client);
  if (updateWork) {
    await retryTerminalTransport(options, async () => {
      await updateWork(options.token, options.deviceId, turn.workId, {
        status: outcome.status,
        completedAt,
        ...('error' in outcome && outcome.error ? { error: outcome.error } : {}),
        payload: {
          ...(agentSessionId ? { agentSessionId } : {}),
          deliveryState: outcome.status,
          executionState: outcome.status,
        },
      });
    });
  }

  await retryTerminalTransport(options, () =>
    publishEvent(options, 'session_turn_state', terminalState, terminalState.workId));
}

async function flushTerminalReporter(
  options: MobileRelayOptions,
  ignoreSchedule: boolean,
): Promise<void> {
  if (!options.terminalReporter) return;
  try {
    await options.terminalReporter.flush(ignoreSchedule ? { ignoreSchedule: true } : undefined);
  } catch (error) {
    options.onError?.(error as Error);
  }
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
  ...requestIdArgument: EventType extends MobileRequestScopedEventType
    ? [requestId: string]
    : [requestId?: string]
): Promise<void> {
  const requestId = requestIdArgument[0];
  if (!options.client.publishMobileEvent) {
    throw new Error('Mobile event transport is unavailable in this CLI client');
  }
  if (
    (
      eventType === 'composer_command_result'
      || eventType === 'followup_question'
      || eventType === 'workspace_file_result'
    )
    && !requestId
  ) {
    throw new Error(`Mobile ${eventType} events require a request ID`);
  }

  await options.client.publishMobileEvent(options.token, {
    sessionId: options.sessionId,
    deviceId: options.deviceId,
    pairingId: options.pairingId,
    eventType,
    requestId,
    payload,
  } as PublishMobileEventPayload<EventType>);
}

async function publishComposerCatalog(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  force = false,
): Promise<boolean> {
  if (relay.composerCatalogPublishInFlight) {
    if (!force) return relay.composerCatalogPublishInFlight;
    await relay.composerCatalogPublishInFlight;
  }
  if (
    relay.disposed
    || activeRelay !== relay
    || !relay.mobileConnected
    || !options.client.publishMobileEvent
    || (!force && relay.composerCatalogPublished)
  ) {
    return false;
  }

  const publication = (async (): Promise<boolean> => {
    try {
      const catalog = options.composerCatalogProvider
        ? await options.composerCatalogProvider()
        : await buildCanonicalMobileComposerCatalog({
          commandExecutionAvailable: (command) =>
            relay.composerCommandDispatcher !== undefined
            && isMobileCommandPermitted(command)
            && (options.isComposerCommandAvailable?.(command) ?? true),
        });
      if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return false;
      await publishEvent(options, 'composer_catalog', catalog);
      relay.composerCatalog = catalog;
      relay.composerCatalogPublished = true;
      return true;
    } catch (error) {
      options.onError?.(error as Error);
      return false;
    }
  })();
  relay.composerCatalogPublishInFlight = publication;
  try {
    return await publication;
  } finally {
    if (relay.composerCatalogPublishInFlight === publication) {
      relay.composerCatalogPublishInFlight = undefined;
    }
  }
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
  pending: { kind: 'permission' | 'directory' | 'changes' | 'followup'; path?: string },
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
    let settled = false;
    const settle = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      relay.pendingActions.delete(requestId);
      resolve(value);
    };
    relay.pendingActions.get(requestId)?.cancel();
    relay.pendingActions.set(requestId, {
      ...pending,
      resolve: (value) => settle(value as T),
      cancel: () => settle(fallback),
    });
    const timer = setTimeout(
      () => relay.pendingActions.get(requestId)?.cancel(),
      options.responseTimeoutMs ?? 60 * 60 * 1000,
    );
  });
}

function cancelAction(relay: ActiveMobileRelay, requestId: string): void {
  relay.pendingActions.get(requestId)?.cancel();
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

async function requestFollowupQuestion(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  message: string,
  suggestedOptions?: string[],
): Promise<string | undefined> {
  const requestId = `mobile-followup-${randomUUID()}`;
  const fallback = undefined;
  const response = waitForAction<string | undefined>(options, relay, requestId, {
    kind: 'followup',
  }, fallback);
  const normalizedOptions = suggestedOptions
    ?.map((option) => option.trim())
    .filter((option) => option.length > 0);

  try {
    if (relay.disposed || activeRelay !== relay) {
      cancelAction(relay, requestId);
      return fallback;
    }
    await publishEvent(options, 'followup_question', {
      message,
      ...(normalizedOptions?.length ? { options: normalizedOptions } : {}),
    }, requestId);
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

function mobileComposerCommandMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const sanitized = stripAnsi(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return sanitized ? sanitized.slice(0, 20_000) : fallback;
}

async function publishComposerCommandResult(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  requestId: string,
  result: MobileComposerCommandResult,
  signal?: AbortSignal,
): Promise<'delivered' | 'cancelled'> {
  const ownedController = signal ? undefined : new AbortController();
  const requestSignal = signal ?? ownedController!.signal;
  if (ownedController) relay.composerResultAbortControllers.add(ownedController);

  try {
    if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return 'cancelled';
    if (!options.client.publishMobileEvent) {
      throw new Error('Mobile event transport is unavailable in this CLI client');
    }
    await options.client.publishMobileEvent(options.token, {
      sessionId: options.sessionId,
      deviceId: options.deviceId,
      pairingId: options.pairingId,
      eventType: 'composer_command_result',
      requestId,
      payload: result,
    }, requestSignal);
    return relay.disposed || activeRelay !== relay || !relay.mobileConnected
      ? 'cancelled'
      : 'delivered';
  } finally {
    if (ownedController) relay.composerResultAbortControllers.delete(ownedController);
  }
}

async function publishFinalComposerCommandResult(
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  requestId: string,
  result: MobileComposerCommandResult,
): Promise<'delivered' | 'cancelled' | 'exhausted'> {
  const controller = new AbortController();
  relay.composerResultAbortControllers.add(controller);
  let lastError: Error | undefined;
  try {
    for (let attempt = 1; attempt <= TERMINAL_TRANSPORT_ATTEMPTS; attempt += 1) {
      if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return 'cancelled';
      try {
        return await publishComposerCommandResult(
          options,
          relay,
          requestId,
          result,
          controller.signal,
        );
      } catch (error) {
        lastError = error as Error;
      }

      if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return 'cancelled';
      const retryDelayMs = composerCommandResultRetryDelay(lastError, attempt);
      if (retryDelayMs === null) break;
      if (attempt < TERMINAL_TRANSPORT_ATTEMPTS) {
        await waitForComposerResultRetry(retryDelayMs, controller.signal);
      }
    }

    if (
      lastError
      && !relay.disposed
      && activeRelay === relay
      && relay.mobileConnected
    ) {
      options.onError?.(lastError);
    }
    return 'exhausted';
  } finally {
    relay.composerResultAbortControllers.delete(controller);
  }
}

function composerCommandResultRetryDelay(error: Error, attempt: number): number | null {
  if (error instanceof MobileHandoffRequestError) {
    const retryable = error.status === 408
      || error.status === 425
      || error.status === 429
      || (error.status >= 500 && error.status <= 599);
    if (!retryable) return null;
    if (Number.isFinite(error.retryAfterMs) && Number(error.retryAfterMs) >= 0) {
      return Math.min(
        Math.trunc(Number(error.retryAfterMs)),
        MAX_COMPOSER_RESULT_RETRY_DELAY_MS,
      );
    }
  } else if (!(error instanceof MobileHandoffTransportError)) {
    return null;
  }
  return Math.min(
    TERMINAL_RETRY_DELAY_MS * attempt,
    MAX_COMPOSER_RESULT_RETRY_DELAY_MS,
  );
}

function waitForComposerResultRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || delayMs <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function resolveComposerCommand(
  action: Extract<MobileAction, { actionType: 'composer_command_execute' }>,
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
): Promise<void> {
  const requestId = typeof action.requestId === 'string' ? action.requestId : '';
  const catalogRevision = action.payload?.catalogRevision;
  const command = action.payload?.command;
  const args = action.payload?.args;
  if (
    !relay.mobileConnected
    || !requestId.trim()
    || typeof catalogRevision !== 'string'
    || !catalogRevision.trim()
    || typeof command !== 'string'
    || !isMobileCommandPermitted(command)
    || !Array.isArray(args)
    || !args.every((arg): arg is string => typeof arg === 'string')
  ) {
    return;
  }

  const baseResult = {
    catalogRevision,
    command: command as MobileComposerExecutableCommand,
    args: [...args],
  };
  const reject = (message: string) => publishComposerCommandResult(
    options,
    relay,
    requestId,
    {
      ...baseResult,
      status: 'rejected',
      message: mobileComposerCommandMessage(message, 'The command was rejected.'),
    },
  );

  const policy = options.workspaceRoot
    ? await validateMobileCommandInvocationForWorkspace(command, args, options.workspaceRoot)
    : command === '/goal'
      ? { allowed: false as const, reason: 'A workspace is required to validate mobile goal commands.' }
      : await validateMobileCommandInvocationForWorkspace(command, args, '');
  if (!policy.allowed) {
    await reject(policy.reason);
    return;
  }
  if (options.isComposerCommandAvailable?.(baseResult.command) === false) {
    await reject(`Command ${baseResult.command} is not enabled in the current CLI session.`);
    return;
  }

  const catalog = relay.composerCatalog;
  if (!catalog || catalog.revision !== catalogRevision) {
    await reject('The composer catalog changed; refresh suggestions before running this command.');
    return;
  }
  const descriptor = catalog.commands.find((candidate) => candidate.command === command);
  if (!descriptor?.available) {
    await reject(`Command ${command} is not available in the current CLI composer catalog.`);
    return;
  }
  const dispatcher = relay.composerCommandDispatcher;
  if (!dispatcher) {
    await reject('The serialized CLI command handler is unavailable.');
    return;
  }

  await publishComposerCommandResult(options, relay, requestId, {
    ...baseResult,
    status: 'queued',
    message: 'Command queued for serialized CLI execution.',
  });
  if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return;

  let finalOutcome: MobileComposerCommandResult | undefined;
  let finalDelivery: Promise<void> | undefined;
  let finalPublished = false;
  let finalDeliveryAbandoned = false;
  const completion: MobileComposerCommandCompletion = (outcome) => {
    if (finalPublished || finalDeliveryAbandoned) return;
    const status = outcome?.status === 'completed'
      || outcome?.status === 'rejected'
      || outcome?.status === 'failed'
      ? outcome.status
      : 'failed';
    finalOutcome ??= {
      ...baseResult,
      status,
      message: mobileComposerCommandMessage(
        outcome?.message,
        status === 'completed' ? 'Command completed.' : 'Command execution failed.',
      ),
    };
    if (finalDelivery) return finalDelivery;

    finalDelivery = (async () => {
      const delivery = await publishFinalComposerCommandResult(
        options,
        relay,
        requestId,
        finalOutcome!,
      );
      finalPublished = delivery === 'delivered';
      finalDeliveryAbandoned = delivery !== 'delivered';
    })().finally(() => {
      finalDelivery = undefined;
    });
    return finalDelivery;
  };

  try {
    dispatcher(baseResult.command, baseResult.args, completion);
  } catch (error) {
    await completion({
      status: 'failed',
      message: error instanceof Error ? error.message : 'Failed to queue the command.',
    });
  }
}

function mobileWorkspaceFileQueryTimeoutMs(options: MobileRelayOptions): number {
  const configured = options.workspaceFileQueryTimeoutMs;
  if (!Number.isFinite(configured) || Number(configured) <= 0) {
    return DEFAULT_MOBILE_WORKSPACE_FILE_QUERY_TIMEOUT_MS;
  }
  return Math.min(
    Math.trunc(Number(configured)),
    MAX_MOBILE_WORKSPACE_FILE_QUERY_TIMEOUT_MS,
  );
}

function sanitizeMobileWorkspaceFileQueryResult(
  query: string,
  limit: number,
  result: MobileWorkspaceFileQueryResult,
): MobileWorkspaceFileQueryResult {
  const sourceFiles = Array.isArray(result.files)
    ? result.files.slice(0, MAX_MOBILE_WORKSPACE_FILE_QUERY_RESULTS + 1)
    : [];
  const seen = new Set<string>();
  const files = sourceFiles.flatMap((file) => {
    if (
      !file
      || typeof file !== 'object'
      || typeof file.relativePath !== 'string'
      || !isSafeMobileWorkspaceRelativePath(file.relativePath)
      || seen.has(file.relativePath)
    ) {
      return [];
    }
    seen.add(file.relativePath);
    return [{ relativePath: file.relativePath }];
  }).slice(0, limit);

  return {
    query,
    files,
    truncated: result.truncated === true
      || sourceFiles.length > files.length,
  };
}

async function resolveWorkspaceFileQuery(
  action: Extract<MobileAction, { actionType: 'workspace_file_query' }>,
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
): Promise<void> {
  const requestId = typeof action.requestId === 'string' ? action.requestId : '';
  const query = action.payload?.query;
  const limit = action.payload?.limit;
  if (
    !relay.mobileConnected
    || !requestId.trim()
    || typeof query !== 'string'
    || query.length > MAX_MOBILE_WORKSPACE_FILE_QUERY_LENGTH
    || query.includes('\0')
    || /[\r\n]/.test(query)
    || !Number.isInteger(limit)
    || limit < 1
    || limit > MAX_MOBILE_WORKSPACE_FILE_QUERY_RESULTS
  ) {
    return;
  }

  let result: MobileWorkspaceFileQueryResult = {
    query,
    files: [],
    truncated: true,
  };
  if (relay.workspaceFileCollector) {
    try {
      const collected = await relay.workspaceFileCollector.queryWorkspaceFiles(query, {
        limit,
        timeoutMs: mobileWorkspaceFileQueryTimeoutMs(options),
      });
      result = sanitizeMobileWorkspaceFileQueryResult(query, limit, collected);
    } catch (error) {
      options.onError?.(error as Error);
    }
  }

  if (relay.disposed || activeRelay !== relay || !relay.mobileConnected) return;
  await publishEvent(options, 'workspace_file_result', result, requestId);
}

async function resolveAction(
  action: MobileAction,
  options: MobileRelayOptions,
  relay: ActiveMobileRelay,
  controller: MobileRelayController,
): Promise<void> {
  if (relay.disposed || activeRelay !== relay) return;

  if (action.actionType === 'composer_command_execute') {
    await resolveComposerCommand(action, options, relay);
    return;
  }

  if (action.actionType === 'workspace_file_query') {
    await resolveWorkspaceFileQuery(action, options, relay);
    return;
  }

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
        updateClaimedWork: false,
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

  if (pending.kind === 'followup' && action.actionType === 'followup_response') {
    const answer = typeof action.payload.answer === 'string'
      ? action.payload.answer
      : '';
    if (answer.trim()) pending.resolve(answer);
    return;
  }

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
