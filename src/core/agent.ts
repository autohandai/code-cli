/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import ora from 'ora';
import { showModal, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import { FileActionManager } from '../actions/filesystem.js';
import { saveConfig, getProviderConfig } from '../config.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import {
  getPromptBlockWidth,
  promptNotify,
  readInstruction,
  safeEmitKeypressEvents
} from '../ui/inputPrompt.js';

import { safeSetRawMode } from '../ui/rawMode.js';
import { isShellCommand, parseShellCommand, executeShellCommandAsync, executeStreamingShellCommand } from '../ui/shellCommand.js';
import { showQuestionModal } from '../ui/questionModal.js';
import { showPlanAcceptModal } from '../ui/planAcceptModal.js';
import { showDirectoryAccessModal } from '../ui/directoryAccessModal.js';
import { createInkUIManager } from '../ui/InkUIManager.js';
import { createPlainUIManager } from '../ui/PlainUIManager.js';
import type { UIManager } from '../ui/UIManager.js';
import {
  getContextWindow,
  estimateMessagesTokens,
  calculateContextUsage
} from './context/tokenizer.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { getAutoCommitInfo } from '../actions/git.js';
import { SLASH_COMMANDS } from './slashCommands.js';
import { ConversationManager } from './conversationManager.js';
import { ContextOrchestrator } from './context/orchestrator.js';
import { ToolManager } from './toolManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { SlashCommandHandler } from './slashCommandHandler.js';
import { renderTerminalMarkdown, createImmediateShellCommandBlockWriter, formatImmediateShellCommandHeader } from './immediateCommandRouter.js';
import { isToolAllowedByYolo, normalizeYoloInput, parseYoloPattern } from '../permissions/yoloMode.js';
import { SessionManager } from '../session/SessionManager.js';
import { ProjectManager } from '../session/ProjectManager.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type { SessionMessage } from '../session/types.js';
import type {
  AgentRuntime,
  AgentAction,
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  AgentStatusSnapshot,
  AgentOutputEvent,
  AssistantReactPayload,
  ToolCallRequest,
  ExplorationEvent,
  ProviderName,
  ToolOutputChunk,
  LoadedConfig
} from '../types.js';

import { AgentDelegator } from './agents/AgentDelegator.js';
import type { ToolDefinition } from './toolManager.js';
import { ErrorLogger } from './errorLogger.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { FeedbackManager } from '../feedback/FeedbackManager.js';
import { TelemetryManager } from '../telemetry/TelemetryManager.js';
import { SkillsRegistry } from '../skills/SkillsRegistry.js';
import { CommunitySkillsClient } from '../skills/CommunitySkillsClient.js';
import { McpClientManager } from '../mcp/McpClientManager.js';
import type { McpServerConfig } from '../mcp/types.js';
import { AUTH_CONFIG } from '../constants.js';
import { getAuthClient } from '../auth/index.js';
import { PersistentInput } from '../ui/persistentInput.js';
import { t } from '../i18n/index.js';
// InkRenderer type - using 'any' to avoid bun bundling ink at compile time
// The actual type comes from dynamic import at runtime
type InkRenderer = any;
import { PermissionManager } from '../permissions/PermissionManager.js';
import {
  isAllowedPermissionPrompt,
  normalizePermissionPromptResponse,
  type PermissionMode,
  type PermissionPromptResponse,
  type PermissionPromptResult,
} from '../permissions/types.js';
import { HookManager } from './HookManager.js';
import { TeamManager } from './teams/TeamManager.js';
import { RepeatManager } from './RepeatManager.js';
import { prepareSessionWorktree, type SessionWorktreeInfo } from '../utils/sessionWorktree.js';
import { WorktreeManager } from '../actions/worktree.js';
import { confirm as unifiedConfirm, isExternalCallbackEnabled } from '../ui/promptCallback.js';
import { ActivityIndicator } from '../ui/activityIndicator.js';
import { NotificationService } from '../utils/notification.js';
import { formatPlanModeToggleMessage, getPlanModeManager, plan as planCommand } from '../commands/plan.js';
import type { VersionCheckResult } from '../utils/versionCheck.js';
import { getInstallHint } from '../utils/versionCheck.js';
import { runWithConcurrency, type ParallelTaskSpec } from '../utils/parallel.js';
// New feature modules
import { ImageManager } from './ImageManager.js';
import { IntentDetector, type Intent, type IntentResult } from './IntentDetector.js';
import { EnvironmentBootstrap, type BootstrapResult } from './EnvironmentBootstrap.js';
import { CodeQualityPipeline } from './CodeQualityPipeline.js';
import { ProjectAnalyzer as OnboardingProjectAnalyzer } from '../onboarding/projectAnalyzer.js';
import { AgentsGenerator } from '../onboarding/agentsGenerator.js';
import {
  formatExplorationLabel,
  formatElapsedTime,
  formatTokens
} from './agent/AgentFormatter.js';
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
import { runAgentInstruction, type AgentInstructionHost } from './agent/InstructionRunner.js';
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
  type AgentInputTurnHost,
} from './agent/InputTurnCoordinator.js';
import { buildSessionBootstrap } from './agent/SessionBootstrapBuilder.js';
import { AutoReportManager } from '../reporting/AutoReportManager.js';
import { isLikelyFilePathSlashInput } from './slashInputDetection.js';
import { SuggestionEngine } from './SuggestionEngine.js';

export class AutohandAgent {
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

  private taskStartedAt: number | null = null;
  private totalTokensUsed = 0;
  private statusInterval: NodeJS.Timeout | null = null;
  private resizeHandler: (() => void) | null = null;
  private sessionStartedAt: number = Date.now();
  private sessionTokensUsed = 0;
  // UI Manager - unified interface for Ink or Plain terminal UI
  private ui: UIManager | null = null;
  private inkRenderer: InkRenderer | null = null;
  private useInkRenderer = false;
  private pendingInkInstructions: string[] = [];
  private inkInstructionResolver: (() => void) | null = null;
  private readlinePromptActive = false;
  private modalActive = false;
  private deferredDebugLines: string[] = [];
  private queueInput = '';
  private promptSeedInput = '';
  private interactiveAutomodeEnabled = false;
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

  // Context compaction - auto-compresses context to prevent "context too long" errors
  private contextOrchestrator!: ContextOrchestrator;

