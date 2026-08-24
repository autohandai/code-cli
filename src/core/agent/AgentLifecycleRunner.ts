/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { getProviderConfig, saveConfig } from '../../config.js';
import { applyStartupProviderDefaults } from '../../commands/login.js';
import type {
  AgentRuntime,
  LLMToolCall,
  LoadedConfig,
  ProviderName,
  ProviderSettings,
  TurnUsage,
} from '../../types.js';
import type { ProviderModelMetadata } from '../../telemetry/types.js';
import type {
  SessionMessage,
  SessionMetadata,
  SessionUsageMetadata,
} from '../../session/types.js';
import { renderTerminalMarkdown } from '../immediateCommandRouter.js';
import { isLikelyFilePathSlashInput } from '../slashInputDetection.js';
import { isShellCommand, parseShellCommand } from '../../ui/shellCommand.js';
import { plan as planCommand } from '../../commands/plan.js';
import { runWithConcurrency } from '../../utils/parallel.js';
import { buildSessionChatLog } from '../../session/chatLog.js';
import { formatExitCleanup, formatForceExit } from '../../ui/theme/startup.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';
import { BARE_SLASH_COMMANDS_DISABLED_MESSAGE } from '../../runtime/bareMode.js';
import type { ImageManager } from '../ImageManager.js';
import { SessionDiffStatsTracker } from '../SessionDiffStatsTracker.js';
import { shouldForceAgentIdleLogout } from './AgentSessionAccounting.js';
import { consumeAgentInkSubmittedInstructionEcho } from './AgentUIRuntime.js';
import {
  createQueuedAgentInstruction,
  resolveActiveGoalContinuation,
  unpackQueuedAgentInstruction,
  type PendingPostTurnAction,
  type SequencedQueuedAgentInstruction,
  type QueuedMobileComposerCommand,
} from './PostTurnActionCoordinator.js';
import type { MobileClaimedTurnContext } from '../../mobile/MobileRelay.js';
import type { MobileImageAttachment } from '../../mobile/MobileHandoffClient.js';
import { validateMobileCommandInvocationForWorkspace } from '../../mobile/MobileCommandPolicy.js';

const execFileAsync = promisify(execFile);
const RUNTIME_RESOURCE_SHUTDOWN_TIMEOUT_MS = 2_500;
/**
 * Grace period given to a background process between SIGTERM and SIGKILL during
 * teardown. Deliberately well inside RUNTIME_RESOURCE_SHUTDOWN_TIMEOUT_MS: if
 * the kill outlives the shutdown deadline the cleanup is abandoned mid-flight
 * and detached children are orphaned.
 */
const BACKGROUND_PROCESS_KILL_GRACE_MS = 1_000;
const COMMAND_FINALIZATION_TIMEOUT_MS = 2_500;
const COMMAND_HOOK_KILL_GRACE_PERIOD_MS = 100;

export interface AgentLifecycleHost {
  [key: string]: any;
}

export interface RunAgentCommandModeOptions {
  signal?: AbortSignal;
  keepAlive?: boolean;
}

type ProviderSettingsHost = {
  runtime?: {
    config?: LoadedConfig;
  };
  activeProvider?: ProviderName;
};

function buildProviderTelemetryMetadata(
  providerSettings: ProviderSettings | null,
): ProviderModelMetadata {
  if (!providerSettings) {
    return {};
  }

  return {
    ...("displayName" in providerSettings && typeof providerSettings.displayName === "string"
      ? { providerDisplayName: providerSettings.displayName }
      : {}),
    ...("apiFormat" in providerSettings && typeof providerSettings.apiFormat === "string"
      ? { providerApiFormat: providerSettings.apiFormat }
      : {}),
    ...(providerSettings.reasoningEffort
      ? { reasoningEffort: providerSettings.reasoningEffort }
      : {}),
    ...(providerSettings.contextWindow
      ? { contextWindow: providerSettings.contextWindow }
      : {}),
  };
}

function getHostProviderSettings(host: ProviderSettingsHost): ProviderSettings | null {
  if (!host.runtime?.config || !host.activeProvider) {
    return null;
  }
  return getProviderConfig(host.runtime.config, host.activeProvider);
}

export interface FreshAgentSessionStateHost {
  runtime: Pick<AgentRuntime, 'workspaceRoot'>;
  taskStartedAt: number | null;
  totalTokensUsed: number;
  currentTurnActualUsage: TurnUsage;
  currentTurnHadUnavailableUsage: boolean;
  lastTurnActualUsage: TurnUsage;
  sessionActualTokensUsed: number;
  sessionTokenUsageUnavailable: boolean;
  sessionTokensUsed: number;
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  lastContextTokens: number;
  filesModifiedThisSession: boolean;
  fileModCount: number;
  modifiedFilePaths?: Set<string>;
  executedActionNames: string[];
  searchQueries: string[];
  sessionRetryCount: number;
  consecutiveCancellations: number;
  restoredChatMessages: unknown[];
  lastAssistantResponseForNotification: string;
  lastActivityAt: number;
  imageManager?: Pick<ImageManager, 'clear'>;
  sessionDiffStatsTracker?: SessionDiffStatsTracker;
  specialistOrchestrator?: { clearSessionContext(): void };
}

export function resetFreshAgentSessionState(
  host: FreshAgentSessionStateHost,
  startedAt: number,
): void {
  host.taskStartedAt = null;
  host.totalTokensUsed = 0;
  host.currentTurnActualUsage = { kind: 'unavailable', reason: 'not_reported' };
  host.currentTurnHadUnavailableUsage = false;
  host.lastTurnActualUsage = { kind: 'unavailable', reason: 'not_reported' };
  host.sessionActualTokensUsed = 0;
  host.sessionTokenUsageUnavailable = false;
  host.sessionTokensUsed = 0;
  host.sessionPromptTokens = 0;
  host.sessionCompletionTokens = 0;
  host.lastContextTokens = 0;
  host.filesModifiedThisSession = false;
  host.fileModCount = 0;
  host.modifiedFilePaths?.clear();
  host.executedActionNames = [];
  host.searchQueries = [];
  host.sessionRetryCount = 0;
  host.consecutiveCancellations = 0;
  host.restoredChatMessages = [];
  host.lastAssistantResponseForNotification = '';
  host.lastActivityAt = startedAt;
  host.imageManager?.clear();
  host.specialistOrchestrator?.clearSessionContext();
  if (host.sessionDiffStatsTracker) {
    host.sessionDiffStatsTracker = new SessionDiffStatsTracker(host.runtime.workspaceRoot);
  }
}

/**
 * Rotate only the agent conversation/session identity while leaving the
 * interactive process and its mobile relay transport alive.
 */
export interface AgentSessionIdentity {
  agentSessionId: string;
}

export interface FreshAgentSessionRecord {
  getMessages(): SessionMessage[];
  metadata: {
    sessionId: string;
    model?: string;
    projectName?: string;
    status?: string;
    summary?: string;
    client?: string;
    clientVersion?: string;
    usage?: SessionUsageMetadata;
  };
}

export interface FreshAgentSessionHost {
  runtime: {
    workspaceRoot: string;
    options: Pick<AgentRuntime['options'], 'bare' | 'model'>;
    config: LoadedConfig;
  };
  activeProvider: ProviderName;
  sessionStartedAt: number;
  sessionManager: {
    getCurrentSession(): FreshAgentSessionRecord | null;
    closeSession(summary: string): Promise<void>;
    createSession(workspaceRoot: string, model: string): Promise<FreshAgentSessionRecord>;
    listSessions?(): Promise<SessionMetadata[]>;
  };
  hookManager: {
    executeHooks(
      event: 'session-end' | 'session-start',
      context: Record<string, unknown>,
    ): Promise<unknown>;
  };
  telemetryManager: {
    endSession(status: 'completed'): Promise<unknown>;
    startSession(
      sessionId: string,
      model: string,
      provider: ProviderName,
      startedAt: number,
      metadata: ProviderModelMetadata,
    ): Promise<unknown>;
  };
  feedbackManager: {
    startSession(): void;
  };
  imageManager: Pick<ImageManager, 'add' | 'formatPlaceholder'>;
  stopActiveAgentHeartbeat?(): Promise<void>;
  startActiveAgentHeartbeat?(): Promise<void>;
  flushScheduledSessionSnapshot(): Promise<void>;
  cancelPendingTurnMemoryReflections(): void;
  syncFreshAgentSessionSnapshot(
    session: FreshAgentSessionRecord,
    endedAt: number,
  ): Promise<void>;
  resetConversationContext(): Promise<void>;
  resetAgentStateForFreshSession(startedAt: number): void;
  injectSessionBootstrap(): Promise<void>;
  restoreSessionState?(sessionId: string): Promise<FreshAgentSessionRecord>;
}

