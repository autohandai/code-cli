/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import ora from 'ora';
import { showModal, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import readline from 'node:readline';
import { FileActionManager } from '../actions/filesystem.js';
import { saveConfig, getProviderConfig } from '../config.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import { ProviderFactory, ProviderNotConfiguredError } from '../providers/ProviderFactory.js';
import { isMLXSupported } from '../utils/platform.js';
import { readInstruction, safeEmitKeypressEvents } from '../ui/inputPrompt.js';
// showFilePalette is imported dynamically to avoid bundling ink in standalone binary
import {
  getContextWindow,
  estimateMessagesTokens,
  calculateContextUsage,
  CONTEXT_WARNING_THRESHOLD,
  CONTEXT_CRITICAL_THRESHOLD,
  type ContextUsage
} from '../utils/context.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { getAutoCommitInfo, executeAutoCommit } from '../actions/git.js';
import { filterToolsByRelevance, detectRelevantCategories } from './toolFilter.js';
import { SLASH_COMMANDS } from './slashCommands.js';
import { ConversationManager } from './conversationManager.js';
import { ContextManager } from './contextManager.js';
import { ToolManager } from './toolManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { SlashCommandHandler } from './slashCommandHandler.js';
import { SessionManager } from '../session/SessionManager.js';
import { ProjectManager } from '../session/ProjectManager.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type { SessionMessage, WorkspaceState } from '../session/types.js';
import { ProjectAnalyzer as OnboardingProjectAnalyzer, AgentsGenerator } from '../onboarding/index.js';
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
  ClientContext,
  ToolOutputChunk
} from '../types.js';

import { AgentDelegator } from './agents/AgentDelegator.js';
import { DEFAULT_TOOL_DEFINITIONS, type ToolDefinition } from './toolManager.js';
import { ErrorLogger } from './errorLogger.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { FeedbackManager } from '../feedback/FeedbackManager.js';
import { TelemetryManager } from '../telemetry/TelemetryManager.js';
import { SkillsRegistry } from '../skills/SkillsRegistry.js';
import { CommunitySkillsClient } from '../skills/CommunitySkillsClient.js';
import type { SkillSuggestion } from '../skills/CommunitySkillsClient.js';
import { ProjectAnalyzer } from '../skills/autoSkill.js';
import { AUTOHAND_PATHS } from '../constants.js';
import { PersistentInput, createPersistentInput } from '../ui/persistentInput.js';
import { injectLocaleIntoPrompt, getCurrentLocale } from '../i18n/index.js';
import { formatToolOutputForDisplay } from '../ui/toolOutput.js';
// InkRenderer type - using 'any' to avoid bun bundling ink at compile time
// The actual type comes from dynamic import at runtime
type InkRenderer = any;
import { PermissionManager } from '../permissions/PermissionManager.js';
import { HookManager, type HookContext } from './HookManager.js';
import { confirm as unifiedConfirm, isExternalCallbackEnabled } from '../ui/promptCallback.js';
import { getPlanModeManager } from '../commands/plan.js';
import packageJson from '../../package.json' with { type: 'json' };
// New feature modules
import { ImageManager } from './ImageManager.js';
import { IntentDetector, type Intent, type IntentResult } from './IntentDetector.js';
import { EnvironmentBootstrap, type BootstrapResult } from './EnvironmentBootstrap.js';
import { CodeQualityPipeline, type QualityResult } from './CodeQualityPipeline.js';
import { resolvePromptValue, SysPromptError } from '../utils/sysPrompt.js';
import {
  formatToolSignature,
  formatExplorationLabel,
  formatToolResultsBatch,
  describeInstruction,
  formatElapsedTime,
  formatTokens
} from './agent/AgentFormatter.js';
import { WorkspaceFileCollector } from './agent/WorkspaceFileCollector.js';
import { ProviderConfigManager } from './agent/ProviderConfigManager.js';

export class AutohandAgent {
  private mentionContexts: { path: string; contents: string }[] = [];
  private contextWindow: number;
  private contextPercentLeft = 100;
  private ignoreFilter: GitIgnoreParser;
  private statusListener?: (snapshot: AgentStatusSnapshot) => void;
  private outputListener?: (event: AgentOutputEvent) => void;
  private confirmationCallback?: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<boolean>;
  private conversation: ConversationManager;
  private toolManager: ToolManager;
  private actionExecutor: ActionExecutor;
  private toolsRegistry: ToolsRegistry;
  private slashHandler: SlashCommandHandler;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private toolOutputQueue: Promise<void> = Promise.resolve();
  private memoryManager: MemoryManager;
  private permissionManager: PermissionManager;
  private hookManager: HookManager;
  private delegator: AgentDelegator;
  private feedbackManager: FeedbackManager;
  private telemetryManager: TelemetryManager;
  private skillsRegistry: SkillsRegistry;
  private communityClient: CommunitySkillsClient;
  private workspaceFileCollector: WorkspaceFileCollector;
  private providerConfigManager: ProviderConfigManager;
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;
  private activeProvider: ProviderName;
  private errorLogger: ErrorLogger;

  private taskStartedAt: number | null = null;
  private totalTokensUsed = 0;
  private statusInterval: NodeJS.Timeout | null = null;
  private sessionStartedAt: number = Date.now();
  private sessionTokensUsed = 0;
  private inkRenderer: InkRenderer | null = null;
  private useInkRenderer = false;
  private pendingInkInstructions: string[] = [];
  private persistentInput: PersistentInput;
  private queueInput = '';
  private lastRenderedStatus = '';

  // New feature modules
  private imageManager: ImageManager;
  private intentDetector: IntentDetector;
  private environmentBootstrap: EnvironmentBootstrap;
  private codeQualityPipeline: CodeQualityPipeline;
  private lastIntent: Intent = 'diagnostic';
  private filesModifiedThisSession = false;
  private searchQueries: string[] = [];
  private sessionRetryCount = 0;

  // Context compaction - auto-compresses context to prevent "context too long" errors
  private contextManager!: ContextManager;
  private contextCompactionEnabled = true;

