/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { FileActionManager } from '../actions/filesystem.js';
import { getProviderConfig } from '../config.js';
import { isAwsBedrockProviderEnabled } from '../features/featureRegistry.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import { safeEmitKeypressEvents } from '../ui/inputPrompt.js';

import { safeSetRawMode } from '../ui/rawMode.js';
import { isAutohandDebugEnabled, writeAutohandDebugLine } from '../utils/debugLog.js';
import type { UIManager } from '../ui/UIManager.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { ConversationManager } from './conversationManager.js';
import { ContextOrchestrator } from './context/orchestrator.js';
import { ToolManager } from './toolManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { SlashCommandHandler } from './slashCommandHandler.js';
import { SessionManager } from '../session/SessionManager.js';
import { ProjectManager } from '../session/ProjectManager.js';
import { SessionDiffStatsTracker } from './SessionDiffStatsTracker.js';
import type { ChatLogMessage } from '../session/chatLog.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type {
  AgentRuntime,
  AgentAction,
  LLMMessage,
  AgentStatusSnapshot,
  AgentOutputEvent,
  ToolCallRequest,
  ExplorationEvent,
  ProviderName,
  ToolOutputChunk,
  ToolActionOutcome,
  TurnUsage,
} from '../types.js';

import { AgentDelegator } from './agents/AgentDelegator.js';
import type { ToolDefinition } from './toolManager.js';
import { ErrorLogger } from './errorLogger.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { FeedbackManager } from '../feedback/FeedbackManager.js';
import { TelemetryManager } from '../telemetry/TelemetryManager.js';
import { extractAndSaveSessionMemories, type ExtractedMemory } from '../memory/extractSessionMemories.js';
import { SkillsRegistry } from '../skills/SkillsRegistry.js';
import { CommunitySkillsClient } from '../skills/CommunitySkillsClient.js';
import { McpClientManager } from '../mcp/McpClientManager.js';
import type { McpServerConfig } from '../mcp/types.js';
import { PersistentInput } from '../ui/persistentInput.js';
// InkRenderer type - using 'any' to avoid bun bundling ink at compile time
// The actual type comes from dynamic import at runtime
type InkRenderer = any;
import { PermissionManager } from '../permissions/PermissionManager.js';
import {
  isAllowedPermissionPrompt,
  type PermissionMode,
  type PermissionPromptResponse,
  type PermissionPromptResult,
} from '../permissions/types.js';
import { HookManager } from './HookManager.js';
import { TeamManager } from './teams/TeamManager.js';
import { RepeatManager } from './RepeatManager.js';
import type { SessionWorktreeInfo } from '../utils/sessionWorktree.js';
import { ActivityIndicator } from '../ui/activityIndicator.js';
import { NotificationService } from '../utils/notification.js';
import type { VersionCheckResult } from '../utils/versionCheck.js';
// New feature modules
import { ImageManager } from './ImageManager.js';
import { IntentDetector, type Intent, type IntentResult } from './IntentDetector.js';
import { EnvironmentBootstrap, type BootstrapResult } from './EnvironmentBootstrap.js';
import { CodeQualityPipeline } from './CodeQualityPipeline.js';
import { formatExplorationLabel } from './agent/AgentFormatter.js';
import { WorkspaceFileCollector } from './agent/WorkspaceFileCollector.js';
import { ProviderConfigManager } from './agent/ProviderConfigManager.js';
import { ReactionParser } from './agent/ReactionParser.js';
import { ShellSuggestionProvider } from './agent/ShellSuggestionProvider.js';
import { SimpleChatHandler, type SimpleChatAgent } from './agent/SimpleChatHandler.js';
import { McpStartupCoordinator } from './agent/McpStartupCoordinator.js';
import { MentionResolver } from './agent/MentionResolver.js';
import { SystemPromptBuilder } from './agent/SystemPromptBuilder.js';
import { runAgentReactLoop, type AgentReactLoopHost } from './agent/ReactLoopRunner.js';
import { initializeAgentDependencies, type AgentDependencyHost } from './agent/AgentDependencyComposer.js';
import {
  InstructionRunner,
  type AgentInstructionHost,
  type RunInstructionOptions,
  type SessionFailureBugReportOptions,
} from './agent/InstructionRunner.js';
import { buildStatusLineExtension, getConfigStatusLineSettings } from './agent/StatusLineSettings.js';
import {
  agentSleep,
  injectAgentContinuationMessage,
  installAgentPersistentConsoleBridge,
  isAgentContextOverflowError,
  isAgentRetryableSessionError,
  setupAgentEscListener,
  setupAgentPersistentInputInterruptHandlers,
  shouldUsePassiveAgentSessionRetry,
  startAgentPreparationStatus,
  type AgentInputRecoveryHost,
  type AgentInputTurnHost,
} from './agent/InputTurnCoordinator.js';
import {
  attachAgentSession,
  clearAgentQueuesAndAbort,
  ensureAgentInitComplete,
  initializeAgentForRPC,
  initializeAgentManagers,
  installAgentExitSignalHandlers,
  logAgentQueuedProcessingMessage,
  performAgentBackgroundInit,
  requestAgentExit,
  removeAgentExitSignalHandlers,
  restoreAgentSessionState,
  resumeAgentSession,
  runAgentCommandMode,
  runAgentInteractive,
  runAgentInteractiveLoop,
  shutdownAgentRuntimeResources,
} from './agent/AgentLifecycleRunner.js';
import { promptForAgentInstruction, type AgentPromptInstructionHost } from './agent/PromptInstructionReader.js';
import {
  applyAgentAcpConfigOption,
  applyAgentAcpMode,
  applyAgentAcpModel,
  confirmAgentDangerousAction,
  connectAgentAcpMcpServers,
  enterAgentSessionWorktree,
  executeAgentAskFollowupQuestion,
  executeAgentSleepTool,
  exitAgentSessionWorktree,
  handleAgentExitPlanMode,
  handleAgentPlanCreated,
  handleAgentSkillTool,
  handleAgentSlashCommand,
  isAgentDestructiveCommand,
  isAgentSlashCommand,
  isAgentSlashCommandSupported,
  parseAgentSlashCommand,
  requestAgentDirectoryAccess,
  resolveAgentWorkspacePath,
  runAgentSlashCommandWithInput,
  setAgentDirectoryAccessCallback,
  switchAgentWorkspaceContext,
} from './agent/AgentCommandRuntime.js';
import {
  addAgentUIToolOutput,
  addAgentUIToolOutputs,
  buildAgentSpinnerStatusText,
  cleanupAgentUI,
  clearAgentComposerInput,
  ensureAgentSpinnerRunning,
  executeAgentImmediateShellCommand,
  executeAgentImmediateShellCommandForComposer,
  executeAgentImmediateShellCommandForInk,
  fitAgentSpinnerLine,
  forceRenderAgentSpinner,
  formatAgentSpinnerFooter,
  handleAgentInkSubmittedInstruction,
  initializeAgentUI,
  initializeAgentUIManager,
  initAgentFallbackSpinner,
  consumeAgentInkSubmittedInstructionEcho,
  isAgentUsingTerminalRegionsForActiveTurn,
  notifyAgentUser,
  printAgentCompletionSummary,
  resumeAgentSpinnerAfterModalPause,
  setAgentComposerFinalResponse,
  setAgentComposerIdle,
  setAgentPersistentInputActivityLine,
  setAgentSpinnerStatus,
  setAgentUIStatus,
  showAgentFeedbackWithPause,
  shouldAgentPreferPtyForImmediateShellCommands,
  startAgentStatusUpdates,
  stopAgentStatusUpdates,
  stopAgentUI,
  updateAgentInputLine,
  withAgentModalPause,
} from './agent/AgentUIRuntime.js';
import {
  buildAgentUserMessage,
  collectAgentContextSummary,
  formatAgentStatusLine,
  generateAgentSessionBootstrap,
  injectAgentProjectKnowledge,
  injectAgentSessionBootstrap,
  loadAgentInstructionFiles,
  resetAgentConversationContext,
  updateAgentContextUsage,
  type AgentContextRuntimeHost,
} from './agent/AgentContextRuntime.js';
import {
  handleAgentToolOutput,
  queueAgentToolMessageChunk,
  saveAgentToolMessage,
  type AgentToolOutputRuntimeHost,
} from './agent/AgentToolOutputRuntime.js';
import {
  createAgentInstructionsFile,
  displayAgentIntentMode,
  handleAgentMemoryStore,
  performAgentAutoCommit,
  printAgentGitDiff,
  runAgentEnvironmentBootstrap,
  runAgentQualityPipeline,
  undoAgentLastMutation,
  type AgentProjectOperationsHost,
} from './agent/AgentProjectOperations.js';
import {
  closeAgentSession,
  emitAgentOutput,
  emitAgentStatus,
  forceAgentIdleLogout,
  flushScheduledAgentSessionSnapshot,
  getAgentCompletionNotificationBody,
  getAgentNotificationGuards,
  getAgentStatusSnapshot,
  getAndResetAgentExecutedActions,
  getAndResetAgentFileModCount,
  markAgentFilesModified,
  normalizeAgentCompletionNotificationBody,
  recordAgentExecutedAction,
  saveAgentAssistantMessage,
  saveAgentUserMessage,
  setAgentOutputListener,
  setAgentStatusListener,
  type AgentSessionAccountingHost,
} from './agent/AgentSessionAccounting.js';
import { AutoReportManager } from '../reporting/AutoReportManager.js';
import { SuggestionEngine } from './SuggestionEngine.js';
import { ActiveAgentHeartbeat, ActiveAgentRegistry } from '../session/ActiveAgentRegistry.js';