export async function startFreshAgentSession(
  host: FreshAgentSessionHost,
): Promise<AgentSessionIdentity> {
  const previousSession = host.sessionManager.getCurrentSession();

  host.cancelPendingTurnMemoryReflections();
  await host.stopActiveAgentHeartbeat?.();
  await host.flushScheduledSessionSnapshot?.();

  if (previousSession) {
    await host.sessionManager.closeSession('Session ended - new mobile task started');
    const endedAt = Date.now();
    if (host.runtime?.options?.bare !== true) {
      await Promise.allSettled([
        host.hookManager.executeHooks('session-end', {
          sessionId: previousSession.metadata.sessionId,
          sessionEndReason: 'clear',
          duration: Math.max(0, endedAt - host.sessionStartedAt),
        }),
        host.syncFreshAgentSessionSnapshot(previousSession, endedAt),
        host.telemetryManager.endSession('completed'),
      ]);
    }
  }

  const startedAt = Date.now();
  await host.resetConversationContext();
  host.resetAgentStateForFreshSession(startedAt);

  const providerSettings = getHostProviderSettings(host);
  const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
  const session = await host.sessionManager.createSession(host.runtime.workspaceRoot, model);
  const sessionId = session.metadata.sessionId;
  host.sessionStartedAt = startedAt;

  if (host.runtime?.options?.bare !== true) {
    host.feedbackManager.startSession();
  }
  await startHostActiveAgentHeartbeat(host);
  if (host.runtime?.options?.bare !== true) {
    await host.injectSessionBootstrap();
    await host.telemetryManager.startSession(
      sessionId,
      model,
      host.activeProvider,
      host.sessionStartedAt,
      buildProviderTelemetryMetadata(providerSettings),
    );
    await host.hookManager.executeHooks('session-start', {
      sessionId,
      sessionType: 'clear',
    });
  }

  return { agentSessionId: sessionId };
}

export type MobileAgentContext = 'fresh' | 'continue' | 'resume';

type AgentContextClaimedTurn = MobileClaimedTurnContext['turn'] & {
  agentContext?: MobileAgentContext;
  resumeSessionId?: string;
  agentSessionId?: string;
};

export interface MobileAgentSessionExecutionContext extends MobileClaimedTurnContext {
  pendingImages?: readonly MobileImageAttachment[];
}

export interface PreparedMobileAgentSession extends AgentSessionIdentity {
  instruction: string;
}

function readMobileAgentContext(turn: AgentContextClaimedTurn): MobileAgentContext {
  if (turn.agentContext === undefined) {
    return 'continue';
  }
  if (
    turn.agentContext === 'fresh'
    || turn.agentContext === 'continue'
    || turn.agentContext === 'resume'
  ) {
    return turn.agentContext;
  }
  throw new Error(`Unsupported mobile agent context: ${String(turn.agentContext)}`);
}

const CANONICAL_RESUME_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function readCanonicalResumeSessionId(turn: AgentContextClaimedTurn): string {
  const resumeSessionId = turn.resumeSessionId;
  if (
    typeof resumeSessionId !== 'string'
    || resumeSessionId.length < 1
    || resumeSessionId.length > 200
    || !CANONICAL_RESUME_SESSION_ID.test(resumeSessionId)
  ) {
    throw new Error('Resume mobile work requires a canonical resume session ID');
  }
  return resumeSessionId;
}

async function restoreHistoricalMobileAgentSession(
  host: FreshAgentSessionHost,
  turn: AgentContextClaimedTurn,
): Promise<AgentSessionIdentity> {
  const resumeSessionId = readCanonicalResumeSessionId(turn);
  if (!host.sessionManager.listSessions || !host.restoreSessionState) {
    throw new Error('Historical mobile session restore is unavailable');
  }

  const target = (await host.sessionManager.listSessions())
    .find((session) => session.sessionId === resumeSessionId);
  if (!target) {
    throw new Error(`Resume agent session not found locally: ${resumeSessionId}`);
  }
  if (path.resolve(target.projectPath) !== path.resolve(host.runtime.workspaceRoot)) {
    throw new Error(
      `Resume agent session ${resumeSessionId} belongs to a different workspace`,
    );
  }

  const restored = await host.restoreSessionState(resumeSessionId);
  if (restored.metadata.sessionId !== resumeSessionId) {
    throw new Error(`Restored agent session identity did not match ${resumeSessionId}`);
  }
  return { agentSessionId: resumeSessionId };
}

function hydratePendingMobileImages(
  host: FreshAgentSessionHost,
  mobileTurn: MobileAgentSessionExecutionContext,
  instruction: string,
): string {
  const images = mobileTurn.pendingImages;
  if (!images?.length) {
    return instruction;
  }

  const placeholders = images.map((image) => {
    const data = Buffer.from(image.data, 'base64');
    const id = host.imageManager.add(data, image.mimeType, image.filename);
    return host.imageManager.formatPlaceholder(id);
  });
  mobileTurn.pendingImages = undefined;
  return `${instruction}\n\n${placeholders.join('\n')}`;
}

/**
 * Resolve the agent-side session identity for a claimed mobile turn.
 *
 * The relay session remains owned by MobileRelay; only `agentSessionId` is
 * written back to the turn for running and terminal event payloads.
 */
export async function prepareMobileAgentSession(
  host: FreshAgentSessionHost,
  mobileTurn: MobileAgentSessionExecutionContext,
  instruction: string,
): Promise<PreparedMobileAgentSession> {
  const turn = mobileTurn.turn as AgentContextClaimedTurn;
  const agentContext = readMobileAgentContext(turn);
  turn.agentSessionId = undefined;
  let agentSessionId: string | undefined;
  if (agentContext === 'fresh') {
    try {
      ({ agentSessionId } = await startFreshAgentSession(host));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to start a fresh agent session: ${message}`);
    }
  } else if (agentContext === 'resume') {
    try {
      ({ agentSessionId } = await restoreHistoricalMobileAgentSession(host, turn));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to resume agent session: ${message}`);
    }
  } else {
    agentSessionId = host.sessionManager.getCurrentSession()?.metadata.sessionId;
  }

  if (!agentSessionId) {
    throw new Error('No active agent session is available for this mobile turn');
  }

  turn.agentContext = agentContext;
  turn.agentSessionId = agentSessionId;
  return {
    agentSessionId,
    instruction: hydratePendingMobileImages(host, mobileTurn, instruction),
  };
}

async function startHostActiveAgentHeartbeat(
  host: { startActiveAgentHeartbeat?(): Promise<void> },
): Promise<void> {
  try {
    await host.startActiveAgentHeartbeat?.();
  } catch {
    // Local dashboard heartbeats are best-effort and must never change session flow.
  }
}

function activateStartupSkill(host: AgentLifecycleHost): void {
  const skillName = host.runtime?.options?.activateSkillOnStartup;
  if (typeof skillName !== 'string' || !skillName.trim()) {
    return;
  }

  const activated = host.skillsRegistry.activateSkill(skillName);
  if (!activated) {
    host.notifyUser?.(`Installed skill "${skillName}" could not be activated for this session.`);
  }
}

function isRuntimeResourceShutdownStarted(host: AgentLifecycleHost): boolean {
  return Boolean(host.runtimeResourceShutdownPromise)
    || host.runtimeResourceShutdownController?.signal.aborted === true;
}

/**
 * Retroactively catches accounts that authenticated before autohandai defaulting existed and
 * never re-run /login (applyPostLoginProviderDefault only fires on a fresh /login). A no-op,
 * including the write, on every run after the first time it actually applies — see
 * applyStartupProviderDefaults in commands/login.ts.
 */