  constructor(
    private llm: LLMProvider,
    private readonly files: FileActionManager,
    private readonly runtime: AgentRuntime
  ) {
    const initialProvider = runtime.config.provider ?? 'openrouter';
    const providerSettings = getProviderConfig(runtime.config, initialProvider);
    const model = runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    this.contextWindow = getContextWindow(model);
    this.ignoreFilter = new GitIgnoreParser(runtime.workspaceRoot, []);
    this.workspaceFileCollector = new WorkspaceFileCollector(runtime.workspaceRoot, this.ignoreFilter);
    this.conversation = ConversationManager.getInstance();
    this.toolsRegistry = new ToolsRegistry();
    this.memoryManager = new MemoryManager(runtime.workspaceRoot);

    // Initialize context manager for auto-compaction
    // Default enabled, can be toggled with --no-cc or /cc command
    this.contextCompactionEnabled = runtime.options.contextCompact !== false;
    this.contextManager = new ContextManager({
      model,
      conversationManager: this.conversation,
      onCrop: (count, reason) => {
        if (this.contextCompactionEnabled) {
          console.log(chalk.cyan(`ℹ Context optimized: ${reason}`));
        }
      },
      onWarning: (usage) => {
        console.log(chalk.yellow(`⚠ Context at ${Math.round(usage.usagePercent * 100)}%`));
      },
    });

    // Initialize new feature modules
    this.imageManager = new ImageManager();
    this.intentDetector = new IntentDetector();
    this.environmentBootstrap = new EnvironmentBootstrap();
    this.codeQualityPipeline = new CodeQualityPipeline();

    // Create permission manager with persistence callback and local project support
    this.permissionManager = new PermissionManager({
      settings: runtime.config.permissions,
      workspaceRoot: runtime.workspaceRoot,
      onPersist: async (settings) => {
        runtime.config.permissions = settings;
        await saveConfig(runtime.config);
      }
    });

    // Initialize local project settings (async, but non-blocking)
    this.permissionManager.initLocalSettings().catch(() => {
      // Ignore errors - local settings are optional
    });

    // Create hook manager with persistence callback
    this.hookManager = new HookManager({
      settings: runtime.config.hooks,
      workspaceRoot: runtime.workspaceRoot,
      onPersist: async () => {
        runtime.config.hooks = this.hookManager.getSettings();
        await saveConfig(runtime.config);
      },
      onHookOutput: (result) => {
        // Display hook output to console (only if not a JSON control flow response)
        // Use synchronous write to prevent race conditions with prompt rendering
        if (result.stdout && !result.response) {
          process.stdout.write(chalk.dim(`[hook:${result.hook.event}] ${result.stdout}\n`));
        }
        if (result.stderr && !result.blockingError) {
          process.stderr.write(chalk.yellow(`[hook:${result.hook.event}] ${result.stderr}\n`));
        }
      }
    });

    this.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => this.resolveWorkspacePath(relativePath),
      confirmDangerousAction: (message, context) => this.confirmDangerousAction(message, context),
      onExploration: (entry) => this.recordExploration(entry),
      onToolOutput: (chunk) => this.handleToolOutput(chunk),
      toolsRegistry: this.toolsRegistry,
      getRegisteredTools: () => this.toolManager?.listDefinitions() ?? [],
      memoryManager: this.memoryManager,
      permissionManager: this.permissionManager,
      onFileModified: () => this.markFilesModified(),
      onAskFollowup: (question, suggestedAnswers) => this.executeAskFollowupQuestion(question, suggestedAnswers),
      onPlanCreated: (plan, filePath) => this.handlePlanCreated(plan, filePath),
      onPermissionRequest: async (context) => {
        const results = await this.hookManager.executeHooks('permission-request', {
          tool: context.tool,
          path: context.path,
          args: context.args,
          permissionType: 'tool_approval'
        });

        // Find the first hook with a decision
        for (const result of results) {
          if (result.response?.decision) {
            return {
              decision: result.response.decision,
              reason: result.response.reason,
              updatedInput: result.response.updatedInput
            };
          }
        }
        return undefined; // No decision from hooks
      }
    });

    this.activeProvider = runtime.config.provider ?? 'openrouter';
    // Determine client context for delegation
    const delegatorContext = runtime.options.clientContext
      ?? (runtime.options.restricted ? 'restricted' : 'cli');
    this.delegator = new AgentDelegator(llm, this.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3,
      onSubagentStop: async (context) => {
        await this.hookManager.executeHooks('subagent-stop', {
          subagentId: context.subagentId,
          subagentName: context.subagentName,
          subagentType: context.subagentType,
          subagentSuccess: context.success,
          subagentError: context.error,
          subagentDuration: context.duration
        });
      }
    });
    this.errorLogger = new ErrorLogger(packageJson.version);
    this.feedbackManager = new FeedbackManager({
      apiBaseUrl: runtime.config.api?.baseUrl || 'https://api.autohand.ai',
      cliVersion: packageJson.version
    });
    this.skillsRegistry = new SkillsRegistry(AUTOHAND_PATHS.skills);
    this.telemetryManager = new TelemetryManager({
      enabled: runtime.config.telemetry?.enabled === true,
      apiBaseUrl: runtime.config.telemetry?.apiBaseUrl || 'https://api.autohand.ai',
      enableSessionSync: runtime.config.telemetry?.enableSessionSync === true
    });

    // Initialize community skills client
    const communitySettings = runtime.config.communitySkills ?? {};
    this.communityClient = new CommunitySkillsClient({
      apiBaseUrl: runtime.config.api?.baseUrl || 'https://api.autohand.ai',
      enabled: communitySettings.enabled !== false,
    });

    // Wire telemetry and community client to skills registry
    this.skillsRegistry.setTelemetryManager(this.telemetryManager);
    this.skillsRegistry.setCommunityClient(this.communityClient);

    // Initialize provider config manager for model selection and configuration
    this.providerConfigManager = new ProviderConfigManager(
      runtime,
      () => this.llm,
      (newLlm) => { this.llm = newLlm; },
      () => this.activeProvider,
      (provider) => { this.activeProvider = provider; },
      () => this.delegator,
      (newDelegator) => { this.delegator = newDelegator; },
      this.telemetryManager,
      this.actionExecutor,
      (contextWindow) => { this.contextWindow = contextWindow; },
      () => { this.contextPercentLeft = 100; },
      () => this.emitStatus()
    );

    const delegationTools: ToolDefinition[] = [
      {
        name: 'delegate_task',
        description: 'Delegate a task to a specialized sub-agent (synchronous). Use /agents to list available agents.',
        parameters: {
          type: 'object',
          properties: {
            agent_name: { type: 'string', description: 'Name of the agent to delegate to' },
            task: { type: 'string', description: 'Task description for the sub-agent' }
          },
          required: ['agent_name', 'task']
        },
        requiresApproval: false
      },
      {
        name: 'delegate_parallel',
        description: 'Run multiple sub-agents in parallel (max 5, swarm mode)',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              description: 'Array of delegation tasks',
              items: {
                type: 'object',
                properties: {
                  agent_name: { type: 'string', description: 'Name of the agent' },
                  task: { type: 'string', description: 'Task for the agent' }
                },
                required: ['agent_name', 'task']
              }
            }
          },
          required: ['tasks']
        },
        requiresApproval: false
      }
    ];

    // Determine client context - restricted mode maps to 'restricted' context
    const clientContext = runtime.options.clientContext
      ?? (runtime.options.restricted ? 'restricted' : 'cli');

    // Block ask_followup_question in command mode (--prompt flag) since it requires interactive terminal
    const customPolicy = runtime.options.prompt ? {
      blockedTools: ['ask_followup_question']
    } : undefined;

    this.toolManager = new ToolManager({
      executor: async (action, context) => {
        const startTime = Date.now();
        const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Execute pre-tool hooks
        await this.hookManager.executeHooks('pre-tool', {
          tool: action.type,
          toolCallId: toolId,
          args: action as Record<string, unknown>,
        });

        // Emit tool_start event for RPC mode
        this.emitOutput({
          type: 'tool_start',
          toolId,
          toolName: action.type,
          toolArgs: action as Record<string, unknown>,
        });

        try {
          let result: string | undefined;
          if (action.type === 'delegate_task') {
            result = await this.delegator.delegateTask(action.agent_name, action.task);
          } else if (action.type === 'delegate_parallel') {
            result = await this.delegator.delegateParallel(action.tasks);
          } else {
            result = await this.actionExecutor.execute(action, context);
          }
          // Track successful tool use
          await this.telemetryManager.trackToolUse({
            tool: action.type,
            success: true,
            duration: Date.now() - startTime
          });

          // Execute post-tool hooks (success)
          await this.hookManager.executeHooks('post-tool', {
            tool: action.type,
            toolCallId: toolId,
            args: action as Record<string, unknown>,
            success: true,
            output: result,
            duration: Date.now() - startTime,
          });

          // Emit tool_end event for RPC mode
          this.emitOutput({
            type: 'tool_end',
            toolId,
            toolName: action.type,
            toolSuccess: true,
            toolOutput: result,
          });

          return result ?? '';
        } catch (error) {
          // Track failed tool use
          await this.telemetryManager.trackToolUse({
            tool: action.type,
            success: false,
            duration: Date.now() - startTime,
            error: (error as Error).message
          });

          // Execute post-tool hooks (failure)
          await this.hookManager.executeHooks('post-tool', {
            tool: action.type,
            toolCallId: toolId,
            args: action as Record<string, unknown>,
            success: false,
            output: (error as Error).message,
            duration: Date.now() - startTime,
          });

          // Emit tool_end event with error for RPC mode
          this.emitOutput({
            type: 'tool_end',
            toolId,
            toolName: action.type,
            toolSuccess: false,
            toolOutput: (error as Error).message,
          });

          throw error;
        }
      },
      confirmApproval: (message, context) => this.confirmDangerousAction(message, context),
      definitions: [...DEFAULT_TOOL_DEFINITIONS, ...delegationTools],
      clientContext,
      customPolicy
    });

    this.sessionManager = new SessionManager();
    this.projectManager = new ProjectManager();

    // Check if Ink renderer is enabled
    this.useInkRenderer = runtime.config.ui?.useInkRenderer === true;

    // Initialize persistent input for queuing messages while agent works
    // Using silent mode to avoid conflicts with ora spinner
    this.persistentInput = createPersistentInput({
      maxQueueSize: 10,
      silentMode: true
    });

    this.persistentInput.on('queued', (text: string, count: number) => {
      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      if (this.inkRenderer) {
        this.inkRenderer.addQueuedInstruction(text);
      } else if (this.runtime.spinner) {
        const originalText = this.runtime.spinner.text;
        this.runtime.spinner.text = chalk.cyan(`✓ Queued: "${preview}" (${count} pending)`);
        setTimeout(() => {
          if (this.runtime.spinner) {
            this.runtime.spinner.text = originalText;
          }
        }, 1500);
      }
    });

    // Create context object with getter for currentSession (dynamic access)
    const sessionMgr = this.sessionManager;
    const filesMgr = this.files;
    const runtimeRef = this.runtime;
    const slashContext = {
      promptModelSelection: () => this.providerConfigManager.promptModelSelection(),
      createAgentsFile: () => this.createAgentsFile(),
      sessionManager: this.sessionManager,
      memoryManager: this.memoryManager,
      permissionManager: this.permissionManager,
      hookManager: this.hookManager,
      skillsRegistry: this.skillsRegistry,
      llm: this.llm,
      workspaceRoot: runtime.workspaceRoot,
      model: model,
      resetConversation: async () => this.resetConversationContext(),
      undoFileMutation: () => this.files.undoLast(),
      removeLastTurn: () => this.conversation.removeLastTurn(),
      // Status command context
      provider: this.activeProvider,
      config: runtime.config,
      getContextPercentLeft: () => this.contextPercentLeft,
      getTotalTokensUsed: () => this.totalTokensUsed,
      // Share command needs current session - use getter for dynamic access
      get currentSession() {
        return sessionMgr.getCurrentSession() ?? undefined;
      },
      // Add-dir command context
      fileManager: this.files,
      get additionalDirs() {
        return runtimeRef.additionalDirs ?? [];
      },
      addAdditionalDir: (dir: string) => {
        filesMgr.addAdditionalDirectory(dir);
        if (!runtimeRef.additionalDirs) {
          runtimeRef.additionalDirs = [];
        }
        if (!runtimeRef.additionalDirs.includes(dir)) {
          runtimeRef.additionalDirs.push(dir);
        }
      },
      // Context compaction toggle for /cc command
      toggleContextCompaction: () => this.toggleContextCompaction(),
      isContextCompactionEnabled: () => this.isContextCompactionEnabled(),
    };
    this.slashHandler = new SlashCommandHandler(slashContext, SLASH_COMMANDS);
  }

  // Context compaction toggle methods for /cc command
  toggleContextCompaction(): void {
    this.contextCompactionEnabled = !this.contextCompactionEnabled;
  }

  isContextCompactionEnabled(): boolean {
    return this.contextCompactionEnabled;
  }

  setContextCompaction(enabled: boolean): void {
    this.contextCompactionEnabled = enabled;
  }

  async runInteractive(): Promise<void> {
    // Initialize managers in parallel for faster startup
    await Promise.all([
      this.sessionManager.initialize(),
      this.projectManager.initialize(),
      this.memoryManager.initialize(),
      this.skillsRegistry.initialize(),
      this.hookManager.initialize(),
    ]);
    // These must run sequentially after the parallel init
    await this.skillsRegistry.setWorkspace(this.runtime.workspaceRoot);
    await this.resetConversationContext();
    this.feedbackManager.startSession();
    const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
    const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    await this.sessionManager.createSession(this.runtime.workspaceRoot, model);

    // Start telemetry session
    const session = this.sessionManager.getCurrentSession();
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

    // Ensure hook output is fully flushed before starting interactive loop
    // This prevents race conditions with prompt rendering
    process.stdout.write('');

    await this.runInteractiveLoop();
  }

  /**
   * Initialize the agent for RPC mode (no interactive loop or command mode)
   */
  async initializeForRPC(): Promise<void> {
    // Initialize managers in parallel for faster startup
    await Promise.all([
      this.sessionManager.initialize(),
      this.projectManager.initialize(),
      this.memoryManager.initialize(),
      this.skillsRegistry.initialize(),
      this.hookManager.initialize(),
    ]);
    // These must run sequentially after the parallel init
    await this.skillsRegistry.setWorkspace(this.runtime.workspaceRoot);
    await this.resetConversationContext();

    const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
    const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    await this.sessionManager.createSession(this.runtime.workspaceRoot, model);

    // Start telemetry session
    const session = this.sessionManager.getCurrentSession();
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

  async resumeSession(sessionId: string): Promise<void> {
    // Initialize session
    await this.sessionManager.initialize();
    await this.projectManager.initialize();
    await this.memoryManager.initialize();

    try {
      const session = await this.sessionManager.loadSession(sessionId);

      // Restore context
      await this.resetConversationContext();
      const messages = session.getMessages();
      for (const msg of messages) {
        if (msg.role === 'system') {
          if (!msg.content.startsWith('You are Autohand')) {
            this.conversation.addSystemNote(msg.content);
          }
        } else {
          // Convert session toolCalls format to LLMToolCall format
          // Session stores: {id, tool, args} but LLMToolCall expects {id, type, function: {name, arguments}}
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

  private async runInteractiveLoop(): Promise<void> {
    while (true) {
      try {
        let instruction: string | null = null;

        if (this.pendingInkInstructions.length > 0) {
          instruction = this.pendingInkInstructions.shift() ?? null;
          if (instruction) {
            console.log(chalk.cyan(`\n▶ Processing queued request: "${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}"`));

            const remaining = this.pendingInkInstructions.length;
            if (remaining > 0) {
              console.log(chalk.gray(`  ${remaining} more request(s) queued`));
            }
          }
        } else if (this.inkRenderer?.hasQueuedInstructions()) {
          instruction = this.inkRenderer.dequeueInstruction() ?? null;
          if (instruction) {
            console.log(chalk.cyan(`\n▶ Processing queued request: "${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}"`));

            const remaining = this.inkRenderer.getQueueCount();
            if (remaining > 0) {
              console.log(chalk.gray(`  ${remaining} more request(s) queued`));
            }
          }
        } else if (this.persistentInput.hasQueued()) {
          const queued = this.persistentInput.dequeue();
          if (queued) {
            instruction = queued.text;
            console.log(chalk.cyan(`\n▶ Processing queued request: "${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}"`));

            if (this.persistentInput.hasQueued()) {
              console.log(chalk.gray(`  ${this.persistentInput.getQueueLength()} more request(s) queued`));
            }
          }
        }

        if (!instruction) {
          instruction = await this.promptForInstruction();
        }

        if (!instruction) {
          continue;
        }

        if (instruction === '/exit' || instruction === '/quit') {
          await this.telemetryManager.trackCommand({ command: instruction });
          const trigger = this.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = this.sessionManager.getCurrentSession();
            await this.feedbackManager.promptForFeedback(trigger, session?.metadata.sessionId);
          }
          await this.closeSession();
          return;
        }

        if (instruction === 'SESSION_RESUMED') {
          continue;
        }

        const isSlashCommand = instruction.startsWith('/');
        if (isSlashCommand) {
          await this.telemetryManager.trackCommand({ command: instruction.split(' ')[0] });
        }

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
        // Hook commands with shell: true can sometimes leave stdin in unexpected state
        this.ensureStdinReady();

        // Ring terminal bell to notify user (shows badge on terminal tab)
        if (this.runtime.config.ui?.terminalBell !== false) {
          process.stdout.write('\x07');
        }

        this.feedbackManager.recordInteraction();
        this.telemetryManager.recordInteraction();

        const feedbackTrigger = this.feedbackManager.shouldPrompt({
          userMessage: instruction,
          taskCompleted: true
        });

        if (feedbackTrigger) {
          const session = this.sessionManager.getCurrentSession();
          if (feedbackTrigger === 'gratitude') {
            await this.feedbackManager.quickRating();
          } else {
            await this.feedbackManager.promptForFeedback(feedbackTrigger, session?.metadata.sessionId);
          }
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
          continue;
        }

        await this.errorLogger.log(error as Error, {
          context: 'Interactive loop',
          workspace: this.runtime.workspaceRoot
        });

        await this.telemetryManager.trackError({
          type: 'interactive_loop_error',
          message: (error as Error).message,
          stack: (error as Error).stack,
          context: 'Interactive loop'
        });

        const session = this.sessionManager.getCurrentSession();
        if (session) {
          session.metadata.status = 'crashed';
          await session.save();
        }

        // Show error to user but don't crash - continue the loop
        const errorMessage = (error as Error).message || 'Unknown error occurred';
        console.error(chalk.red('\n❌ An error occurred:'));
        console.error(chalk.red(errorMessage));
        console.error(chalk.gray(`Error logged to: ${this.errorLogger.getLogPath()}\n`));

        // Continue the loop instead of crashing
        continue;
      }
    }
  }

  private async promptForInstruction(): Promise<string | null> {
    const workspaceFiles = await this.workspaceFileCollector.collectWorkspaceFiles();
    const statusLine = this.formatStatusLine();
    const input = await readInstruction(
      workspaceFiles,
      SLASH_COMMANDS,
      statusLine,
      {}, // default IO
      (data, mimeType, filename) => this.imageManager.add(data, mimeType, filename)
    );
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

    // Check if it looks like a file path rather than a slash command
    // Slash commands are short: /help, /model, /new
    // File paths have: multiple /, /Users/, extensions like .png, .ts, etc.
    const looksLikeFilePath = (text: string): boolean => {
      // Has multiple path separators (e.g., /Users/foo/bar)
      if ((text.match(/\//g) || []).length > 1) return true;
      // Starts with common path prefixes
      if (/^\/(?:Users|home|tmp|var|opt|etc|usr)\//i.test(text)) return true;
      // Has a file extension
      if (/\.[a-z0-9]{1,5}(?:\s|$)/i.test(text)) return true;
      return false;
    };

    if (normalized.startsWith('/') && !looksLikeFilePath(normalized)) {
      // Parse command and arguments from input
      const parts = normalized.split(/\s+/);
      let command = parts[0];
      let args = parts.slice(1);

      // Handle multi-word commands like "/skills new", "/agents new"
      const twoWordCommands = ['/skills new', '/agents new'];
      const potentialTwoWord = `${parts[0]} ${parts[1] || ''}`.trim();
      if (twoWordCommands.includes(potentialTwoWord)) {
        command = potentialTwoWord;
        args = parts.slice(2);
      }

      const handled = await this.slashHandler.handle(command, args);
      if (handled === null) {
        return null;
      }
      normalized = handled;
    }

    // Handle # trigger for storing memories
    if (normalized.startsWith('#')) {
      await this.handleMemoryStore(normalized.slice(1).trim());
      return null;
    }

    if (normalized) {
      normalized = await this.resolveMentions(normalized);
      return normalized;
    }
    return null;
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
    // Too long = likely complex request
    if (instruction.length > 200) return false;

    // File mentions = needs context
    if (instruction.includes('@')) return false;

    // Slash commands = special handling
    if (instruction.startsWith('/')) return false;

    // Keywords that suggest tool usage
    const toolKeywords = /\b(file|create|edit|delete|run|fix|implement|refactor|build|test|install|commit|push|read|write|search|find|list|show me|update|add|remove|change|modify|rename|copy|move|execute|deploy|check|analyze|review|debug|inspect|explore|look at|open|save)\b/i;
    if (toolKeywords.test(instruction)) return false;

    return true;
  }

  /**
   * Handle simple chat without spinner/tools (fast path)
   */
  private async handleSimpleChat(instruction: string): Promise<boolean> {
    this.isInstructionActive = true;

    try {
      // Add user message to conversation
      this.conversation.addMessage({ role: 'user', content: instruction });
      await this.saveUserMessage(instruction);

      // Quick LLM call - no tools, no spinner
      const completion = await this.llm.complete({
        messages: this.conversation.history(),
        tools: [],  // No tools for chat
        maxTokens: 1000,
        temperature: 0.7
      });

      // Parse the response (LLM returns JSON format)
      const payload = this.parseAssistantResponse(completion);
      const rawContent = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      const content = this.cleanupModelResponse(rawContent);
      console.log(content);

      // Add to conversation and save
      this.conversation.addMessage({ role: 'assistant', content: completion.content });
      await this.saveAssistantMessage(completion.content);

      // Track token usage
      if (completion.usage) {
        this.totalTokensUsed = completion.usage.totalTokens;
      }

      this.updateContextUsage(this.conversation.history());
      return true;
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      return false;
    } finally {
      this.isInstructionActive = false;
    }
  }

  async runInstruction(instruction: string): Promise<boolean> {
    this.isInstructionActive = true;
    this.clearExplorationLog();
    this.filesModifiedThisSession = false;

    // Initialize task-level tracking
    this.taskStartedAt = Date.now();
    this.totalTokensUsed = 0;

    // Detect user intent (diagnostic vs implementation)
    const intentResult = this.intentDetector.detect(instruction);
    this.lastIntent = intentResult.intent;

    // Display mode indicator
    this.displayIntentMode(intentResult);

    // Run environment bootstrap for implementation mode
    if (intentResult.intent === 'implementation') {
      const bootstrapResult = await this.runEnvironmentBootstrap();
      if (!bootstrapResult.success) {
        console.log(chalk.red('\n[BLOCKED] Environment setup failed. Fix issues before proceeding.'));
        this.isInstructionActive = false;
        return false;
      }
    }

    const abortController = new AbortController();
    let canceledByUser = false;
    let success = true;

    // Initialize UI (InkRenderer or ora spinner)
    // Pass abort controller for InkRenderer to handle ESC/Ctrl+C
    await this.initializeUI(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        this.stopStatusUpdates();
        this.stopUI();
        console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
      }
    });

    // Only setup ESC listener for non-Ink mode (Ink handles its own input)
    const cleanupEsc = this.useInkRenderer
      ? () => {} // No-op, Ink handles input
      : this.setupEscListener(abortController, () => {
          if (!canceledByUser) {
            canceledByUser = true;
            this.stopStatusUpdates();
            this.stopUI();
            console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
          }
        }, true);
    const stopPreparation = this.startPreparationStatus(instruction);
    try {
      const userMessage = await this.buildUserMessage(instruction);
      stopPreparation();
      this.setUIStatus('Reasoning with the AI (ReAct loop)...');
      this.conversation.addMessage({ role: 'user', content: userMessage });

      // Save user message to session
      await this.saveUserMessage(instruction);

      this.updateContextUsage(this.conversation.history());
      await this.runReactLoop(abortController);

      // Run quality pipeline after file modifications in implementation mode
      if (this.lastIntent === 'implementation' && this.filesModifiedThisSession) {
        await this.runQualityPipeline();
      }
    } catch (error) {
      success = false;
      if (abortController.signal.aborted) {
        return false;
      }

      // Handle unconfigured provider by prompting for configuration
      if (error instanceof ProviderNotConfiguredError) {
        this.cleanupUI();
        console.log(chalk.yellow(`\nNo provider is configured yet. Let's set one up!\n`));
        await this.providerConfigManager.promptModelSelection();
        // After configuration, retry the instruction
        return this.runInstruction(instruction);
      }

      // Session failure retry logic
      const err = error instanceof Error ? error : new Error(String(error));
      const maxRetries = this.runtime.config.agent?.sessionRetryLimit ?? 3;
      const baseDelay = this.runtime.config.agent?.sessionRetryDelay ?? 1000;

      if (this.isRetryableSessionError(err) && this.sessionRetryCount < maxRetries) {
        this.sessionRetryCount++;

        // Submit bug report to telemetry
        await this.submitSessionFailureBugReport(err, this.sessionRetryCount, maxRetries);

        // Show retry message to user
        console.log(chalk.yellow(`\n⚠ Session encountered an error: ${err.message}`));
        console.log(chalk.cyan(`  Attempting recovery (${this.sessionRetryCount}/${maxRetries})...`));

        // Wait with exponential backoff (1.5x multiplier)
        const delay = baseDelay * Math.pow(1.5, this.sessionRetryCount - 1);
        await this.sleep(delay);

        // Inject continuation message into conversation
        this.injectContinuationMessage(err, this.sessionRetryCount);

        // Retry the ReAct loop
        try {
          this.setUIStatus('Recovering session...');
          await this.runReactLoop(abortController);

          // If we get here, retry succeeded - reset counter
          this.sessionRetryCount = 0;
          success = true;
          return success;
        } catch (retryError) {
          // Retry failed, will be caught by outer logic on next iteration
          // or fall through to final failure if max retries exceeded
          if (this.sessionRetryCount >= maxRetries) {
            // Max retries exceeded, fall through to failure
            this.sessionRetryCount = 0;
          } else {
            // Re-throw to trigger another retry attempt
            throw retryError;
          }
        }
      }

      // Reset retry counter on non-retryable errors or max retries exceeded
      this.sessionRetryCount = 0;

      this.stopUI(true, 'Session failed');
      // Emit error for RPC mode
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emitOutput({ type: 'error', content: errorMessage });
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      } else {
        console.error(error);
      }
    } finally {
      cleanupEsc();
      stopPreparation();
      this.stopStatusUpdates();
      this.cleanupUI();

      // Show completion summary (skip if using Ink - it handles this via completionStats)
      if (this.taskStartedAt && !canceledByUser && !this.useInkRenderer) {
        const elapsed = formatElapsedTime(this.taskStartedAt);
        const tokens = formatTokens(this.totalTokensUsed);
        // Count queued instructions from all sources
        const queueCount = this.pendingInkInstructions.length +
          (this.inkRenderer?.getQueueCount() ?? 0) +
          this.persistentInput.getQueueLength();
        const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';
        console.log(chalk.gray(`\nCompleted in ${elapsed} · ${tokens} used${queueStatus}`));
      }

      // Accumulate session tokens before resetting task
      this.sessionTokensUsed += this.totalTokensUsed;

      this.taskStartedAt = null;
      this.isInstructionActive = false;
      this.clearExplorationLog();
    }
    return success;
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

  private async closeSession(): Promise<void> {
    // Clean up persistent input
    this.persistentInput.dispose();

    const session = this.sessionManager.getCurrentSession();

    // Fire session-end hook
    const sessionDuration = Date.now() - this.sessionStartedAt;
    await this.hookManager.executeHooks('session-end', {
      sessionId: session?.metadata.sessionId,
      sessionEndReason: 'quit',
      duration: sessionDuration,
    });
    if (!session) {
      console.log(chalk.gray('Ending Autohand session.'));
      await this.telemetryManager.shutdown();
      return;
    }

    // Generate summary from last few messages
    const messages = session.getMessages();
    const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
    const summary = lastUserMsg?.content.slice(0, 60) || 'Session complete';

    // Sync session to cloud before closing
    const syncResult = await this.telemetryManager.syncSession({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      })),
      metadata: {
        workspaceRoot: this.runtime.workspaceRoot
      }
    });

    // End telemetry session
    await this.telemetryManager.endSession('completed');
    await this.telemetryManager.shutdown();

    await this.sessionManager.closeSession(summary);

    console.log(chalk.gray('\nEnding Autohand session.\n'));
    console.log(chalk.cyan(`💾 Session saved: ${session.metadata.sessionId}`));
    if (syncResult.success) {
      console.log(chalk.gray(`   Synced to cloud: ${syncResult.id}`));
    }
    console.log(chalk.gray(`   Resume with: autohand resume ${session.metadata.sessionId}\n`));
  }

  private async runReactLoop(abortController: AbortController): Promise<void> {
    const debugMode = this.runtime.config.agent?.debug === true || process.env.AUTOHAND_DEBUG === '1';
    if (debugMode) process.stderr.write(`[AGENT DEBUG] runReactLoop started\n`);

    // Check if we're executing an accepted plan - bypass iteration limit
    const planModeManager = getPlanModeManager();
    const isExecutingPlan = planModeManager.isEnabled() && planModeManager.getPhase() === 'executing';

    // For plan execution, use effectively unlimited iterations (user accepted the plan)
    // Otherwise use configurable limit (default 100)
    const maxIterations = isExecutingPlan
      ? 1000
      : (this.runtime.config.agent?.maxIterations ?? 100);

    // Get all function definitions for native tool calling
    const allTools = this.toolManager.toFunctionDefinitions();
    if (debugMode) process.stderr.write(`[AGENT DEBUG] Loaded ${allTools.length} tools, maxIterations=${maxIterations}\n`);

    // Start status updates for the main loop
    this.startStatusUpdates();

    // Check if thinking should be shown
    const showThinking = this.runtime.config.ui?.showThinking !== false;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      // Check for abort at the start of each iteration
      if (abortController.signal.aborted) {
        if (debugMode) process.stderr.write('[AGENT DEBUG] Abort detected at loop start, breaking\n');
        break;
      }

      // Filter tools by relevance to reduce token overhead
      const messages = this.conversation.history();
      let tools = filterToolsByRelevance(allTools, messages);

      // Filter tools for plan mode (read-only tools only during planning phase)
      const planModeManager = getPlanModeManager();
      if (planModeManager.isEnabled() && planModeManager.getPhase() === 'planning') {
        const readOnlyTools = new Set(planModeManager.getReadOnlyTools());
        tools = tools.filter(t => readOnlyTools.has(t.name));
        if (debugMode) {
          process.stderr.write(`[AGENT DEBUG] Plan mode active: filtered to ${tools.length} read-only tools\n`);
        }
      }

      // Use ContextManager for smart auto-compaction when enabled
      const model = this.runtime.options.model ?? getProviderConfig(this.runtime.config, this.activeProvider)?.model ?? 'unconfigured';

      if (this.contextCompactionEnabled) {
        // Use tiered context management (70% compress, 80% summarize, 90%+ crop)
        this.contextManager.setModel(model);
        const prepared = this.contextManager.prepareRequest(tools);

        if (prepared.wasCropped) {
          this.runtime.spinner?.stop();
          console.log(chalk.cyan(`ℹ Auto-compacted ${prepared.croppedCount} messages`));
          if (prepared.summary) {
            console.log(chalk.gray(`   Summary preserved in context`));
          }
        }

        this.updateContextUsage(prepared.messages, tools);
      } else {
        // Manual context management (legacy behavior when compaction disabled)
        const contextUsage = calculateContextUsage(messages, tools, model);

        // Auto-crop if at critical threshold (90%+)
        if (contextUsage.isCritical) {
          this.runtime.spinner?.stop();
          console.log(chalk.yellow('\n⚠ Context at critical level, auto-cropping old messages...'));

          // Target 70% usage after cropping
          const targetTokens = Math.floor(contextUsage.contextWindow * 0.7);
          const tokensToRemove = contextUsage.totalTokens - targetTokens;
          const avgMessageTokens = 200; // Rough estimate
          const messagesToRemove = Math.ceil(tokensToRemove / avgMessageTokens);

          const removed = this.conversation.cropHistory('top', messagesToRemove);
          if (removed.length > 0) {
            // Generate a summary of what was removed
            const summary = this.summarizeRemovedMessages(removed);
            this.conversation.addSystemNote(
              `[Context Management] ${removed.length} older messages were summarized to maintain context limits.\n` +
              `Summary of removed content:\n${summary}`
            );
            console.log(chalk.gray(`   Removed ${removed.length} messages to free up context space`));
            console.log(chalk.gray(`   Summary preserved in context`));
          }
          this.updateContextUsage(this.conversation.history(), tools);
        } else if (contextUsage.isWarning && iteration === 0) {
          // Only warn once per user turn (iteration 0)
          console.log(chalk.yellow(`\n⚠ Context at ${Math.round(contextUsage.usagePercent * 100)}% - approaching limit`));
        }
      }

      // Show iteration progress for long-running tasks (every 10 steps after step 10)
      if (iteration >= 10 && iteration % 10 === 0) {
        this.runtime.spinner?.start(`Working... (step ${iteration + 1})`);
      } else {
        this.runtime.spinner?.start('Working ...');
      }
      // Get messages with images included for multimodal support
      const messagesWithImages = this.getMessagesWithImages();

      if (debugMode) process.stderr.write(`[AGENT DEBUG] Calling LLM with ${messagesWithImages.length} messages, ${tools.length} tools\n`);

      let completion;
      try {
        // Get thinking level from env var (set by ACP extensions like Zed)
        const thinkingLevel = (process.env.AUTOHAND_THINKING_LEVEL as 'none' | 'normal' | 'extended') || 'normal';

        completion = await this.llm.complete({
          messages: messagesWithImages,
          temperature: this.runtime.options.temperature ?? 0.2,
          model: this.runtime.options.model,
          signal: abortController.signal,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          maxTokens: 16000,  // Allow large outputs for file generation
          thinkingLevel,
        });
        if (debugMode) process.stderr.write(`[AGENT DEBUG] LLM returned: content length=${completion.content?.length ?? 0}, toolCalls=${completion.toolCalls?.length ?? 0}\n`);
      } catch (llmError) {
        const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
        const errStack = llmError instanceof Error ? llmError.stack : '';
        if (debugMode) process.stderr.write(`[AGENT DEBUG] LLM ERROR: ${errMsg}\n`);
        if (debugMode) process.stderr.write(`[AGENT DEBUG] LLM STACK: ${errStack}\n`);
        throw llmError;
      }

      // Track token usage from response and immediately update UI
      if (completion.usage) {
        this.totalTokensUsed += completion.usage.totalTokens;
        // Immediately render updated token count
        this.forceRenderSpinner();
      }

      const payload = this.parseAssistantResponse(completion);
      if (debugMode) process.stderr.write(`[AGENT DEBUG] Parsed payload: finalResponse=${!!payload.finalResponse}, thought=${!!payload.thought}, toolCalls=${payload.toolCalls?.length ?? 0}\n`);
      const assistantMessage: LLMMessage = { role: 'assistant', content: completion.content };
      if (completion.toolCalls?.length) {
        assistantMessage.tool_calls = completion.toolCalls;
      }
      this.conversation.addMessage(assistantMessage);
      await this.saveAssistantMessage(completion.content, payload.toolCalls);
      this.updateContextUsage(this.conversation.history(), tools);

      // Debug: show what the model returned (helps diagnose response issues)
      if (debugMode) {
        console.log(chalk.yellow(`\n[DEBUG] Iteration ${iteration}:`));
        console.log(chalk.yellow(`  - toolCalls: ${payload.toolCalls?.length ?? 0}`));
        console.log(chalk.yellow(`  - thought: ${payload.thought?.slice(0, 100) || '(none)'}`));
        console.log(chalk.yellow(`  - finalResponse: ${payload.finalResponse?.slice(0, 100) || '(none)'}`));
        console.log(chalk.yellow(`  - raw content: ${completion.content?.slice(0, 200) || '(empty)'}`));
      }

      // Show what the LLM is doing for visibility
      const toolCount = payload.toolCalls?.length ?? 0;
      // Response could come from finalResponse, response, or thought (when no tool calls)
      const hasResponse = Boolean(payload.finalResponse || payload.response || (!toolCount && payload.thought));
      const thoughtPreview = payload.thought?.slice(0, 80) || '';

      if (this.inkRenderer) {
        if (toolCount > 0) {
          const toolNames = payload.toolCalls!.map(t => t.tool).join(', ');
          this.inkRenderer.setStatus(`Calling: ${toolNames}`);
        } else if (hasResponse) {
          this.inkRenderer.setStatus('Responding...');
        } else if (thoughtPreview) {
          this.inkRenderer.setStatus(`Thinking: ${thoughtPreview}...`);
        }
      } else {
        // Console mode: show iteration status
        if (iteration > 0) {
          const status = toolCount > 0
            ? `→ Step ${iteration + 1}: calling ${toolCount} tool(s)`
            : hasResponse
              ? `→ Step ${iteration + 1}: preparing response`
              : `→ Step ${iteration + 1}: thinking...`;
          console.log(chalk.gray(status));
        }
      }

      if (payload.toolCalls && payload.toolCalls.length > 0) {
        const cropCalls = payload.toolCalls.filter((call) => call.tool === 'smart_context_cropper');
        const otherCalls = payload.toolCalls.filter((call) => call.tool !== 'smart_context_cropper');

        // Collect all output lines for a single batch write
        const outputLines: string[] = [];

        // Extract thought for display (skip raw JSON)
        const thought = showThinking && payload.thought && !payload.thought.trim().startsWith('{')
          ? payload.thought
          : undefined;

        // Handle smart_context_cropper calls (add to conversation + collect output)
        if (cropCalls.length) {
          for (const call of cropCalls) {
            const content = await this.handleSmartContextCrop(call);
            this.conversation.addMessage({
              role: 'tool',
              name: 'smart_context_cropper',
              content,
              tool_call_id: call.id
            });
            await this.saveToolMessage('smart_context_cropper', content, call.id);
            this.updateContextUsage(this.conversation.history(), tools);
            outputLines.push(`${chalk.cyan('✂ smart_context_cropper')}`);
            outputLines.push(chalk.gray(content));
            outputLines.push('');
          }
        }

        // Execute other tools
        let results: Array<{ tool: AgentAction['type']; success: boolean; output?: string; error?: string }> = [];
        if (otherCalls.length) {
          // Execute all tools (spinner stays running during execution)
          results = await this.toolManager.execute(otherCalls);

          // Add tool messages to conversation first (no output yet)
          for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const content = result.success
              ? result.output ?? '(no output)'
              : result.error ?? result.output ?? 'Tool failed without error message';
            this.conversation.addMessage({
              role: 'tool',
              name: result.tool,
              content,
              tool_call_id: otherCalls[i]?.id
            });
            await this.saveToolMessage(result.tool, content, otherCalls[i]?.id);
          }
          this.updateContextUsage(this.conversation.history(), tools);

          // Add batched tool output (with thought shown before tools)
          const charLimit = this.runtime.config.ui?.readFileCharLimit ?? 300;
          outputLines.push(formatToolResultsBatch(results, charLimit, otherCalls, thought));
        }

        // Output tool results
        if (this.inkRenderer) {
          // InkRenderer: add tool outputs to the UI with thought
          const thought = showThinking && payload.thought && !payload.thought.trim().startsWith('{')
            ? payload.thought
            : undefined;

          if (results.length > 0) {
            const charLimit = this.runtime.config.ui?.readFileCharLimit ?? 300;
            this.addUIToolOutputs(results.map((r, i) => {
              // Extract args from tool call
              const call = otherCalls[i];
              const filePath = call?.args?.path as string | undefined;
              const command = call?.args?.command as string | undefined;
              const commandArgs = call?.args?.args as string[] | undefined;
              return {
                tool: r.tool,
                success: r.success,
                output: r.success
                  ? formatToolOutputForDisplay({ tool: r.tool, content: r.output ?? '', charLimit, filePath, command, commandArgs }).output
                  : r.error ?? r.output ?? 'Tool failed',
                thought // Pass thought to be displayed before tool
              };
            }));
          }
        } else {
          // Ora mode: stop spinner, batch output, continue
          this.runtime.spinner?.stop();
          if (outputLines.length > 0) {
            console.log('\n' + outputLines.join('\n'));
          }
        }

        // Record success/failure for each tool (async, non-blocking display)
        if (results.length > 0) {
          const sessionId = this.sessionManager.getCurrentSession()?.metadata.sessionId || 'unknown';
          for (const result of results) {
            if (result.success) {
              await this.projectManager.recordSuccess(this.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId,
                tool: result.tool,
                context: 'Tool execution',
                tags: [result.tool]
              });
            } else {
              await this.projectManager.recordFailure(this.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId,
                tool: result.tool,
                error: result.error || 'Unknown error',
                context: 'Tool execution',
                tags: [result.tool]
              });
            }
          }
        }

        // After tool execution, add a hint to encourage the model to respond
        // This helps models that might get stuck in tool-calling loops
        if (iteration > 0 && results.length > 0 && results.every(r => r.success)) {
          // Only add hint if we've been calling tools for a while without a response
          const recentMessages = this.conversation.history().slice(-6);
          const toolResultCount = recentMessages.filter(m => m.role === 'tool').length;
          if (toolResultCount >= 2) {
            this.conversation.addSystemNote(
              '[Reminder] Tool execution complete. Please analyze the results and provide your response to the user\'s original question. Do not call more tools unless absolutely necessary.'
            );
          }
        }

        // Search-specific throttling to prevent excessive sequential searches
        const searchTools = ['search', 'search_with_context', 'semantic_search'];
        const searchCallsThisIteration = otherCalls.filter(call => searchTools.includes(call.tool));

        // Track search queries for this iteration
        for (const call of searchCallsThisIteration) {
          const query = String(call.args?.query || call.args?.pattern || 'unknown');
          this.searchQueries.push(query);
        }

        // Add search limit warning if too many searches in one iteration
        if (searchCallsThisIteration.length >= 3) {
          this.conversation.addSystemNote(
            '[Search Limit] You have made 3+ searches this iteration. Please analyze the search results before searching again. Consider combining patterns (e.g., `pattern1|pattern2`) if you need more information.'
          );
        }

        // Add search history summary if accumulated too many searches
        if (this.searchQueries.length > 5) {
          const recentSearches = this.searchQueries.slice(-5).map(q => `"${q}"`).join(', ');
          this.conversation.addSystemNote(
            `[Search Summary] Recent searches: ${recentSearches}. Avoid repeating similar searches - analyze existing results first.`
          );
        }

        // Check for abort after tool execution before continuing
        if (abortController.signal.aborted) {
          if (debugMode) process.stderr.write('[AGENT DEBUG] Abort detected after tools, breaking\n');
          break;
        }

        continue;
      }

      // CRITICAL: Detect when model says it will act but didn't include tool calls
      // This catches the common failure mode: "Let me now update X..." with empty toolCalls
      const pendingResponse = payload.finalResponse || payload.response || '';
      if (this.expressesIntentToAct(pendingResponse) && !payload.toolCalls?.length) {
        // Model said it will do something but didn't call the tool - force it to actually act
        const intentRetryKey = '__intentRetryCount';
        const intentRetries = ((this as any)[intentRetryKey] ?? 0) + 1;
        (this as any)[intentRetryKey] = intentRetries;

        if (intentRetries < 3) {
          this.conversation.addSystemNote(
            `[System] ERROR: You said "${pendingResponse.slice(0, 100)}..." but did NOT include any tool calls. ` +
            `You MUST include the actual tool call in toolCalls array. ` +
            `Do NOT say "let me update X" - actually call write_file/search_replace/apply_patch with the changes. ` +
            `Try again with the actual tool call.`
          );
          continue; // Force another iteration
        }
        // After 3 retries, fall through and show the response (better than infinite loop)
        (this as any)[intentRetryKey] = 0;
      } else {
        // Reset counter on successful response
        (this as any).__intentRetryCount = 0;
      }

      this.stopStatusUpdates();

      // Extract the response - prioritize explicit response fields, but use thought as fallback
      // when there are no tool calls (model might provide analysis in thought without finalResponse)
      let rawResponse: string;
      const usedThoughtAsResponse = Boolean(payload.thought) &&
        !payload.finalResponse &&
        !payload.response &&
        !payload.toolCalls?.length;
      if (payload.finalResponse) {
        rawResponse = payload.finalResponse;
      } else if (payload.response) {
        rawResponse = payload.response;
      } else if (!payload.toolCalls?.length && payload.thought) {
        // No tool calls and no explicit response, but has thought - use thought as the response
        rawResponse = payload.thought;
      } else {
        // Last resort: try to extract something useful from raw content
        const cleanedContent = this.cleanupModelResponse(completion.content);
        // If cleaned content looks like JSON, it's not a real response
        rawResponse = cleanedContent.startsWith('{') ? '' : cleanedContent;
      }
      let response = this.cleanupModelResponse(rawResponse.trim());
      if (!response && usedThoughtAsResponse && payload.thought) {
        response = payload.thought.trim();
      }

      // If response is empty and we've done work (iteration > 0), try to get a proper response
      // But limit retries to prevent infinite loops
      if (!response && iteration > 0) {
        // Track consecutive empty responses to prevent infinite loops
        const consecutiveEmptyKey = '__consecutiveEmpty';
        const consecutiveEmpty = ((this as any)[consecutiveEmptyKey] ?? 0) + 1;
        (this as any)[consecutiveEmptyKey] = consecutiveEmpty;

        if (consecutiveEmpty >= 3) {
          // After 3 retries, force a fallback and break out
          if (debugMode) process.stderr.write(`[AGENT DEBUG] Exiting after 3 consecutive empty responses\n`);
          console.log(chalk.yellow('\n⚠ Model not providing response after multiple attempts. Showing available context.'));
          const fallback = payload.thought || 'The model did not provide a clear response. Please try rephrasing your question.';
          if (this.inkRenderer) {
            this.inkRenderer.setWorking(false);
            this.inkRenderer.setFinalResponse(fallback);
          } else {
            this.runtime.spinner?.stop();
            console.log(fallback);
          }
          (this as any)[consecutiveEmptyKey] = 0;
          // Emit fallback for RPC mode
          this.emitOutput({ type: 'message', content: fallback });
          return;
        }

        this.conversation.addSystemNote(
          `[System] IMPORTANT: You must now provide your finalResponse. The user is waiting for your analysis. Do not call any more tools - just provide your answer in the finalResponse field.`
        );
        continue;
      }

      // Reset consecutive empty counter on success
      (this as any).__consecutiveEmpty = 0;

      // Emit output event for RPC mode
      const suppressThinking = usedThoughtAsResponse && response.length > 0;
      if (payload.thought && !suppressThinking) {
        this.emitOutput({ type: 'thinking', thought: payload.thought });
      }
      this.emitOutput({ type: 'message', content: response });

      if (this.inkRenderer) {
        // InkRenderer: set final response
        if (showThinking && payload.thought && !suppressThinking) {
          this.inkRenderer.setThinking(payload.thought);
        }
        // Update final stats before stopping (session totals for completionStats)
        this.inkRenderer.setElapsed(formatElapsedTime(this.sessionStartedAt));
        this.inkRenderer.setTokens(formatTokens(this.sessionTokensUsed + this.totalTokensUsed));
        this.inkRenderer.setWorking(false);
        this.inkRenderer.setFinalResponse(response);
      } else {
        // Ora mode: stop spinner and output
        this.runtime.spinner?.stop();
        if (showThinking && payload.thought && !suppressThinking && !payload.thought.trim().startsWith('{')) {
          console.log(chalk.gray(`Thinking: ${payload.thought}`));
          console.log();
        }
        console.log(response);
      }
      return;
    }
    this.stopStatusUpdates();
    this.runtime.spinner?.stop();
    console.log(chalk.yellow(`\n⚠ Task exceeded ${maxIterations} tool iterations without completing.`));
    console.log(chalk.gray('This usually means the task is too complex for a single turn.'));
    console.log(chalk.gray('Try breaking it into smaller steps or use /new to start fresh.'));
    throw new Error(`Reached maximum iterations (${maxIterations}) while processing. Try a simpler request or break the task into smaller steps.`);
  }

  /**
   * Parse LLM response, preferring native tool calls over JSON parsing.
   * This enables reliable function calling when providers support it,
   * while falling back to JSON parsing for providers without native support.
   */
  private parseAssistantResponse(completion: LLMResponse): AssistantReactPayload {
    if (completion.toolCalls?.length) {
      // When using native tool calls, content might be JSON or plain text
      // Try to extract thought from JSON, otherwise use content as-is
      let thought: string | undefined;
      if (completion.content) {
        const trimmed = completion.content.trim();
        if (trimmed.startsWith('{')) {
          // Try to parse JSON and extract thought field
          try {
            const parsed = JSON.parse(trimmed);
            thought = typeof parsed.thought === 'string' ? parsed.thought : undefined;
          } catch {
            // Not valid JSON, use as plain text (but clean it)
            thought = this.cleanupModelResponse(trimmed) || undefined;
          }
        } else {
          // Plain text content
          thought = trimmed || undefined;
        }
      }
      return {
        thought,
        toolCalls: completion.toolCalls.map(tc => {
          const rawArgs = tc.function.arguments;
          return {
            id: tc.id,
            tool: tc.function.name as AgentAction['type'],
            args: this.safeParseToolArgs(rawArgs)
          };
        })
      };
    }
    return this.parseAssistantReactPayload(completion.content);
  }

  /**
   * Safely parse tool arguments from JSON string
   */
  private safeParseToolArgs(json: string): ToolCallRequest['args'] {
    if (!json || typeof json !== 'string') {
      console.error(chalk.yellow('⚠ Tool arguments empty or not a string'));
      return undefined;
    }

    try {
      const parsed = JSON.parse(json);
      // Return the parsed object if it's valid, otherwise undefined
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
      console.error(chalk.yellow(`⚠ Tool arguments parsed but not an object: ${typeof parsed}`));
      return undefined;
    } catch (err) {
      // Log the error with the raw JSON for debugging
      console.error(chalk.yellow(`⚠ Failed to parse tool arguments: ${err instanceof Error ? err.message : String(err)}`));
      console.error(chalk.gray(`  Raw JSON: ${json.slice(0, 200)}${json.length > 200 ? '...' : ''}`));
      return undefined;
    }
  }

  private parseAssistantReactPayload(raw: string): AssistantReactPayload {
    const jsonBlock = this.extractJson(raw);
    if (!jsonBlock) {
      return { finalResponse: raw.trim() };
    }
    try {
      const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;

      // Check if this looks like our expected structured format
      const hasExpectedFields =
        'thought' in parsed ||
        'toolCalls' in parsed ||
        'finalResponse' in parsed ||
        'response' in parsed;

      if (hasExpectedFields) {
        // Standard structured response format
        return {
          thought: typeof parsed.thought === 'string' ? parsed.thought : undefined,
          toolCalls: this.normalizeToolCalls(parsed.toolCalls),
          finalResponse:
            (typeof parsed.finalResponse === 'string' ? parsed.finalResponse : undefined) ??
            (typeof parsed.response === 'string' ? parsed.response : undefined),
          response: typeof parsed.response === 'string' ? parsed.response : undefined
        };
      }

      // Handle non-standard JSON formats from various models
      // Look for common content fields that models might use
      const contentValue = this.extractContentFromUnstructuredJson(parsed);
      if (contentValue) {
        return { finalResponse: contentValue };
      }

      // If JSON doesn't match any known format, treat original raw as plain text
      return { finalResponse: raw.trim() };
    } catch {
      // JSON parsing failed - try to extract thought from malformed JSON using regex
      const thoughtMatch = raw.match(/"thought"\s*:\s*"([^"]+)"/);
      if (thoughtMatch?.[1]) {
        return { thought: thoughtMatch[1], finalResponse: thoughtMatch[1] };
      }
      // If it looks like JSON but we can't parse it, return empty to trigger retry
      if (raw.trim().startsWith('{')) {
        return {};
      }
      return { finalResponse: raw.trim() };
    }
  }

  /**
   * Extracts content from non-standard JSON response formats.
   * Different models may return content in various fields like:
   * - { "content": "..." }
   * - { "text": "..." }
   * - { "message": "..." }
   * - { "answer": "..." }
   * - { "output": "..." }
   * - { "type": "chat", "content": "..." }
   */
  private extractContentFromUnstructuredJson(parsed: Record<string, unknown>): string | undefined {
    // Priority order for common content field names
    const contentFields = ['content', 'text', 'message', 'answer', 'output', 'result', 'reply'];

    for (const field of contentFields) {
      const value = parsed[field];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    // Check for nested message structures like { message: { content: "..." } }
    if (parsed.message && typeof parsed.message === 'object') {
      const msg = parsed.message as Record<string, unknown>;
      if (typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content.trim();
      }
    }

    // Check for choices array format (OpenAI-like responses that slip through)
    if (Array.isArray(parsed.choices) && parsed.choices.length > 0) {
      const choice = parsed.choices[0] as Record<string, unknown>;
      if (choice.message && typeof choice.message === 'object') {
        const msg = choice.message as Record<string, unknown>;
        if (typeof msg.content === 'string' && msg.content.trim()) {
          return msg.content.trim();
        }
      }
      if (typeof choice.text === 'string' && choice.text.trim()) {
        return choice.text.trim();
      }
    }

    return undefined;
  }

  private normalizeToolCalls(value: unknown): ToolCallRequest[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => this.toToolCall(entry))
      .filter((call): call is ToolCallRequest => Boolean(call));
  }

  private toToolCall(entry: any): ToolCallRequest | null {
    if (!entry || typeof entry.tool !== 'string') {
      return null;
    }

    // Get args from entry.args if it exists and is an object
    let args = entry.args && typeof entry.args === 'object' ? entry.args : undefined;

    // Fallback: if args is undefined, check if tool arguments are at the top level
    // This handles cases where the LLM formats as: {"tool": "write_file", "path": "...", "contents": "..."}
    // instead of: {"tool": "write_file", "args": {"path": "...", "contents": "..."}}
    if (!args) {
      const topLevelArgs: Record<string, unknown> = {};
      const reservedKeys = ['tool', 'id', 'args'];

      for (const [key, value] of Object.entries(entry)) {
        if (!reservedKeys.includes(key) && value !== undefined) {
          topLevelArgs[key] = value;
        }
      }

      if (Object.keys(topLevelArgs).length > 0) {
        args = topLevelArgs;
      }
    }

    return {
      id: typeof entry.id === 'string' ? entry.id : randomUUID(),
      tool: entry.tool as AgentAction['type'],
      args
    };
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
      if (!approved) {
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

    const mentionContext = this.flushMentionContexts();
    if (mentionContext) {
      if (mentionContext.files.length) {
        this.recordExploration({ kind: 'read', target: mentionContext.files.join(', ') });
      }
      userPromptParts.push(`Mentioned files context:\n${mentionContext.block}`);
    }

    return userPromptParts.join('\n\n');
  }

  private async buildSystemPrompt(): Promise<string> {
    // Check for custom system prompt replacement (--sys-prompt)
    if (this.runtime.options.sysPrompt) {
      try {
        const customPrompt = await resolvePromptValue(this.runtime.options.sysPrompt, {
          cwd: this.runtime.workspaceRoot,
        });
        // Custom prompt completely replaces the default - no memories, AGENTS.md, or skills
        return customPrompt;
      } catch (error) {
        if (error instanceof SysPromptError) {
          console.error(chalk.red(`Error loading custom system prompt: ${error.message}`));
          throw error;
        }
        throw error;
      }
    }

    const toolDefs = this.toolManager?.listDefinitions() ?? [];
    const toolSignatures = toolDefs.map(def => formatToolSignature(def)).join('\n');

    const memories = await this.memoryManager.getContextMemories();
    const instructions = await this.loadInstructionFiles();

    const authUser = this.runtime.config.auth?.user;

    const parts: string[] = [
      // ═══════════════════════════════════════════════════════════════════
      // 1. IDENTITY & CORE STANDARDS
      // ═══════════════════════════════════════════════════════════════════
      'You are Autohand, an expert AI software engineer built for the command line.',
      'You are the best engineer in the world. You write code that is clean, efficient, maintainable, and easy to understand.',
      'You are a master of your craft and can solve any problem with precision and elegance.',
      'Your goal: Gather necessary information, clarify uncertainties, and decisively execute. Never stop until the task is fully complete.',
      '',
      ...(authUser ? [
        '## Current User',
        `You are working with ${authUser.name || authUser.email}.`,
        ''
      ] : []),

      // ═══════════════════════════════════════════════════════════════════
      // 2. SINGLE SOURCE OF TRUTH (Critical Rule)
      // ═══════════════════════════════════════════════════════════════════
      '## CRITICAL: Single Source of Truth',
      'Never speculate about code you have not opened. If the user references a specific file (e.g., utils.ts), you MUST read it before explaining or proposing fixes.',
      'Do not rely on your training data for project-specific logic. Always inspect the actual code first.',
      'If you need to edit a file, read it first using read_file tool. If you need to fix a bug, read the failing code first. No exceptions.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 3. WORKFLOW PHASES
      // ═══════════════════════════════════════════════════════════════════
      '## Workflow Phases',
      '',
      '### Phase 0: Intent Detection',
      '- If you will make ANY file changes (edit/create/delete), you are in IMPLEMENTATION mode.',
      '- Otherwise, you are in DIAGNOSTIC mode (analysis only).',
      '- If unsure, ask one concise clarifying question.',
      '',
      '### Phase 1: Environment Hygiene (MANDATORY for implementation)',
      'Before editing code, ensure the environment is ready:',
      '1. Run `git_status` to check for uncommitted changes or conflicts.',
      '2. If implementing, verify dependencies are installed (check for package.json/requirements.txt/etc).',
      '3. If the repo is dirty or dependencies are missing, inform the user before proceeding.',
      'Skip this phase for diagnostic-only tasks.',
      '',
      '### Phase 2: Discovery & Planning',
      '1. Read ALL relevant files before planning. Use `read_file`, `search`, or `semantic_search`.',
      '2. For multi-step tasks, use `todo_write` to create a structured plan. Mark tasks as "in_progress" or "completed" as you go.',
      '3. Identify outputs, success criteria, edge cases, and potential blockers.',
      '',
      '#### Search Optimization',
      '- Combine related searches into a single regex pattern (e.g., `pattern1|pattern2`) instead of separate searches.',
      '- Use `search_with_context` when you need surrounding code context.',
      '- Limit searches to 2-3 per task. Analyze results before searching again.',
      '- If a search returns no results, broaden the pattern rather than trying variations.',
      '',
      '### Phase 3: Implementation',
      '1. Write code using `write_file`, `search_replace`, `apply_patch`, or `multi_file_edit`.',
      '2. Make small, logical changes with clear reasoning in your "thought" field.',
      '3. Destructive operations (delete_path, run_command with rm/sudo) require explicit user approval—clearly justify them.',
      '',
      '### Phase 4: Verification (MANDATORY for implementation)',
      'You are NOT done until you have validated your changes:',
      '1. If a build system exists (package.json scripts, Makefile, etc.), run the build command.',
      '2. If tests exist, run them. Fix any failures you caused.',
      '3. Use `git_diff` to review your changes before declaring success.',
      'Do not ask the user to fix broken code you introduced. Fix it yourself.',
      '',
      '### Phase 5: Completion Summary (MANDATORY)',
      'When a task is complete, provide a clear summary:',
      '1. **What was done**: List the key changes made (files created/modified/deleted).',
      '2. **How it works**: Brief explanation of the implementation approach.',
      '3. **Next steps** (if any): Suggest follow-up actions like testing, deployment, or related improvements.',
      '',
      'Keep summaries concise but informative. Use bullet points for clarity.',
      'Example:',
      '```',
      '✓ Added user authentication:',
      '  - Created src/auth/login.ts with JWT token handling',
      '  - Updated src/routes/index.ts to include /login and /logout endpoints',
      '  - Added bcrypt for password hashing',
      '',
      'Next: Run `npm test` to verify, then update your .env with JWT_SECRET.',
      '```',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 4. REACT PATTERN & TOOL USAGE
      // ═══════════════════════════════════════════════════════════════════
      '## ReAct Pattern (Reason + Act)',
      'You must follow the ReAct loop: think about the request, decide whether to call tools, execute them, interpret the results, and only then respond.',
      '',
      '### Available Tools',
      'Use these tools with the specified arguments. Required parameters have no "?", optional parameters have "?".',
      toolSignatures ? `\n${toolSignatures}\n` : 'Tools are resolved at runtime. Use tools_registry to inspect them.',
      'If you need a capability not listed, define it as a `custom_command` (with name, command, args, description) before invoking it.',
      'Do not override existing tool functionality when adding meta tools.',
      '',
      '### Response Format',
      'Always reply with structured JSON:',
      '{"thought": "your reasoning here", "toolCalls": [{"tool": "tool_name", "args": {...}}], "finalResponse": "your answer to the user"}',
      '',
      'Response Guidelines:',
      '- If no tools are needed, set toolCalls to [] and provide finalResponse directly.',
      '- When calling tools, you may omit finalResponse - you will see the tool outputs next.',
      '- CRITICAL: After receiving tool outputs (role=tool messages), you MUST:',
      '  1. Analyze the results in context of the user\'s original request',
      '  2. Provide a finalResponse that directly answers the user\'s question',
      '  3. Only call more tools if genuinely needed to complete the task',
      '- If the user asked a question (e.g., "check for typos", "find X", "tell me about Y"),',
      '  you MUST provide an answer in finalResponse after gathering the necessary information.',
      '- Do NOT stop after showing tool output - always conclude with analysis/answer.',
      '- CRITICAL: If you intend to edit/write/create a file, PUT THE TOOL CALL IN toolCalls.',
      '  Do NOT write "let me update X" in finalResponse without the actual tool call.',
      '- Never include markdown fences (```json) around the JSON.',
      '- Never hallucinate tools that do not exist.',
      '',
      '### Tool Call Examples',
      'Always include ALL required parameters. Here are correct examples:',
      '',
      '// run_command - MUST include "command" argument:',
      '{"tool": "run_command", "args": {"command": "npm", "args": ["test"]}}',
      '{"tool": "run_command", "args": {"command": "bun", "args": ["run", "build"]}}',
      '{"tool": "run_command", "args": {"command": "git", "args": ["status"]}}',
      '',
      '// read_file - MUST include "path" argument:',
      '{"tool": "read_file", "args": {"path": "src/index.ts"}}',
      '',
      '// write_file - MUST include "path" and "contents" arguments:',
      '{"tool": "write_file", "args": {"path": "src/utils.ts", "contents": "export const foo = 1;"}}',
      '',
      '// custom_command - MUST include "name" and "command" arguments:',
      '{"tool": "custom_command", "args": {"name": "lint_fix", "command": "eslint", "args": ["--fix", "."]}}',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 5. TASK MANAGEMENT
      // ═══════════════════════════════════════════════════════════════════
      '## Task Management',
      'Use the `todo_write` tool for ANY task with more than 2-3 steps. This keeps you organized and makes progress visible to the user.',
      'Example: If asked to "refactor the auth system," create a todo list with items like:',
      '- Read existing auth code',
      '- Identify refactoring opportunities',
      '- Implement changes',
      '- Run tests',
      'Mark each item "in_progress" when you start it and "completed" when done.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 5.5. DYNAMIC TOOL CREATION
      // ═══════════════════════════════════════════════════════════════════
      '## Dynamic Tool Creation (Meta-Tools)',
      'You can create new reusable tools using `create_meta_tool`. Use this when:',
      '- A task requires a reusable shell command pattern',
      '- You need to extend your capabilities for the current project',
      '- The user asks for a custom automation',
      '',
      'Example: Create a tool to count lines in files:',
      'create_meta_tool(name="count_lines", description="Count lines in a file", parameters={"type": "object", "properties": {"path": {"type": "string"}}}, handler="wc -l {{path}}")',
      '',
      'The handler uses {{param}} syntax for parameter substitution.',
      'Meta-tools are saved to ~/.autohand/tools/ and persist across sessions.',
      'IMPORTANT: Do not create meta-tools that duplicate built-in functionality.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 6. MEMORY & PREFERENCES
      // ═══════════════════════════════════════════════════════════════════
      '## Memory & User Preferences',
      'Use the `save_memory` tool to remember important user preferences and project conventions.',
      'Automatically detect and save preferences when the user expresses them:',
      '- "I prefer..." / "I like..." / "I want..." / "Always use..." / "Never use..."',
      '- "Don\'t use..." / "Avoid..." / "I hate..."',
      '- Coding style preferences (tabs vs spaces, semicolons, naming conventions)',
      '- Framework/library preferences',
      '- Any explicit instruction about how to work',
      '',
      'When saving, choose the appropriate level:',
      '- `user`: Global preferences (applies to all projects)',
      '- `project`: Project-specific conventions (applies only to current workspace)',
      '',
      'Example: User says "I prefer functional components over class components"',
      '→ Call save_memory(fact="User prefers functional React components over class components", level="user")',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 7. REPOSITORY CONVENTIONS
      // ═══════════════════════════════════════════════════════════════════
      '## Repository Conventions',
      'Match existing code style, patterns, and naming conventions. Review similar modules before adding new ones.',
      'Respect framework/library choices already present. Avoid superfluous documentation; keep changes consistent with repo standards.',
      'Implement changes in the simplest way possible. Prefer clarity over cleverness.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 8. SAFETY & APPROVALS
      // ═══════════════════════════════════════════════════════════════════
      '## Safety',
      'Destructive operations (delete_path, run_command with rm/sudo/dd) require explicit user approval.',
      'Clearly justify risky actions in your "thought" field before calling them.',
      'Respect workspace boundaries: never escape the workspace root.',
      'Do not commit broken code. If you break the build, fix it before declaring success.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 9. COMPLETION CRITERIA
      // ═══════════════════════════════════════════════════════════════════
      '## Definition of Done',
      'A task is complete only when:',
      '- All requested functionality is implemented',
      '- The code follows repository conventions',
      '- The build passes (if applicable)',
      '- Tests pass (if applicable)',
      '- You have verified your changes with git_diff or similar',
      '',
      'Do not stop until all criteria are met. Do not ask the user to complete your work.',
      '',
      '## CRITICAL: Actions vs Words',
      'NEVER say "let me update X" or "I will now edit Y" in finalResponse without ACTUALLY calling the tool.',
      'If you intend to make a change, you MUST include the tool call in toolCalls array.',
      'BAD: finalResponse says "Let me now update README.md" → but no write_file/search_replace in toolCalls',
      'GOOD: toolCalls contains the actual edit → finalResponse summarizes what was done',
      '',
      'If you find yourself writing "let me...", "I will now...", "next I\'ll..." in finalResponse,',
      'STOP and add the actual tool call instead. Actions speak louder than words.',
      '',
      '## Completion Summary',
      'When finishing a multi-step task, ALWAYS provide a clear summary that includes:',
      '1. **What was done**: List the key changes made (files created/modified, features added)',
      '2. **Files changed**: List paths of files that were created or modified',
      '3. **How to verify**: Commands to run or steps to test the changes',
      '4. **Next steps** (if any): Suggest follow-up actions if relevant',
      '',
      'Example completion summary:',
      '```',
      '## Summary',
      '- Added user authentication with JWT tokens',
      '- Created new middleware for protected routes',
      '',
      '**Files changed:**',
      '- src/auth/jwt.ts (new)',
      '- src/middleware/auth.ts (new)',
      '- src/routes/api.ts (modified)',
      '',
      '**Verify:** Run `npm test` and `npm run build`',
      '```',
      '',
      'This summary helps users understand what was accomplished and how to proceed.'
    ];

    if (memories) {
      parts.push('', '## User Preferences & Memory', memories);
    }

    if (instructions.length) {
      parts.push('', ...instructions);
    }

    // Add available skills (progressive disclosure - descriptions only)
    const allSkills = this.skillsRegistry.listSkills();
    if (allSkills.length > 0) {
      parts.push('', '## Available Skills');
      parts.push('Skills are specialized instruction packages. Use /skills use <name> to activate one.');
      for (const skill of allSkills) {
        const activeMarker = skill.isActive ? ' [ACTIVE]' : '';
        parts.push(`- **${skill.name}**${activeMarker}: ${skill.description}`);
      }
    }

    // Add active skills (full content loaded)
    const activeSkills = this.skillsRegistry.getActiveSkills();
    if (activeSkills.length > 0) {
      parts.push('', '## Active Skills');
      parts.push('The following skills are active and provide specialized instructions:');
      for (const skill of activeSkills) {
        parts.push('', `### Skill: ${skill.name}`, skill.body);
      }
    }

    // Inject locale instruction for non-English users
    let basePrompt = parts.join('\n');
    basePrompt = injectLocaleIntoPrompt(basePrompt, getCurrentLocale());

    // Check for system prompt append (--append-sys-prompt)
    if (this.runtime.options.appendSysPrompt) {
      try {
        const appendContent = await resolvePromptValue(this.runtime.options.appendSysPrompt, {
          cwd: this.runtime.workspaceRoot,
        });
        basePrompt = basePrompt + '\n\n' + appendContent;
      } catch (error) {
        if (error instanceof SysPromptError) {
          console.error(chalk.red(`Error loading append system prompt: ${error.message}`));
          throw error;
        }
        throw error;
      }
    }

    return basePrompt;
  }

  private async resolveMentions(instruction: string): Promise<string> {
    const mentionRegex = /@([A-Za-z0-9_./\\-]*)/g;
    const matches: Array<{ start: number; end: number; token: string; seed: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(instruction)) !== null) {
      const token = match[0];
      const seed = match[1] ?? '';
      const start = match.index ?? 0;
      const prevChar = start > 0 ? instruction[start - 1] : ' ';
      if (prevChar && /[^\s\(\[]/.test(prevChar)) {
        continue;
      }
      matches.push({ start, end: start + token.length, token, seed });
    }

    if (!matches.length) {
      return instruction;
    }

    let result = '';
    let lastIndex = 0;
    for (const entry of matches) {
      if (entry.start < lastIndex) {
        continue;
      }
      result += instruction.slice(lastIndex, entry.start);
      const replacement = await this.resolveMentionToken(entry.token, entry.seed);
      if (replacement) {
        result += replacement;
      } else {
        result += instruction.slice(entry.start, entry.end);
      }
      lastIndex = entry.end;
    }
    result += instruction.slice(lastIndex);
    return result;
  }

  private async resolveMentionToken(token: string, seed: string): Promise<string | null> {
    const normalizedSeed = seed.trim();
    if (normalizedSeed && (await this.fileExists(normalizedSeed))) {
      await this.captureMentionContext(normalizedSeed);
      return normalizedSeed;
    }

    const workspaceFiles = await this.workspaceFileCollector.collectWorkspaceFiles();
    if (!workspaceFiles.length) {
      return normalizedSeed || null;
    }

    // Dynamic import to avoid bundling ink in standalone binary
    // Use computed path to prevent bun from statically analyzing the import
    const palettePath = ['..', 'ui', 'filePalette.js'].join('/');
    const { showFilePalette } = await import(/* @vite-ignore */ palettePath);
    const selection = await showFilePalette({
      files: workspaceFiles,
      statusLine: this.formatStatusLine(),
      seed: normalizedSeed
    });
    if (selection) {
      await this.captureMentionContext(selection);
      return selection;
    }

    return normalizedSeed || null;
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    const fullPath = path.resolve(this.runtime.workspaceRoot, relativePath);
    if (!fullPath.startsWith(this.runtime.workspaceRoot)) {
      return false;
    }
    const exists = await fs.pathExists(fullPath);
    if (!exists) {
      return false;
    }
    try {
      const stats = await fs.stat(fullPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  private async captureMentionContext(file: string): Promise<void> {
    try {
      const contents = await this.files.readFile(file);
      this.mentionContexts.push({ path: file, contents: this.trimContext(contents) });
    } catch (error) {
      console.log(chalk.yellow(`Unable to read ${file} for context: ${(error as Error).message}`));
    }
  }

  private trimContext(content: string): string {
    const limit = 2000;
    if (content.length > limit) {
      return content.slice(0, limit) + '\n...trimmed';
    }
    return content;
  }

  /**
   * Generate a concise summary of removed messages
   * This helps the LLM understand what context was lost
   */
  private summarizeRemovedMessages(messages: LLMMessage[]): string {
    const summaryParts: string[] = [];
    const toolsUsed = new Set<string>();
    const filesDiscussed = new Set<string>();

    for (const msg of messages) {
      const content = msg.content ?? '';

      // Track tools used
      if (msg.tool_calls) {
        for (const call of msg.tool_calls) {
          toolsUsed.add(call.function.name);
        }
      }
      if (msg.role === 'tool' && msg.name) {
        toolsUsed.add(msg.name);
      }

      // Extract file paths mentioned
      const pathMatches = content.match(/(?:\/[\w.-]+)+(?:\/[\w.-]+)*\.\w+/g);
      if (pathMatches) {
        for (const p of pathMatches.slice(0, 5)) {
          filesDiscussed.add(p);
        }
      }

      // Create brief summary for each message
      if (msg.role === 'user') {
        const preview = content.slice(0, 100).replace(/\n/g, ' ');
        summaryParts.push(`- User: ${preview}${content.length > 100 ? '...' : ''}`);
      } else if (msg.role === 'assistant' && content) {
        const preview = content.slice(0, 100).replace(/\n/g, ' ');
        summaryParts.push(`- Assistant: ${preview}${content.length > 100 ? '...' : ''}`);
      }
    }

    // Build final summary
    const parts: string[] = [];

    if (toolsUsed.size > 0) {
      parts.push(`Tools used: ${[...toolsUsed].join(', ')}`);
    }
    if (filesDiscussed.size > 0) {
      parts.push(`Files discussed: ${[...filesDiscussed].slice(0, 5).join(', ')}`);
    }
    if (summaryParts.length > 0) {
      parts.push(`Conversation:\n${summaryParts.slice(0, 5).join('\n')}`);
      if (summaryParts.length > 5) {
        parts.push(`... and ${summaryParts.length - 5} more messages`);
      }
    }

    return parts.join('\n') || 'No significant content to summarize';
  }

  private flushMentionContexts(): { block: string; files: string[] } | null {
    if (!this.mentionContexts.length) {
      return null;
    }
    const contexts = [...this.mentionContexts];
    const block = contexts
      .map((ctx) => `File: ${ctx.path}\n${ctx.contents}`)
      .join('\n\n');
    this.mentionContexts = [];
    return {
      block,
      files: contexts.map((ctx) => ctx.path)
    };
  }

  private extractJson(raw: string): string | null {
    const fenceMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      return fenceMatch[1];
    }
    const braceIndex = raw.indexOf('{');
    if (braceIndex !== -1) {
      return raw.slice(braceIndex);
    }
    return null;
  }

  /**
   * Detect if response text expresses intent to perform an action without having done it.
   * This catches phrases like "Let me update...", "I will now edit...", "Next I'll create..."
   */
  private expressesIntentToAct(text: string): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();

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
   * Initialize the UI for a new instruction.
   * Uses InkRenderer when enabled, otherwise falls back to ora spinner.
   */
  private async initializeUI(abortController?: AbortController, onCancel?: () => void): Promise<void> {
    if (this.useInkRenderer && process.stdout.isTTY && process.stdin.isTTY) {
      // Dynamically import InkRenderer to avoid bundling yoga-wasm in standalone binary
      // Use computed path to prevent bun from statically analyzing the import
      try {
        const inkPath = ['..', 'ui', 'ink', 'InkRenderer.js'].join('/');
        const { createInkRenderer } = await import(/* @vite-ignore */ inkPath);
        // Create and start InkRenderer (only in TTY mode)
        this.inkRenderer = createInkRenderer({
          onInstruction: (text: string) => {
            // Queue the instruction in InkRenderer (it manages its own queue)
            this.inkRenderer?.addQueuedInstruction(text);
          },
          onEscape: () => {
            // ESC cancels the current operation
            if (abortController && !abortController.signal.aborted) {
              abortController.abort();
              onCancel?.();
            }
          },
          onCtrlC: () => {
            // Ctrl+C is handled by InkRenderer (first warns, second exits)
            // We just need to abort on the second one
          },
          enableQueueInput: this.runtime.config.agent?.enableRequestQueue !== false
        });
        this.inkRenderer.start();
        this.inkRenderer.setWorking(true, 'Gathering context...');
        this.runtime.inkRenderer = this.inkRenderer;
      } catch {
        // Fall back to ora spinner if ink can't be loaded (e.g., standalone binary)
        this.useInkRenderer = false;
        this.initFallbackSpinner();
      }
    } else if (process.stdout.isTTY) {
      // Use ora spinner (only in TTY mode)
      const spinner = ora({
        text: 'Gathering context...',
        spinner: 'dots'
      }).start();
      this.runtime.spinner = spinner;
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
      this.runtime.spinner.text = status;
    }
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
   */
  private cleanupUI(): void {
    if (this.inkRenderer) {
      // Preserve queued instructions before stopping
      while (this.inkRenderer.hasQueuedInstructions()) {
        const instruction = this.inkRenderer.dequeueInstruction();
        if (instruction) {
          this.pendingInkInstructions.push(instruction);
        }
      }
      this.inkRenderer.stop();
      this.inkRenderer = null;
      this.runtime.inkRenderer = undefined;
    }
    if (this.runtime.spinner) {
      this.runtime.spinner.stop();
      this.runtime.spinner = undefined;
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

  private async collectContextSummary(): Promise<{ workspaceRoot: string; gitStatus?: string; recentFiles: string[] }> {
    const git = spawnSync('git', ['status', '-sb'], {
      cwd: this.runtime.workspaceRoot,
      encoding: 'utf8'
    });

    const gitStatus = git.status === 0 ? git.stdout.trim() : undefined;
    const entries = await fs.readdir(this.runtime.workspaceRoot);
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
    const instructions: string[] = [];
    const workspace = this.runtime.workspaceRoot;

    const agentsPath = path.join(workspace, 'AGENTS.md');
    if (await fs.pathExists(agentsPath)) {
      const content = await fs.readFile(agentsPath, 'utf-8');
      instructions.push(`## Project Instructions (AGENTS.md)\n${content}`);
    }

    const providerFile = this.activeProvider.includes('anthropic') || this.activeProvider === 'openrouter'
      ? 'CLAUDE.md'
      : this.activeProvider.includes('google')
        ? 'GEMINI.md'
        : null;

    if (providerFile) {
      const providerPath = path.join(workspace, providerFile);
      if (await fs.pathExists(providerPath)) {
        const content = await fs.readFile(providerPath, 'utf-8');
        instructions.push(`## Provider Instructions (${providerFile})\n${content}`);
      }
    }

    return instructions;
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
    const input = process.stdin as NodeJS.ReadStream;
    if (!input.isTTY) {
      return () => { };
    }
    // Use safe version to prevent duplicate listener registration across turns
    safeEmitKeypressEvents(input);
    const supportsRaw = typeof input.setRawMode === 'function';
    const wasRaw = (input as any).isRaw;
    if (!wasRaw && supportsRaw) {
      input.setRawMode(true);
    }

    let ctrlCCount = 0;
    this.queueInput = '';
    const enableQueue = this.runtime.config.agent?.enableRequestQueue !== false;

    const handler = (_str: string, key: readline.Key) => {
      if (controller.signal.aborted) {
        return;
      }

      // ESC to cancel
      if (key?.name === 'escape') {
        controller.abort();
        onCancel();
        return;
      }

      // Ctrl+C handling
      if (ctrlCInterrupt && key?.name === 'c' && key.ctrl) {
        ctrlCCount += 1;
        if (ctrlCCount >= 2) {
          controller.abort();
          onCancel();
        } else {
          console.log(chalk.gray('Press Ctrl+C again to exit.'));
        }
        return;
      }

      if (enableQueue) {
        if (key?.name === 'return' || key?.name === 'enter') {
          if (this.queueInput.trim()) {
            const text = this.queueInput.trim();
            this.queueInput = '';

            const queue = (this.persistentInput as any).queue as Array<{ text: string; timestamp: number }>;
            if (queue.length >= 10) {
              return;
            }
            queue.push({ text, timestamp: Date.now() });

            const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
            if (this.runtime.spinner) {
              this.runtime.spinner.text = chalk.cyan(`✓ Queued: "${preview}" (${this.persistentInput.getQueueLength()} pending)`);
            }
          }
          return;
        }

        if (key?.name === 'backspace') {
          this.queueInput = this.queueInput.slice(0, -1);
          this.updateInputLine();
          return;
        }

        if (key?.ctrl || key?.meta) {
          return;
        }

        if (_str) {
          const printable = _str.replace(/[\x00-\x1F\x7F]/g, '');
          if (printable) {
            this.queueInput += printable;
            this.updateInputLine();
          }
        }
      }
    };
    input.on('keypress', handler);

    return () => {
      input.off('keypress', handler);
      this.queueInput = ''; // Clear input on cleanup
      if (!wasRaw && supportsRaw) {
        input.setRawMode(false);
      }
    };
  }

  private startPreparationStatus(instruction: string): () => void {
    const label = describeInstruction(instruction);
    const startedAt = Date.now();
    const update = () => {
      const elapsed = formatElapsedTime(startedAt);
      const status = `Preparing to ${label} (${elapsed} • esc to interrupt)`;
      if (this.inkRenderer) {
        this.inkRenderer.setStatus(status);
        this.inkRenderer.setElapsed(elapsed);
      } else if (this.runtime.spinner) {
        this.runtime.spinner.text = status;
      }
    };
    update();
    let stopped = false;
    const interval = setInterval(update, 1000);
    return () => {
      if (stopped) {
        return;
      }
      clearInterval(interval);
      stopped = true;
    };
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Categorize errors to determine retry behavior.
   * Returns true if the error is retryable.
   */
  private isRetryableSessionError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // NON-RETRYABLE ERRORS (should fail immediately):

    // Authentication/authorization errors
    if (message.includes('authentication') ||
        message.includes('api key') ||
        message.includes('unauthorized') ||
        message.includes('forbidden') ||
        message.includes('access denied')) {
      return false;
    }

    // Payment/billing errors
    if (message.includes('payment required') ||
        message.includes('billing') ||
        message.includes('quota exceeded')) {
      return false;
    }

    // Model not found
    if (message.includes('model not found') ||
        message.includes('model does not exist')) {
      return false;
    }

    // User cancellation
    if (message.includes('cancelled') ||
        message.includes('canceled') ||
        message.includes('aborted') ||
        message.includes('user force closed')) {
      return false;
    }

    // Context/payload errors (user action needed)
    // Note: Match both "context is too long" and "context too long"
    if (message.includes('payload too large') ||
        (message.includes('context') && message.includes('too long')) ||
        message.includes('malformed')) {
      return false;
    }

    // RETRYABLE ERRORS (transient failures):

    // Network/connection issues
    if (message.includes('network') ||
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('enotfound') ||
        message.includes('etimedout')) {
      return true;
    }

    // Server-side errors (5xx)
    if (message.includes('internal error') ||
        message.includes('service unavailable') ||
        message.includes('bad gateway') ||
        message.includes('gateway timeout') ||
        message.includes('overloaded')) {
      return true;
    }

    // Rate limiting (worth retrying after delay)
    if (message.includes('rate limit') ||
        message.includes('too many requests')) {
      return true;
    }

    // Timeout errors
    if (message.includes('timed out') ||
        message.includes('timeout')) {
      return true;
    }

    // JSON parsing errors (LLM returned malformed response)
    if (message.includes('json') ||
        message.includes('parse') ||
        message.includes('unexpected token')) {
      return true;
    }

    // Generic/unknown errors - default to retry
    return true;
  }

  /**
   * Inject a continuation message into the conversation to help the LLM
   * recover from a failure and continue the task.
   */
  private injectContinuationMessage(error: Error, retryAttempt: number): void {
    const continuationPrompts = [
      // First retry: gentle continuation
      `[System Recovery] An error occurred (${error.message}). Please continue from where you left off. ` +
      `Review the conversation context and proceed with the next logical step. ` +
      `If you were in the middle of a tool call, retry it. If you completed tools, provide your response.`,

      // Second retry: more explicit
      `[System Recovery - Attempt ${retryAttempt + 1}] The previous operation encountered an error. ` +
      `Please analyze the current state and continue. Focus on completing the user's original request. ` +
      `If needed, you can re-read files or re-execute commands to verify the current state.`,

      // Third retry: most explicit with safety
      `[System Recovery - Final Attempt] Multiple errors have occurred. ` +
      `Please provide a status update to the user. If the task cannot be completed, ` +
      `explain what was accomplished and what remains. Do not attempt complex operations - ` +
      `focus on providing a helpful response.`
    ];

    const promptIndex = Math.min(retryAttempt, continuationPrompts.length - 1);
    const continuationMessage = continuationPrompts[promptIndex];

    // Add as a system note to preserve conversation flow
    this.conversation.addSystemNote(continuationMessage);
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
  markFilesModified(): void {
    this.filesModifiedThisSession = true;
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
   * Handle a slash command (e.g., /skills, /skills install, /model)
   * Returns the command output or null if the command doesn't exist
   */
  async handleSlashCommand(command: string, args: string[] = []): Promise<string | null> {
    return this.slashHandler.handle(command, args);
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

    // Check for two-word commands like "/skills install"
    const twoWordCommands = ['/skills install', '/skills new', '/agents new'];
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
   * The returned messages may have multimodal content (array of text/image parts)
   * which is supported by OpenAI/OpenRouter APIs but not strictly typed.
   * @returns Messages formatted for API with multimodal content
   */
  private getMessagesWithImages(): LLMMessage[] {
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

    // Clone messages and modify the last user message to include images
    const result: LLMMessage[] = messages.map((msg, i) => {
      if (i === lastUserMessageIndex && images.length > 0) {
        // Create multimodal content array
        // Note: content will be an array, which the API accepts but our type says string
        // This is intentional for multimodal support
        const contentParts = [
          { type: 'text', text: msg.content }
        ];

        // Add images from ImageManager (OpenAI/OpenRouter format)
        for (const img of images) {
          contentParts.push({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.data.toString('base64')}`
            }
          } as unknown as typeof contentParts[0]);
        }

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
    const statusLine = `Working... (esc to interrupt · ${elapsed} · ${tokens}${queueHint})`;

    if (this.inkRenderer) {
      // InkRenderer handles its own state updates
      this.inkRenderer.setStatus('Working...');
      this.inkRenderer.setElapsed(elapsed);
      this.inkRenderer.setTokens(tokens);
      return;
    }

    if (!this.runtime.spinner) return;

    const inputPreview = this.queueInput.length > 40
      ? '...' + this.queueInput.slice(-37)
      : this.queueInput;
    const inputLine = `\n${chalk.gray('›')} ${inputPreview}${chalk.gray('▋')}`;

    const fullText = statusLine + inputLine;

    // Only update if something actually changed
    const cacheKey = `${statusLine}|${inputPreview}`;
    if (cacheKey === this.lastRenderedStatus) return;
    this.lastRenderedStatus = cacheKey;

    this.runtime.spinner.text = fullText;
  }

  private startStatusUpdates(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
    }

    // Reset tracking state
    this.lastRenderedStatus = '';

    // Immediate initial render
    this.forceRenderSpinner();

    // Update every second for elapsed time, but forceRenderSpinner
    // handles deduplication so frequent calls are fine
    this.statusInterval = setInterval(() => {
      this.forceRenderSpinner();
    }, 1000); // Once per second is enough for time updates
  }

  private stopStatusUpdates(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
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

    // Ensure stdin is not paused and is readable
    // Some operations (like shell spawns) can leave stdin in an unexpected state
    try {
      // First, ensure raw mode is off (readline will set it as needed)
      if (typeof stdin.setRawMode === 'function' && (stdin as any).isRaw) {
        stdin.setRawMode(false);
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

  private formatStatusLine(): string {
    const percent = Number.isFinite(this.contextPercentLeft)
      ? Math.max(0, Math.min(100, this.contextPercentLeft))
      : 100;

    const queueCount = this.inkRenderer?.getQueueCount() ?? this.persistentInput.getQueueLength();
    const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';

    // Plan mode indicator
    const planModeManager = getPlanModeManager();
    const planIndicator = planModeManager.isEnabled()
      ? chalk.bgCyan.black.bold(' PLAN ') + ' '
      : '';

    return `${planIndicator}${percent}% context left · / for commands · @ to mention files${queueStatus}`;
  }

  private async resetConversationContext(): Promise<void> {
    const systemPrompt = await this.buildSystemPrompt();
    this.conversation.reset(systemPrompt);
    this.mentionContexts = [];
    this.updateContextUsage(this.conversation.history());
  }

  private availableProviders(): ProviderName[] {
    const providers: ProviderName[] = [];
    if (this.runtime.config.openrouter) providers.push('openrouter');
    if (this.runtime.config.ollama) providers.push('ollama');
    if (this.runtime.config.llamacpp) providers.push('llamacpp');
    if (this.runtime.config.openai) providers.push('openai');
    if (this.runtime.config.mlx) providers.push('mlx');
    if (this.runtime.config.llmgateway) providers.push('llmgateway');
    return providers.length ? providers : ['openrouter'];
  }


  private async confirmDangerousAction(message: string, context?: { tool?: string; path?: string; command?: string }): Promise<boolean> {
    if (this.runtime.options.yes || this.runtime.config.ui?.autoConfirm) {
      return true;
    }

    // Use confirmation callback if set (e.g., RPC mode)
    if (this.confirmationCallback) {
      return this.confirmationCallback(message, context);
    }

    if (isExternalCallbackEnabled()) {
      return unifiedConfirm(message);
    }

    this.stopStatusUpdates();

    const spinnerWasSpinning = this.runtime.spinner?.isSpinning;
    if (spinnerWasSpinning) {
      this.runtime.spinner?.stop();
    }

    this.persistentInput.pause();

    if (this.inkRenderer) {
      this.inkRenderer.pause();
    }

    // Reset stdin to cooked mode for Modal prompts
    const wasRaw = process.stdin.isTTY && (process.stdin as any).isRaw;
    if (wasRaw) {
      process.stdin.setRawMode(false);
    }

    try {
      return await unifiedConfirm(message);
    } finally {
      if (this.inkRenderer) {
        this.inkRenderer.resume();
      }

      this.persistentInput.resume();

      if (spinnerWasSpinning && this.runtime.spinner) {
        this.runtime.spinner.start();
      }

      this.startStatusUpdates();
    }
  }

  /**
   * Handle ask_followup_question tool with proper TUI coordination.
   * Uses Ink-based question modal for consistent UX.
   */
  private async executeAskFollowupQuestion(
    question: string,
    suggestedAnswers?: string[]
  ): Promise<string> {
    // Non-interactive mode fallback
    if (this.runtime.options.yes || process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      console.log(chalk.yellow(`\n❓ ${question}`));
      console.log(chalk.gray('  (Auto-skipped in non-interactive mode)\n'));
      return '<answer>Skipped (non-interactive mode)</answer>';
    }

    this.stopStatusUpdates();

    const spinnerWasSpinning = this.runtime.spinner?.isSpinning;
    if (spinnerWasSpinning) {
      this.runtime.spinner?.stop();
    }

    this.persistentInput.pause();

    if (this.inkRenderer) {
      this.inkRenderer.pause();
    }

    // Let Ink manage its own stdin mode - don't manipulate it manually

    try {
      // Dynamically import the question modal to avoid bundling issues
      const modalPath = ['..', 'ui', 'questionModal.js'].join('/');
      const { showQuestionModal } = await import(/* @vite-ignore */ modalPath);

      const answer = await showQuestionModal({
        question,
        suggestedAnswers
      });

      if (answer === null) {
        console.log(chalk.yellow('\n  (Question cancelled)\n'));
        return '<answer>User cancelled</answer>';
      }

      console.log(chalk.green(`\n✓ Answer: ${answer}\n`));
      return `<answer>${answer}</answer>`;
    } finally {
      if (this.inkRenderer) {
        this.inkRenderer.resume();
      }

      this.persistentInput.resume();

      if (spinnerWasSpinning && this.runtime.spinner) {
        this.runtime.spinner.start();
      }

      this.startStatusUpdates();
    }
  }

  /**
   * Handle plan creation - sets plan on manager and asks for acceptance.
   * This is called when the LLM uses the `plan` tool.
   */
  private async handlePlanCreated(plan: import('../modes/planMode/types.js').Plan, filePath: string): Promise<string> {
    const planManager = getPlanModeManager();

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

    // Non-interactive mode: auto-accept with default option
    if (this.runtime.options.yes || process.env.CI === '1' || process.env.AUTOHAND_NON_INTERACTIVE === '1') {
      const config = planManager.acceptPlan('auto_accept');
      console.log(chalk.yellow('  (Auto-accepted in non-interactive mode)\n'));
      return `Plan accepted with option: ${config.option}. Starting execution...`;
    }

    // Get acceptance options from PlanModeManager
    const acceptOptions = planManager.getAcceptOptions();

    // Stop status updates and spinner before showing modal (same pattern as executeAskFollowupQuestion)
    this.stopStatusUpdates();

    const spinnerWasSpinning = this.runtime.spinner?.isSpinning;
    if (spinnerWasSpinning) {
      this.runtime.spinner?.stop();
    }

    // Pause persistent input to prevent conflicts with modal
    this.persistentInput.pause();
    if (this.inkRenderer) {
      this.inkRenderer.pause();
    }

    try {
      // Dynamically import the plan accept modal
      const modalPath = ['..', 'ui', 'planAcceptModal.js'].join('/');
      const { showPlanAcceptModal } = await import(/* @vite-ignore */ modalPath);

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
        return 'Plan not accepted. Staying in planning mode for revisions.';
      }

      if (result.type === 'custom' && result.customText) {
        console.log(chalk.yellow(`\n  Feedback received: ${result.customText}\n`));
        return `User feedback on plan: ${result.customText}. Please revise the plan accordingly.`;
      }

      if (result.type === 'option' && result.optionId) {
        const selectedOption = acceptOptions.find(opt => opt.id === result.optionId);
        if (selectedOption) {
          const config = planManager.acceptPlan(selectedOption.id);

          console.log(chalk.green(`\n✓ Plan accepted: ${selectedOption.label}`));
          if (config.clearContext) {
            console.log(chalk.gray('  Context will be cleared for fresh execution.'));
          }
          if (config.autoAcceptEdits) {
            console.log(chalk.gray('  Edits will be auto-accepted.'));
          }
          console.log();

          return `Plan accepted with option: ${config.option}. Ready for execution.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
        }
      }

      // Default: accept with manual approve if result wasn't recognized
      const config = planManager.acceptPlan('manual_approve');
      console.log(chalk.green('\n✓ Plan accepted with manual approval for edits.\n'));

      return `Plan accepted. Starting execution with manual edit approval.\n\nSteps:\n${plan.steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
    } finally {
      if (this.inkRenderer) {
        this.inkRenderer.resume();
      }
      this.persistentInput.resume();

      if (spinnerWasSpinning && this.runtime.spinner) {
        this.runtime.spinner.start();
      }

      this.startStatusUpdates();
    }
  }

  private resolveWorkspacePath(relativePath: string): string {
    const resolved = path.resolve(this.runtime.workspaceRoot, relativePath);
    if (!resolved.startsWith(this.runtime.workspaceRoot)) {
      throw new Error(`Path ${relativePath} escapes workspace root.`);
    }
    return resolved;
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
  setConfirmationCallback(callback: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<boolean>): void {
    this.confirmationCallback = callback;
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