function formatTurnMemoryUpdate(saved: ExtractedMemory[]): string {
  const lines = ['[Auto Memory Update] Background reflection saved these memories for future turns:'];
  for (const memory of saved) {
    lines.push(`- ${memory.level}: ${memory.content}`);
  }
  return lines.join('\n');
}

export class AutohandAgent {
  private static readonly INTERACTIVE_SLASH_COMMANDS = new Set([
    '/chrome', '/hooks', '/feedback', '/permissions', '/login', '/logout',
    '/agents-new', '/agents new', '/resume', '/theme', '/language',
    '/model', '/skills', '/skills install', '/skills-install',
    '/skills new', '/skills-new', '/mcp', '/mcp install', '/mcp-install',
    '/experiments', '/squad',
  ]);

  private contextWindow!: number;
  private contextPercentLeft = 100;
  private ignoreFilter!: GitIgnoreParser;
  private statusListener?: (snapshot: AgentStatusSnapshot) => void;
  private outputListener?: (event: AgentOutputEvent) => void;
  private confirmationCallback?: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<PermissionPromptResponse>;
  private conversation!: ConversationManager;
  private toolManager!: ToolManager;
  private actionExecutor!: ActionExecutor;
  private toolsRegistry!: ToolsRegistry;
  private slashHandler!: SlashCommandHandler;
  private sessionManager!: SessionManager;
  private projectManager!: ProjectManager;
  private toolOutputQueue: Promise<void> = Promise.resolve();
  private memoryManager!: MemoryManager;
  private turnMemoryReflectionInFlight: Promise<void> | null = null;
  private turnMemoryReflectionQueued = false;
  private turnMemoryReflectionAbortController: AbortController | null = null;
  private permissionManager!: PermissionManager;
  private hookManager!: HookManager;
  private delegator!: AgentDelegator;
  private feedbackManager!: FeedbackManager;
  private telemetryManager!: TelemetryManager;
  private skillsRegistry!: SkillsRegistry;
  private communityClient!: CommunitySkillsClient;
  private mcpManager!: McpClientManager;
  private mcpStartupCoordinator!: McpStartupCoordinator;
  /** Background MCP connection promise - resolves when all servers finish connecting */
  private mcpReady: Promise<void> | null = null;
  private activeAbortController: AbortController | null = null;
  private workspaceFileCollector!: WorkspaceFileCollector;
  private mentionResolver!: MentionResolver;
  private providerConfigManager!: ProviderConfigManager;
  private reactionParser!: ReactionParser;
  private simpleChatHandler!: SimpleChatHandler;
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;
  private activeProvider!: ProviderName;
  private errorLogger!: ErrorLogger;
  private autoReportManager!: AutoReportManager;
  private notificationService!: NotificationService;
  private versionCheckResult?: VersionCheckResult;
  private teamManager!: TeamManager;
  private repeatManager!: RepeatManager;
  private sessionWorktreeState: (SessionWorktreeInfo & { originalWorkspaceRoot: string }) | null = null;
  private suggestionEngine: SuggestionEngine | null = null;
  private pendingSuggestion: Promise<void> | null = null;
  private isStartupSuggestion = false;
  private shellSuggestionProvider!: ShellSuggestionProvider;
  private instructionRunner!: InstructionRunner;
  private sessionDiffStatsTracker?: SessionDiffStatsTracker;
  private activeAgentHeartbeat: ActiveAgentHeartbeat | null = null;
  private readonly runtimeResourceShutdownController = new AbortController();
  private runtimeResourceShutdownPromise: Promise<void> | null = null;

  private taskStartedAt: number | null = null;
  private totalTokensUsed = 0;
  private currentTurnActualUsage: TurnUsage = { kind: 'unavailable', reason: 'not_reported' };
  private currentTurnHadUnavailableUsage = false;
  private lastTurnActualUsage: TurnUsage = { kind: 'unavailable', reason: 'not_reported' };
  private sessionActualTokensUsed = 0;
  private sessionTokenUsageUnavailable = false;
  // Real-time token usage status (experimental `token_usage_status` feature).
  // Cumulative input (up) / output (down) tokens, and the most recent request's
  // prompt tokens, which approximate current context-window occupancy.
  private sessionPromptTokens = 0;
  private sessionCompletionTokens = 0;
  private lastContextTokens = 0;
  private statusInterval: NodeJS.Timeout | null = null;
  private resizeHandler: (() => void) | null = null;
  private sessionSyncTimer?: ReturnType<typeof setTimeout>;
  private sessionStartedAt: number = Date.now();
  private sessionTokensUsed = 0;
  // UI Manager - unified interface for Ink or Plain terminal UI
  private ui: UIManager | null = null;
  private inkRenderer: InkRenderer | null = null;
  private useInkRenderer = false;
  private pendingInkInstructions: string[] = [];
  private restoredChatMessages: ChatLogMessage[] = [];
  private inkInstructionResolver: (() => void) | null = null;
  private readlinePromptActive = false;
  private modalActive = false;
  private deferredDebugLines: string[] = [];
  private queueInput = '';
  private promptSeedInput = '';
  private interactiveAutomodeEnabled = false;
  private baseYesMode = false;
  private basePermissionMode: PermissionMode = 'interactive';
  private lastRenderedStatus = '';
  private activityIndicator!: ActivityIndicator;
  private lastAssistantResponseForNotification = '';
  private persistentInput!: PersistentInput;
  private persistentInputActiveTurn = false;
  private currentInkAbortController: AbortController | null = null;
  private currentInkOnCancel: (() => void) | null = null;

  // New feature modules
  private imageManager!: ImageManager;
  private intentDetector!: IntentDetector;
  private environmentBootstrap!: EnvironmentBootstrap;
  private codeQualityPipeline!: CodeQualityPipeline;
  private lastIntent: Intent = 'diagnostic';
  private filesModifiedThisSession = false;
  private fileModCount = 0;
  private modifiedFilePaths = new Set<string>();
  private executedActionNames: string[] = [];
  private searchQueries: string[] = [];
  private sessionRetryCount = 0;
  private consecutiveCancellations = 0;
  private lastActivityAt = Date.now();

  // Exit flag - set when SIGINT/SIGTERM received to stop queue processing immediately
  private shouldExit = false;
  private exitSignalHandlersInstalled = false;
  private exitSignalHandler: (() => void) | null = null;

  // Context compaction - auto-compresses context to prevent "context too long" errors
  private contextOrchestrator!: ContextOrchestrator;

  constructor(
    private llm: LLMProvider,
    private readonly files: FileActionManager,
    private readonly runtime: AgentRuntime
  ) {
    this.baseYesMode = runtime.options.yes === true;
    initializeAgentDependencies(this as unknown as AgentDependencyHost, llm, files, runtime);
    this.sessionDiffStatsTracker = new SessionDiffStatsTracker(runtime.workspaceRoot);
    this.instructionRunner = new InstructionRunner(this as unknown as AgentInstructionHost);
  }