async function applyStartupProviderDefaultsToHost(host: AgentLifecycleHost): Promise<void> {
  const before = host.runtime.config as LoadedConfig;
  const after = applyStartupProviderDefaults(before);
  if (after === before) return;
  host.runtime.config = after;
  await saveConfig(after);
}

export async function runAgentInteractive(host: AgentLifecycleHost, initialInstruction?: string): Promise<void> {
    await applyStartupProviderDefaultsToHost(host);

    // Bail out early if stdin is not a TTY - interactive mode requires a terminal
    if (!process.stdin.isTTY) {
      console.error(chalk.red('Interactive mode requires a terminal (TTY). Use --prompt for non-interactive usage.'));
      process.exitCode = 1;
      return;
    }

    // Queue piped text so the first loop iteration processes it before prompting.
    if (initialInstruction) {
      host.pendingInkInstructions.push(createQueuedAgentInstruction({ text: initialInstruction }));
    }

    host.mcpStartupCoordinator.prepareForInteractiveStartup();

    // Start ALL initialization in background so prompt appears instantly.
    // The user can start typing while managers initialize.
    // When they submit, we await initReady before processing.
    host.initReady = host.performBackgroundInit();

    // Fire startup suggestion LLM call immediately so the first prompt
    // shows contextual ghost text. Git context is gathered asynchronously
    // and the LLM call runs fully in the background.
    // promptForInstruction() awaits this work with a startup deadline,
    // then falls back to no suggestion if the call hasn't resolved.
    if (host.suggestionEngine) {
      const engine = host.suggestionEngine;
      const workspaceRoot = host.runtime.workspaceRoot;
      const collector = host.workspaceFileCollector;
      host.isStartupSuggestion = true;
      host.pendingSuggestion = (async () => {
        const [gitStatusResult, gitLogResult] = await runWithConcurrency([
          {
            label: 'git_status',
            run: async () => execFileAsync('git', ['status', '-sb'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
          {
            label: 'git_log',
            run: async () => execFileAsync('git', ['log', '--oneline', '-5'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
        ], host.getParallelismLimit());
        const recentFiles = collector.getCachedFiles().slice(0, 20);
        await engine.generateFromProjectContext({
          gitStatus: gitStatusResult?.stdout.trim() || undefined,
          recentCommits: gitLogResult?.stdout.trim() || undefined,
          recentFiles,
        });
      })();
      host.persistentInput.setPendingSuggestion(host.pendingSuggestion);
      host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion);
    }

    // Install exit signal handlers to stop queue processing immediately on SIGINT/SIGTERM
    host.installExitSignalHandlers();

    // Show prompt immediately - don't wait for init
    await host.runInteractiveLoop();

    // Clean up signal handlers
    host.removeExitSignalHandlers();
  }

export function installAgentExitSignalHandlers(host: AgentLifecycleHost): void {
    if (host.exitSignalHandlersInstalled) return;
    host.exitSignalHandlersInstalled = true;

    const handleExitSignal = () => {
      if (host.shouldExit) {
        // Second signal - force immediate exit
        console.log(formatForceExit());
        process.exit(0);
      }
      host.shouldExit = true;
      host.runtimeResourceShutdownController?.abort();
      console.log(formatExitCleanup());
      host.clearAllQueuesAndAbort();
    };

    host.exitSignalHandler = handleExitSignal;
    process.on('SIGINT', handleExitSignal);
    process.on('SIGTERM', handleExitSignal);
  }

export function removeAgentExitSignalHandlers(host: AgentLifecycleHost): void {
    const handleExitSignal = host.exitSignalHandler;
    if (handleExitSignal) {
      process.off('SIGINT', handleExitSignal);
      process.off('SIGTERM', handleExitSignal);
      host.exitSignalHandler = null;
    }
    host.exitSignalHandlersInstalled = false;
  }

function abortAgentRuntimeWork(host: AgentLifecycleHost): void {
    // Clear pending instruction queues
    callResourceCleanupSync(() => {
      host.pendingInkInstructions.length = 0;
    });
    callResourceCleanupSync(() => host.inkRenderer?.clearQueue());
    // Clear persistent input queue
    callResourceCleanupSync(() => {
      while (host.persistentInput?.hasQueued?.()) {
        host.persistentInput.dequeue();
      }
    });

    // Abort any active abort controllers to stop current work
    const activeAbortController = host.activeAbortController;
    host.activeAbortController = null;
    callResourceCleanupSync(() => activeAbortController?.abort());
    const currentInkAbortController = host.currentInkAbortController;
    host.currentInkAbortController = null;
    callResourceCleanupSync(() => currentInkAbortController?.abort());
    const turnMemoryReflectionAbortController = host.turnMemoryReflectionAbortController;
    host.turnMemoryReflectionAbortController = null;
    callResourceCleanupSync(() => turnMemoryReflectionAbortController?.abort());
    callResourceCleanupSync(() => host.shellSuggestionProvider?.abort());
    callResourceCleanupSync(() => host.suggestionEngine?.cancel());
    host.pendingSuggestion = null;
    callResourceCleanupSync(() => host.persistentInput?.setPendingSuggestion?.(undefined));
    callResourceCleanupSync(() => host.inkRenderer?.setPendingSuggestion?.(undefined));

    // Resolve any pending ink instruction resolver to unblock the loop
    const instructionResolver = host.inkInstructionResolver;
    host.inkInstructionResolver = null;
    callResourceCleanupSync(instructionResolver ?? undefined);
  }

export function clearAgentQueuesAndAbort(host: AgentLifecycleHost): void {
    abortAgentRuntimeWork(host);

    // Stop any active team processes
    if (host.teamManager) {
      host.teamManager.shutdown().catch(() => {});
    }
  }

export function requestAgentExit(host: AgentLifecycleHost): void {
    host.shouldExit = true;
    host.runtimeResourceShutdownController?.abort();
    host.clearAllQueuesAndAbort();
  }

function callResourceCleanup(action: () => unknown): Promise<unknown> {
    try {
      return Promise.resolve(action());
    } catch (error) {
      return Promise.reject(error);
    }
  }

function callResourceCleanupSync(action: (() => unknown) | undefined): void {
    try {
      action?.();
    } catch {
      // Cleanup remains best-effort so one faulty resource cannot skip the rest.
    }
  }

/**
 * Release process-scoped resources without finalizing the current session.
 * Session hooks, telemetry endSession, and SessionManager.closeSession belong
 * to the outer lifecycle boundary and must not be duplicated here.
 */
export async function shutdownAgentRuntimeResources(host: AgentLifecycleHost): Promise<void> {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, RUNTIME_RESOURCE_SHUTDOWN_TIMEOUT_MS);
    });

    try {
      abortAgentRuntimeWork(host);
      removeAgentExitSignalHandlers(host);

      callResourceCleanupSync(() => host.stopStatusUpdates?.());
      callResourceCleanupSync(host.persistentConsoleBridgeCleanup ?? undefined);
      host.persistentConsoleBridgeCleanup = null;
      callResourceCleanupSync(host.announcementUnsubscribe ?? undefined);
      host.announcementUnsubscribe = null;
      callResourceCleanupSync(host.teamActivityUnsubscribe ?? undefined);
      host.teamActivityUnsubscribe = null;

      callResourceCleanupSync(() => host.repeatManager?.shutdown());
      host.persistentInputActiveTurn = false;
      callResourceCleanupSync(() => host.persistentInput?.dispose?.());
      callResourceCleanupSync(() => process.stdin.pause());

      const cleanupTasks: Promise<unknown>[] = [];
      if (host.ui) {
        const ui = host.ui;
        host.ui = null;
        host.inkRenderer = null;
        if (host.runtime) host.runtime.inkRenderer = undefined;
        cleanupTasks.push(callResourceCleanup(() => ui.stop()));
      } else {
        callResourceCleanupSync(() => host.cleanupUI?.(false));
      }
      callResourceCleanupSync(() => host.runtime?.spinner?.stop?.());
      if (host.runtime) host.runtime.spinner = undefined;

      const heartbeat = host.activeAgentHeartbeat;
      host.activeAgentHeartbeat = null;

      if (heartbeat) cleanupTasks.push(callResourceCleanup(() => heartbeat.stop()));
      if (host.teamManager) cleanupTasks.push(callResourceCleanup(() => host.teamManager.shutdown()));
      if (host.mcpManager) cleanupTasks.push(callResourceCleanup(() => host.mcpManager.disconnectAll()));
      if (host.backgroundProcessRegistry) {
        cleanupTasks.push(callResourceCleanup(() => host.backgroundProcessRegistry.killAll(BACKGROUND_PROCESS_KILL_GRACE_MS)));
      }
      if (host.initReady) cleanupTasks.push(callResourceCleanup(() => host.initReady));
      if (Array.isArray(host.turnMemoryReflectionQueue)) {
        host.turnMemoryReflectionQueue.length = 0;
      }
      if (host.flushTurnMemoryReflection) {
        cleanupTasks.push(callResourceCleanup(() => host.flushTurnMemoryReflection()));
      }
      if (host.skillsRegistry?.flushCapabilityUsage) {
        cleanupTasks.push(callResourceCleanup(() => host.skillsRegistry.flushCapabilityUsage()));
      }
      const snapshotFlush = host.flushScheduledSessionSnapshot
        ? callResourceCleanup(() => host.flushScheduledSessionSnapshot())
        : Promise.resolve().then(() => {
            if (host.sessionSyncTimer) clearTimeout(host.sessionSyncTimer);
            host.sessionSyncTimer = undefined;
          });
      cleanupTasks.push(snapshotFlush);
      if (host.telemetryManager) {
        cleanupTasks.push(callResourceCleanup(() => host.telemetryManager.shutdown()));
      }

      await Promise.race([Promise.allSettled(cleanupTasks), deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }

export async function initializeAgentManagers(host: AgentLifecycleHost): Promise<void> {
    if (host.runtime?.options?.bare === true) {
      await runWithConcurrency([
        { label: 'session_manager', run: async () => host.sessionManager.initialize() },
        { label: 'skills_registry', run: async () => host.skillsRegistry.initialize() },
        {
          label: 'workspace_files',
          run: async () => {
            await host.workspaceFileCollector.collectWorkspaceFiles();
          },
        },
      ], host.getParallelismLimit());
      return;
    }

    await runWithConcurrency([
      { label: 'session_manager', run: async () => host.sessionManager.initialize() },
      { label: 'project_manager', run: async () => host.projectManager.initialize() },
      { label: 'memory_manager', run: async () => host.memoryManager.initialize() },
      { label: 'skills_registry', run: async () => host.skillsRegistry.initialize() },
      { label: 'hook_manager', run: async () => host.hookManager.initialize() },
      {
        label: 'workspace_files',
        run: async () => {
          await host.workspaceFileCollector.collectWorkspaceFiles();
        },
      },
    ], host.getParallelismLimit());
  }

export async function performAgentBackgroundInit(
  host: AgentLifecycleHost,
  signal?: AbortSignal,
): Promise<void> {
    try {
      // Phase 1: Parallel manager initialization
      await awaitLifecycleStep(Promise.resolve(host.initializeManagers()), signal);
      if (isRuntimeResourceShutdownStarted(host)) return;

      // Fire MCP connections in background (non-blocking, like Claude Code).
      // Servers connect asynchronously; tools become available once ready.
      // Does NOT block the main init pipeline or user prompt.
      if (host.runtime.config.mcp?.enabled !== false) {
        host.mcpStartupCoordinator.markConnectStarted();
        host.mcpReady = host.mcpManager
          .connectAll(host.runtime.config.mcp?.servers ?? [])
          .then(() => {
            if (!isRuntimeResourceShutdownStarted(host)) host.syncMcpTools();
          })
          .catch(() => { /* individual server errors already captured by connectAll */ })
          .finally(() => {
            if (!isRuntimeResourceShutdownStarted(host)) {
              host.mcpStartupCoordinator.markSummaryPending();
            }
          });
      }

      // Phase 2: Sequential setup that depends on phase 1

      await awaitLifecycleStep(
        Promise.resolve(host.skillsRegistry.setWorkspace(host.runtime.workspaceRoot)),
        signal,
      );
      if (isRuntimeResourceShutdownStarted(host)) return;
      activateStartupSkill(host);
      if (host.runtime?.options?.bare !== true) {
        host.feedbackManager.startSession();
      }
      const providerSettings = getHostProviderSettings(host);
      const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      const providerTelemetryMetadata = buildProviderTelemetryMetadata(providerSettings);
      host.sessionStartedAt = Date.now();
      const [, session] = await awaitLifecycleStep(Promise.all([
        host.resetConversationContext(),
        host.sessionManager.createSession(host.runtime.workspaceRoot, model),
      ]), signal);
      if (isRuntimeResourceShutdownStarted(host)) return;
      await awaitLifecycleStep(startHostActiveAgentHeartbeat(host), signal);
      if (isRuntimeResourceShutdownStarted(host)) return;

      // Inject explicit session bootstrap so the LLM is consciously aware of
      // memories, AGENTS.md, skills, and project context from the first turn.
      if (host.runtime?.options?.bare !== true) {
        await awaitLifecycleStep(Promise.resolve(host.injectSessionBootstrap()), signal);
        if (isRuntimeResourceShutdownStarted(host)) return;
      }

      // Phase 3: Telemetry (no stdout output)
      if (session && host.runtime?.options?.bare !== true) {
        if (isRuntimeResourceShutdownStarted(host)) return;
        await awaitLifecycleStep(host.telemetryManager.startSession(
          session.metadata.sessionId,
          model,
          host.activeProvider,
          host.sessionStartedAt,
          providerTelemetryMetadata,
        ), signal);
      }

      // NOTE: session-start hook is fired in ensureInitComplete() AFTER the
      // prompt closes, so its output doesn't corrupt the readline display.
    } catch (error) {
      if (!(signal?.aborted && error instanceof Error && error.name === 'AbortError')) {
        throw error;
      }
    } finally {
      host.initDone = true;
    }
  }

export async function ensureAgentInitComplete(
  host: AgentLifecycleHost,
  signal?: AbortSignal,
): Promise<void> {
    if (host.initReady) {
      try {
        await awaitLifecycleStep(host.initReady, signal);
      } catch (error) {
        if (signal?.aborted && error instanceof Error && error.name === 'AbortError') return;
        throw error;
      }
      host.initReady = null;
      if (isRuntimeResourceShutdownStarted(host)) return;

      // Connection starts while the user is typing, but the first model request
      // must see the final registered MCP tool set.
      if (host.mcpReady) {
        try {
          await awaitLifecycleStep(host.mcpReady, signal);
        } catch (error) {
          if (signal?.aborted && error instanceof Error && error.name === 'AbortError') return;
          throw error;
        }
      }
      if (isRuntimeResourceShutdownStarted(host)) return;
      host.flushMcpStartupSummaryIfPending();

      // Fire session-start hook now that the prompt is closed and stdout is clean
      const session = host.sessionManager.getCurrentSession();
      if (host.runtime?.options?.bare !== true) {
        await awaitLifecycleStep(host.hookManager.executeHooks('session-start', {
          sessionId: session?.metadata.sessionId,
          sessionType: 'startup',
        }), signal);
      }
    }
  }

function createLifecycleAbortError(): Error {
    const error = new Error('Agent initialization aborted');
    error.name = 'AbortError';
    return error;
  }

function awaitLifecycleStep<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return task;
    if (signal.aborted) {
      void task.catch(() => {});
      return Promise.reject(createLifecycleAbortError());
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(createLifecycleAbortError());
      signal.addEventListener('abort', onAbort, { once: true });
      task.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }

interface CommandFinalizationDeadline {
  readonly hardSignal: AbortSignal;
  readonly hookSignal: AbortSignal;
  readonly started: boolean;
  readonly expired: boolean;
  start(): void;
  dispose(): void;
}

function createCommandFinalizationDeadline(
  lifecycleSignal?: AbortSignal,
): CommandFinalizationDeadline {
    const hookController = new AbortController();
    const hardController = new AbortController();
    let started = false;
    let hookTimer: ReturnType<typeof setTimeout> | undefined;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;

    const start = (): void => {
      if (started) return;
      started = true;
      hookTimer = setTimeout(
        () => hookController.abort(createLifecycleAbortError()),
        Math.max(0, COMMAND_FINALIZATION_TIMEOUT_MS - COMMAND_HOOK_KILL_GRACE_PERIOD_MS),
      );
      hardTimer = setTimeout(
        () => hardController.abort(createLifecycleAbortError()),
        COMMAND_FINALIZATION_TIMEOUT_MS,
      );
      hookTimer.unref?.();
      hardTimer.unref?.();
    };

    if (lifecycleSignal?.aborted) {
      start();
    } else {
      lifecycleSignal?.addEventListener('abort', start, { once: true });
    }

    return {
      get hardSignal() {
        return hardController.signal;
      },
      get hookSignal() {
        return hookController.signal;
      },
      get started() {
        return started;
      },
      get expired() {
        return hardController.signal.aborted;
      },
      start,
      dispose: () => {
        lifecycleSignal?.removeEventListener('abort', start);
        if (hookTimer) clearTimeout(hookTimer);
        if (hardTimer) clearTimeout(hardTimer);
      },
    };
  }

export async function initializeAgentForRPC(
  host: AgentLifecycleHost,
  signal?: AbortSignal,
): Promise<void> {
    // Initialize managers in parallel for faster startup
    await awaitLifecycleStep(Promise.resolve(host.initializeManagers()), signal);
    // Start MCP connections concurrently with the remaining initialization.
    if (host.runtime.config.mcp?.enabled !== false) {
      host.mcpReady = host.mcpManager
        .connectAll(host.runtime.config.mcp?.servers ?? [])
        .then(() => { host.syncMcpTools(); })
        .catch(() => {})
        .finally(() => {
          host.mcpStartupCoordinator.markSummaryPending();
        });
    }
    // These must run sequentially after the parallel init
    await awaitLifecycleStep(
      Promise.resolve(host.skillsRegistry.setWorkspace(host.runtime.workspaceRoot)),
      signal,
    );
    const providerSettings = getHostProviderSettings(host);
    const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    const providerTelemetryMetadata = buildProviderTelemetryMetadata(providerSettings);
    host.sessionStartedAt = Date.now();
    const [, session] = await awaitLifecycleStep(Promise.all([
      host.resetConversationContext(),
      host.sessionManager.createSession(host.runtime.workspaceRoot, model),
    ]), signal);
    await awaitLifecycleStep(startHostActiveAgentHeartbeat(host), signal);

    await awaitLifecycleStep(Promise.resolve(host.injectSessionBootstrap()), signal);

    // Do not acknowledge initialization until the first RPC/command turn can
    // advertise every successfully connected MCP tool.
    if (host.mcpReady) {
      await awaitLifecycleStep(host.mcpReady, signal);
    }

    // Start telemetry session
    if (session) {
      await awaitLifecycleStep(host.telemetryManager.startSession(
        session.metadata.sessionId,
        model,
        host.activeProvider,
        host.sessionStartedAt,
        providerTelemetryMetadata
      ), signal);
    }

    // Fire session-start hook
    await awaitLifecycleStep(host.hookManager.executeHooks('session-start', {
      sessionId: session?.metadata.sessionId,
      sessionType: 'startup',
    }), signal);
  }

export async function runAgentCommandMode(
  host: AgentLifecycleHost,
  instruction: string,
  commandOptions: AbortSignal | RunAgentCommandModeOptions = {},
): Promise<boolean> {
    await applyStartupProviderDefaultsToHost(host);

    const options = 'aborted' in commandOptions
      ? { signal: commandOptions }
      : commandOptions;
    const signal = options.signal;
    const previousCommandMode = host.runtime.isCommandMode;
    const previousUseInkRenderer = host.useInkRenderer;
    let initialized = false;
    let succeeded = false;
    let completedNormally = false;
    let executionFailed = false;
    let turnStartedAt: number | null = null;
    let stopHookFired = false;
    const finalizationDeadline = createCommandFinalizationDeadline(signal);
    host.runtime.isCommandMode = true;
    host.useInkRenderer = false;

    const executeCommandHook = (
      event: 'stop' | 'session-end',
      payload: Record<string, unknown>,
    ): Promise<unknown> => {
      if (signal || finalizationDeadline.started) {
        return host.hookManager.executeHooks(event, payload, {
          signal: finalizationDeadline.hookSignal,
          killGracePeriodMs: COMMAND_HOOK_KILL_GRACE_PERIOD_MS,
        });
      }
      return host.hookManager.executeHooks(event, payload);
    };

    const awaitFinalizationStep = <T>(task: Promise<T>): Promise<T> => (
      awaitLifecycleStep(task, finalizationDeadline.hardSignal)
    );

    const finalizeCommandTurn = async (): Promise<void> => {
      if (turnStartedAt === null || stopHookFired) return;
      stopHookFired = true;

      let finalizationError: unknown;
      let sessionId: string | undefined;
      let snapshot: { tokensUsed?: number; tokensUsageStatus?: string } | undefined;
      try {
        sessionId = host.sessionManager.getCurrentSession()?.metadata.sessionId;
      } catch (error) {
        finalizationError = error;
      }
      try {
        snapshot = host.getStatusSnapshot();
      } catch (error) {
        finalizationError ??= error;
      }
      try {
        await awaitFinalizationStep(executeCommandHook('stop', {
          sessionId,
          turnDuration: Date.now() - turnStartedAt,
          tokensUsed: snapshot?.tokensUsed ?? 0,
          tokensUsageStatus: snapshot?.tokensUsageStatus ?? 'unavailable',
        }));
      } catch {
        // Stop hooks are best-effort and never change command completion.
      }
      if (finalizationError !== undefined) {
        throw finalizationError;
      }
    };

    try {
      if (signal?.aborted) {
        throw createLifecycleAbortError();
      }
      await awaitLifecycleStep(
        Promise.resolve(host.initializeForRPC(signal)),
        signal,
      );
      initialized = true;

      turnStartedAt = Date.now();
      succeeded = await awaitLifecycleStep(
        Promise.resolve(host.runInstruction(instruction, { signal })),
        signal,
      );

      if (!succeeded) {
        finalizationDeadline.start();
      }
      await finalizeCommandTurn();

      if (signal?.aborted) {
        throw createLifecycleAbortError();
      }

      if (succeeded) {
        if (
          host.runtime.config.ui?.terminalBell !== false
          && (host.runtime.options.commandOutputFormat ?? 'text') === 'text'
        ) {
          process.stdout.write('\x07');
        }

        if (host.runtime.config.ui?.showCompletionNotification !== false) {
          host.notificationService.notify(
            { body: host.getCompletionNotificationBody(), reason: 'task_complete' },
            host.getNotificationGuards()
          ).catch(() => {});
        }

        if (host.runtime.options.autoCommit) {
          await awaitLifecycleStep(
            Promise.resolve(host.performAutoCommit(signal)),
            signal,
          );
        }
      }
      completedNormally = true;
      return succeeded;
    } catch (error) {
      executionFailed = true;
      finalizationDeadline.start();
      if (signal?.aborted && error instanceof Error && error.name === 'AbortError') {
        return false;
      }
      throw error;
    } finally {
      try {
        const commandCompleted = completedNormally && succeeded;
        let finalizationError: unknown;
        if (initialized) {
          try {
            await finalizeCommandTurn();
          } catch (error) {
            finalizationError = error;
          }

        }

        if (!options.keepAlive) {
          try {
            await awaitFinalizationStep(Promise.resolve(host.shutdown({
              sessionEndReason: commandCompleted ? 'exit' : 'error',
              telemetryReason: commandCompleted ? 'completed' : 'crashed',
              showSessionSummary: false,
            })));
          } catch (error) {
            finalizationError ??= error;
          }
        }

        if (
          finalizationError !== undefined
          && !executionFailed
          && !finalizationDeadline.expired
        ) {
          throw finalizationError;
        }
      } finally {
        finalizationDeadline.dispose();
        host.runtime.isCommandMode = previousCommandMode;
        host.useInkRenderer = previousUseInkRenderer;
      }
    }
  }

export async function restoreAgentSessionState(host: AgentLifecycleHost, sessionId: string) {
    const session = await host.sessionManager.loadSession(sessionId);

    await host.resetConversationContext();
    await host.injectSessionBootstrap();
    const messages = session.getMessages();
    host.restoredChatMessages = buildSessionChatLog(messages);
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!msg.content.startsWith('You are Autohand')) {
          host.conversation.addSystemNote(msg.content);
        }
      } else {
        let convertedToolCalls: LLMToolCall[] | undefined;
        const sessionToolCalls = (msg as any).toolCalls;
        if (sessionToolCalls && Array.isArray(sessionToolCalls)) {
          convertedToolCalls = sessionToolCalls.map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.tool || tc.function?.name || 'unknown',
              arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args || {})
            }
          }));
        }

        host.conversation.addMessage({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          tool_calls: convertedToolCalls,
          tool_call_id: (msg as any).tool_call_id
        });
      }
    }

    await host.injectProjectKnowledge();
    host.updateContextUsage(host.conversation.history());
    if (host.inkRenderer?.setChatMessages) {
      host.inkRenderer.setChatMessages(host.restoredChatMessages);
    }
    return session;
  }