  constructor(
    private llm: LLMProvider,
    private readonly files: FileActionManager,
    private readonly runtime: AgentRuntime
  ) {
    initializeAgentDependencies(this as unknown as AgentDependencyHost, llm, files, runtime);
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
    // Bail out early if stdin is not a TTY - interactive mode requires a terminal
    if (!process.stdin.isTTY) {
      console.error(chalk.red('Interactive mode requires a terminal (TTY). Use --prompt for non-interactive usage.'));
      process.exitCode = 1;
      return;
    }

    // Queue piped text so the first loop iteration processes it before prompting.
    if (initialInstruction) {
      this.pendingInkInstructions.push(initialInstruction);
    }

    this.mcpStartupCoordinator.prepareForInteractiveStartup();

    // Start ALL initialization in background so prompt appears instantly.
    // The user can start typing while managers initialize.
    // When they submit, we await initReady before processing.
    this.initReady = this.performBackgroundInit();

    // Fire startup suggestion LLM call immediately so the first prompt
    // shows contextual ghost text. Git context is gathered asynchronously
    // and the LLM call runs fully in the background.
    // promptForInstruction() awaits this with a 5s startup deadline,
    // then falls back to no suggestion if the call hasn't resolved.
    if (this.suggestionEngine) {
      const engine = this.suggestionEngine;
      const workspaceRoot = this.runtime.workspaceRoot;
      const collector = this.workspaceFileCollector;
      this.isStartupSuggestion = true;
      this.pendingSuggestion = (async () => {
        const [gitStatusResult, gitLogResult] = await runWithConcurrency([
          {
            label: 'git_status',
            run: async () => execFileAsync('git', ['status', '-sb'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
          {
            label: 'git_log',
            run: async () => execFileAsync('git', ['log', '--oneline', '-5'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          },
        ], this.getParallelismLimit());
        const recentFiles = collector.getCachedFiles().slice(0, 20);
        await engine.generateFromProjectContext({
          gitStatus: gitStatusResult?.stdout.trim() || undefined,
          recentCommits: gitLogResult?.stdout.trim() || undefined,
          recentFiles,
        });
      })();
      this.persistentInput.setPendingSuggestion(this.pendingSuggestion);
    }

    // Install exit signal handlers to stop queue processing immediately on SIGINT/SIGTERM
    this.installExitSignalHandlers();

    // Show prompt immediately - don't wait for init
    await this.runInteractiveLoop();

    // Clean up signal handlers
    this.removeExitSignalHandlers();
  }

  /**
   * Install SIGINT/SIGTERM handlers to trigger immediate exit with queue cleanup.
   * This ensures queued requests and child processes are terminated when user exits.
   */
  private installExitSignalHandlers(): void {
    if (this.exitSignalHandlersInstalled) return;
    this.exitSignalHandlersInstalled = true;

    const handleExitSignal = () => {
      if (this.shouldExit) {
        // Second signal - force immediate exit
        console.log(chalk.gray('\nForce exiting...'));
        process.exit(0);
      }
      this.shouldExit = true;
      console.log(chalk.gray('\nExiting - clearing queues and stopping...'));
      this.clearAllQueuesAndAbort();
    };

    process.on('SIGINT', handleExitSignal);
    process.on('SIGTERM', handleExitSignal);
  }

  /**
   * Remove exit signal handlers (cleanup).
   */
  private removeExitSignalHandlers(): void {
    this.exitSignalHandlersInstalled = false;
    // Note: process.removeListener would require storing the handler reference.
    // The shouldExit flag prevents handlers from doing anything after cleanup.
  }

  /**
   * Clear all queues and abort any active work for immediate exit.
   */
  private clearAllQueuesAndAbort(): void {
    // Clear pending instruction queues
    this.pendingInkInstructions.length = 0;
    if (this.inkRenderer) {
      this.inkRenderer.clearQueue();
    }
    // Clear persistent input queue
    while (this.persistentInput.hasQueued()) {
      this.persistentInput.dequeue();
    }

    // Abort any active abort controllers to stop current work
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
      } catch {
        // Ignore abort errors
      }
      this.activeAbortController = null;
    }
    if (this.currentInkAbortController) {
      try {
        this.currentInkAbortController.abort();
      } catch {
        // Ignore abort errors
      }
      this.currentInkAbortController = null;
    }
    this.shellSuggestionProvider?.abort();

    // Stop any active team processes
    if (this.teamManager) {
      this.teamManager.shutdown().catch(() => {});
    }

    // Resolve any pending ink instruction resolver to unblock the loop
    if (this.inkInstructionResolver) {
      this.inkInstructionResolver();
      this.inkInstructionResolver = null;
    }
  }

  /**
   * Shared parallel initialization for all managers + workspace file collection.
   * Used by performBackgroundInit, initializeForRPC, and resumeSession.
   */
  private async initializeManagers(): Promise<void> {
    await runWithConcurrency([
      { label: 'session_manager', run: async () => this.sessionManager.initialize() },
      { label: 'project_manager', run: async () => this.projectManager.initialize() },
      { label: 'memory_manager', run: async () => this.memoryManager.initialize() },
      { label: 'skills_registry', run: async () => this.skillsRegistry.initialize() },
      { label: 'hook_manager', run: async () => this.hookManager.initialize() },
      {
        label: 'workspace_files',
        run: async () => {
          await this.workspaceFileCollector.collectWorkspaceFiles();
        },
      },
    ], this.getParallelismLimit());
  }

  /**
   * Background initialization - runs while prompt is visible.
   * Everything here happens concurrently with the user reading/typing.
   * NOTE: Must NOT write to stdout - the prompt is already rendering.
   */
  private async performBackgroundInit(): Promise<void> {
    try {
      // Phase 1: Parallel manager initialization
      await this.initializeManagers();

      // Fire MCP connections in background (non-blocking, like Claude Code).
      // Servers connect asynchronously; tools become available once ready.
      // Does NOT block the main init pipeline or user prompt.
      if (this.runtime.config.mcp?.enabled !== false) {
        this.mcpStartupCoordinator.markConnectStarted();
        this.mcpReady = this.mcpManager
          .connectAll(this.runtime.config.mcp?.servers ?? [])
          .then(() => { this.syncMcpTools(); })
          .catch(() => { /* individual server errors already captured by connectAll */ })
          .finally(() => {
            this.mcpStartupCoordinator.markSummaryPending();
          });
      }

      // Phase 2: Sequential setup that depends on phase 1

      await this.skillsRegistry.setWorkspace(this.runtime.workspaceRoot);
      this.feedbackManager.startSession();
      const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
      const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      const [, session] = await Promise.all([
        this.resetConversationContext(),
        this.sessionManager.createSession(this.runtime.workspaceRoot, model),
      ]);

      // Inject explicit session bootstrap so the LLM is consciously aware of
      // memories, AGENTS.md, skills, and project context from the first turn.
      await this.injectSessionBootstrap();

      // Phase 3: Telemetry (no stdout output)
      if (session) {
        await this.telemetryManager.startSession(
          session.metadata.sessionId,
          model,
          this.activeProvider
        );
      }

      // NOTE: session-start hook is fired in ensureInitComplete() AFTER the
      // prompt closes, so its output doesn't corrupt the readline display.
    } finally {
      this.initDone = true;
    }
  }

  /**
   * Ensure background initialization is complete before processing instructions.
   * Called once when user submits their first instruction (prompt is closed).
   * Also fires the session-start hook here so output renders cleanly.
   */
  private async ensureInitComplete(): Promise<void> {
    if (this.initReady) {
      await this.initReady;
      this.initReady = null;

      // Keep MCP startup async and do not block first instruction execution.
      // MCP tool calls still await mcpReady in the tool executor path.
      this.flushMcpStartupSummaryIfPending();

      // Fire session-start hook now that the prompt is closed and stdout is clean
      const session = this.sessionManager.getCurrentSession();
      await this.hookManager.executeHooks('session-start', {
        sessionId: session?.metadata.sessionId,
        sessionType: 'startup',
      });
    }
  }

  /**
   * Initialize the agent for RPC mode (no interactive loop or command mode)
   */
  async initializeForRPC(): Promise<void> {
    // Initialize managers in parallel for faster startup
    await this.initializeManagers();
    // Fire MCP connections in background (non-blocking)
    if (this.runtime.config.mcp?.enabled !== false) {
      this.mcpReady = this.mcpManager
        .connectAll(this.runtime.config.mcp?.servers ?? [])
        .then(() => { this.syncMcpTools(); })
        .catch(() => {})
        .finally(() => {
          this.mcpStartupCoordinator.markSummaryPending();
        });
    }
    // These must run sequentially after the parallel init
    await this.skillsRegistry.setWorkspace(this.runtime.workspaceRoot);
    const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
    const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    const [, session] = await Promise.all([
      this.resetConversationContext(),
      this.sessionManager.createSession(this.runtime.workspaceRoot, model),
    ]);

    await this.injectSessionBootstrap();

    // Start telemetry session
    if (session) {
      await this.telemetryManager.startSession(
        session.metadata.sessionId,
        model,
        this.activeProvider
      );
    }

    // Fire session-start hook
    await this.hookManager.executeHooks('session-start', {
      sessionId: session?.metadata.sessionId,
      sessionType: 'startup',
    });
  }

  async runCommandMode(instruction: string): Promise<void> {
    await this.initializeForRPC();

    const turnStartTime = Date.now();
    await this.runInstruction(instruction);

    // Fire stop hook after turn completes (non-blocking)
    const turnDuration = Date.now() - turnStartTime;
    const session = this.sessionManager.getCurrentSession();
    this.hookManager.executeHooks('stop', {
      sessionId: session?.metadata.sessionId,
      turnDuration,
      tokensUsed: this.sessionTokensUsed,
    }).catch(() => {
      // Ignore hook errors - they shouldn't block the user
    });

    // Restore stdin to known state after hook execution
    this.ensureStdinReady();

    // Ring terminal bell to notify user (shows badge on terminal tab)
    if (this.runtime.config.ui?.terminalBell !== false) {
      process.stdout.write('\x07');
    }

    // Native OS notification for task completion
    if (this.runtime.config.ui?.showCompletionNotification !== false) {
      this.notificationService.notify(
        { body: this.getCompletionNotificationBody(), reason: 'task_complete' },
        this.getNotificationGuards()
      ).catch(() => {});
    }

    if (this.runtime.options.autoCommit) {
      await this.performAutoCommit();
    }

    // Fire session-end hook for command mode
    await this.hookManager.executeHooks('session-end', {
      sessionId: session?.metadata.sessionId,
      sessionEndReason: 'exit',
      duration: Date.now() - this.sessionStartedAt,
    });

    // Restore stdin after session-end hook
    this.ensureStdinReady();

    await this.telemetryManager.endSession('completed');
  }

  /**
   * Auto-commit: Run lint, test, then use LLM to generate commit message
   */
  private async performAutoCommit(): Promise<void> {
    const info = getAutoCommitInfo(this.runtime.workspaceRoot);

    if (!info.canCommit) {
      if (info.error !== 'No changes to commit') {
        console.log(chalk.yellow(`\n⚠ Cannot auto-commit: ${info.error}`));
      }
      return;
    }

    console.log(chalk.cyan('\n🧠 Auto-commit: Changes detected'));
    info.filesChanged.slice(0, 5).forEach(file => {
      console.log(chalk.gray(`   ${file}`));
    });
    if (info.filesChanged.length > 5) {
      console.log(chalk.gray(`   ... and ${info.filesChanged.length - 5} more files`));
    }

    // Build the auto-commit prompt for LLM
    const autoCommitPrompt = `You have uncommitted changes in the repository. Please perform the following steps:

1. **Lint**: Run the project's linter (try: bun run lint, npm run lint, or pnpm lint). If there are fixable issues, fix them.

2. **Test**: Run the project's tests (try: bun run test, npm test, or pnpm test). If tests fail, do NOT proceed with commit.

3. **Review Changes**: Use git diff to understand what changed.

4. **Commit**: If lint passes and tests pass (or no test script exists), create a commit with a meaningful message that:
   - Uses conventional commit format (feat:, fix:, docs:, refactor:, test:, chore:)
   - Describes WHAT changed and WHY (not just "update files")
   - Is concise but informative

Changed files:
${info.filesChanged.map(f => `- ${f}`).join('\n')}

Diff summary:
${info.diffSummary || 'Use git diff to see changes'}

If lint or tests fail, report the issues but do NOT commit.`;

    console.log(chalk.cyan('\n🔄 Running lint, test, and generating commit message...\n'));

    // Run the auto-commit through the agent
    try {
      await this.runInstruction(autoCommitPrompt);
    } catch (error) {
      console.log(chalk.red(`\n✗ Auto-commit failed: ${(error as Error).message}`));
    }
  }

  private async restoreSessionState(sessionId: string) {
    const session = await this.sessionManager.loadSession(sessionId);

    await this.resetConversationContext();
    await this.injectSessionBootstrap();
    const messages = session.getMessages();
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (!msg.content.startsWith('You are Autohand')) {
          this.conversation.addSystemNote(msg.content);
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

        this.conversation.addMessage({
          role: msg.role,
          content: msg.content,
          name: msg.name,
          tool_calls: convertedToolCalls,
          tool_call_id: (msg as any).tool_call_id
        });
      }
    }

    await this.injectProjectKnowledge();
    this.updateContextUsage(this.conversation.history());
    return session;
  }

  async attachSession(sessionId: string): Promise<{ sessionId: string; model: string; workspaceRoot: string; messageCount: number }> {
    await this.initializeManagers();
    const session = await this.restoreSessionState(sessionId);

    await this.telemetryManager.startSession(
      sessionId,
      session.metadata.model,
      this.activeProvider
    );

    return {
      sessionId: session.metadata.sessionId,
      model: session.metadata.model,
      workspaceRoot: session.metadata.projectPath,
      messageCount: session.getMessages().length,
    };
  }

  async resumeSession(sessionId: string): Promise<void> {
    // Initialize managers and pre-load files in parallel
    await this.initializeManagers();

    try {
      const session = await this.restoreSessionState(sessionId);

      console.log(chalk.cyan(`\n📂 Resumed session ${sessionId}`));

      // Start telemetry for resumed session
      await this.telemetryManager.startSession(
        sessionId,
        session.metadata.model,
        this.activeProvider
      );

      // Start interactive loop
      await this.runInteractiveLoop();
    } catch (error) {
      console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
      await this.telemetryManager.trackError({
        type: 'session_resume_failed',
        message: (error as Error).message,
        context: 'resumeSession'
      });
      // Fallback to new session
      const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
      const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      await this.sessionManager.createSession(this.runtime.workspaceRoot, model);
      await this.runInteractiveLoop();
    }
  }

  private lastErrorMessage: string | null = null;
  private consecutiveErrorCount = 0;

  private logQueuedProcessingMessage(instruction: string, remaining = 0): void {
    const preview = `${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}`;
    const headline = chalk.cyan(`▶ Processing queued request: "${preview}"`);
    const detail = remaining > 0 ? chalk.gray(`  ${remaining} more request(s) queued`) : '';
    const usingTerminalRegions = this.isUsingTerminalRegionsForActiveTurn();

    if (usingTerminalRegions) {
      this.persistentInput.writeAbove(`${headline}\n`);
      if (detail) {
        this.persistentInput.writeAbove(`${detail}\n`);
      }
      return;
    }

    console.log(`\n${headline}`);
    if (detail) {
      console.log(detail);
    }
  }

  private async runInteractiveLoop(): Promise<void> {
    // Initialize Ink UI early so the composer is ready before the first idle check.
    // This ensures consistent UI from startup instead of falling back to readline
    // and then switching to Ink after the first prompt.
    if (this.useInkRenderer && !this.inkRenderer) {
      await this.initializeUI(undefined, undefined, true);
      // Set to idle state so the Composer accepts input immediately
      this.setComposerIdle();
    }

    while (true) {
      // Check if we should exit immediately (SIGINT/SIGTERM received)
      if (this.shouldExit) {
        return;
      }

      try {
        let instruction: string | null = null;

        // Check shouldExit again before processing any queued items
        if (this.shouldExit) {
          return;
        }

        if (this.pendingInkInstructions.length > 0) {
          instruction = this.pendingInkInstructions.shift() ?? null;
          if (instruction) {
            if (this.runtime.spinner?.isSpinning) {
              this.runtime.spinner.stop();
              this.lastRenderedStatus = '';
            }
            const remaining = this.pendingInkInstructions.length;
            this.logQueuedProcessingMessage(instruction, remaining);
          }
        } else if (this.inkRenderer?.hasQueuedInstructions()) {
          instruction = this.inkRenderer.dequeueInstruction() ?? null;
          if (instruction) {
            if (this.runtime.spinner?.isSpinning) {
              this.runtime.spinner.stop();
              this.lastRenderedStatus = '';
            }
            const remaining = this.inkRenderer.getQueueCount();
            this.logQueuedProcessingMessage(instruction, remaining);
          }
        } else if (this.persistentInput.hasQueued()) {
          const queued = this.persistentInput.dequeue();
          if (queued) {
            instruction = queued.text;
            if (this.runtime.spinner?.isSpinning) {
              this.runtime.spinner.stop();
              this.lastRenderedStatus = '';
            }
            const remaining = this.persistentInput.hasQueued()
              ? this.persistentInput.getQueueLength()
              : 0;
            this.logQueuedProcessingMessage(instruction, remaining);
          }
        }

        if (!instruction) {
          if (this.persistentInputActiveTurn) {
            this.promptSeedInput = this.persistentInput.getCurrentInput();
            this.persistentInput.stop();
            this.persistentInputActiveTurn = false;
          }
          // If Ink is still active (idle between turns), wait for the next
          // instruction from the Composer instead of stopping the renderer and
          // falling back to readline. This keeps the Composer alive after
          // non-interactive slash commands like /help and /history.
          if (process.env.AUTOHAND_DEBUG === '1') {
            console.log(`[DEBUG] Idle check: inkRenderer exists=${!!this.inkRenderer}, isRunning=${this.inkRenderer?.isRunning()}`);
          }
          if (this.inkRenderer?.isRunning()) {
            // Ensure the renderer is in idle (not working) state so the
            // Composer accepts input.
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] Entering idle-wait, setting working=false`);
            }
            this.setComposerIdle();

            // Wait for the user to submit text in the Composer.
            // handleInkSubmittedInstruction resolves this promise when it
            // queues a new instruction.
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] Waiting for resolver...`);
            }
            await new Promise<void>(resolve => {
              this.inkInstructionResolver = resolve;
            });
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] Resolver resolved`);
            }

            // The instruction is now queued — dequeue it.
            if (this.inkRenderer?.hasQueuedInstructions()) {
              instruction = this.inkRenderer.dequeueInstruction() ?? null;
              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] Dequeued instruction: ${instruction}`);
              }
            }
            // If we still don't have an instruction (race condition), loop
            // around and try again.
            if (!instruction) {
              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] No instruction after resolver, continuing`);
              }
              continue;
            }
          } else {
            // Ink is not running — drain any stale queued instructions and
            // fall back to readline.
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] Ink not running, falling back to readline`);
            }
            if (this.inkRenderer) {
              while (this.inkRenderer.hasQueuedInstructions()) {
                const qi = this.inkRenderer.dequeueInstruction();
                if (qi) this.pendingInkInstructions.push(qi);
              }
              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] Stopping inkRenderer in fallback path`);
              }
              this.inkRenderer.stop();
              this.inkRenderer = null;
              this.runtime.inkRenderer = undefined;
              this.inkInstructionResolver = null;
            }
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] Calling promptForInstruction in readline mode`);
            }
            instruction = await this.promptForInstruction();
            if (process.env.AUTOHAND_DEBUG === '1') {
              console.log(`[DEBUG] promptForInstruction returned: ${instruction}`);
            }
          }
        }

        if (!instruction) {
          continue;
        }

        // Handle ! shell commands locally (never send to LLM)
        if (isShellCommand(instruction)) {
          const shellCmd = parseShellCommand(instruction);
          await this.executeImmediateShellCommand(shellCmd);
          continue;
        }

        // Handle slash commands locally (never send to LLM).
        // The readline path (promptForInstruction) handles slash commands
        // before runInstruction, but instructions from the Ink queue bypass
        // that path. Without this, /help etc. go through the full ReAct loop
        // which sends them to the LLM and leaves the composer frozen.
        if (instruction.startsWith('/')) {
          const parsed = this.parseSlashCommand(instruction);
          const isKnownSlashCommand = this.isSlashCommandSupported(parsed.command);
          if (isKnownSlashCommand || !isLikelyFilePathSlashInput(instruction)) {
            const command = parsed.command;
            const args = parsed.args;

            // /quit and /exit are handled above (line 1795)
            if (command !== '/quit' && command !== '/exit') {
              this.clearComposerInput();

              // Echo the slash command to the chat log so it's visible.
              // Skip the echo for /plan in Ink mode to avoid stdout corruption.
              if (!(command === '/plan' && this.inkRenderer?.isRunning())) {
                console.log(chalk.white(`\n› ${instruction}`));
              }

              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] Before runSlashCommandWithInput: inkRenderer exists=${!!this.inkRenderer}, isRunning=${this.inkRenderer?.isRunning()}`);
              }

              // For /plan in Ink mode, redirect console output to user messages
              // to avoid stdout corruption that freezes the composer.
              let handled: string | null = null;
              if (command === '/plan' && this.inkRenderer?.isRunning()) {
                const logBuffer: string[] = [];
                handled = await planCommand({} as any, args.join(' '), {
                  output: (msg: string) => logBuffer.push(msg),
                });
                if (logBuffer.length > 0) {
                  this.inkRenderer.addUserMessage(logBuffer.join('\n'));
                }
              } else {
                handled = await this.runSlashCommandWithInput(command, args);
              }

              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] After runSlashCommandWithInput: inkRenderer exists=${!!this.inkRenderer}, isRunning=${this.inkRenderer?.isRunning()}`);
              }
              if (handled !== null) {
                console.log(renderTerminalMarkdown(handled));
              }
              // Ensure the renderer is in idle state so the Composer accepts input
              // after non-interactive slash commands like /help, /clear, /history
              if (process.env.AUTOHAND_DEBUG === '1') {
                console.log(`[DEBUG] After slash command output: inkRenderer exists=${!!this.inkRenderer}, isRunning=${this.inkRenderer?.isRunning()}`);
              }
              if (this.ui || this.inkRenderer) {
                this.setComposerIdle();
                this.clearComposerInput();
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
        if (instruction.startsWith('#')) {
          const content = instruction.slice(1).trim();
          if (this.inkRenderer) {
            this.modalActive = true;
            this.inkRenderer.pause();
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          try {
            await this.handleMemoryStore(content);
          } finally {
            if (this.inkRenderer) {
              this.modalActive = false;
              await this.inkRenderer.resume();
            }
          }
          continue;
        }

        // Ensure background init is complete before processing any instruction.
        // This runs while the user was typing, so it's usually already done.
        await this.ensureInitComplete();
        this.flushMcpStartupSummaryIfPending();

        // Check idle timeout — force logout if session has been idle too long.
        // Must check BEFORE updating lastActivityAt so the idle duration is accurate.
        if (this.runtime.config.auth?.token) {
          const idleMs = Date.now() - this.lastActivityAt;
          const timeoutMs = AUTH_CONFIG.idleTimeoutMs;
          if (idleMs >= timeoutMs) {
            await this.forceIdleLogout();
            return;
          }
        }

        // Update activity timestamp on every user interaction
        this.lastActivityAt = Date.now();

        if (instruction === '/exit' || instruction === '/quit') {
          // Fire-and-forget: don't block quit on telemetry
          this.telemetryManager.trackCommand({ command: instruction }).catch(() => {});
          const trigger = this.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = this.sessionManager.getCurrentSession();
            await this.showFeedbackWithPause(trigger, session?.metadata.sessionId);
          }
          await this.closeSession();
          return;
        }

        const isSlashCommand = instruction.startsWith('/');
        if (isSlashCommand) {
          await this.telemetryManager.trackCommand({ command: instruction.split(' ')[0] });
        }

        // Reset error tracking on successful prompt
        this.lastErrorMessage = null;
        this.consecutiveErrorCount = 0;

        // Check shouldExit before processing the instruction
        if (this.shouldExit) {
          return;
        }

        const turnStartTime = Date.now();
        await this.runInstruction(instruction);
        this.flushMcpStartupSummaryIfPending();

        // Start generating next-step suggestion in background.
        // The promise is awaited in promptForInstruction() with a deadline
        // so the LLM call runs concurrently with hooks/notifications below.
        if (this.suggestionEngine) {
          this.pendingSuggestion = this.suggestionEngine.generate(this.conversation.history());
          this.persistentInput.setPendingSuggestion(this.pendingSuggestion);
        }

        // Fire stop hook after turn completes (non-blocking)
        const turnDuration = Date.now() - turnStartTime;
        const session = this.sessionManager.getCurrentSession();
        this.hookManager.executeHooks('stop', {
          sessionId: session?.metadata.sessionId,
          turnDuration,
          tokensUsed: this.sessionTokensUsed,
        }).catch(() => {
          // Ignore hook errors - they shouldn't block the user
        });

        // Restore stdin to known state after hook execution
        // Hook commands with shell: true can sometimes leave stdin in unexpected state
        this.ensureStdinReady();

        // Ring terminal bell to notify user (shows badge on terminal tab)
        if (this.runtime.config.ui?.terminalBell !== false) {
          process.stdout.write('\x07');
        }

        // Native OS notification for task completion
        if (this.runtime.config.ui?.showCompletionNotification !== false) {
          this.notificationService.notify(
            { body: this.getCompletionNotificationBody(), reason: 'task_complete' },
            this.getNotificationGuards()
          ).catch(() => {});
        }

        this.feedbackManager.recordInteraction();
        this.telemetryManager.recordInteraction();

        const feedbackTrigger = this.feedbackManager.shouldPrompt({
          userMessage: instruction,
          taskCompleted: true
        });

        if (feedbackTrigger) {
          const session = this.sessionManager.getCurrentSession();
          await this.showFeedbackWithPause(feedbackTrigger, session?.metadata.sessionId);
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
          this.lastErrorMessage = null;
          this.consecutiveErrorCount = 0;
          continue;
        }

        // TTY/IO errors (errno 5 = EIO, setRawMode failures) are unrecoverable.
        // Exit immediately instead of retrying — the terminal is gone.
        const isTTYError = /setRawMode|errno:\s*\d+|EIO|EPERM/.test(errorObj.message ?? '');
        if (isTTYError) {
          await this.errorLogger.log(error as Error, {
            context: 'Interactive loop (TTY failure)',
            workspace: this.runtime.workspaceRoot
          });
          const session = this.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'completed';
            await session.save();
          }
          await this.telemetryManager.endSession('completed');
          return;
        }

        const errorMessage = this.getDisplayErrorMessage(error);

        // Track consecutive identical errors to prevent infinite telemetry spam
        if (errorMessage === this.lastErrorMessage) {
          this.consecutiveErrorCount++;
        } else {
          this.lastErrorMessage = errorMessage;
          this.consecutiveErrorCount = 1;
        }

        // Only send telemetry for the first occurrence of a repeated error
        if (this.consecutiveErrorCount <= 1) {
          await this.errorLogger.log(error as Error, {
            context: 'Interactive loop',
            workspace: this.runtime.workspaceRoot
          });

          await this.telemetryManager.trackError({
            type: 'interactive_loop_error',
            message: errorMessage,
            stack: (error as Error).stack,
            context: 'Interactive loop'
          });

          // Auto-report to GitHub (fire-and-forget, non-blocking)
          this.autoReportManager.reportError(error as Error, {
            errorType: 'interactive_loop_error',
            model: this.runtime.options.model ?? getProviderConfig(this.runtime.config, this.activeProvider)?.model,
            provider: this.activeProvider,
            sessionId: this.sessionManager.getCurrentSession()?.metadata.sessionId,
            conversationLength: this.conversation.history().length,
            contextUsagePercent: Math.round((1 - this.contextPercentLeft / 100) * 100),
          }).catch(() => {});
        }

        // Exit if the same error repeats 3 times - it won't fix itself
        if (this.consecutiveErrorCount >= 3) {
          console.error(chalk.red(`\nFatal: "${errorMessage}" repeated ${this.consecutiveErrorCount} times. Exiting.`));
          const session = this.sessionManager.getCurrentSession();
          if (session) {
            session.metadata.status = 'crashed';
            await session.save();
          }
          await this.telemetryManager.endSession('crashed');
          process.exitCode = 1;
          return;
        }

        const session = this.sessionManager.getCurrentSession();
        if (session) {
          session.metadata.status = 'crashed';
          await session.save();
        }

        this.reportInteractiveLoopError(errorMessage);
        console.error(chalk.gray(`Error logged to: ${this.errorLogger.getLogPath()}\n`));

        continue;
      }
    }
  }

  private async promptForInstruction(): Promise<string | null> {
    // Use cached workspace files for instant prompt display.
    // Files are pre-loaded during runInteractive() init and cached for 30s.
    // Trigger a background refresh without blocking the prompt.
    this.workspaceFileCollector.collectWorkspaceFiles().catch(() => {});
    const statusLine = this.formatStatusLine();
    const initialValue = this.promptSeedInput;
    this.promptSeedInput = '';
    // Wait for the pending suggestion LLM call to finish.
    // Startup: don't block — show the prompt instantly. The user wants to
    // start typing immediately. If the suggestion resolved already, great;
    // otherwise the default placeholder is shown.
    // Turns: wait up to 3s. The user is still reading output so a brief
    // wait for contextual ghost text is acceptable.
    // Suggestion uses a lazy provider: each render cycle in the prompt reads
    // the latest value via getSuggestion(). This eliminates the race condition
    // where the LLM takes >3s and the static snapshot was always undefined.
    // The pendingSuggestion promise triggers a re-render when it resolves,
    // so the ghost text appears as soon as the LLM responds — even if the
    // prompt is already displayed.
    const pendingSuggestion = this.pendingSuggestion;
    this.isStartupSuggestion = false;
    this.pendingSuggestion = null;

    const debugSuggestion = process.env.AUTOHAND_DEBUG === '1';
    if (debugSuggestion) {
      const state = pendingSuggestion ? 'pending' : 'none';
      this.writeDebugLine(`[SUGGESTION] Provider mode — pending=${state}, engine=${this.suggestionEngine ? 'exists' : 'null'}`);
    }

    const engine = this.suggestionEngine;
    this.readlinePromptActive = true;
    let input: string | null;
    try {
      input = await readInstruction(
        () => this.workspaceFileCollector.getCachedFiles(),
        SLASH_COMMANDS,
        statusLine,
        {}, // default IO
        (data, mimeType, filename) => this.imageManager.add(data, mimeType, filename),
        this.runtime.workspaceRoot,
        initialValue,
        () => engine?.getSuggestion() ?? undefined,
        (line) => this.resolveLlmShellSuggestion(line),
        pendingSuggestion ?? undefined,
        () =>
          this.skillsRegistry.listSkills().map((s) => ({
            name: s.name,
            description: s.description ?? '',
            isActive: s.isActive,
            source: s.source,
          })),
      );
    } finally {
      this.readlinePromptActive = false;
      this.flushDeferredDebugLines();
    }
    // Only exit on explicit ABORT (double Ctrl+C). Palette cancel or dismiss should continue.
    if (input === 'ABORT') { // double Ctrl+C from prompt
      return '/exit';
    }
    if (input === null) {
      // keep interactive loop running
      return null;
    }

    let normalized = input.trim();
    if (!normalized) {
      return null;
    }

    if (normalized === '/') {
      console.log(chalk.gray('Type a slash command name (e.g. /diff) and press Enter.'));
      return null;
    }

    if (normalized.startsWith('/')) {
      // Always prioritize known slash commands, even when args contain '/'
      // (e.g. package specs like "@playwright/mcp@latest").
      const parsed = this.parseSlashCommand(normalized);
      const isKnownSlashCommand = this.isSlashCommandSupported(parsed.command);
      if (!isKnownSlashCommand && isLikelyFilePathSlashInput(normalized)) {
        // Looks like an absolute file path, not a command.
        // Fall through to normal prompt handling below.
      } else {
        const command = parsed.command;
        const args = parsed.args;

        // /quit and /exit return themselves as pass-through instructions
        // so the interactive loop's special exit handler (line 963) can catch them.
        // Skip the slash handler for these - they're control-flow, not commands.
        if (command === '/quit' || command === '/exit') {
          return command;
        }

        // Clear any residual status line content from the readline prompt
        // before rendering the slash command output. The readline status
        // row can leave artefacts when the terminal wraps or resizes.
        process.stdout.write('\x1b[0J');

        // Echo the user's slash command to the chat log so it's visible
        console.log(chalk.white(`\n› ${normalized}`));

        const handled = await this.runSlashCommandWithInput(command, args);
        if (handled !== null) {
          // Slash command returned display output - print it, don't send to LLM
          // Convert markdown formatting (**bold**, _italic_) to ANSI terminal codes
          console.log(renderTerminalMarkdown(handled));
        }
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] promptForInstruction: slash command handled, returning null`);
        }
        return null;
      }
    }

    // Handle # trigger for storing memories
    if (normalized.startsWith('#')) {
      await this.handleMemoryStore(normalized.slice(1).trim());
      return null;
    }

    if (normalized) {
      normalized = await this.mentionResolver.resolve(normalized);
      return normalized;
    }
    return null;
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
    if (!content) {
      console.log(chalk.gray('Usage: # <text to remember>'));
      console.log(chalk.gray('Example: # Always use TypeScript strict mode'));
      return;
    }

    try {
      const levelOptions: ModalOption[] = [
        { label: 'Project level (.autohand/memory/) - specific to this project', value: 'project' },
        { label: 'User level (~/.autohand/memory/) - available in all projects', value: 'user' }
      ];

      const levelResult = await showModal({
        title: 'Where should this memory be stored?',
        options: levelOptions
      });

      if (!levelResult) {
        return;
      }

      const level = levelResult.value as 'project' | 'user';

      // Check for similar memories first
      const similar = await this.memoryManager.findSimilar(content, level);
      if (similar && similar.score >= 0.6) {
        console.log();
        console.log(chalk.yellow('Found similar existing memory:'));
        console.log(chalk.gray(`  "${similar.entry.content}"`));

        const shouldUpdate = await showConfirm({
          title: 'Update the existing memory instead of creating a new one?'
        });

        if (shouldUpdate) {
          await this.memoryManager.updateMemory(similar.entry.id, content, level);
          console.log(chalk.green('Memory updated.'));
          return;
        }
      }

      // Store new memory
      await this.memoryManager.store(content, level);
      console.log(chalk.green(`Memory saved to ${level} level.`));
    } catch (error) {
      // User cancelled
      if ((error as any).isCanceled) {
        return;
      }
      console.error(chalk.red('Failed to store memory:'), (error as Error).message);
    }
  }

  private printGitDiff(): void {
    const status = spawnSync('git', ['status', '-sb'], {
      cwd: this.runtime.workspaceRoot,
      encoding: 'utf8'
    });
    if (status.status === 0 && status.stdout) {
      console.log('\n' + chalk.cyan('Git status:'));
      console.log(status.stdout.trim() + '\n');
    }

    const diff = spawnSync('git', ['diff', '--color=always'], {
      cwd: this.runtime.workspaceRoot,
      encoding: 'utf8'
    });

    if (diff.status === 0) {
      console.log(chalk.cyan('Git diff:'));
      console.log(diff.stdout || chalk.gray('No diff.'));
    } else {
      console.log(chalk.yellow('Unable to compute git diff. Is this a git repository?'));
    }
  }

  private async undoLastMutation(): Promise<void> {
    try {
      await this.files.undoLast();
      console.log(chalk.green('Reverted last mutation.'));
    } catch (error) {
      console.log(chalk.yellow((error as Error).message));
    }
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

    this.runtime.options.yes = result.value === 'prompt';
    console.log(
      result.value === 'prompt'
        ? chalk.yellow('Auto-confirm enabled. Use responsibly.')
        : chalk.green('Manual approvals required before risky writes.')
    );
  }

  private async createAgentsFile(): Promise<void> {
    const target = path.join(this.runtime.workspaceRoot, 'AGENTS.md');
    if (await fs.pathExists(target)) {
      console.log(chalk.gray('AGENTS.md already exists in this workspace.'));
      return;
    }

    console.log(chalk.gray('Analyzing project structure...'));

    // Use OnboardingProjectAnalyzer to detect project characteristics
    const analyzer = new OnboardingProjectAnalyzer(this.runtime.workspaceRoot);
    const projectInfo = await analyzer.analyze();

    // Show what was detected
    if (Object.keys(projectInfo).length > 0) {
      console.log(chalk.gray('Detected:'));
      if (projectInfo.language) {
        console.log(chalk.white(`  - Language: ${projectInfo.language}`));
      }
      if (projectInfo.framework) {
        console.log(chalk.white(`  - Framework: ${projectInfo.framework}`));
      }
      if (projectInfo.packageManager) {
        console.log(chalk.white(`  - Package manager: ${projectInfo.packageManager}`));
      }
      if (projectInfo.testFramework) {
        console.log(chalk.white(`  - Test framework: ${projectInfo.testFramework}`));
      }
    }

    // Generate AGENTS.md content using the detected info
    const generator = new AgentsGenerator();
    const content = generator.generateContent(projectInfo);

    await fs.writeFile(target, content, 'utf8');
    console.log(chalk.green('Created AGENTS.md based on your project. Customize it to guide the agent.'));
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

  async runInstruction(instruction: string): Promise<boolean> {
    return runAgentInstruction(this as unknown as AgentInstructionHost, instruction);
  }

  private handleToolOutput(chunk: ToolOutputChunk): void {
    if (process.env.AUTOHAND_STREAM_TOOL_OUTPUT !== '1') {
      return;
    }
    if (!chunk.toolCallId || !chunk.data) {
      return;
    }
    this.queueToolMessageChunk(chunk.tool, chunk.data, chunk.toolCallId, chunk.stream);
  }

  private queueToolMessageChunk(
    name: string,
    content: string,
    toolCallId: string,
    stream?: 'stdout' | 'stderr'
  ): void {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

    const message: SessionMessage = {
      role: 'tool',
      content,
      name,
      timestamp: new Date().toISOString(),
      tool_call_id: toolCallId,
      _meta: stream ? { stream } : undefined
    };

    this.toolOutputQueue = this.toolOutputQueue
      .catch(() => undefined)
      .then(() => session.appendTransient(message));
  }

  private async saveToolMessage(name: string, content: string, toolCallId?: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

    await this.toolOutputQueue.catch(() => undefined);

    const message: SessionMessage = {
      role: 'tool',
      content,
      name,
      timestamp: new Date().toISOString(),
      tool_call_id: toolCallId
    };
    await session.append(message);
  }

  /**
   * Force logout when the session has been idle beyond the configured timeout.
   * Clears the local auth token, informs the user, and exits.
   */
  private async forceIdleLogout(): Promise<void> {
    const idleMinutes = Math.round((Date.now() - this.lastActivityAt) / 60_000);
    console.log();
    console.log(chalk.yellow(`Session idle for ${idleMinutes} minutes — logging out for security.`));
    console.log(chalk.gray('Run autohand again to start a new session.'));

    // Clear auth from config
    if (this.runtime.config.auth?.token) {
      const authClient = getAuthClient();
      try {
        await authClient.logout(this.runtime.config.auth.token);
      } catch {
        // Server logout failed, but we still clear local token
      }

      const updatedConfig: LoadedConfig = {
        ...this.runtime.config,
        auth: undefined,
      };
      try {
        await saveConfig(updatedConfig);
      } catch {
        // Ignore save errors during idle logout
      }
    }

    // Save current session before exit
    const session = this.sessionManager.getCurrentSession();
    if (session) {
      try {
        await this.sessionManager.closeSession('Idle timeout — auto logout');
      } catch {
        // Ignore session save errors during forced logout
      }
    }

    await this.closeSession();
  }

  private async closeSession(): Promise<void> {
    const CLEANUP_TIMEOUT_MS = 2500;

    // Clean up persistent input immediately
    this.persistentInput.dispose();

    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      console.log(chalk.gray('Ending Autohand session.'));
      await Promise.race([
        Promise.allSettled([
          this.mcpManager.disconnectAll(),
        ]),
        new Promise((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
      ]);
      await this.telemetryManager.shutdown().catch(() => {});
      return;
    }

    // Save session locally first (fast, essential)
    const messages = session.getMessages();
    const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
    const summary = lastUserMsg?.content.slice(0, 60) || 'Session complete';
    await this.sessionManager.closeSession(summary);

    // Print exit message immediately - user sees instant feedback
    console.log(chalk.gray('\nEnding Autohand session.\n'));
    console.log(chalk.cyan(`💾 Session saved: ${session.metadata.sessionId}`));
    console.log(chalk.gray(`   Resume with: autohand resume ${session.metadata.sessionId}\n`));

    const sessionDuration = Date.now() - this.sessionStartedAt;
    const cleanupTasks = [
      this.mcpManager.disconnectAll(),
      this.hookManager.executeHooks('session-end', {
        sessionId: session.metadata.sessionId,
        sessionEndReason: 'quit',
        duration: sessionDuration,
      }),
      this.telemetryManager.syncSession({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        })),
        metadata: { workspaceRoot: this.runtime.workspaceRoot }
      }),
      this.telemetryManager.endSession('completed'),
    ];

    await Promise.race([
      Promise.allSettled(cleanupTasks),
      new Promise((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS)),
    ]);

    await this.telemetryManager.shutdown().catch(() => {});
  }

  private async runReactLoop(abortController: AbortController): Promise<void> {
    return runAgentReactLoop(this as unknown as AgentReactLoopHost, abortController);
  }
  private getReactionParser(): ReactionParser {
    if (!this.reactionParser) {
      this.reactionParser = new ReactionParser({
        cleanupModelResponse: (content) => this.cleanupModelResponse(content),
      });
    }
    return this.reactionParser;
  }

  private parseAssistantResponse(completion: LLMResponse): AssistantReactPayload {
    return this.getReactionParser().parseAssistantResponse(completion);
  }

  private extractXmlToolCalls(content: string): ToolCallRequest[] {
    return this.getReactionParser().extractXmlToolCalls(content);
  }

  private tryParseXmlToolCall(json: string): ToolCallRequest | null {
    return this.getReactionParser().tryParseXmlToolCall(json);
  }

  private safeParseToolArgs(json: string): ToolCallRequest['args'] {
    return this.getReactionParser().safeParseToolArgs(json);
  }

  private parseAssistantReactPayload(raw: string): AssistantReactPayload {
    return this.getReactionParser().parseAssistantReactPayload(raw);
  }

  private extractContentFromUnstructuredJson(parsed: Record<string, unknown>): string | undefined {
    return this.getReactionParser().extractContentFromUnstructuredJson(parsed);
  }

  private normalizeToolCalls(value: unknown): ToolCallRequest[] {
    return this.getReactionParser().normalizeToolCalls(value);
  }

  private toToolCall(entry: unknown): ToolCallRequest | null {
    return this.getReactionParser().toToolCall(entry);
  }

  private extractSingleToolCall(parsed: Record<string, unknown>): ToolCallRequest | null {
    return this.getReactionParser().extractSingleToolCall(parsed);
  }

  private extractJson(raw: string): string | null {
    return this.getReactionParser().extractJson(raw);
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
    const context = await this.collectContextSummary();

    const userPromptParts = [
      `Workspace: ${context.workspaceRoot}`,
      context.gitStatus ? `Git status:\n${context.gitStatus}` : 'Git status: clean or unavailable.',
      `Recent files: ${context.recentFiles.join(', ') || 'none'}`,
      this.runtime.options.path ? `Target path: ${this.runtime.options.path}` : undefined,
      `Options: dryRun=${this.runtime.options.dryRun ?? false}, yes=${this.runtime.options.yes ?? false}`,
      `Instruction: ${instruction}`
    ]
      .filter(Boolean)
      .map(String);

    const mentionContext = this.mentionResolver.flush();
    if (mentionContext) {
      if (mentionContext.files.length) {
        this.recordExploration({ kind: 'read', target: mentionContext.files.join(', ') });
      }
      userPromptParts.push(`Mentioned files context:\n${mentionContext.block}`);
    }

    return userPromptParts.join('\n\n');
  }

  private async buildSystemPrompt(): Promise<string> {
    return new SystemPromptBuilder({
      runtime: this.runtime,
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

  /**
   * Detect if response text expresses intent to perform an action without having done it.
   * This catches phrases like "Let me update...", "I will now edit...", "Next I'll create..."
   */
  private expressesIntentToAct(text: string): boolean {
    if (!text) return false;
    // const _lower = text.toLowerCase();

    // Patterns that indicate intent to perform a file operation
    const intentPatterns = [
      /\b(let me|i('ll| will)|now i('ll| will)|i('m| am) going to|let's|i need to|i should|i can now)\b.{0,30}\b(update|edit|modify|change|create|write|add|remove|delete|fix|refactor|implement|apply|patch)/i,
      /\b(updating|editing|modifying|creating|writing|adding|removing|fixing|refactoring|implementing)\b.{0,20}\b(the file|readme|config|code|function|component)/i,
      /\blet me (now )?make (the|these|those) (changes?|updates?|modifications?|edits?)/i,
      /\bi('ll| will) (proceed|go ahead|start|begin) (to|and|with) (update|edit|modify|change|create|write)/i,
      /\bnow (let me|i('ll| will)|i can) (update|edit|modify|create|write|add|fix)/i,
    ];

    for (const pattern of intentPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
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
    if (this.ui) {
      return; // Already initialized
    }

    const isTTY = process.stdout.isTTY && process.stdin.isTTY;

    if (this.useInkRenderer && isTTY) {
      // Create Ink UIManager
      const inkUIManager = createInkUIManager({
        onInstruction: (text: string) => { void this.handleInkSubmittedInstruction(text); },
        onEscape: () => {
          const ctrl = this.currentInkAbortController;
          if (ctrl && !ctrl.signal.aborted) {
            ctrl.abort();
            this.currentInkOnCancel?.();
          }
        },
        onCtrlC: () => {
          // Ctrl+C handling - could trigger graceful shutdown
        },
        enableQueueInput: true,
        filesProvider: () => this.workspaceFileCollector.getCachedFiles(),
        slashCommands: SLASH_COMMANDS,
        skillsProvider: () =>
          this.skillsRegistry.listSkills().map((skill) => ({
            name: skill.name,
            description: skill.description ?? '',
            isActive: skill.isActive,
            source: skill.source,
          })),
      });
      this.ui = inkUIManager;
    } else {
      // Create Plain UIManager
      const disableTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS === '0';
      this.ui = createPlainUIManager({
        workspaceRoot: this.runtime.workspaceRoot,
        silentMode: disableTerminalRegions,
        resolveShellSuggestion: (input) => this.resolveLlmShellSuggestion(input),
        suggestionProvider: () => this.suggestionEngine?.getSuggestion() ?? undefined,
      });
    }
  }

  /**
   * Sync the active provider and model into the Ink status line.
   */
  private syncProviderModelStatusLine(provider: ProviderName = this.activeProvider): void {
    const providerSettings = getProviderConfig(this.runtime.config, provider);
    const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    this.ui?.setProviderModel?.(provider, model);
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
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] initializeUI: useInkRenderer=${this.useInkRenderer}, stdout.isTTY=${process.stdout.isTTY}, stdin.isTTY=${process.stdin.isTTY}`);
    }
    if (this.useInkRenderer && process.stdout.isTTY && process.stdin.isTTY) {
      try {
        // Update the shared abort controller reference so Ink's onEscape
        // always targets the current turn (even when reusing Ink across turns).
        this.currentInkAbortController = abortController ?? null;
        this.currentInkOnCancel = onCancel ?? null;

        this.syncProviderModelStatusLine();
        await this.ui?.start();
        this.inkRenderer = this.ui?.getInkRenderer?.() ?? this.inkRenderer;
        this.ui?.setWorking(true, 'Gathering context...');
        this.runtime.inkRenderer = this.inkRenderer;
      } catch (err) {
        // Fall back to ora spinner if ink can't be loaded (e.g., standalone binary)
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] InkRenderer initialization failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.useInkRenderer = false;
        if (!suppressSpinner) {
          this.initFallbackSpinner();
        }
      }
    } else if (!suppressSpinner) {
      this.initFallbackSpinner();
    }
    // In non-TTY mode (RPC), skip spinner entirely
  }

  /**
   * Initialize fallback ora spinner when InkRenderer can't be loaded.
   */
  private initFallbackSpinner(): void {
    if (process.stdout.isTTY) {
      const spinner = ora({
        text: 'Gathering context...',
        spinner: 'dots'
      }).start();
      this.runtime.spinner = spinner;
    }
  }

  /**
   * Update the UI status text.
   */
  private setUIStatus(status: string): void {
    if (this.inkRenderer) {
      this.inkRenderer.setStatus(status);
    } else if (this.runtime.spinner) {
      // setSpinnerStatus already handles terminal regions internally
      this.setSpinnerStatus(status);
    } else if (this.isUsingTerminalRegionsForActiveTurn()) {
      // No spinner (suppressed when persistent input is used) — route directly
      this.setPersistentInputActivityLine(status);
    }
  }

  private setComposerIdle(): void {
    if (this.inkRenderer?.isRunning()) {
      this.inkRenderer.setWorking(false);
    }
    this.ui?.setWorking(false);
  }

  private clearComposerInput(): void {
    this.inkRenderer?.clearInput();
    this.ui?.clearInput();
  }

  private setComposerFinalResponse(response: string): void {
    this.inkRenderer?.setFinalResponse(response);
    this.ui?.setFinalResponse(response);
  }

  /**
   * Stop the UI and show completion state.
   */
  private stopUI(failed = false, message?: string): void {
    if (this.inkRenderer) {
      // Update final stats before stopping (session totals for completionStats)
      this.inkRenderer.setElapsed(formatElapsedTime(this.sessionStartedAt));
      this.inkRenderer.setTokens(formatTokens(this.sessionTokensUsed + this.totalTokensUsed));
      this.inkRenderer.setWorking(false);
      if (message) {
        this.inkRenderer.setFinalResponse(message);
      }
      // Don't stop InkRenderer here - let it stay for final response display
    } else if (this.runtime.spinner) {
      if (failed && message) {
        this.runtime.spinner.fail(message);
      } else {
        this.runtime.spinner.stop();
      }
    }
  }

  /**
   * Clean up the UI completely.
   * Preserves any queued instructions from InkRenderer before stopping.
   * When `keepInkAlive` is true, the Ink renderer is transitioned to idle
   * instead of being destroyed, preventing the composer disappear/reappear
   * flicker between back-to-back turns.
   */
  private cleanupUI(keepInkAlive = false): void {
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] cleanupUI called: keepInkAlive=${keepInkAlive}, inkRenderer exists=${!!this.inkRenderer}`);
    }
    if (this.inkRenderer) {
      if (keepInkAlive) {
        // Transition to idle state instead of destroying Ink.
        // Queued instructions stay in Ink so runInteractiveLoop can dequeue
        // directly on the next iteration without a full unmount/remount cycle.
        this.inkRenderer.setWorking(false);
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] cleanupUI: set working to false`);
        }
      } else {
        // Preserve queued instructions before stopping
        while (this.inkRenderer.hasQueuedInstructions()) {
          const instruction = this.inkRenderer.dequeueInstruction();
          if (instruction) {
            this.pendingInkInstructions.push(instruction);
          }
        }
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] cleanupUI: stopping inkRenderer`);
        }
        this.inkRenderer.stop();
        this.inkRenderer = null;
        this.runtime.inkRenderer = undefined;
        // Clear any pending resolver so the idle-wait promise doesn't hang
        this.inkInstructionResolver = null;
      }
    }
    if (this.runtime.spinner) {
      this.runtime.spinner.stop();
      this.runtime.spinner = undefined;
    }
  }

  /**
   * Print the turn-completion summary line.  When terminal regions are still
   * active (queued instruction keeps persistent input alive), route through
   * writeAbove so the message lands in the scroll region instead of on top of
   * the composer.
   */
  private printCompletionSummary(regionsStillActive: boolean): void {
    if (!this.taskStartedAt) return;
    const elapsed = formatElapsedTime(this.taskStartedAt);
    const tokens = formatTokens(this.totalTokensUsed);
    const queueCount = this.pendingInkInstructions.length +
      (this.inkRenderer?.getQueueCount() ?? 0) +
      this.persistentInput.getQueueLength();
    const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';
    const message = chalk.gray(`Completed in ${elapsed} · ${tokens} used${queueStatus}`);

    if (regionsStillActive) {
      this.persistentInput.writeAbove(message + '\n');
    } else {
      console.log(message);
    }
  }

  notifyUser(message: string): void {
    if (this.inkRenderer?.isRunning()) {
      this.inkRenderer.setStatus(message);
      return;
    }

    if (
      this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0'
    ) {
      this.persistentInput.writeAbove(`${chalk.yellow(message)}\n`);
      return;
    }

    promptNotify(chalk.yellow(message));
  }

  /**
   * Show a feedback prompt, pausing persistent input first so the Modal
   * owns stdin exclusively and keystrokes don't leak into the composer.
   */
  private async showFeedbackWithPause(
    trigger: string,
    sessionId?: string
  ): Promise<void> {
    const needsPause = this.persistentInputActiveTurn;

    if (needsPause) {
      this.persistentInput.pause();
    }

    try {
      if (trigger === 'gratitude') {
        await this.feedbackManager.quickRating();
      } else {
        await this.feedbackManager.promptForFeedback(trigger as any, sessionId);
      }
    } catch {
      // Feedback should never crash the session
    } finally {
      if (needsPause) {
        this.persistentInput.resume();
      }
    }
  }

  /**
   * Add tool output to the UI.
   */
  private addUIToolOutput(tool: string, success: boolean, output: string): void {
    if (this.inkRenderer) {
      this.inkRenderer.addToolOutput(tool, success, output);
    }
    // For ora mode, we use console.log (handled separately)
  }

  /**
   * Add batched tool outputs to the UI.
   */
  private addUIToolOutputs(outputs: Array<{ tool: string; success: boolean; output: string; thought?: string }>): void {
    if (this.inkRenderer) {
      this.inkRenderer.addToolOutputs(outputs);
    }
    // For ora mode, we use console.log (handled separately)
  }

  private async handleInkSubmittedInstruction(text: string): Promise<void> {
    if (isShellCommand(text)) {
      await this.executeImmediateShellCommand(parseShellCommand(text));
      return;
    }

    this.inkRenderer?.addQueuedInstruction(text);

    // If the interactive loop is idle-waiting for the next Composer input,
    // resolve the promise so it can dequeue and process this instruction.
    if (this.inkInstructionResolver) {
      this.inkInstructionResolver();
      this.inkInstructionResolver = null;
    }
  }

  private shouldPreferPtyForImmediateShellCommands(): boolean {
    return false;
  }

  private async executeImmediateShellCommand(
    shellCmd: string,
    routeOpts?: { persistentInputActiveTurn: boolean; terminalRegionsDisabled: boolean; writeAbove: (text: string) => void }
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    if (this.inkRenderer) {
      return this.executeImmediateShellCommandForInk(shellCmd);
    }

    return this.executeImmediateShellCommandForComposer(shellCmd, routeOpts);
  }

  private async executeImmediateShellCommandForComposer(
    shellCmd: string,
    routeOpts?: { persistentInputActiveTurn: boolean; terminalRegionsDisabled: boolean; writeAbove: (text: string) => void }
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    if (routeOpts) {
      const writer = createImmediateShellCommandBlockWriter(shellCmd, routeOpts);
      const result = await executeShellCommandAsync(shellCmd, this.runtime.workspaceRoot, undefined, {
        onStdout: (chunk) => writer.pushStdout(chunk),
        onStderr: (chunk) => writer.pushStderr(chunk),
      });
      writer.flush();
      return result;
    }

    console.log(chalk.cyan(formatImmediateShellCommandHeader(shellCmd)));
    const result = await executeShellCommandAsync(shellCmd, this.runtime.workspaceRoot, undefined, {
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
    if (!result.success) {
      console.log(chalk.red(result.error || 'Command failed'));
    }
    console.log();
    return result;
  }

  private async executeImmediateShellCommandForInk(shellCmd: string): Promise<{ success: boolean; output?: string; error?: string }> {
    if (!this.inkRenderer) {
      return { success: false, error: 'Ink renderer is unavailable' };
    }

    const commandId = this.inkRenderer.startLiveCommand(`! ${shellCmd}`);
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] executeImmediateShellCommandForInk: started ${shellCmd}, commandId=${commandId}`);
    }
    const result = await executeStreamingShellCommand(shellCmd, this.runtime.workspaceRoot, {
      onStdout: (chunk) => {
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] onStdout chunk: ${JSON.stringify(chunk)}`);
        }
        this.inkRenderer?.appendLiveCommandOutput(commandId, 'stdout', chunk);
      },
      onStderr: (chunk) => {
        if (process.env.AUTOHAND_DEBUG === '1') {
          console.log(`[DEBUG] onStderr chunk: ${JSON.stringify(chunk)}`);
        }
        this.inkRenderer?.appendLiveCommandOutput(commandId, 'stderr', chunk);
      },
      preferPty: this.shouldPreferPtyForImmediateShellCommands(),
      columns: process.stdout.columns,
      rows: process.stdout.rows,
    });
    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] executeImmediateShellCommandForInk: finished, result=${JSON.stringify(result)}`);
    }
    this.inkRenderer.finishLiveCommand(commandId, result.success, result.error);
    return result;
  }

  private async collectContextSummary(): Promise<{ workspaceRoot: string; gitStatus?: string; recentFiles: string[] }> {
    const [gitStatus, entries] = await Promise.all([
      execFileAsync('git', ['status', '-sb'], {
        cwd: this.runtime.workspaceRoot,
        encoding: 'utf8',
      })
        .then(({ stdout }) => String(stdout || '').trim() || undefined)
        .catch(() => undefined),
      fs.readdir(this.runtime.workspaceRoot),
    ]);
    const recentFiles = entries
      .filter((entry) => !this.ignoreFilter.isIgnored(entry))
      .slice(0, 20);

    return {
      workspaceRoot: this.runtime.workspaceRoot,
      gitStatus,
      recentFiles
    };
  }

  private async loadInstructionFiles(): Promise<string[]> {
    const workspace = this.runtime.workspaceRoot;
    const agentsPath = path.join(workspace, 'AGENTS.md');
    const providerFile = this.activeProvider.includes('anthropic') || this.activeProvider === 'openrouter'
      ? 'CLAUDE.md'
      : this.activeProvider.includes('google')
        ? 'GEMINI.md'
        : null;
    const tasks: ParallelTaskSpec<string | null>[] = [
      {
        label: 'agents_instructions',
        run: async () => {
          if (!(await fs.pathExists(agentsPath))) {
            return null;
          }
          const content = await fs.readFile(agentsPath, 'utf-8');
          return `## Project Instructions (AGENTS.md)\n${content}`;
        },
      },
    ];

    if (providerFile) {
      const providerPath = path.join(workspace, providerFile);
      tasks.push({
        label: 'provider_instructions',
        run: async () => {
          if (!(await fs.pathExists(providerPath))) {
            return null;
          }
          const content = await fs.readFile(providerPath, 'utf-8');
          return `## Provider Instructions (${providerFile})\n${content}`;
        },
      });
    }

    const instructions = await runWithConcurrency(tasks, this.getParallelismLimit());
    return instructions.filter((instruction): instruction is string => Boolean(instruction));
  }

  private async injectProjectKnowledge(): Promise<void> {
    const knowledge = await this.projectManager.getKnowledge(this.runtime.workspaceRoot);
    if (!knowledge) return;

    const parts: string[] = [];

    if (knowledge.antiPatterns.length > 0) {
      parts.push('Avoid these past failures:');
      knowledge.antiPatterns.forEach(p => {
        parts.push(`- ${p.pattern}: ${p.reason} (confidence: ${p.confidence.toFixed(2)})`);
      });
    }

    if (knowledge.bestPractices.length > 0) {
      parts.push('Follow these successful patterns:');
      knowledge.bestPractices.forEach(p => {
        parts.push(`- ${p.pattern}: ${p.reason} (confidence: ${p.confidence.toFixed(2)})`);
      });
    }

    if (parts.length > 0) {
      this.conversation.addSystemNote(
        `Project Knowledge:\n${parts.join('\n')}`
      );
    }
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
    injectAgentContinuationMessage(this as unknown as AgentInputTurnHost, error, retryAttempt);
  }


  /**
   * Submit a detailed bug report when a session failure occurs.
   */
  private async submitSessionFailureBugReport(
    error: Error,
    retryAttempt: number,
    maxRetries: number
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
    // Only show mode indicator when AUTOHAND_DEBUG=1
    if (process.env.AUTOHAND_DEBUG !== '1') {
      return;
    }

    if (result.intent === 'diagnostic') {
      console.log(chalk.blue('[DIAG] Mode: Diagnostic (read-only analysis)'));
      if (result.keywords.length > 0) {
        const kws = result.keywords.slice(0, 3).join('", "');
        console.log(chalk.gray(`       Detected: "${kws}"`));
      }
    } else {
      console.log(chalk.yellow('[IMPL] Mode: Implementation'));
      if (result.keywords.length > 0) {
        const kws = result.keywords.slice(0, 3).join('", "');
        console.log(chalk.gray(`       Detected: "${kws}"`));
      }
    }
    console.log();
  }

  /**
   * Run environment bootstrap before implementation
   */
  private async runEnvironmentBootstrap(): Promise<BootstrapResult> {
    const isDebug = process.env.AUTOHAND_DEBUG === '1';

    if (isDebug) {
      console.log(chalk.cyan('[BOOTSTRAP] Running environment setup...'));
    }

    const result = await this.environmentBootstrap.run(this.runtime.workspaceRoot);

    // Display results (only in debug mode, except for failures)
    for (const step of result.steps) {
      const status = step.status === 'success' ? chalk.green('[OK]')
        : step.status === 'failed' ? chalk.red('[FAIL]')
        : step.status === 'skipped' ? chalk.gray('[SKIP]')
        : chalk.gray('[...]');

      const duration = step.duration ? chalk.gray(`(${(step.duration / 1000).toFixed(1)}s)`) : '';
      const detail = step.detail ? chalk.gray(` ${step.detail}`) : '';

      // Always show failures, only show others in debug mode
      if (step.status === 'failed' || isDebug) {
        console.log(`  ${status} ${step.name.padEnd(14)} ${duration}${detail}`);
      }

      if (step.error) {
        console.log(chalk.red(`       Error: ${step.error}`));
      }
    }

    if (result.success && isDebug) {
      console.log(chalk.green(`\n[READY] Environment ready (${(result.duration / 1000).toFixed(1)}s)\n`));
    }

    return result;
  }

  private async saveUserMessage(content: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

    const message: SessionMessage = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };
    await session.append(message);
  }

  private async saveAssistantMessage(content: string, toolCalls?: any[]): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

    const message: SessionMessage = {
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
      toolCalls
    };
    await session.append(message);
  }


  /**
   * Run code quality pipeline after file modifications
   */
  private async runQualityPipeline(): Promise<void> {
    console.log(chalk.cyan('\n[QUALITY] Running quality checks...'));

    const result = await this.codeQualityPipeline.run(this.runtime.workspaceRoot);

    // Display results
    for (const check of result.checks) {
      const status = check.status === 'passed' ? chalk.green('[OK]')
        : check.status === 'failed' ? chalk.red('[FAIL]')
        : check.status === 'skipped' ? chalk.gray('[SKIP]')
        : chalk.gray('[...]');

      const duration = check.duration ? chalk.gray(`(${(check.duration / 1000).toFixed(1)}s)`) : '';

      console.log(`  ${status} ${check.name.padEnd(8)} ${check.command.padEnd(20)} ${duration}`);

      // Show first few lines of error output
      if (check.status === 'failed' && check.output) {
        const errorLines = check.output.split('\n').slice(0, 3);
        for (const line of errorLines) {
          if (line.trim()) {
            console.log(chalk.red(`       ${line}`));
          }
        }
      }
    }

    // Summary
    if (result.passed) {
      console.log(chalk.green(`\n[PASS] ${result.summary} (${(result.duration / 1000).toFixed(1)}s)`));
    } else {
      console.log(chalk.red(`\n[FAIL] ${result.summary}`));
    }
  }

  /**
   * Mark that files were modified during this session (called by action executor)
   */
  markFilesModified(filePath?: string, changeType?: 'create' | 'modify' | 'delete'): void {
    this.filesModifiedThisSession = true;
    this.fileModCount++;
    if (filePath) {
      this.modifiedFilePaths.add(filePath);
    }
    // Fire file-modified hook for automation/notifications
    if (filePath && this.hookManager) {
      this.hookManager.executeHooks('file-modified', {
        path: filePath,
        changeType: changeType || 'modify',
      }).catch(() => {}); // Non-blocking
    }

    // Emit file_modified output event for RPC/ACP forwarding
    if (filePath) {
      this.emitOutput({
        type: 'file_modified',
        filePath,
        changeType: changeType || 'modify',
      });
    }
  }

  /**
   * Get file modification count and modified paths since last reset, then reset counters.
   * Used by auto-mode to track per-iteration file changes.
   */
  getAndResetFileModCount(): { count: number; paths: string[] } {
    const result = {
      count: this.fileModCount,
      paths: [...this.modifiedFilePaths],
    };
    this.fileModCount = 0;
    this.modifiedFilePaths.clear();
    return result;
  }

  /**
   * Record an executed action name (tool call) for tracking.
   */
  recordExecutedAction(actionType: string): void {
    this.executedActionNames.push(actionType);
  }

  /**
   * Get and reset executed action names since last call.
   */
  getAndResetExecutedActions(): string[] {
    const actions = [...this.executedActionNames];
    this.executedActionNames = [];
    return actions;
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
    const unrestricted = modeId === 'unrestricted' || modeId === 'full-access' || modeId === 'auto-mode';
    const restricted = modeId === 'restricted' || modeId === 'dry-run';

    this.runtime.options.yes = unrestricted;
    this.runtime.options.unrestricted = unrestricted;
    this.runtime.options.restricted = modeId === 'restricted';
    this.runtime.options.dryRun = modeId === 'dry-run';

    if (restricted) {
      this.permissionManager.setMode('restricted');
      return;
    }
    if (unrestricted) {
      this.permissionManager.setMode('unrestricted');
      return;
    }
    this.permissionManager.setMode('interactive');
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
    this.runtime.options.model = modelId;

    const provider = this.activeProvider ?? this.runtime.config.provider ?? 'openrouter';
    const providerConfig = this.runtime.config[provider] as { model?: string } | undefined;
    if (providerConfig) {
      providerConfig.model = modelId;
    }

    if (process.env.AUTOHAND_DEBUG === '1') {
      console.log(`[DEBUG] Model changed via ACP: provider=${provider}, model=${modelId}`);
    }

    this.llm.setModel(modelId);
    this.contextWindow = getContextWindow(modelId);
    this.contextOrchestrator.setModel(modelId);
    this.contextPercentLeft = 100;
    this.syncProviderModelStatusLine(provider);
    this.emitStatus();
  }

  /**
   * Apply ACP config option changes to runtime behavior.
   */
  applyAcpConfigOption(configId: string, value: string): void {
    if (configId === 'thinking_level') {
      if (value === 'none' || value === 'normal' || value === 'extended') {
        this.runtime.options.thinking = value;
      }
      return;
    }

    if (configId === 'auto_commit') {
      this.runtime.options.autoCommit = value === 'on';
      return;
    }

    if (configId === 'context_compact') {
      this.contextOrchestrator.applyAcpConfig(configId, value);
    }
  }

  /**
   * Connect ACP-provided MCP servers and refresh available MCP tools.
   */
  async connectAcpMcpServers(configs: McpServerConfig[]): Promise<void> {
    if (configs.length === 0) {
      return;
    }
    await this.mcpManager.connectAll(configs);
    this.syncMcpTools();
  }

  /**
   * Run a slash command with PersistentInput active so the user can type
   * while long-running commands like /learn execute. This prevents blocking
   * the composer during commands that involve LLM calls or network requests.
   */
  // Commands that show their own interactive UI (modals, prompts).
  // These must NOT have the persistent input active — it conflicts with
  // their own terminal rendering and leaves the status line on screen.
  private static readonly INTERACTIVE_SLASH_COMMANDS = new Set([
    '/chrome', '/hooks', '/feedback', '/permissions', '/login', '/logout',
    '/agents-new', '/agents new', '/resume', '/theme', '/language',
    '/model', '/skills', '/skills install', '/skills-install',
    '/skills new', '/skills-new', '/mcp', '/mcp install', '/mcp-install',
  ]);

  private async runSlashCommandWithInput(command: string, args: string[]): Promise<string | null> {
    const queueEnabled = this.runtime.config.agent?.enableRequestQueue !== false;
    const isInteractive = AutohandAgent.INTERACTIVE_SLASH_COMMANDS.has(command);
    const canUsePersistentInput =
      process.stdout.isTTY && process.stdin.isTTY && queueEnabled && !this.inkRenderer && !isInteractive;

    let cleanupConsoleBridge: () => void = () => {};

    if (canUsePersistentInput) {
      this.persistentInput.start();
      this.persistentInputActiveTurn = true;
      // Install console bridge so console.log output from slash commands
      // (e.g. /learn progress messages) routes through writeAbove() into
      // the scroll region instead of landing on the fixed-region status line.
      cleanupConsoleBridge = this.installPersistentConsoleBridge();
    }

    try {
      const result = await this.handleSlashCommand(command, args);
      return result;
    } finally {
      if (this.persistentInputActiveTurn) {
        // Preserve any text the user typed while the slash command ran.
        // Prefer current input; if empty, take the first queued item as seed
        // so the user can review before submitting. Do NOT auto-process
        // queued items from a slash command context.
        const typed = this.persistentInput.getCurrentInput();
        if (typed.trim()) {
          this.promptSeedInput = typed;
        } else if (this.persistentInput.hasQueued()) {
          const first = this.persistentInput.dequeue();
          if (first) {
            this.promptSeedInput = first.text;
          }
        }
        // Drain remaining queued items — they should not be auto-processed
        while (this.persistentInput.hasQueued()) {
          this.persistentInput.dequeue();
        }
        this.persistentInput.stop();
        this.persistentInputActiveTurn = false;
      }
      cleanupConsoleBridge();
      if (isInteractive && this.inkRenderer?.isRunning()) {
        this.inkRenderer.clearInput();
      }
    }
  }

  /**
   * Handle a slash command (e.g., /skills, /skills install, /model)
   * Returns the command output or null if the command doesn't exist
   */
  async handleSlashCommand(command: string, args: string[] = []): Promise<string | null> {
    // /mcp depends on background startup state (notably MCP auto-connect).
    // Ensure startup init is settled before rendering server status/actions.
    if (command === '/mcp' || command === '/mcp install') {
      await this.ensureInitComplete();
      this.flushMcpStartupSummaryIfPending();
    }

    const result = await this.slashHandler.handle(command, args);
    if (command === '/mcp' || command === '/mcp install') {
      this.syncMcpTools();
    }
    return result;
  }

  /**
   * Check if a string is a slash command
   */
  isSlashCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  /**
   * Check if a slash command is supported (exists in the command map)
   */
  isSlashCommandSupported(command: string): boolean {
    return this.slashHandler.isCommandSupported(command);
  }

  /**
   * Parse a slash command string into command and args
   * e.g., "/skills install myskill" -> { command: "/skills install", args: ["myskill"] }
   */
  parseSlashCommand(input: string): { command: string; args: string[] } {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);

    // Check for two-word commands like "/skills install", "/mcp install"
    const twoWordCommands = ['/skills install', '/skills new', '/skills use', '/agents new', '/mcp install'];
    const potentialTwoWord = parts.slice(0, 2).join(' ');

    if (twoWordCommands.includes(potentialTwoWord)) {
      return {
        command: potentialTwoWord,
        args: parts.slice(2),
      };
    }

    return {
      command: parts[0],
      args: parts.slice(1),
    };
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
    // Just trigger a render - the render function will use current queueInput
    this.forceRenderSpinner();
  }

  /**
   * Force an immediate spinner render with current state
   */
  private forceRenderSpinner(): void {
    if (!this.taskStartedAt) return;

    const elapsed = formatElapsedTime(this.taskStartedAt);
    // Show session total tokens (includes current task + previous tasks in session)
    const sessionTotal = this.sessionTokensUsed + this.totalTokensUsed;
    const tokens = formatTokens(sessionTotal);
    const queueCount = this.inkRenderer?.getQueueCount() ?? this.persistentInput.getQueueLength();
    const queueHint = queueCount > 0 ? ` [${queueCount} queued]` : '';
    const verb = this.activityIndicator?.getVerb?.() ?? 'Working';
    const statusLine = `${verb}... (esc to interrupt · ${elapsed} · ${tokens}${queueHint})`;
    const footerLine = this.formatStatusLine();
    this.persistentInput.setStatusLine(footerLine);
    const usingTerminalRegions = this.isUsingTerminalRegionsForActiveTurn();

    if (this.inkRenderer) {
      // InkRenderer handles its own state updates
      this.inkRenderer.setStatus(`${verb}...`);
      this.inkRenderer.setElapsed(elapsed);
      this.inkRenderer.setTokens(tokens);
      return;
    }

    const promptWidth = getPromptBlockWidth(process.stdout.columns);
    const footerText = this.formatSpinnerFooter(footerLine);
    const cacheKey = `${statusLine}|${footerText}|${promptWidth}|${usingTerminalRegions ? 'regions' : 'spinner'}`;

    // Only update if something actually changed
    if (cacheKey === this.lastRenderedStatus) return;
    this.lastRenderedStatus = cacheKey;

    if (usingTerminalRegions) {
      if (this.runtime.spinner?.isSpinning) {
        this.runtime.spinner.stop();
      }
      this.setPersistentInputActivityLine(statusLine);
      return;
    }

    if (!this.runtime.spinner) return;

    const fullText = this.buildSpinnerStatusText(statusLine, footerText);
    this.runtime.spinner.text = fullText;
  }

  private formatSpinnerFooter(footer: { left: string; right?: string }): string {
    return footer.left + (footer.right ? ` · ${footer.right}` : '');
  }

  private buildSpinnerStatusText(statusLine: string, footerLine?: string): string {
    const promptWidth = getPromptBlockWidth(process.stdout.columns);
    // Ora prefixes the first line with the spinner glyph and a space.
    // Reserve 2 columns so wrapped status lines do not corrupt redraw.
    const statusWidth = Math.max(10, promptWidth - 2);
    const combined = footerLine ? `${statusLine} · ${footerLine}` : statusLine;
    return this.fitSpinnerLine(combined, statusWidth);
  }

  private fitSpinnerLine(value: string, width: number): string {
    const plain = value.replace(/\u001b\[[0-9;]*m/g, '').replace(/[\x00-\x1F\x7F]/g, '');
    if (width <= 0) {
      return '';
    }
    if (plain.length <= width) {
      return plain;
    }
    if (width === 1) {
      return '…';
    }
    return `${plain.slice(0, width - 1)}…`;
  }

  private setSpinnerStatus(status: string): void {
    const footerLine = this.formatStatusLine();
    this.persistentInput.setStatusLine(footerLine);

    if (this.isUsingTerminalRegionsForActiveTurn()) {
      if (this.runtime.spinner?.isSpinning) {
        this.runtime.spinner.stop();
      }
      this.setPersistentInputActivityLine(status);
      return;
    }

    if (!this.runtime.spinner) {
      return;
    }

    const footerText = footerLine.left + (footerLine.right ? ` · ${footerLine.right}` : '');
    this.runtime.spinner.text = this.buildSpinnerStatusText(status, footerText);
  }

  private startStatusUpdates(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }

    // Reset tracking state
    this.lastRenderedStatus = '';

    // Pick a fresh verb and tip for this working session
    this.activityIndicator?.next?.();

    // Immediate initial render
    this.forceRenderSpinner();

    // Update every second for elapsed time, but forceRenderSpinner
    // handles deduplication so frequent calls are fine
    this.statusInterval = setInterval(() => {
      this.forceRenderSpinner();
    }, 1000); // Once per second is enough for time updates

    if (process.stdout.isTTY && !this.resizeHandler) {
      this.resizeHandler = () => {
        this.lastRenderedStatus = '';
        if (this.runtime.spinner?.isSpinning) {
          this.runtime.spinner.stop();
          if (!this.isUsingTerminalRegionsForActiveTurn()) {
            this.runtime.spinner.start();
          }
        }
        this.forceRenderSpinner();
      };
      process.stdout.on('resize', this.resizeHandler);
    }
  }

  private stopStatusUpdates(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    if (this.resizeHandler) {
      process.stdout.off('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.isUsingTerminalRegionsForActiveTurn()) {
      this.setPersistentInputActivityLine('');
    }
  }

  private isUsingTerminalRegionsForActiveTurn(): boolean {
    return this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0' &&
      !this.useInkRenderer;
  }

  private setPersistentInputActivityLine(activity: string): void {
    const persistentInputWithActivity = this.persistentInput as {
      setActivityLine?: (value: string) => void;
    } | undefined;
    persistentInputWithActivity?.setActivityLine?.(activity);
  }

  private ensureSpinnerRunning(): void {
    if (!this.runtime.spinner) {
      return;
    }
    if (this.isUsingTerminalRegionsForActiveTurn()) {
      if (this.runtime.spinner.isSpinning) {
        this.runtime.spinner.stop();
      }
      return;
    }
    if (!this.runtime.spinner.isSpinning) {
      this.runtime.spinner.start();
    }
  }

  private resumeSpinnerAfterModalPause(): void {
    if (!this.runtime.spinner) {
      return;
    }
    if (this.isUsingTerminalRegionsForActiveTurn()) {
      return;
    }
    this.runtime.spinner.start();
  }

  /**
   * Pause all UI (status updates, spinner, persistent input, ink renderer),
   * execute a callback, then restore everything. Used by confirmAction,
   * executeAskFollowupQuestion, and handlePlanCreated.
   */
  private async withModalPause<T>(fn: () => Promise<T>): Promise<T> {
    this.stopStatusUpdates();

    const spinnerWasSpinning = this.runtime.spinner?.isSpinning;
    if (spinnerWasSpinning) {
      this.runtime.spinner?.stop();
    }

    this.persistentInput.pause();

    if (this.inkRenderer) {
      this.inkRenderer.pause();
    }

    try {
      return await fn();
    } finally {
      if (this.inkRenderer) {
        await this.inkRenderer.resume();
      }

      this.persistentInput.resume();

      if (spinnerWasSpinning && this.runtime.spinner) {
        this.resumeSpinnerAfterModalPause();
      }

      this.startStatusUpdates();
    }
  }

  private updateContextUsage(messages: LLMMessage[], tools?: any[]): void {
    if (!this.contextWindow) {
      return;
    }

    // Use comprehensive context calculation if tools provided
    if (tools) {
      const model = this.runtime.options.model ?? getProviderConfig(this.runtime.config, this.activeProvider)?.model ?? 'unconfigured';
      const usage = calculateContextUsage(
        messages,
        tools,
        model
      );
      this.contextPercentLeft = Math.round((1 - usage.usagePercent) * 100);
    } else {
      // Fallback to simple message estimation
      const usage = estimateMessagesTokens(messages);
      const percent = Math.max(0, Math.min(1 - usage / this.contextWindow, 1));
      this.contextPercentLeft = Math.round(percent * 100);
    }

    // Update InkRenderer with context percentage
    if (this.inkRenderer) {
      this.inkRenderer.setContextPercent(this.contextPercentLeft);
    }

    this.emitStatus();
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
    const percent = Number.isFinite(this.contextPercentLeft)
      ? Math.max(0, Math.min(100, this.contextPercentLeft))
      : 100;

    const queueCount = this.inkRenderer?.getQueueCount() ?? this.persistentInput.getQueueLength();
    const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';

    const planModeManager = getPlanModeManager();

    // Plan mode indicator
    const planIndicator = planModeManager.isEnabled()
      ? chalk.bgCyan.black.bold(' PLAN ') + ' '
      : '';

    const left = `${planIndicator}${percent}% context left · ${t('ui.commandHint')}${queueStatus}`;

    let right = '';
    if (this.versionCheckResult?.updateAvailable) {
      const hint = getInstallHint(this.versionCheckResult.channel);
      right = chalk.yellow('Update available! ') + chalk.cyan(`Run: ${hint}`);
    }

    return { left, right };
  }

  private printUserInstructionToChatLog(instruction: string): void {
    const normalized = instruction.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return;
    }

    // Use InkRenderer if available
    if (this.useInkRenderer && this.inkRenderer) {
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
    const systemPrompt = await this.buildSystemPrompt();
    this.conversation.reset(systemPrompt);
    this.mentionResolver.clear();
    this.updateContextUsage(this.conversation.history());
  }

  /**
   * Generate an explicit session bootstrap note that surfaces the most
   * important context — memories, AGENTS.md, skills, and project structure —
   * as a coherent "here's what you should know" block. This is injected as a
   * system note so the LLM explicitly sees it, rather than passively hoping it
   * notices buried system prompt content.
   */
  private async generateSessionBootstrap(): Promise<string> {
    return buildSessionBootstrap({
      workspaceRoot: this.runtime.workspaceRoot,
      getContextMemories: (limit) => this.memoryManager.getContextMemories(limit),
      getActiveSkills: () => this.skillsRegistry.getActiveSkills(),
    });
  }

  /**
   * Inject the session bootstrap into the conversation. Called once per
   * session start (new CLI invocation, /new, /clear, or resumed session).
   */
  private async injectSessionBootstrap(): Promise<void> {
    try {
      const bootstrap = await this.generateSessionBootstrap();
      if (bootstrap && bootstrap.length > '[Session Bootstrap]'.length + 10) {
        this.conversation.addSystemNote(bootstrap, '[Session Bootstrap]');
      }
    } catch {
      // Bootstrap is best-effort; never block session start
    }
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
    return providers.length ? providers : ['openrouter'];
  }


  private getNotificationGuards() {
    return {
      isRpcMode: !!this.runtime.isRpcMode,
      hasConfirmationCallback: !!this.confirmationCallback,
      isAutoConfirm: !!this.runtime.config.ui?.autoConfirm,
      isYesMode: !!this.runtime.options.yes,
      hasExternalCallback: isExternalCallbackEnabled(),
      notificationsConfig: this.runtime.config.ui?.notifications,
    };
  }

  private getCompletionNotificationBody(): string {
    const direct = this.normalizeCompletionNotificationBody(this.lastAssistantResponseForNotification);
    if (direct) {
      return direct;
    }

    const history = this.conversation.history();
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const message = history[i];
      if (message.role !== 'assistant' || typeof message.content !== 'string') {
        continue;
      }

      const payload = this.parseAssistantReactPayload(message.content);
      const candidate = this.normalizeCompletionNotificationBody(
        payload.finalResponse ?? payload.response ?? payload.thought ?? message.content
      );
      if (candidate) {
        return candidate;
      }
    }

    return 'Task completed';
  }

  private normalizeCompletionNotificationBody(raw: string): string {
    const cleaned = this.cleanupModelResponse(raw).replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return '';
    }
    if (cleaned.length <= 220) {
      return cleaned;
    }
    return `${cleaned.slice(0, 219)}…`;
  }

  private async confirmDangerousAction(
    message: string,
    context?: { tool?: string; path?: string; command?: string }
  ): Promise<PermissionPromptResult> {
    const normalizedYolo = normalizeYoloInput(this.runtime.options.yolo as string | boolean | undefined);
    if (normalizedYolo && context?.tool) {
      try {
        const pattern = parseYoloPattern(normalizedYolo);
        if (isToolAllowedByYolo(context.tool, pattern)) {
          return { decision: 'allow_once' };
        }
      } catch {
        // Ignore malformed runtime YOLO values here; CLI validation handles normal entrypoints.
      }
    }

    if (this.runtime.options.yes || this.runtime.options.unrestricted || this.runtime.config.ui?.autoConfirm) {
      return { decision: 'allow_once' };
    }

    let decision: PermissionPromptResult;

    // Use confirmation callback if set (e.g., RPC mode)
    if (this.confirmationCallback) {
      decision = normalizePermissionPromptResponse(await this.confirmationCallback(message, context));
    } else if (isExternalCallbackEnabled()) {
      decision = normalizePermissionPromptResponse(await unifiedConfirm(message));
    } else {
      this.notificationService.notify(
        { body: message, reason: 'confirmation' },
        this.getNotificationGuards()
      ).catch(() => {});

      decision = await this.withModalPause(async () => {
        // Reset stdin to cooked mode for Modal prompts
        const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
        if (wasRaw) {
          safeSetRawMode(process.stdin as NodeJS.ReadStream, false);
        }
        return unifiedConfirm(message);
      });
    }

    if (context?.tool) {
      await this.permissionManager.applyPromptDecision(
        {
          tool: context.tool,
          path: context.path,
          command: context.command,
        },
        decision
      );
    }

    return decision;
  }

  /**
   * Request access to a directory outside the workspace.
   * In RPC mode, sends a notification to the client for user approval.
   * In interactive mode, shows a modal prompt.
   */
  private directoryAccessCallback?: (path: string, reason?: string) => Promise<string | undefined>;

  setDirectoryAccessCallback(callback: (path: string, reason?: string) => Promise<string | undefined>): void {
    this.directoryAccessCallback = callback;
  }

  private async requestDirectoryAccess(dirPath: string, reason?: string): Promise<string | undefined> {
    // In yolo/yes/unrestricted mode, auto-grant
    const normalizedYolo = normalizeYoloInput(this.runtime.options.yolo as string | boolean | undefined);
    if (normalizedYolo || this.runtime.options.yes || this.runtime.options.unrestricted) {
      return dirPath;
    }

    // Use callback if set (e.g., RPC mode)
    if (this.directoryAccessCallback) {
      return this.directoryAccessCallback(dirPath, reason);
    }

    // Interactive mode - show modal prompt via Ink
    if (this.useInkRenderer && this.inkRenderer) {
      return this.withModalPause(async () => {
        const result = await showDirectoryAccessModal({ path: dirPath, reason });
        return result ? dirPath : undefined;
      });
    }

    // Fallback - no callback and no Ink renderer
    return undefined;
  }

  /**
   * Handle ask_followup_question tool with proper TUI coordination.
   * Uses Ink-based question modal for consistent UX.
   */
  private async executeAskFollowupQuestion(
    question: string,
    suggestedAnswers?: string[]
  ): Promise<string> {
    // Auto-approve mode: always answer "Yes" to unblock autonomous flows.
    if (this.runtime.options.yes || this.runtime.options.unrestricted) {
      console.log(chalk.yellow(`\n❓ ${question}`));
      console.log(chalk.gray('  (Auto-answered: Yes)\n'));
      return '<answer>Yes</answer>';
    }

    // Non-interactive mode fallback
    if (process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      console.log(chalk.yellow(`\n❓ ${question}`));
      console.log(chalk.gray('  (Auto-skipped in non-interactive mode)\n'));
      return '<answer>Skipped (non-interactive mode)</answer>';
    }

    this.notificationService.notify(
      { body: `Question: ${question.slice(0, 100)}`, reason: 'question' },
      this.getNotificationGuards()
    ).catch(() => {});

    return this.withModalPause(async () => {
      const answer = await showQuestionModal({
        question,
        suggestedAnswers
      });

      if (answer === null) {
        this.consecutiveCancellations++;
        console.log(chalk.yellow('\n  (Question cancelled)\n'));
        return '<answer>User cancelled this question. Do NOT call ask_followup_question again. Continue with your best judgment or provide a final response.</answer>';
      }

      this.consecutiveCancellations = 0;
      console.log(chalk.green(`\n✓ Answer: ${answer}\n`));
      return `<answer>${answer}</answer>`;
    });
  }

  /**
   * Handle plan creation - sets plan on manager and confirms to the LLM.
   * This is called when the LLM uses the `plan` tool.
   *
   * The acceptance modal is NOT shown here. The LLM must call `exit_plan_mode`
   * when ready to present the plan for approval.
   */
  private async handlePlanCreated(plan: import('../modes/planMode/types.js').Plan, filePath: string): Promise<string> {
    const planManager = getPlanModeManager();

    // Guard: if plan mode is not enabled, just save the plan without
    // interacting with the manager. This prevents state corruption when
    // the LLM calls `plan` outside plan mode (which should no longer
    // happen since the tool is gated, but we keep this as a safety net).
    if (!planManager.isEnabled()) {
      console.log(chalk.cyan('\n' + '─'.repeat(60)));
      console.log(chalk.cyan.bold('📋 Plan Summary'));
      console.log(chalk.cyan('─'.repeat(60)));
      for (const step of plan.steps) {
        console.log(chalk.white(`  ${step.number}. ${step.description}`));
      }
      console.log(chalk.cyan('─'.repeat(60)));
      console.log(chalk.gray(`  Saved to: ${filePath}`));
      console.log(chalk.cyan('─'.repeat(60) + '\n'));

      return `Plan saved to ${filePath}. Plan mode is not active — enable it with /plan to use the acceptance flow.`;
    }

    // Store the plan in PlanModeManager
    planManager.setPlan(plan);

    // Display plan summary
    console.log(chalk.cyan('\n' + '─'.repeat(60)));
    console.log(chalk.cyan.bold('📋 Plan Summary'));
    console.log(chalk.cyan('─'.repeat(60)));

    for (const step of plan.steps) {
      console.log(chalk.white(`  ${step.number}. ${step.description}`));
    }

    console.log(chalk.cyan('─'.repeat(60)));
    console.log(chalk.gray(`  Saved to: ${filePath}`));
    console.log(chalk.cyan('─'.repeat(60) + '\n'));

    return `Plan saved to ${filePath} (${plan.steps.length} step(s)).\n\nCall \`exit_plan_mode\` when you are ready to present this plan to the user for approval.`;
  }

  /**
   * Handle exit_plan_mode tool - presents the plan to the user for approval.
   * This transitions from planning phase to execution (or back to planning
   * if the user rejects).
   */
  private async handleExitPlanMode(_summary?: string): Promise<string> {
    const planManager = getPlanModeManager();

    // Guard: must be in plan mode
    if (!planManager.isEnabled()) {
      return 'Error: Plan mode is not active. You can only call `exit_plan_mode` when plan mode is enabled.';
    }

    const plan = planManager.getPlan();
    if (!plan) {
      return 'Error: No plan has been created yet. Call the `plan` tool first to create a plan before calling `exit_plan_mode`.';
    }

    // Non-interactive mode: auto-accept with default option
    if (this.runtime.options.yes || this.runtime.options.unrestricted || process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      const config = planManager.acceptPlan('auto_accept');
      console.log(chalk.yellow('  (Auto-accepted in non-interactive mode)\n'));
      this.conversation.addSystemNote(
        `Plan accepted with option: ${config.option}. You may now proceed to execution.`
      );
      return `Plan accepted with option: ${config.option}. Starting execution...`;
    }

    // Get acceptance options from PlanModeManager
    const acceptOptions = planManager.getAcceptOptions();
    const filePath = `${plan.id}.md`;

    return this.withModalPause(async () => {
      const result = await showPlanAcceptModal({
        planFilePath: filePath,
        options: acceptOptions.map(opt => ({
          id: opt.id,
          label: opt.label,
          shortcut: opt.shortcut
        }))
      });

      // Handle result
      if (result.type === 'cancel') {
        console.log(chalk.yellow('\n  Plan not accepted. You can revise and try again.\n'));
        this.conversation.addSystemNote(
          'The user has reviewed the plan and did not accept it yet. ' +
          'Do NOT call the `plan` tool again automatically. ' +
          'Instead, ask the user what changes they would like, or provide your response summarizing the current plan.'
        );
        return 'Plan not accepted. Staying in planning mode for revisions.';
      }

      if (result.type === 'custom' && result.customText) {
        console.log(chalk.yellow(`\n  Feedback received: ${result.customText}\n`));
        this.conversation.addSystemNote(
          'The user has reviewed the plan and provided feedback. ' +
          'Do NOT call the `plan` tool again automatically. ' +
          'Revise the plan based on the user feedback and present the updated plan.'
        );
        return `User feedback on plan: ${result.customText}. Please revise the plan accordingly.`;
      }

      if (result.type === 'option' && result.optionId) {
        const selectedOption = acceptOptions.find(opt => opt.id === result.optionId);
        if (selectedOption) {
          const config = planManager.acceptPlan(selectedOption.id);

          console.log(chalk.green(`\n✓ Plan accepted: ${selectedOption.label}`));
          if (config.clearContext) {
            console.log(chalk.gray('  Context will be cleared for fresh execution.'));
            await this.resetConversationContext();
            console.log(chalk.gray('  Context cleared for fresh execution.'));
          }
          if (config.autoAcceptEdits) {
            console.log(chalk.gray('  Edits will be auto-accepted.'));
          }
          console.log();

          this.conversation.addSystemNote(
            `Plan accepted with option: ${config.option}. You may now proceed to execution.`
          );
          return `Plan accepted with option: ${config.option}. Ready for execution.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
        }
      }

      // Default: accept with manual approve if result wasn't recognized
      planManager.acceptPlan('manual_approve');
      console.log(chalk.green('\n✓ Plan accepted with manual approval for edits.\n'));
      this.conversation.addSystemNote(
        'Plan accepted with option: manual_approve. You may now proceed to execution.'
      );

      return `Plan accepted. Starting execution with manual edit approval.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
    });
  }

  private resolveWorkspacePath(relativePath: string): string {
    const resolved = path.isAbsolute(relativePath)
      ? path.resolve(relativePath)
      : path.resolve(this.runtime.workspaceRoot, relativePath);
    const allowedRoots = this.files.getAllowedDirectories?.()
      ?? [this.runtime.workspaceRoot, ...(this.runtime.additionalDirs ?? [])];

    let probe = resolved;
    let realPath = resolved;

    while (true) {
      try {
        const realProbe = fs.realpathSync(probe);
        realPath = probe === resolved
          ? realProbe
          : path.join(realProbe, path.relative(probe, resolved));
        break;
      } catch {
        const parent = path.dirname(probe);
        if (parent === probe) {
          break;
        }
        probe = parent;
      }
    }

    for (const allowedRoot of allowedRoots) {
      let realRoot: string;
      try {
        realRoot = fs.realpathSync(allowedRoot);
      } catch {
        realRoot = path.resolve(allowedRoot);
      }

      const rootWithSep = realRoot.endsWith(path.sep)
        ? realRoot
        : `${realRoot}${path.sep}`;

      if (realPath === realRoot || realPath.startsWith(rootWithSep)) {
        return resolved;
      }
    }

    const allowedDirsList = allowedRoots.join(', ');
    throw new Error(
      `Path ${relativePath} escapes the allowed directories: ${allowedDirsList}. ` +
      'Tell the user to grant access with /add-dir <path> for this session or restart with --add-dir <path>.'
    );
  }

  private async switchWorkspaceContext(workspaceRoot: string): Promise<void> {
    this.runtime.workspaceRoot = workspaceRoot;
    this.memoryManager.setWorkspace(workspaceRoot);
    this.hookManager.setWorkspaceRoot(workspaceRoot);
    this.files.setWorkspaceRoot(workspaceRoot);
    this.persistentInput.setWorkspaceRoot(workspaceRoot);
    this.ignoreFilter = new GitIgnoreParser(workspaceRoot, []);
    this.workspaceFileCollector.setWorkspace(workspaceRoot, this.ignoreFilter);
    await this.skillsRegistry.setWorkspace(workspaceRoot);
  }

  private async enterSessionWorktree(name?: string): Promise<string> {
    if (this.sessionWorktreeState) {
      return `Already inside worktree ${this.sessionWorktreeState.worktreePath} (${this.sessionWorktreeState.branchName}). Exit it first with exit_worktree.`;
    }

    const originalWorkspaceRoot = this.runtime.workspaceRoot;
    const info = prepareSessionWorktree({
      cwd: originalWorkspaceRoot,
      worktree: name ?? true,
      mode: 'cli',
    });

    this.sessionWorktreeState = {
      ...info,
      originalWorkspaceRoot,
    };

    await this.switchWorkspaceContext(info.worktreePath);

    return [
      `Entered worktree ${info.worktreePath}.`,
      `Branch: ${info.branchName}${info.createdBranch ? ' (new)' : ''}`,
      `Original workspace: ${originalWorkspaceRoot}`,
    ].join('\n');
  }

  private handleSkillTool(
    action: Extract<AgentAction, { type: 'skill' }>
  ): string {
    if (action.command === 'list') {
      const skills = this.skillsRegistry.listSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        active: skill.isActive,
      }));
      return JSON.stringify(skills, null, 2);
    }

    if (!action.name?.trim()) {
      throw new Error(`skill ${action.command} requires a "name" argument.`);
    }

    const name = action.name.trim();
    const skill = this.skillsRegistry.getSkill(name);
    if (!skill) {
      const similar = this.skillsRegistry.findSimilar(name, 0.2)
        .slice(0, 3)
        .map((match) => match.skill.name);
      const suggestion = similar.length > 0
        ? `\nDid you mean: ${similar.join(', ')}`
        : '';
      return `Skill "${name}" not found.${suggestion}`;
    }

    if (action.command === 'info') {
      return JSON.stringify({
        name: skill.name,
        description: skill.description,
        source: skill.source,
        path: skill.path,
        active: skill.isActive,
        allowedTools: skill['allowed-tools'] ?? null,
      }, null, 2);
    }

    if (action.command === 'activate') {
      if (skill.isActive) {
        return `Skill "${name}" is already active.`;
      }
      const success = this.skillsRegistry.activateSkill(name);
      return success
        ? `Activated skill: ${name}\n${skill.description}`
        : `Failed to activate skill: ${name}`;
    }

    if (action.command === 'deactivate') {
      if (!skill.isActive) {
        return `Skill "${name}" is not active.`;
      }
      const success = this.skillsRegistry.deactivateSkill(name);
      return success
        ? `Deactivated skill: ${name}`
        : `Failed to deactivate skill: ${name}`;
    }

    throw new Error(`Unsupported skill command: ${action.command}`);
  }

  private async executeSleepTool(seconds: number, reason?: string): Promise<string> {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('sleep requires a non-negative "seconds" argument.');
    }
    if (seconds > 300) {
      throw new Error('sleep cannot exceed 300 seconds.');
    }

    await this.sleep(seconds * 1000);
    const units = seconds === 1 ? 'second' : 'seconds';
    return reason
      ? `Slept for ${seconds} ${units}.\nReason: ${reason}`
      : `Slept for ${seconds} ${units}.`;
  }

  private async exitSessionWorktree(keep = false): Promise<string> {
    const state = this.sessionWorktreeState;
    if (!state) {
      return 'No active session worktree.';
    }

    if (!keep) {
      const manager = new WorktreeManager(state.repoRoot);
      await manager.remove(state.worktreePath, {
        force: true,
        deleteBranch: state.createdBranch,
      });
    }

    await this.switchWorkspaceContext(state.originalWorkspaceRoot);
    this.sessionWorktreeState = null;

    return keep
      ? `Exited worktree ${state.worktreePath} and returned to ${state.originalWorkspaceRoot}. Worktree kept on disk.`
      : `Exited worktree ${state.worktreePath} and returned to ${state.originalWorkspaceRoot}.`;
  }

  private isDestructiveCommand(command: string): boolean {
    const lowered = command.toLowerCase();
    return lowered.includes('rm ') || lowered.includes('sudo ') || lowered.includes('dd ');
  }

  setStatusListener(listener: (snapshot: AgentStatusSnapshot) => void): void {
    this.statusListener = listener;
    this.emitStatus();
  }

  setOutputListener(listener: (event: AgentOutputEvent) => void): void {
    this.outputListener = listener;
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
    if (this.outputListener) {
      this.outputListener(event);
    }
  }

  private emitStatus(): void {
    if (this.statusListener) {
      this.statusListener(this.getStatusSnapshot());
    }
  }

  getStatusSnapshot(): AgentStatusSnapshot {
    const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
    return {
      model: this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured',
      workspace: this.runtime.workspaceRoot,
      contextPercent: this.contextPercentLeft,
      tokensUsed: this.totalTokensUsed
    };
  }
}