  private syncMcpTools(): void {
    const mcpTools = this.mcpManager.getAllTools();
    const toolDefs: ToolDefinition[] = mcpTools.map((tool) => ({
      name: tool.name as AgentAction['type'],
      description: `[MCP:${tool.serverName}] ${tool.description}`,
      parameters: {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, schema]) => {
            const s = schema as Record<string, unknown>;
            return [key, {
              type: (s.type as string) || 'string',
              description: (s.description as string) || key,
            }];
          })
        ),
        required: tool.parameters.required,
      },
      requiresApproval: false,
    }));

    this.toolManager.replaceMcpTools(toolDefs);
  }

  // Context compaction toggle methods for /cc command
  toggleContextCompaction(): void {
    this.contextOrchestrator.toggle();
  }

  isContextCompactionEnabled(): boolean {
    return this.contextOrchestrator.isEnabled();
  }

  setContextCompaction(enabled: boolean): void {
    this.contextOrchestrator.setEnabled(enabled);
  }

  getContextOrchestrator(): ContextOrchestrator {
    return this.contextOrchestrator;
  }

  /** Promise that resolves when background init is complete */
  private initReady: Promise<void> | null = null;
  private initDone = false;

  private getParallelismLimit(): number {
    return this.runtime?.config?.agent?.parallelToolConcurrency ?? 5;
  }
  private persistentConsoleBridgeCleanup: (() => void) | null = null;

  rebindInteractiveStreams(
    input: NodeJS.ReadStream = process.stdin,
    output: NodeJS.WriteStream = process.stdout
  ): void {
    this.persistentInput.rebindStreams(input, output);
  }

  async runInteractive(initialInstruction?: string): Promise<void> {
    return runAgentInteractive(this, initialInstruction);
  }

  /** Release process resources without ending or closing the current session. */
  shutdownRuntimeResources(): Promise<void> {
    this.runtimeResourceShutdownController?.abort();
    this.runtimeResourceShutdownPromise ??= shutdownAgentRuntimeResources(this);
    return this.runtimeResourceShutdownPromise;
  }

  /**
   * Install SIGINT/SIGTERM handlers to trigger immediate exit with queue cleanup.
   * This ensures queued requests and child processes are terminated when user exits.
   */
  private installExitSignalHandlers(): void {
    return installAgentExitSignalHandlers(this);
  }

  /**
   * Remove exit signal handlers (cleanup).
   */
  private removeExitSignalHandlers(): void {
    return removeAgentExitSignalHandlers(this);
  }

  /**
   * Clear all queues and abort any active work for immediate exit.
   */
  private clearAllQueuesAndAbort(): void {
    return clearAgentQueuesAndAbort(this);
  }

  /**
   * Shared parallel initialization for all managers + workspace file collection.
   * Used by performBackgroundInit, initializeForRPC, and resumeSession.
   */
  private async initializeManagers(): Promise<void> {
    return initializeAgentManagers(this);
  }

  /**
   * Background initialization - runs while prompt is visible.
   * Everything here happens concurrently with the user reading/typing.
   * NOTE: Must NOT write to stdout - the prompt is already rendering.
   */
  private async performBackgroundInit(): Promise<void> {
    return performAgentBackgroundInit(this, this.runtimeResourceShutdownController?.signal);
  }

  /**
   * Ensure background initialization is complete before processing instructions.
   * Called once when user submits their first instruction (prompt is closed).
   * Also fires the session-start hook here so output renders cleanly.
   */
  private async ensureInitComplete(): Promise<void> {
    return ensureAgentInitComplete(this, this.runtimeResourceShutdownController?.signal);
  }

  /**
   * Initialize the agent for RPC mode (no interactive loop or command mode)
   */
  async initializeForRPC(signal?: AbortSignal): Promise<void> {
    return initializeAgentForRPC(this, signal);
  }

  async runCommandMode(instruction: string, signal?: AbortSignal): Promise<boolean> {
    return runAgentCommandMode(
      this,
      instruction,
      signal ?? this.runtimeResourceShutdownController?.signal,
    );
  }

  requestExit(): void {
    requestAgentExit(this);
  }

  /**
   * Auto-commit: Run lint, test, then use LLM to generate commit message
   */
  private async performAutoCommit(signal?: AbortSignal): Promise<void> {
    return performAgentAutoCommit(this as unknown as AgentProjectOperationsHost, signal);
  }

  private async restoreSessionState(sessionId: string) {
    return restoreAgentSessionState(this, sessionId);
  }

  async attachSession(sessionId: string): Promise<{ sessionId: string; model: string; workspaceRoot: string; messageCount: number }> {
    return attachAgentSession(this, sessionId);
  }

  async resumeSession(sessionId: string): Promise<void> {
    return resumeAgentSession(this, sessionId);
  }

  private lastErrorMessage: string | null = null;
  private consecutiveErrorCount = 0;

  private logQueuedProcessingMessage(instruction: string, remaining = 0): void {
    return logAgentQueuedProcessingMessage(this, instruction, remaining);
  }

  private async runInteractiveLoop(): Promise<void> {
    return runAgentInteractiveLoop(this);
  }

  private async promptForInstruction(): Promise<string | null> {
    return promptForAgentInstruction(this.createPromptInstructionHost());
  }

  private createPromptInstructionHost(): AgentPromptInstructionHost {
    const agent = this;

    return {
      flushDeferredDebugLines: () => agent.flushDeferredDebugLines(),
      formatStatusLine: () => agent.formatStatusLine(),
      handleMemoryStore: (content: string) => agent.handleMemoryStore(content),
      imageManager: agent.imageManager,
      isSlashCommandSupported: (command: string) => agent.isSlashCommandSupported(command),
      get isStartupSuggestion() { return agent.isStartupSuggestion; },
      set isStartupSuggestion(value: boolean) { agent.isStartupSuggestion = value; },
      mentionResolver: agent.mentionResolver,
      parseSlashCommand: (input: string) => agent.parseSlashCommand(input),
      get pendingSuggestion() { return agent.pendingSuggestion; },
      set pendingSuggestion(value: Promise<void> | null) { agent.pendingSuggestion = value; },
      get promptSeedInput() { return agent.promptSeedInput; },
      set promptSeedInput(value: string) { agent.promptSeedInput = value; },
      get readlinePromptActive() { return agent.readlinePromptActive; },
      set readlinePromptActive(value: boolean) { agent.readlinePromptActive = value; },
      resolveLlmShellSuggestion: (input: string) => agent.resolveLlmShellSuggestion(input),
      runSlashCommandWithInput: (command: string, args: string[]) => agent.runSlashCommandWithInput(command, args),
      runtime: agent.runtime,
      skillsRegistry: agent.skillsRegistry,
      get suggestionEngine() { return agent.suggestionEngine; },
      workspaceFileCollector: agent.workspaceFileCollector,
      writeDebugLine: (line: string) => agent.writeDebugLine(line),
    };
  }

  private async resolveLlmShellSuggestion(inputLine: string): Promise<string | null> {
    return this.getShellSuggestionProvider().resolve(inputLine);
  }

  private getShellSuggestionProvider(): ShellSuggestionProvider {
    if (!this.shellSuggestionProvider) {
      this.shellSuggestionProvider = new ShellSuggestionProvider({
        runtime: this.runtime,
        conversation: this.conversation,
        getLlm: () => this.llm,
        getParallelismLimit: () => this.getParallelismLimit(),
      });
    }
    return this.shellSuggestionProvider;
  }

  private async handleMemoryStore(content: string): Promise<void> {
    return handleAgentMemoryStore(this as unknown as AgentProjectOperationsHost, content);
  }

  private scheduleTurnMemoryReflection(success: boolean): void {
    if (this.runtimeResourceShutdownPromise) {
      return;
    }
    if (!this.shouldRunTurnMemoryReflection(success)) {
      return;
    }

    if (this.turnMemoryReflectionInFlight) {
      this.turnMemoryReflectionQueued = true;
      return;
    }

    this.turnMemoryReflectionInFlight = this.runQueuedTurnMemoryReflection()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.writeTurnMemoryDebugLine(`[memory] turn reflection failed: ${message}`);
      })
      .finally(() => {
        this.turnMemoryReflectionInFlight = null;
      });
  }

  private shouldRunTurnMemoryReflection(success: boolean): boolean {
    if (!success) return false;
    if (this.runtime.options?.bare) return false;
    if (this.runtime.isCommandMode || this.runtime.options?.prompt) return false;
    return this.runtime.config?.agent?.autoMemory !== false;
  }

  private async runQueuedTurnMemoryReflection(): Promise<void> {
    do {
      this.turnMemoryReflectionQueued = false;
      await this.runTurnMemoryReflectionOnce();
    } while (this.turnMemoryReflectionQueued);
  }

  private async runTurnMemoryReflectionOnce(): Promise<void> {
    const abortController = new AbortController();
    this.turnMemoryReflectionAbortController = abortController;

    try {
      const conversationHistory = this.conversation.history().filter((message) =>
        !(message.role === 'system' && typeof message.content === 'string' && message.content.includes('[Auto Memory Update]'))
      );

      const saved = await extractAndSaveSessionMemories({
        llm: this.llm,
        memoryManager: this.memoryManager,
        conversationHistory,
        workspaceRoot: this.runtime.workspaceRoot,
        signal: abortController.signal,
        options: {
          minUserMessages: 1,
          source: 'turn-reflection',
        },
      });

      if (abortController.signal.aborted || this.runtimeResourceShutdownPromise || saved.length === 0) {
        return;
      }

      this.conversation.addSystemNote(formatTurnMemoryUpdate(saved), '[Auto Memory Update]');
      this.writeTurnMemoryDebugLine(
        `[memory] turn reflection saved ${saved.length} ${saved.length === 1 ? 'memory' : 'memories'}`,
      );
    } finally {
      if (this.turnMemoryReflectionAbortController === abortController) {
        this.turnMemoryReflectionAbortController = null;
      }
    }
  }

  private writeTurnMemoryDebugLine(message: string): void {
    if (this.runtimeResourceShutdownPromise || !isAutohandDebugEnabled()) {
      return;
    }

    this.writeDebugLine(message);
  }

  private async flushTurnMemoryReflection(timeoutMs = 1500): Promise<void> {
    if (!this.turnMemoryReflectionInFlight) {
      return;
    }

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      deadlineTimer = setTimeout(resolve, timeoutMs);
      deadlineTimer.unref?.();
    });
    try {
      await Promise.race([this.turnMemoryReflectionInFlight, deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
  }

  private printGitDiff(): void {
    return printAgentGitDiff(this as unknown as AgentProjectOperationsHost);
  }

  private async undoLastMutation(): Promise<void> {
    return undoAgentLastMutation(this as unknown as AgentProjectOperationsHost);
  }


  private async promptApprovalMode(): Promise<void> {
    const options: ModalOption[] = [
      { label: 'Require approval before risky actions', value: 'confirm' },
      { label: 'Auto-confirm actions (dangerous)', value: 'prompt' }
    ];

    const result = await showModal({
      title: 'Choose confirmation mode',
      options,
      initialIndex: this.runtime.options.yes ? 1 : 0
    });

    if (!result) {
      // User cancelled, keep current setting
      return;
    }

    this.baseYesMode = result.value === 'prompt';
    this.runtime.options.yes = this.baseYesMode;
    console.log(
      result.value === 'prompt'
        ? chalk.yellow('Auto-confirm enabled. Use responsibly.')
        : chalk.green('Manual approvals required before risky writes.')
    );
  }

  private async createAgentsFile(): Promise<void> {
    return createAgentInstructionsFile(this as unknown as AgentProjectOperationsHost);
  }

  /**
   * Detect if instruction is simple chat that doesn't need tools
   * Fast path for conversational responses
   */
  private isSimpleChat(instruction: string): boolean {
    return this.getSimpleChatHandler().isSimpleChat(instruction);
  }

  private getSimpleChatHandler(): SimpleChatHandler {
    if (!this.simpleChatHandler) {
      this.simpleChatHandler = new SimpleChatHandler(this as unknown as SimpleChatAgent);
    }
    return this.simpleChatHandler;
  }

  /**
   * Handle simple chat without spinner/tools (fast path)
   */
  private async handleSimpleChat(instruction: string): Promise<boolean> {
    return this.getSimpleChatHandler().handle(instruction);
  }

  async runInstruction(instruction: string, options?: RunInstructionOptions): Promise<boolean> {
    this.instructionRunner ??= new InstructionRunner(this as unknown as AgentInstructionHost);
    return this.instructionRunner.run(instruction, options);
  }

  private handleToolOutput(chunk: ToolOutputChunk): void {
    return handleAgentToolOutput(this as unknown as AgentToolOutputRuntimeHost, chunk);
  }

  private queueToolMessageChunk(
    name: string,
    content: string,
    toolCallId: string,
    stream?: 'stdout' | 'stderr'
  ): void {
    return queueAgentToolMessageChunk(
      this as unknown as AgentToolOutputRuntimeHost,
      name,
      content,
      toolCallId,
      stream
    );
  }

  private async saveToolMessage(name: string, content: string, toolCallId?: string): Promise<void> {
    return saveAgentToolMessage(
      this as unknown as AgentToolOutputRuntimeHost,
      name,
      content,
      toolCallId
    );
  }

  /**
   * Force logout when the session has been idle beyond the configured timeout.
   * Clears the local auth token, informs the user, and exits.
   */
  private async forceIdleLogout(): Promise<void> {
    return forceAgentIdleLogout(this as unknown as AgentSessionAccountingHost);
  }

  private async closeSession(): Promise<void> {
    await this.flushTurnMemoryReflection();
    return closeAgentSession(this as unknown as AgentSessionAccountingHost);
  }

  private flushScheduledSessionSnapshot(): Promise<void> {
    return flushScheduledAgentSessionSnapshot(this as unknown as AgentSessionAccountingHost);
  }

  private async runReactLoop(abortController: AbortController): Promise<void> {
    return runAgentReactLoop(this.createReactLoopHost(), abortController);
  }

  private createReactLoopHost(): AgentReactLoopHost {
    const agent = this;

    return {
      get activeProvider() { return agent.activeProvider; },
      autoReportManager: agent.autoReportManager,
      get consecutiveCancellations() { return agent.consecutiveCancellations; },
      set consecutiveCancellations(value) { agent.consecutiveCancellations = value; },
      contextOrchestrator: agent.contextOrchestrator,
      get contextWindow() { return agent.contextWindow; },
      set contextWindow(value) { agent.contextWindow = value; },
      get contextPercentLeft() { return agent.contextPercentLeft; },
      conversation: agent.conversation,
      get inkRenderer() { return agent.inkRenderer as AgentReactLoopHost['inkRenderer']; },
      get lastAssistantResponseForNotification() { return agent.lastAssistantResponseForNotification; },
      set lastAssistantResponseForNotification(value) { agent.lastAssistantResponseForNotification = value; },
      llm: agent.llm,
      memoryManager: agent.memoryManager,
      projectManager: agent.projectManager,
      runtime: agent.runtime,
      searchQueries: agent.searchQueries,
      sessionManager: agent.sessionManager,
      get sessionStartedAt() { return agent.sessionStartedAt; },
      get sessionTokensUsed() { return agent.sessionTokensUsed; },
      get taskStartedAt() { return agent.taskStartedAt; },
      toolManager: agent.toolManager,
      get totalTokensUsed() { return agent.totalTokensUsed; },
      set totalTokensUsed(value) { agent.totalTokensUsed = value; },
      get currentTurnActualUsage() { return agent.currentTurnActualUsage; },
      set currentTurnActualUsage(value) { agent.currentTurnActualUsage = value; },
      get currentTurnHadUnavailableUsage() { return agent.currentTurnHadUnavailableUsage; },
      set currentTurnHadUnavailableUsage(value) { agent.currentTurnHadUnavailableUsage = value; },
      get sessionActualTokensUsed() { return agent.sessionActualTokensUsed; },
      get sessionTokenUsageUnavailable() { return agent.sessionTokenUsageUnavailable; },
      get sessionPromptTokens() { return agent.sessionPromptTokens; },
      set sessionPromptTokens(value) { agent.sessionPromptTokens = value; },
      get sessionCompletionTokens() { return agent.sessionCompletionTokens; },
      set sessionCompletionTokens(value) { agent.sessionCompletionTokens = value; },
      get lastContextTokens() { return agent.lastContextTokens; },
      set lastContextTokens(value) { agent.lastContextTokens = value; },
      cleanupModelResponse: (content) => agent.cleanupModelResponse(content),
      emitOutput: (event) => agent.emitOutput(event),
      ensureSpinnerRunning: () => agent.ensureSpinnerRunning(),
      forceRenderSpinner: () => agent.forceRenderSpinner(),
      getMessagesWithImages: () => agent.getMessagesWithImages(),
      getReactionParser: () => agent.getReactionParser(),
      handleSmartContextCrop: (call) => agent.handleSmartContextCrop(call),
      isContextOverflowError: (errorOrMessage) => agent.isContextOverflowError(errorOrMessage),
      saveAssistantMessage: (content, toolCalls) => agent.saveAssistantMessage(content, toolCalls),
      saveToolMessage: (name, content, toolCallId) => agent.saveToolMessage(name, content, toolCallId),
      setComposerFinalResponse: (response) => agent.setComposerFinalResponse(response),
      setComposerIdle: () => agent.setComposerIdle(),
      setSpinnerStatus: (status) => agent.setSpinnerStatus(status),
      startStatusUpdates: () => agent.startStatusUpdates(),
      stopStatusUpdates: () => agent.stopStatusUpdates(),
      updateContextUsage: (messages, tools) => agent.updateContextUsage(messages, tools),
      writeDebugLine: (message) => agent.writeDebugLine(message),
    };
  }

  private getReactionParser(): ReactionParser {
    if (!this.reactionParser) {
      this.reactionParser = new ReactionParser({
        cleanupModelResponse: (content) => this.cleanupModelResponse(content),
      });
    }
    return this.reactionParser;
  }

  private async handleSmartContextCrop(call: ToolCallRequest): Promise<string> {
    const args = (call.args ?? {}) as Record<string, unknown>;
    const direction = typeof args.crop_direction === 'string' ? args.crop_direction.toLowerCase() : '';
    if (direction !== 'top' && direction !== 'bottom') {
      return 'smart_context_cropper skipped: invalid crop_direction';
    }
    const amount = Number(args.crop_amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return 'smart_context_cropper skipped: crop_amount must be positive';
    }
    const needApproval = Boolean(args.need_user_approve);
    if (needApproval) {
      const approved = await this.confirmDangerousAction(
        `Crop ${direction} ${Math.floor(amount)} message(s) from the conversation?`,
        { tool: 'smart_context_cropper' }
      );
      if (!isAllowedPermissionPrompt(approved)) {
        return 'smart_context_cropper canceled by user.';
      }
    }

    const removed = this.conversation.cropHistory(direction, Math.floor(amount));
    if (!removed.length) {
      return 'smart_context_cropper: no eligible messages to remove.';
    }

    const summary = typeof args.deleted_messages_summary === 'string' ? args.deleted_messages_summary.trim() : '';
    if (summary) {
      this.conversation.addSystemNote(`Cropped summary: ${summary}`);
    }

    return `Cropped ${removed.length} message(s) from the ${direction}.`;
  }

  private async buildUserMessage(instruction: string): Promise<string> {
    return buildAgentUserMessage(this as unknown as AgentContextRuntimeHost, instruction);
  }

  private async buildSystemPrompt(): Promise<string> {
    return new SystemPromptBuilder({
      runtime: this.runtime,
      supportsNativeToolCalling: this.llm?.getCapabilities?.().nativeToolCalling === true,
      getToolDefinitions: () => this.toolManager?.listDefinitions() ?? [],
      getContextMemories: () => this.memoryManager.getContextMemories(),
      loadInstructionFiles: () => this.loadInstructionFiles(),
      listSkills: () => this.skillsRegistry.listSkills(),
      getActiveSkills: () => this.skillsRegistry.getActiveSkills(),
      getTeam: () => this.teamManager.getTeam(),
    }).build();
  }

  /**
   * Generate a concise summary of removed messages using LLM-powered summarization.
   * Delegates to the summarizer module for rich summaries,
   * falling back to static extraction if LLM is unavailable.
   */
  private async summarizeRemovedMessages(messages: LLMMessage[]): Promise<string> {
    const { summarizeWithLLM } = await import('./context/summarizer.js');
    return summarizeWithLLM(messages, this.llm, this.memoryManager);
  }

  private cleanupModelResponse(content: string): string {
    let cleaned = content;

    // Remove common artifacts from models
    cleaned = cleaned.replace(/<end_of.turn>/gi, '');
    cleaned = cleaned.replace(/<\|.*?\|>/g, ''); // Remove tokens like <|eot_id|>

    // Strip <tool_call> XML blocks that leaked through (some models output these
    // as text instead of using native tool calling; if extractXmlToolCalls didn't
    // catch them, they must not be displayed as raw text)
    cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');
    // Also strip unclosed <tool_call> tags at the end of content
    cleaned = cleaned.replace(/<tool_call>[\s\S]*$/g, '');

    // Remove broken JSON fragments at the end
    cleaned = cleaned.replace(/```json[\s\S]*$/i, '');
    cleaned = cleaned.replace(/\{"?toolCalls"?\s*:\s*\[\][\s\S]*$/i, '');
    cleaned = cleaned.replace(/,?\s*"finalResponse"\s*:\s*"[^"]*"\s*\}?\]?\}?$/i, '');

    // Remove **Thought:** prefix pattern
    cleaned = cleaned.replace(/^\*\*Thought:\*\*\s*/i, '');

    // Remove trailing JSON-like fragments
    cleaned = cleaned.replace(/\}\s*\]\s*\}?\s*$/g, '');

    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

    return cleaned;
  }

  private recordExploration(event: ExplorationEvent): void {
    if (!this.isInstructionActive) {
      return;
    }
    if (!this.hasPrintedExplorationHeader) {
      console.log('\n' + chalk.bold('* Explored'));
      this.hasPrintedExplorationHeader = true;
    }
    const label = formatExplorationLabel(event.kind);
    console.log(`  ${chalk.cyan(label)} ${event.target}`);
  }

  private clearExplorationLog(): void {
    this.hasPrintedExplorationHeader = false;
  }

  /**
   * Initialize the UIManager for the active terminal mode.
   * Ink is the default interactive UI; Plain is only used for non-TTY/fallback paths.
   */
  private initializeUIManager(): void {
    return initializeAgentUIManager(this);
  }

  /**
   * Sync the active provider and model into the Ink status line.
   */
  private syncProviderModelStatusLine(provider: ProviderName = this.activeProvider): void {
    const providerSettings = getProviderConfig(this.runtime.config, provider);
    const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    const providerLabel =
      providerSettings && 'displayName' in providerSettings && typeof providerSettings.displayName === 'string'
        ? providerSettings.displayName
        : provider;
    this.ui?.setProviderModel?.(providerLabel, model);
    this.inkRenderer?.setConfiguredLineExtensions?.(buildStatusLineExtension({
      settings: getConfigStatusLineSettings(this.runtime.config),
      sessionDiffStats: this.sessionDiffStatsTracker?.getStats(),
      sessionHasFileChanges: this.filesModifiedThisSession === true,
    }));
  }

  /**
   * Initialize the UI for a new instruction.
   * Uses InkRenderer when enabled, otherwise falls back to ora spinner.
   */
  private async initializeUI(
    abortController?: AbortController,
    onCancel?: () => void,
    suppressSpinner = false
  ): Promise<void> {
    return initializeAgentUI(this, abortController, onCancel, suppressSpinner);
  }

  /**
   * Initialize fallback ora spinner when InkRenderer can't be loaded.
   */
  private initFallbackSpinner(): void {
    return initAgentFallbackSpinner(this);
  }

  /**
   * Update the UI status text.
   */
  private setUIStatus(status: string): void {
    return setAgentUIStatus(this, status);
  }

  private setComposerIdle(): void {
    return setAgentComposerIdle(this);
  }

  private clearComposerInput(): void {
    return clearAgentComposerInput(this);
  }

  private setComposerFinalResponse(response: string): void {
    return setAgentComposerFinalResponse(this, response);
  }

  /**
   * Stop the UI and show completion state.
   */
  private stopUI(failed = false, message?: string): void {
    return stopAgentUI(this, failed, message);
  }

  /**
   * Clean up the UI completely.
   * Preserves any queued instructions from InkRenderer before stopping.
   * When `keepInkAlive` is true, the Ink renderer is transitioned to idle
   * instead of being destroyed, preventing the composer disappear/reappear
   * flicker between back-to-back turns.
   */
  private cleanupUI(keepInkAlive = false): void {
    return cleanupAgentUI(this, keepInkAlive);
  }

  /**
   * Print the turn-completion summary line.  When terminal regions are still
   * active (queued instruction keeps persistent input alive), route through
   * writeAbove so the message lands in the scroll region instead of on top of
   * the composer.
   */
  private printCompletionSummary(regionsStillActive: boolean, succeeded = true): void {
    return printAgentCompletionSummary(this, regionsStillActive, succeeded);
  }

  notifyUser(message: string): void {
    return notifyAgentUser(this, message);
  }

  /**
   * Show a feedback prompt, pausing persistent input first so the Modal
   * owns stdin exclusively and keystrokes don't leak into the composer.
   */
  private async showFeedbackWithPause(
    trigger: string,
    sessionId?: string
  ): Promise<void> {
    return showAgentFeedbackWithPause(this, trigger, sessionId);
  }

  /**
   * Add tool output to the UI.
   */
  private addUIToolOutput(tool: string, success: boolean, output: string): void {
    return addAgentUIToolOutput(this, tool, success, output);
  }

  /**
   * Add batched tool outputs to the UI.
   */
  private addUIToolOutputs(outputs: Array<{ tool: string; success: boolean; output: string; thought?: string }>): void {
    return addAgentUIToolOutputs(this, outputs);
  }

  private async handleInkSubmittedInstruction(text: string): Promise<void> {
    return handleAgentInkSubmittedInstruction(this, text);
  }

  private shouldPreferPtyForImmediateShellCommands(): boolean {
    return shouldAgentPreferPtyForImmediateShellCommands(this);
  }

  private async executeImmediateShellCommand(
    shellCmd: string,
    routeOpts?: { persistentInputActiveTurn: boolean; terminalRegionsDisabled: boolean; writeAbove: (text: string) => void }
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return executeAgentImmediateShellCommand(this, shellCmd, routeOpts);
  }

  private async executeImmediateShellCommandForComposer(
    shellCmd: string,
    routeOpts?: { persistentInputActiveTurn: boolean; terminalRegionsDisabled: boolean; writeAbove: (text: string) => void }
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return executeAgentImmediateShellCommandForComposer(this, shellCmd, routeOpts);
  }

  private async executeImmediateShellCommandForInk(shellCmd: string): Promise<{ success: boolean; output?: string; error?: string }> {
    return executeAgentImmediateShellCommandForInk(this, shellCmd);
  }

  private async collectContextSummary(): Promise<{ workspaceRoot: string; gitStatus?: string; recentFiles: string[] }> {
    return collectAgentContextSummary(this as unknown as AgentContextRuntimeHost);
  }

  private async loadInstructionFiles(): Promise<string[]> {
    return loadAgentInstructionFiles(this as unknown as AgentContextRuntimeHost);
  }

  private async injectProjectKnowledge(): Promise<void> {
    return injectAgentProjectKnowledge(this as unknown as AgentContextRuntimeHost);
  }

  private setupEscListener(controller: AbortController, onCancel: () => void, ctrlCInterrupt = false): () => void {
    return setupAgentEscListener(this as unknown as AgentInputTurnHost, controller, onCancel, ctrlCInterrupt);
  }


  /**
   * Wire ESC/Ctrl+C through PersistentInput while it owns stdin.
   * This prevents dual keypress listeners from racing the cursor state.
   */
  private setupPersistentInputInterruptHandlers(
    controller: AbortController,
    onCancel: () => void
  ): () => void {
    return setupAgentPersistentInputInterruptHandlers(this as unknown as AgentInputTurnHost, controller, onCancel);
  }


  private installPersistentConsoleBridge(): () => void {
    return installAgentPersistentConsoleBridge(this as unknown as AgentInputTurnHost);
  }


  private startPreparationStatus(instruction: string): () => void {
    return startAgentPreparationStatus(this as unknown as AgentInputTurnHost, instruction);
  }


  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return agentSleep(ms);
  }


  /**
   * Detect context-overflow errors from API 400 responses.
   * These are recoverable via auto-compaction and retry.
   */
  private isContextOverflowError(errorOrMessage: Error | string): boolean {
    return isAgentContextOverflowError(errorOrMessage);
  }


  /**
   * Categorize errors to determine retry behavior.
   * Returns true if the error is retryable.
   */
  private isRetryableSessionError(error: Error): boolean {
    return isAgentRetryableSessionError(error);
  }


  /**
   * Transport/service retries should simply wait and retry the same turn.
   * They must not inject extra continuation instructions back into the model.
   */
  private shouldUsePassiveSessionRetry(error: Error): boolean {
    return shouldUsePassiveAgentSessionRetry(error);
  }


  /**
   * Inject a continuation message into the conversation to help the LLM
   * recover from a failure and continue the task.
   */
  private injectContinuationMessage(error: Error, retryAttempt: number): void {
    injectAgentContinuationMessage(this as unknown as AgentInputRecoveryHost, error, retryAttempt);
  }


  /**
   * Submit a detailed bug report when a session failure occurs.
   */
  private async submitSessionFailureBugReport(
    error: Error,
    retryAttempt: number,
    maxRetries: number,
    options: SessionFailureBugReportOptions = {}
  ): Promise<void> {
    try {
      // Gather context for the bug report
      const history = this.conversation.history();
      const recentToolCalls = history
        .filter(m => m.role === 'assistant' && m.tool_calls)
        .slice(-3)
        .flatMap(m => m.tool_calls?.map(tc => tc.function?.name) || [])
        .filter(Boolean) as string[];

      const model = this.runtime.options.model ??
        getProviderConfig(this.runtime.config, this.activeProvider)?.model;

      await this.telemetryManager.trackSessionFailureBug({
        error,
        retryAttempt,
        maxRetries,
        conversationLength: history.length,
        lastToolCalls: recentToolCalls,
        iterationCount: (this as any).__currentIteration ?? 0,
        contextUsage: this.contextPercentLeft,
        model,
        provider: this.activeProvider
      });

      // Also log to local error logger for debugging
      await this.errorLogger.log(error, {
        context: `Session failure (retry ${retryAttempt + 1}/${maxRetries})`,
        workspace: this.runtime.workspaceRoot
      });

      if (options.autoReport === false) {
        writeAutohandDebugLine(
          `[DEBUG] Skipping session failure auto-report during retry attempt ${retryAttempt}/${maxRetries}`,
          this.writeDebugLine.bind(this)
        );
        return;
      }

      // Auto-report to GitHub (fire-and-forget, non-blocking)
      this.autoReportManager.reportError(error, {
        errorType: 'session_failure',
        model,
        provider: this.activeProvider,
        sessionId: this.sessionManager.getCurrentSession()?.metadata.sessionId,
        conversationLength: history.length,
        lastToolCalls: recentToolCalls,
        contextUsagePercent: Math.round((1 - this.contextPercentLeft / 100) * 100),
        retryAttempt,
        maxRetries,
      }).catch(() => {});
    } catch (reportError) {
      // Don't let bug reporting failure prevent the retry
      console.error(chalk.gray(`[Debug] Failed to submit bug report: ${(reportError as Error).message}`));
    }
  }

  /**
   * Display the detected intent mode to the user (only in debug mode)
   */
  private displayIntentMode(result: IntentResult): void {
    return displayAgentIntentMode(result);
  }

  /**
   * Run environment bootstrap before implementation
   */
  private async runEnvironmentBootstrap(): Promise<BootstrapResult> {
    return runAgentEnvironmentBootstrap(this as unknown as AgentProjectOperationsHost);
  }

  private async saveUserMessage(content: string): Promise<void> {
    return saveAgentUserMessage(this as unknown as AgentSessionAccountingHost, content);
  }

  private async saveAssistantMessage(content: string, toolCalls?: ToolCallRequest[]): Promise<void> {
    return saveAgentAssistantMessage(
      this as unknown as AgentSessionAccountingHost,
      content,
      toolCalls
    );
  }


  /**
   * Run code quality pipeline after file modifications
   */
  private async runQualityPipeline(): Promise<void> {
    return runAgentQualityPipeline(this as unknown as AgentProjectOperationsHost);
  }

  /**
   * Mark that files were modified during this session (called by action executor)
   */
  markFilesModified(filePath?: string, changeType?: 'create' | 'modify' | 'delete'): void {
    return markAgentFilesModified(this as unknown as AgentSessionAccountingHost, filePath, changeType);
  }

  /**
   * Get file modification count and modified paths since last reset, then reset counters.
   * Used by auto-mode to track per-iteration file changes.
   */
  getAndResetFileModCount(): { count: number; paths: string[] } {
    return getAndResetAgentFileModCount(this as unknown as AgentSessionAccountingHost);
  }

  /**
   * Record an executed action name (tool call) for tracking.
   */
  recordExecutedAction(actionType: string): void {
    return recordAgentExecutedAction(this as unknown as AgentSessionAccountingHost, actionType);
  }

  /**
   * Get and reset executed action names since last call.
   */
  getAndResetExecutedActions(): string[] {
    return getAndResetAgentExecutedActions(this as unknown as AgentSessionAccountingHost);
  }

  /**
   * Get the image manager for adding/managing images
   */
  getImageManager(): ImageManager {
    return this.imageManager;
  }

  /**
   * Get the file action manager for preview mode and change batching
   */
  getFileManager(): FileActionManager {
    return this.files;
  }

  /**
   * Get the hook manager for lifecycle hooks
   */
  getHookManager(): HookManager {
    return this.hookManager;
  }

  /**
   * Get the skills registry for skill management
   */
  getSkillsRegistry(): SkillsRegistry {
    return this.skillsRegistry;
  }

  /**
   * Get the auto-mode manager (if running in auto-mode)
   * Returns undefined when not in auto-mode - automode is CLI-driven
   */
  getAutomodeManager(): import('./AutomodeManager.js').AutomodeManager | undefined {
    // Auto-mode manager is created externally when running with --auto-mode flag
    // This method is primarily for RPC integration
    return undefined;
  }

  /**
   * Get the session manager for session history access
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get the MCP client manager for server/tool listing
   */
  getMcpManager(): McpClientManager {
    return this.mcpManager;
  }

  /**
   * Get the dynamic tools registry for non-interactive management surfaces.
   */
  getToolsRegistry(): ToolsRegistry {
    return this.toolsRegistry;
  }

  /**
   * Get the memory manager for memory extraction and storage
   */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * Get the LLM provider for direct model access (e.g. memory extraction)
   */
  getLlmProvider(): LLMProvider {
    return this.llm;
  }

  /**
   * Get current tool definitions for context usage calculations.
   * Used by RPC adapter to provide real context usage data.
   */
  getToolDefinitions(): import('../types.js').FunctionDefinition[] {
    return this.toolManager?.toFunctionDefinitions() ?? [];
  }

  /**
   * Get the permission manager for mode control
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Cancel the currently active instruction loop, if any.
   * Used by ACP/RPC adapters to propagate session/cancel.
   */
  cancelCurrentInstruction(): void {
    this.activeAbortController?.abort();
  }

  /**
   * Apply ACP mode changes to runtime and permission behavior.
   */
  applyAcpMode(modeId: string): void {
    return applyAgentAcpMode(this, modeId);
  }

  private setInteractiveAutomodeEnabled(enabled: boolean): void {
    this.interactiveAutomodeEnabled = enabled;
    this.syncInteractiveAutomodePermissions();
  }

  private syncInteractiveAutomodePermissions(): void {
    if (this.interactiveAutomodeEnabled) {
      this.runtime.options.yes = true;
      this.runtime.options.unrestricted = true;
      this.runtime.options.restricted = false;
      this.permissionManager.setMode('unrestricted');
      return;
    }

    // CLI flags override config file settings (restricted takes precedence for safety)
    if (this.runtime.options.restricted) {
      this.runtime.options.yes = false;
      this.runtime.options.unrestricted = false;
      this.permissionManager.setMode('restricted');
      return;
    }

    if (this.runtime.options.unrestricted) {
      this.runtime.options.yes = true;
      this.runtime.options.restricted = false;
      this.permissionManager.setMode('unrestricted');
      return;
    }

    if (this.baseYesMode) {
      this.runtime.options.yes = true;
      this.runtime.options.unrestricted = false;
      this.runtime.options.restricted = false;
      this.permissionManager.setMode('interactive');
      return;
    }

    if (this.basePermissionMode === 'restricted') {
      this.runtime.options.yes = false;
      this.runtime.options.unrestricted = false;
      this.runtime.options.restricted = true;
      this.permissionManager.setMode('restricted');
      return;
    }

    if (this.basePermissionMode === 'unrestricted') {
      this.runtime.options.yes = true;
      this.runtime.options.unrestricted = true;
      this.runtime.options.restricted = false;
      this.permissionManager.setMode('unrestricted');
      return;
    }

    this.runtime.options.yes = false;
    this.runtime.options.unrestricted = false;
    this.runtime.options.restricted = false;
    this.permissionManager.setMode('interactive');
  }

  /**
   * Apply ACP model changes for subsequent and in-flight iterations.
   */
  applyAcpModel(modelId: string): void {
    return applyAgentAcpModel(this, modelId);
  }

  /**
   * Apply ACP config option changes to runtime behavior.
   */
  applyAcpConfigOption(configId: string, value: string): void {
    return applyAgentAcpConfigOption(this, configId, value);
  }

  /**
   * Connect ACP-provided MCP servers and refresh available MCP tools.
   */
  async connectAcpMcpServers(configs: McpServerConfig[]): Promise<void> {
    return connectAgentAcpMcpServers(this, configs);
  }

  /**
   * Run a slash command with PersistentInput active so the user can type
   * while long-running commands like /learn execute.
   */
  private async runSlashCommandWithInput(command: string, args: string[]): Promise<string | null> {
    return runAgentSlashCommandWithInput(this, command, args);
  }

  /**
   * Handle a slash command (e.g., /skills, /skills install, /model)
   * Returns the command output or null if the command doesn't exist
   */
  async handleSlashCommand(command: string, args: string[] = []): Promise<string | null> {
    return handleAgentSlashCommand(this, command, args);
  }

  /**
   * Check if a string is a slash command
   */
  isSlashCommand(input: string): boolean {
    return isAgentSlashCommand(this, input);
  }

  /**
   * Check if a slash command is supported (exists in the command map)
   */
  isSlashCommandSupported(command: string): boolean {
    return isAgentSlashCommandSupported(this, command);
  }

  /**
   * Parse a slash command string into command and args
   * e.g., "/skills install myskill" -> { command: "/skills install", args: ["myskill"] }
   */
  parseSlashCommand(input: string): { command: string; args: string[] } {
    return parseAgentSlashCommand(this, input);
  }

  /**
   * Get messages with images included for the LLM API call.
   * Modifies the last user message to include any images from the session.
   * Uses ImageManager.toOpenAIFormat() which applies size limits to prevent
   * the 53MB+ payload overflow issue (Issue #81).
   * The returned messages may have multimodal content (array of text/image parts)
   * which is supported by OpenAI/OpenRouter APIs but not strictly typed.
   * @returns Messages formatted for API with multimodal content
   */
  private async getMessagesWithImages(): Promise<LLMMessage[]> {
    const messages = this.conversation.history();
    const images = this.imageManager.getAll();

    // If no images, return messages as-is
    if (images.length === 0) {
      return messages;
    }

    // Find the last user message to attach images to
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    // Use ImageManager's size-limited format (prevents 53MB+ payloads)
    const imageContents = await this.imageManager.toOpenAIFormat();

    // Clone messages and modify the last user message to include images
    const result: LLMMessage[] = messages.map((msg, i) => {
      if (i === lastUserMessageIndex && imageContents.length > 0) {
        // Create multimodal content array
        // Note: content will be an array, which the API accepts but our type says string
        // This is intentional for multimodal support
        const contentParts = [
          { type: 'text', text: msg.content },
          ...imageContents,
        ];

        return {
          ...msg,
          // Cast to string to satisfy type, API actually accepts array
          content: contentParts as unknown as string
        };
      }
      return { ...msg };
    });

    return result;
  }


  /**
   * Update the spinner display (called on input change)
   * Triggers immediate re-render with current input
   */
  private updateInputLine(): void {
    return updateAgentInputLine(this);
  }

  /**
   * Force an immediate spinner render with current state
   */
  private forceRenderSpinner(): void {
    return forceRenderAgentSpinner(this);
  }

  private formatSpinnerFooter(footer: { left: string; right?: string }): string {
    return formatAgentSpinnerFooter(this, footer);
  }

  private buildSpinnerStatusText(statusLine: string, footerLine?: string): string {
    return buildAgentSpinnerStatusText(this, statusLine, footerLine);
  }

  private fitSpinnerLine(value: string, width: number): string {
    return fitAgentSpinnerLine(this, value, width);
  }

  private setSpinnerStatus(status: string): void {
    return setAgentSpinnerStatus(this, status);
  }

  private startStatusUpdates(): void {
    return startAgentStatusUpdates(this);
  }

  private stopStatusUpdates(): void {
    return stopAgentStatusUpdates(this);
  }

  private isUsingTerminalRegionsForActiveTurn(): boolean {
    return isAgentUsingTerminalRegionsForActiveTurn(this);
  }

  private setPersistentInputActivityLine(activity: string): void {
    return setAgentPersistentInputActivityLine(this, activity);
  }

  private ensureSpinnerRunning(): void {
    return ensureAgentSpinnerRunning(this);
  }

  private resumeSpinnerAfterModalPause(): void {
    return resumeAgentSpinnerAfterModalPause(this);
  }

  /**
   * Pause all UI (status updates, spinner, persistent input, ink renderer),
   * execute a callback, then restore everything. Used by confirmAction,
   * executeAskFollowupQuestion, and handlePlanCreated.
   */
  private async withModalPause<T>(fn: () => Promise<T>): Promise<T> {
    return withAgentModalPause(this, fn);
  }

  private updateContextUsage(messages: LLMMessage[], tools?: import('../types.js').FunctionDefinition[]): void {
    return updateAgentContextUsage(this as unknown as AgentContextRuntimeHost, messages, tools);
  }

  /**
   * Ensure stdin is in a known good state for readline input.
   * This is called after operations that may interfere with stdin state,
   * such as hook execution with shell: true.
   */
  private ensureStdinReady(): void {
    const stdin = process.stdin as NodeJS.ReadStream;
    if (!stdin.isTTY) return;

    // When the Ink renderer is active, it manages raw mode and readable
    // listeners via its own reference counting. External manipulation breaks
    // Ink 7's stdin handling and leaves the composer unresponsive.
    if (this.inkRenderer?.isRunning()) {
      return;
    }

    // When persistent input is active, it owns raw mode and key handling.
    // Do not override stdin state between queued turns.
    if (this.persistentInputActiveTurn) {
      return;
    }

    // Ensure stdin is not paused and is readable
    // Some operations (like shell spawns) can leave stdin in an unexpected state
    try {
      // First, ensure raw mode is off (readline will set it as needed)
      if (typeof stdin.setRawMode === 'function' && (stdin as any).isRaw) {
        safeSetRawMode(stdin, false);
      }

      // Resume stdin if it was paused
      if (stdin.isPaused()) {
        stdin.resume();
      }

      // Re-apply keypress events setup (idempotent operation)
      safeEmitKeypressEvents(stdin);
    } catch {
      // Ignore errors - best effort restoration
    }
  }

  setVersionCheckResult(result: VersionCheckResult): void {
    this.versionCheckResult = result;
  }

  private formatStatusLine(): { left: string; right: string } {
    return formatAgentStatusLine(this as unknown as AgentContextRuntimeHost);
  }

  private printUserInstructionToChatLog(instruction: string): void {
    const normalized = instruction.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return;
    }

    // Use InkRenderer if available
    if (this.useInkRenderer && this.inkRenderer) {
      if (consumeAgentInkSubmittedInstructionEcho(this, normalized)) {
        return;
      }
      this.inkRenderer.addUserMessage(normalized);
      return;
    }

    const lines = normalized.split('\n');
    const usingTerminalRegions = this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0';
    if (usingTerminalRegions) {
      this.persistentInput.writeAbove(`${chalk.white(`› ${lines[0] ?? ''}`)}\n`);
      for (const line of lines.slice(1)) {
        this.persistentInput.writeAbove(`${chalk.white(`  ${line}`)}\n`);
      }
      return;
    }

    console.log(chalk.white(`\n› ${lines[0] ?? ''}`));
    for (const line of lines.slice(1)) {
      console.log(chalk.white(`  ${line}`));
    }
  }

  private flushMcpStartupSummaryIfPending(): void {
    this.mcpStartupCoordinator.flushSummaryIfPending();
  }

  private async resetConversationContext(): Promise<void> {
    return resetAgentConversationContext(this as unknown as AgentContextRuntimeHost);
  }

  /**
   * Generate an explicit session bootstrap note that surfaces the most
   * important context — memories, AGENTS.md, skills, and project structure —
   * as a coherent "here's what you should know" block. This is injected as a
   * system note so the LLM explicitly sees it, rather than passively hoping it
   * notices buried system prompt content.
   */
  private async generateSessionBootstrap(): Promise<string> {
    return generateAgentSessionBootstrap(this as unknown as AgentContextRuntimeHost);
  }

  /**
   * Inject the session bootstrap into the conversation. Called once per
   * session start (new CLI invocation, /new, /clear, or resumed session).
   */
  private async injectSessionBootstrap(): Promise<void> {
    return injectAgentSessionBootstrap(this as unknown as AgentContextRuntimeHost);
  }

  private availableProviders(): ProviderName[] {
    const providers: ProviderName[] = [];
    if (this.runtime.config.openrouter) providers.push('openrouter');
    if (this.runtime.config.ollama) providers.push('ollama');
    if (this.runtime.config.llamacpp) providers.push('llamacpp');
    if (this.runtime.config.openai) providers.push('openai');
    if (this.runtime.config.mlx) providers.push('mlx');
    if (this.runtime.config.llmgateway) providers.push('llmgateway');
    if (this.runtime.config.zai) providers.push('zai');
    if (this.runtime.config.sakana) providers.push('sakana');
    if (this.runtime.config.bedrock && isAwsBedrockProviderEnabled(this.runtime.config)) providers.push('bedrock');
    return providers.length ? providers : ['openrouter'];
  }


  private getNotificationGuards() {
    return getAgentNotificationGuards(this as unknown as AgentSessionAccountingHost);
  }

  private getCompletionNotificationBody(): string {
    return getAgentCompletionNotificationBody(this as unknown as AgentSessionAccountingHost);
  }

  private normalizeCompletionNotificationBody(raw: string): string {
    return normalizeAgentCompletionNotificationBody(
      this as unknown as AgentSessionAccountingHost,
      raw
    );
  }

  private async confirmDangerousAction(
    message: string,
    context?: { tool?: string; path?: string; command?: string }
  ): Promise<PermissionPromptResult> {
    return confirmAgentDangerousAction(this, message, context);
  }

  /**
   * Request access to a directory outside the workspace.
   * In RPC mode, sends a notification to the client for user approval.
   * In interactive mode, shows a modal prompt.
   */
  private directoryAccessCallback?: (path: string, reason?: string) => Promise<string | undefined>;

  setDirectoryAccessCallback(callback: (path: string, reason?: string) => Promise<string | undefined>): void {
    return setAgentDirectoryAccessCallback(this, callback);
  }

  private async requestDirectoryAccess(dirPath: string, reason?: string): Promise<string | undefined> {
    return requestAgentDirectoryAccess(this, dirPath, reason);
  }

  /**
   * Handle ask_followup_question tool with proper TUI coordination.
   * Uses Ink-based question modal for consistent UX.
   */
  private async executeAskFollowupQuestion(
    question: string,
    suggestedAnswers?: string[]
  ): Promise<string> {
    return executeAgentAskFollowupQuestion(this, question, suggestedAnswers);
  }

  /**
   * Handle plan creation - sets plan on manager and confirms to the LLM.
   * This is called when the LLM uses the `plan` tool.
   *
   * The acceptance modal is NOT shown here. The LLM must call `exit_plan_mode`
   * when ready to present the plan for approval.
   */
  private async handlePlanCreated(plan: import('../modes/planMode/types.js').Plan, filePath: string): Promise<string> {
    return handleAgentPlanCreated(this, plan, filePath);
  }

  /**
   * Handle exit_plan_mode tool - presents the plan to the user for approval.
   * This transitions from planning phase to execution (or back to planning
   * if the user rejects).
   */
  private async handleExitPlanMode(_summary?: string): Promise<ToolActionOutcome> {
    return handleAgentExitPlanMode(this, _summary);
  }

  private resolveWorkspacePath(relativePath: string): string {
    return resolveAgentWorkspacePath(this, relativePath);
  }

  private async switchWorkspaceContext(workspaceRoot: string): Promise<void> {
    return switchAgentWorkspaceContext(this, workspaceRoot);
  }

  private async enterSessionWorktree(name?: string): Promise<string> {
    return enterAgentSessionWorktree(this, name);
  }

  private handleSkillTool(
    action: Extract<AgentAction, { type: 'skill' }>
  ): ToolActionOutcome {
    return handleAgentSkillTool(this, action);
  }

  private async executeSleepTool(seconds: number, reason?: string): Promise<string> {
    return executeAgentSleepTool(this, seconds, reason);
  }

  private async exitSessionWorktree(keep = false): Promise<string> {
    return exitAgentSessionWorktree(this, keep);
  }

  private isDestructiveCommand(command: string): boolean {
    return isAgentDestructiveCommand(this, command);
  }

  setStatusListener(listener?: (snapshot: AgentStatusSnapshot) => void): void {
    return setAgentStatusListener(this as unknown as AgentSessionAccountingHost, listener);
  }

  setOutputListener(listener?: (event: AgentOutputEvent) => void): void {
    return setAgentOutputListener(this as unknown as AgentSessionAccountingHost, listener);
  }

  /**
   * Set a callback for confirmation prompts (used by RPC mode)
   * When set, this callback is used instead of the default Modal prompt
   */
  setConfirmationCallback(
    callback: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<PermissionPromptResponse>
  ): void {
    this.confirmationCallback = callback;
  }

  private getDisplayErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    const fallback = String(error ?? '').trim();
    return fallback || 'Unknown error occurred';
  }

  private reportInteractiveLoopError(errorMessage: string): void {
    this.emitOutput({ type: 'error', content: errorMessage });

    if (this.persistentInputActiveTurn) {
      this.promptSeedInput = this.persistentInput.getCurrentInput();
      this.persistentInput.stop();
      this.persistentInputActiveTurn = false;
    }

    console.error(chalk.red('\nAn error occurred:'));
    console.error(chalk.red(errorMessage));
  }

  private writeDebugLine(message: string): void {
    const line = message.endsWith('\n') ? message : `${message}\n`;

    // Defer debug output while the readline prompt is active so async
    // callbacks (e.g. SuggestionEngine) don't corrupt the prompt box.
    if (this.readlinePromptActive && !this.persistentInputActiveTurn) {
      this.deferredDebugLines.push(line);
      return;
    }

    if (this.inkRenderer?.isRunning?.()) {
      this.inkRenderer.addNotification(message.trim());
      return;
    }

    if (
      this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0'
    ) {
      this.persistentInput.pause();
      try {
        process.stderr.write(line);
      } finally {
        this.persistentInput.resume();
      }
      return;
    }

    process.stderr.write(line);
  }

  private flushDeferredDebugLines(): void {
    if (this.deferredDebugLines.length === 0) return;
    const lines = this.deferredDebugLines.splice(0);
    for (const line of lines) {
      process.stderr.write(line);
    }
  }

  private emitOutput(event: AgentOutputEvent): void {
    return emitAgentOutput(this as unknown as AgentSessionAccountingHost, event);
  }

  private emitStatus(): void {
    emitAgentStatus(this as unknown as AgentSessionAccountingHost);
    this.activeAgentHeartbeat?.update(this.isInstructionActive ? 'working' : 'idle').catch(() => {});
  }

  getStatusSnapshot(): AgentStatusSnapshot {
    return getAgentStatusSnapshot(this as unknown as AgentSessionAccountingHost);
  }

  private async startActiveAgentHeartbeat(): Promise<void> {
    if (this.runtimeResourceShutdownPromise || this.runtimeResourceShutdownController?.signal.aborted) return;

    const previousHeartbeat = this.activeAgentHeartbeat;
    await previousHeartbeat?.stop().catch(() => {});
    if (this.runtimeResourceShutdownPromise || this.runtimeResourceShutdownController?.signal.aborted) return;

    const heartbeat = new ActiveAgentHeartbeat(
      new ActiveAgentRegistry(),
      {
        runtime: this.runtime,
        getProvider: () => this.activeProvider,
        getSession: () => this.sessionManager.getCurrentSession(),
        getStatusSnapshot: () => this.getStatusSnapshot(),
      },
    );
    this.activeAgentHeartbeat = heartbeat;
    await heartbeat.start();
    if (
      this.runtimeResourceShutdownPromise
      || this.runtimeResourceShutdownController?.signal.aborted
      || this.activeAgentHeartbeat !== heartbeat
    ) {
      if (this.activeAgentHeartbeat === heartbeat) this.activeAgentHeartbeat = null;
      await heartbeat.stop().catch(() => {});
    }
  }

  private async stopActiveAgentHeartbeat(): Promise<void> {
    const heartbeat = this.activeAgentHeartbeat;
    this.activeAgentHeartbeat = null;
    await heartbeat?.stop().catch(() => {});
  }

  private async updateActiveAgentHeartbeat(status?: 'idle' | 'working'): Promise<void> {
    await this.activeAgentHeartbeat?.update(status ?? (this.isInstructionActive ? 'working' : 'idle'));
  }
}