export async function attachAgentSession(
  host: AgentLifecycleHost,
  sessionId: string
): Promise<{ sessionId: string; model: string; workspaceRoot: string; messageCount: number }> {
    await host.initializeManagers();
    const session = await host.restoreSessionState(sessionId);
    host.sessionStartedAt = Date.now();
    const providerSettings = getHostProviderSettings(host);
    await startHostActiveAgentHeartbeat(host);

    await host.telemetryManager.startSession(
      sessionId,
      session.metadata.model,
      host.activeProvider,
      host.sessionStartedAt,
      buildProviderTelemetryMetadata(providerSettings)
    );

    return {
      sessionId: session.metadata.sessionId,
      model: session.metadata.model,
      workspaceRoot: session.metadata.projectPath,
      messageCount: session.getMessages().length,
    };
  }

export async function resumeAgentSession(host: AgentLifecycleHost, sessionId: string): Promise<void> {
    // Initialize managers and pre-load files in parallel
    await host.initializeManagers();

    try {
      const session = await host.restoreSessionState(sessionId);
      host.sessionStartedAt = Date.now();
      const providerSettings = getHostProviderSettings(host);
      await startHostActiveAgentHeartbeat(host);

      console.log(chalk.cyan(`\n📂 Resumed session ${sessionId}`));

      // Start telemetry for resumed session
      await host.telemetryManager.startSession(
        sessionId,
        session.metadata.model,
        host.activeProvider,
        host.sessionStartedAt,
        buildProviderTelemetryMetadata(providerSettings)
      );

      // Start interactive loop
      await host.runInteractiveLoop();
    } catch (error) {
      console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
      await host.telemetryManager.trackError({
        type: 'session_resume_failed',
        message: (error as Error).message,
        context: 'resumeSession'
      });
      // Fallback to new session
      const providerSettings = getHostProviderSettings(host);
      const model = host.runtime?.options?.model ?? providerSettings?.model ?? 'unconfigured';
      host.sessionStartedAt = Date.now();
      const workspaceRoot = host.runtime?.workspaceRoot ?? process.cwd();
      const fallbackSession = await host.sessionManager.createSession(workspaceRoot, model);
      await startHostActiveAgentHeartbeat(host);
      await host.telemetryManager.startSession(
        fallbackSession.metadata.sessionId,
        model,
        host.activeProvider,
        host.sessionStartedAt,
        buildProviderTelemetryMetadata(providerSettings)
      );
      await host.runInteractiveLoop();
    }
  }

export function logAgentQueuedProcessingMessage(host: AgentLifecycleHost, instruction: string, remaining = 0): void {
    void host;
    void instruction;
    void remaining;
  }

function pendingQueuedWorkHead(
  host: AgentLifecycleHost,
): SequencedQueuedAgentInstruction | undefined {
  const value = host.pendingInkInstructions[0];
  if (value === undefined) return undefined;
  const queued = unpackQueuedAgentInstruction(value);
  if (queued !== value) host.pendingInkInstructions[0] = queued;
  return queued;
}

function totalQueuedWorkCount(host: AgentLifecycleHost): number {
  return host.pendingInkInstructions.length
    + (host.inkRenderer?.getQueueCount?.() ?? 0)
    + (host.persistentInput?.getQueueLength?.() ?? 0);
}

function dequeueOldestQueuedWork(
  host: AgentLifecycleHost,
): { queued: SequencedQueuedAgentInstruction; remaining: number } | undefined {
  const pending = pendingQueuedWorkHead(host);
  const ink = host.inkRenderer?.peekQueuedInstruction?.();
  const persistent = host.persistentInput?.peek?.();
  const heads = [
    pending ? { source: 'pending' as const, sequence: pending.sequence } : undefined,
    ink ? { source: 'ink' as const, sequence: ink.sequence } : undefined,
    persistent ? { source: 'persistent' as const, sequence: persistent.sequence } : undefined,
  ].filter((head): head is NonNullable<typeof head> => head !== undefined);
  heads.sort((left, right) => left.sequence - right.sequence);

  const oldest = heads[0];
  let queued: SequencedQueuedAgentInstruction | undefined;
  if (oldest?.source === 'pending') {
    const value = host.pendingInkInstructions.shift();
    if (value !== undefined) queued = unpackQueuedAgentInstruction(value);
  } else if (oldest?.source === 'ink') {
    const value = host.inkRenderer.dequeueQueuedInstruction();
    if (value) queued = { ...value };
  } else if (oldest?.source === 'persistent') {
    const value = host.persistentInput.dequeue();
    if (value) queued = { text: value.text, sequence: value.sequence };
  } else if (pending) {
    // Compatibility for test/custom renderers that predate sequenced queue heads.
    const value = host.pendingInkInstructions.shift();
    if (value !== undefined) queued = unpackQueuedAgentInstruction(value);
  } else if (host.inkRenderer?.hasQueuedInstructions?.()) {
    const text = host.inkRenderer.dequeueInstruction();
    if (text) queued = createQueuedAgentInstruction({ text });
  } else if (host.persistentInput?.hasQueued?.()) {
    const value = host.persistentInput.dequeue();
    if (value) {
      queued = typeof value.sequence === 'number'
        ? { text: value.text, sequence: value.sequence }
        : createQueuedAgentInstruction({ text: value.text });
    }
  }

  return queued
    ? { queued, remaining: totalQueuedWorkCount(host) }
    : undefined;
}

async function completeQueuedMobileComposerCommand(
  mobileCommand: QueuedMobileComposerCommand,
  outcome: Parameters<QueuedMobileComposerCommand['completion']>[0],
): Promise<void> {
  try {
    await mobileCommand.completion(outcome);
  } catch {
    // The relay completion callback is best-effort and must not break the CLI loop.
  }
}

async function executeQueuedMobileComposerCommand(
  host: AgentLifecycleHost,
  mobileCommand: QueuedMobileComposerCommand,
): Promise<void> {
  try {
    await host.ensureInitComplete();
    host.flushMcpStartupSummaryIfPending();

    const decision = await validateMobileCommandInvocationForWorkspace(
      mobileCommand.command,
      mobileCommand.args,
      host.runtime.workspaceRoot,
    );
    if (!decision.allowed) {
      await completeQueuedMobileComposerCommand(mobileCommand, {
        status: 'rejected',
        message: decision.reason,
      });
      return;
    }

    const handled = await host.handleSlashCommand(
      mobileCommand.command,
      [...mobileCommand.args],
    );
    await completeQueuedMobileComposerCommand(mobileCommand, {
      status: 'completed',
      message: typeof handled === 'string' && handled.trim()
        ? handled
        : `Command ${mobileCommand.command} completed.`,
    });
  } catch (error) {
    await completeQueuedMobileComposerCommand(mobileCommand, {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Command execution failed.',
    });
  }
}

export async function runAgentInteractiveLoop(host: AgentLifecycleHost): Promise<void> {
    // Initialize Ink UI early so the composer is ready before the first idle check.
    // This ensures consistent UI from startup instead of falling back to readline
    // and then switching to Ink after the first prompt.
    if (host.useInkRenderer && !host.inkRenderer) {
      await host.initializeUI(undefined, undefined, true);
      if (host.restoredChatMessages?.length && host.inkRenderer?.setChatMessages) {
        host.inkRenderer.setChatMessages(host.restoredChatMessages);
        host.restoredChatMessages = [];
      }
      // Set to idle state so the Composer accepts input immediately
      host.setComposerIdle();
      host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion ?? undefined);
    }

    while (true) {
      // Check if we should exit immediately (SIGINT/SIGTERM received)
      if (host.shouldExit) {
        await host.closeSession();
        return;
      }

      try {
        let instruction: string | null = null;
        let postTurnAction: PendingPostTurnAction | undefined;
        let mobileTurn: MobileClaimedTurnContext | undefined;
        let mobileCommand: QueuedMobileComposerCommand | undefined;

        // Check shouldExit again before processing any queued items
        if (host.shouldExit) {
          await host.closeSession();
          return;
        }

        const nextQueuedWork = dequeueOldestQueuedWork(host);
        if (nextQueuedWork) {
          instruction = nextQueuedWork.queued.text ?? null;
          postTurnAction = nextQueuedWork.queued.postTurnAction;
          mobileTurn = nextQueuedWork.queued.mobileTurn;
          mobileCommand = nextQueuedWork.queued.mobileCommand;
          if (instruction) {
            if (host.runtime.spinner?.isSpinning) {
              host.runtime.spinner.stop();
              host.lastRenderedStatus = '';
            }
            host.logQueuedProcessingMessage(instruction, nextQueuedWork.remaining);
          }
        }

        if (!instruction && !mobileCommand) {
          if (host.persistentInputActiveTurn) {
            host.promptSeedInput = host.persistentInput.getCurrentInput();
            host.persistentInput.stop();
            host.persistentInputActiveTurn = false;
          }
          // If Ink is still active (idle between turns), wait for the next
          // instruction from the Composer instead of stopping the renderer and
          // falling back to readline. This keeps the Composer alive after
          // non-interactive slash commands like /help and /history.
          writeAutohandDebugLine(
            `[DEBUG] Idle check: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
            host.writeDebugLine?.bind(host)
          );
          if (host.inkRenderer?.isRunning()) {
            // Ensure the renderer is in idle (not working) state so the
            // Composer accepts input.
            writeAutohandDebugLine('[DEBUG] Entering idle-wait, setting working=false', host.writeDebugLine?.bind(host));
            host.setComposerIdle();

            // Wait for the user to submit text in the Composer.
            // handleInkSubmittedInstruction resolves host promise when it
            // queues a new instruction.
            writeAutohandDebugLine('[DEBUG] Waiting for resolver...', host.writeDebugLine?.bind(host));
            await new Promise<void>(resolve => {
              host.inkInstructionResolver = resolve;
            });
            writeAutohandDebugLine('[DEBUG] Resolver resolved', host.writeDebugLine?.bind(host));

            // Restart through the sequenced head arbiter. This prevents a
            // submission from another source after wakeup from overtaking the
            // item that originally resolved the wait.
            continue;
          } else {
            // Ink is not running — drain any stale queued instructions and
            // fall back to readline.
            writeAutohandDebugLine('[DEBUG] Ink not running, falling back to readline', host.writeDebugLine?.bind(host));
            if (host.inkRenderer) {
              while (host.inkRenderer.hasQueuedInstructions()) {
                const qi = host.inkRenderer.dequeueQueuedInstruction?.();
                if (qi) {
                  host.pendingInkInstructions.push(qi);
                  continue;
                }
                const text = host.inkRenderer.dequeueInstruction();
                if (text) {
                  host.pendingInkInstructions.push(createQueuedAgentInstruction({ text }));
                }
              }
              writeAutohandDebugLine('[DEBUG] Stopping inkRenderer in fallback path', host.writeDebugLine?.bind(host));
              host.inkRenderer.stop();
              host.inkRenderer = null;
              host.runtime.inkRenderer = undefined;
              host.inkInstructionResolver = null;
            }
            writeAutohandDebugLine('[DEBUG] Calling promptForInstruction in readline mode', host.writeDebugLine?.bind(host));
            instruction = await host.promptForInstruction();
            writeAutohandDebugLine(`[DEBUG] promptForInstruction returned: ${instruction}`, host.writeDebugLine?.bind(host));
          }
        }

        if (!instruction && !mobileCommand) {
          continue;
        }

        if (mobileCommand) {
          await executeQueuedMobileComposerCommand(host, mobileCommand);
          continue;
        }

        if (!instruction) {
          continue;
        }

        // Handle ! shell commands locally (never send to LLM)
        if (!mobileTurn && isShellCommand(instruction)) {
          const shellCmd = parseShellCommand(instruction);
          await host.executeImmediateShellCommand(shellCmd);
          continue;
        }

        // Ensure background init is complete before processing user input.
        // Slash commands depend on initialized managers too; for example,
        // /skills reads the registry populated during startup.
        await host.ensureInitComplete();
        host.flushMcpStartupSummaryIfPending();

        // Handle slash commands locally (never send to LLM).
        // The readline path (promptForInstruction) handles slash commands
        // before runInstruction, but instructions from the Ink queue bypass
        // that path. Without host, /help etc. go through the full ReAct loop
        // which sends them to the LLM and leaves the composer frozen.
        if (!mobileTurn && instruction.startsWith('/')) {
          if (host.runtime.options.bare && !isLikelyFilePathSlashInput(instruction)) {
            if (host.inkRenderer?.isRunning()) {
              if (!consumeAgentInkSubmittedInstructionEcho(host, instruction)) {
                host.inkRenderer.addUserMessage(instruction);
              }
              host.inkRenderer.addAssistantMessage(BARE_SLASH_COMMANDS_DISABLED_MESSAGE);
            } else {
              console.log(chalk.gray(BARE_SLASH_COMMANDS_DISABLED_MESSAGE));
            }
            if (host.ui || host.inkRenderer) {
              host.setComposerIdle();
              host.clearComposerInput();
              continue;
            }
            continue;
          }

          const parsed = host.parseSlashCommand(instruction);
          const isKnownSlashCommand = host.isSlashCommandSupported(parsed.command);
          if (isKnownSlashCommand || !isLikelyFilePathSlashInput(instruction)) {
            const command = parsed.command;
            const args = parsed.args;

            // /quit and /exit are handled above (line 1795)
            if (command !== '/quit' && command !== '/exit') {
              const isInkRunning = host.inkRenderer?.isRunning();

              // Echo the slash command to the chat log so it's visible.
              // In Ink mode this must stay inside the renderer; raw stdout
              // fights the composer and duplicates the input frame.
              if (isInkRunning) {
                if (!consumeAgentInkSubmittedInstructionEcho(host, instruction)) {
                  host.inkRenderer.addUserMessage(instruction);
                }
              } else if (command !== '/plan') {
                console.log(chalk.white(`\n› ${instruction}`));
              }

              writeAutohandDebugLine(
                `[DEBUG] Before runSlashCommandWithInput: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );

              // For /plan in Ink mode, redirect console output to user messages
              // to avoid stdout corruption that freezes the composer.
              let handled: string | null = null;
              if (command === '/plan' && host.inkRenderer?.isRunning()) {
                const logBuffer: string[] = [];
                handled = await planCommand({} as any, args.join(' '), {
                  output: (msg: string) => logBuffer.push(msg),
                });
                if (logBuffer.length > 0) {
                  host.inkRenderer.addUserMessage(logBuffer.join('\n'));
                }
              } else {
                handled = await host.runSlashCommandWithInput(command, args);
              }

              writeAutohandDebugLine(
                `[DEBUG] After runSlashCommandWithInput: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );
              if (handled !== null && host.inkRenderer?.isRunning()) {
                host.inkRenderer.addAssistantMessage(handled);
              } else if (handled !== null) {
                console.log(renderTerminalMarkdown(handled));
              }
              // Ensure the renderer is in idle state so the Composer accepts input
              // after non-interactive slash commands like /help, /clear, /history
              writeAutohandDebugLine(
                `[DEBUG] After slash command output: inkRenderer exists=${!!host.inkRenderer}, isRunning=${host.inkRenderer?.isRunning()}`,
                host.writeDebugLine?.bind(host)
              );
              if (host.ui || host.inkRenderer) {
                host.setComposerIdle();
                host.clearComposerInput();
                // Return to the top of the loop so the idle-wait path can await
                // the next Composer submission without falling through to
                // instruction.startsWith('/') which would throw on null.
                continue;
              } else {
                continue;
              }
            }
          }
        }

        // Handle # trigger for storing memories (never send to LLM).
        // The readline path (promptForInstruction) handles # memory storage,
        // but instructions from the Ink queue bypass that path.
        if (!mobileTurn && instruction.startsWith('#')) {
          const content = instruction.slice(1).trim();
          if (host.inkRenderer) {
            host.modalActive = true;
            host.inkRenderer.pause();
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          try {
            await host.handleMemoryStore(content);
          } finally {
            if (host.inkRenderer) {
              host.modalActive = false;
              await host.inkRenderer.resume();
            }
          }
          continue;
        }

        // Check idle timeout — force logout if session has been idle too long.
        // Must check BEFORE updating lastActivityAt so the idle duration is accurate.
        if (shouldForceAgentIdleLogout(host.runtime, host.lastActivityAt)) {
          await host.forceIdleLogout();
          return;
        }

        // Update activity timestamp on every user interaction
        host.lastActivityAt = Date.now();

        if (!mobileTurn && (instruction.trim() === '/exit' || instruction.trim() === '/quit')) {
          // Fire-and-forget: don't block quit on telemetry
          host.telemetryManager.trackCommand({ command: instruction }).catch(() => {});
          const trigger = host.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = host.sessionManager.getCurrentSession();
            await host.showFeedbackWithPause(trigger, session?.metadata.sessionId);
          }
          await host.closeSession();
          return;
        }

        const isSlashCommand = !mobileTurn && instruction.startsWith('/');
        if (isSlashCommand) {
          await host.telemetryManager.trackCommand({ command: instruction.split(' ')[0] });
        }

        // Reset error tracking on successful prompt
        host.lastErrorMessage = null;
        host.consecutiveErrorCount = 0;

        // Check shouldExit before processing the instruction
        if (host.shouldExit) {
          return;
        }

        const turnStartTime = Date.now();
        const turnSucceeded = mobileTurn
          ? await host.runInstruction(instruction, { mobileTurn })
          : await host.runInstruction(instruction);
        if (postTurnAction) {
          const consumedAction = postTurnAction;
          postTurnAction = undefined;
          let publicationResult: string | null = null;
          try {
            publicationResult = await host.runPostTurnAction(consumedAction, turnSucceeded);
          } catch {
            publicationResult = [
              'The publication prompt could not be completed. The report remains local.',
              `Recovery: /publish-research ${consumedAction.reportPath}`,
            ].join('\n');
          }
          if (publicationResult && host.inkRenderer?.isRunning()) {
            host.inkRenderer.addAssistantMessage(publicationResult);
          } else if (publicationResult) {
            console.log(renderTerminalMarkdown(publicationResult));
          }
        }
        const goalContinuation = await resolveActiveGoalContinuation(
          {
            runtime: host.runtime,
            sessionId: host.sessionManager.getCurrentSession()?.metadata.sessionId,
            shouldExit: host.shouldExit,
            interactiveAutomodeEnabled: host.interactiveAutomodeEnabled,
            runtimeResourceShutdownController: host.runtimeResourceShutdownController,
          },
          turnSucceeded,
        );
        if (goalContinuation) {
          host.pendingInkInstructions.push(createQueuedAgentInstruction({ text: goalContinuation }));
        }
        host.flushMcpStartupSummaryIfPending();

        // Start generating next-step suggestion in background.
        // The promise is awaited in promptForInstruction() with a deadline
        // so the LLM call runs concurrently with hooks/notifications below.
        if (host.suggestionEngine) {
          host.pendingSuggestion = host.suggestionEngine.generate(host.conversation.history());
          host.persistentInput.setPendingSuggestion(host.pendingSuggestion);
          host.inkRenderer?.setPendingSuggestion?.(host.pendingSuggestion);
        }

        // Fire stop hook after turn completes (non-blocking)
        const turnDuration = Date.now() - turnStartTime;
        const session = host.sessionManager.getCurrentSession();
        const snapshot = host.getStatusSnapshot();
        host.hookManager.executeHooks('stop', {
          sessionId: session?.metadata.sessionId,
          turnDuration,
          tokensUsed: snapshot.tokensUsed,
          tokensUsageStatus: snapshot.tokensUsageStatus,
        }).catch(() => {
          // Ignore hook errors - they shouldn't block the user
        });

        // Restore stdin to known state after hook execution
        // Hook commands with shell: true can sometimes leave stdin in unexpected state
        host.ensureStdinReady();

        // Ring terminal bell to notify user (shows badge on terminal tab)
        if (host.runtime.config.ui?.terminalBell !== false) {
          process.stdout.write('\x07');
        }

        // Native OS notification for task completion
        if (host.runtime.config.ui?.showCompletionNotification !== false) {
          host.notificationService.notify(
            { body: host.getCompletionNotificationBody(), reason: 'task_complete' },
            host.getNotificationGuards()
          ).catch(() => {});
        }

        host.feedbackManager.recordInteraction();
        host.telemetryManager.recordInteraction();

        const feedbackTrigger = host.feedbackManager.shouldPrompt({
          userMessage: instruction,
          taskCompleted: true
        });

        if (feedbackTrigger) {
          const session = host.sessionManager.getCurrentSession();
          await host.showFeedbackWithPause(feedbackTrigger, session?.metadata.sessionId);
        }

        console.log();
      } catch (error) {
        const errorObj = error as any;
        const isCancel = errorObj.name === 'ExitPromptError' ||
          errorObj.isCanceled ||
          errorObj.message?.includes('canceled') ||
          errorObj.message?.includes('User force closed') ||
          !errorObj.message;

        if (isCancel) {
          host.lastErrorMessage = null;
          host.consecutiveErrorCount = 0;
          continue;
        }

        // TTY/IO errors (errno 5 = EIO, setRawMode failures) are unrecoverable.
        // Exit immediately instead of retrying — the terminal is gone.
        const isTTYError = /setRawMode|errno:\s*\d+|EIO|EPERM/.test(errorObj.message ?? '');
        if (isTTYError) {
          await host.errorLogger.log(error as Error, {
            context: 'Interactive loop (TTY failure)',
            workspace: host.runtime.workspaceRoot
          });
          const session = host.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'completed';
            await session.save();
          }
          await host.telemetryManager.endSession('completed');
          return;
        }

        const errorMessage = host.getDisplayErrorMessage(error);

        // Track consecutive identical errors to prevent infinite telemetry spam
        if (errorMessage === host.lastErrorMessage) {
          host.consecutiveErrorCount++;
        } else {
          host.lastErrorMessage = errorMessage;
          host.consecutiveErrorCount = 1;
        }

        // Only send telemetry for the first occurrence of a repeated error
        if (host.consecutiveErrorCount <= 1) {
          await host.errorLogger.log(error as Error, {
            context: 'Interactive loop',
            workspace: host.runtime.workspaceRoot
          });

          await host.telemetryManager.trackError({
            type: 'interactive_loop_error',
            message: errorMessage,
            stack: (error as Error).stack,
            context: 'Interactive loop'
          });

          // Auto-report to GitHub (fire-and-forget, non-blocking)
          host.autoReportManager.reportError(error as Error, {
            errorType: 'interactive_loop_error',
            model: host.runtime.options.model ?? getProviderConfig(host.runtime.config, host.activeProvider)?.model,
            provider: host.activeProvider,
            sessionId: host.sessionManager.getCurrentSession()?.metadata.sessionId,
            conversationLength: host.conversation.history().length,
            contextUsagePercent: Math.round((1 - host.contextPercentLeft / 100) * 100),
          }).catch(() => {});
        }

        // Exit if the same error repeats 3 times - it won't fix itself
        if (host.consecutiveErrorCount >= 3) {
          console.error(chalk.red(`\nFatal: "${errorMessage}" repeated ${host.consecutiveErrorCount} times. Exiting.`));
          const session = host.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'crashed';
            await session.save();
          }
          await host.telemetryManager.endSession('crashed');
          process.exitCode = 1;
          return;
        }

        const session = host.sessionManager.getCurrentSession();
        if (session) {
          session.metadata.status = 'crashed';
          await session.save();
        }

        host.reportInteractiveLoopError(errorMessage);
        console.error(chalk.gray(`Error logged to: ${host.errorLogger.getLogPath()}\n`));

        continue;
      }
    }
  }
