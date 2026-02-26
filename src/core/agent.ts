/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { format as formatText, promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import ora from 'ora';
import { showModal, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import readline from 'node:readline';
import { FileActionManager } from '../actions/filesystem.js';
import { saveConfig, getProviderConfig } from '../config.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import { ProviderNotConfiguredError } from '../providers/ProviderFactory.js';
import {
  getPromptBlockWidth,
  readInstruction,
  safeEmitKeypressEvents
} from '../ui/inputPrompt.js';
import { safeSetRawMode } from '../ui/rawMode.js';
import { isShellCommand, isImmediateCommand, parseShellCommand, executeShellCommand } from '../ui/shellCommand.js';
import { showFilePalette } from '../ui/filePalette.js';
import { createInkRenderer } from '../ui/ink/InkRenderer.js';
import { showQuestionModal } from '../ui/questionModal.js';
import { showPlanAcceptModal } from '../ui/planAcceptModal.js';
import {
  getContextWindow,
  estimateMessagesTokens,
  calculateContextUsage
} from '../utils/context.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
import { getAutoCommitInfo } from '../actions/git.js';
import { filterToolsByRelevance } from './toolFilter.js';
import { isSearchConfigured } from '../actions/web.js';
import { SLASH_COMMANDS } from './slashCommands.js';
import { ConversationManager } from './conversationManager.js';
import { ContextManager } from './contextManager.js';
import { ToolManager } from './toolManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { SlashCommandHandler } from './slashCommandHandler.js';
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
import { McpClientManager } from '../mcp/McpClientManager.js';
import { AUTOHAND_PATHS } from '../constants.js';
import { PersistentInput, createPersistentInput } from '../ui/persistentInput.js';
import { injectLocaleIntoPrompt, getCurrentLocale, t } from '../i18n/index.js';
import { formatToolOutputForDisplay } from '../ui/toolOutput.js';
// InkRenderer type - using 'any' to avoid bun bundling ink at compile time
// The actual type comes from dynamic import at runtime
type InkRenderer = any;
import { PermissionManager } from '../permissions/PermissionManager.js';
import { HookManager } from './HookManager.js';
import { TeamManager } from './teams/TeamManager.js';
import { confirm as unifiedConfirm, isExternalCallbackEnabled } from '../ui/promptCallback.js';
import { ActivityIndicator } from '../ui/activityIndicator.js';
import { NotificationService } from '../utils/notification.js';
import { getPlanModeManager } from '../commands/plan.js';
import type { VersionCheckResult } from '../utils/versionCheck.js';
import { getInstallHint } from '../utils/versionCheck.js';
import packageJson from '../../package.json' with { type: 'json' };
// New feature modules
import { ImageManager } from './ImageManager.js';
import { IntentDetector, type Intent, type IntentResult } from './IntentDetector.js';
import { EnvironmentBootstrap, type BootstrapResult } from './EnvironmentBootstrap.js';
import { CodeQualityPipeline } from './CodeQualityPipeline.js';
import { ProjectAnalyzer as OnboardingProjectAnalyzer } from '../onboarding/projectAnalyzer.js';
import { AgentsGenerator } from '../onboarding/agentsGenerator.js';
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
import { AutoReportManager } from '../reporting/AutoReportManager.js';
import { isLikelyFilePathSlashInput } from './slashInputDetection.js';
import { SuggestionEngine } from './SuggestionEngine.js';
import {
  buildMcpStartupSummaryRows,
  getAutoConnectMcpServerNames,
  truncateMcpStartupError,
} from './mcpStartupHistory.js';

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
  private mcpManager: McpClientManager;
  /** Background MCP connection promise - resolves when all servers finish connecting */
  private mcpReady: Promise<void> | null = null;
  private workspaceFileCollector: WorkspaceFileCollector;
  private providerConfigManager: ProviderConfigManager;
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;
  private activeProvider: ProviderName;
  private errorLogger: ErrorLogger;
  private autoReportManager: AutoReportManager;
  private notificationService: NotificationService;
  private versionCheckResult?: VersionCheckResult;
  private teamManager: TeamManager;
  private suggestionEngine: SuggestionEngine | null = null;
  private pendingSuggestion: Promise<void> | null = null;
  private isStartupSuggestion = false;

  private taskStartedAt: number | null = null;
  private totalTokensUsed = 0;
  private statusInterval: NodeJS.Timeout | null = null;
  private resizeHandler: (() => void) | null = null;
  private sessionStartedAt: number = Date.now();
  private sessionTokensUsed = 0;
  private inkRenderer: InkRenderer | null = null;
  private useInkRenderer = false;
  private pendingInkInstructions: string[] = [];
  private persistentInput: PersistentInput;
  private persistentInputActiveTurn = false;
  private queueInput = '';
  private promptSeedInput = '';
  private lastRenderedStatus = '';
  private activityIndicator: ActivityIndicator;
  private lastAssistantResponseForNotification = '';

  // New feature modules
  private imageManager: ImageManager;
  private intentDetector: IntentDetector;
  private environmentBootstrap: EnvironmentBootstrap;
  private codeQualityPipeline: CodeQualityPipeline;
  private lastIntent: Intent = 'diagnostic';
  private filesModifiedThisSession = false;
  private fileModCount = 0;
  private modifiedFilePaths = new Set<string>();
  private executedActionNames: string[] = [];
  private searchQueries: string[] = [];
  private sessionRetryCount = 0;
  private consecutiveCancellations = 0;

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

    // Initialize suggestion engine if enabled in config
    if (runtime.config.ui?.promptSuggestions !== false) {
      this.suggestionEngine = new SuggestionEngine(this.llm);
    }

    this.toolsRegistry = new ToolsRegistry();
    this.memoryManager = new MemoryManager(runtime.workspaceRoot);

    // Initialize context manager for auto-compaction
    // Default enabled, can be toggled with --no-cc or /cc command
    this.contextCompactionEnabled = runtime.options.contextCompact !== false;
    this.contextManager = new ContextManager({
      model,
      conversationManager: this.conversation,
      llm: this.llm,
      memoryManager: this.memoryManager,
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
    this.notificationService = new NotificationService();

    this.activityIndicator = new ActivityIndicator({
      activityVerbs: runtime.config.ui?.activityVerbs,
      activitySymbol: runtime.config.ui?.activitySymbol,
    });

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
        // In RPC mode, stdout must only contain JSON-RPC messages
        // Hook output would break the protocol, so suppress it
        if (runtime.isRpcMode) {
          return;
        }
        // Display hook output to console (only if not a JSON control flow response)
        // Write text THEN newline separately to prevent ANSI reset codes
        // from being written after \n (which corrupts the next line for readline)
        if (result.stdout && !result.response) {
          const msg = chalk.dim(`[hook:${result.hook.event}] ${result.stdout}`);
          process.stdout.write(msg + '\n');
        }
        if (result.stderr && !result.blockingError) {
          const msg = chalk.yellow(`[hook:${result.hook.event}] ${result.stderr}`);
          process.stderr.write(msg + '\n');
        }
      }
    });

    // Initialize team manager for /team, /tasks, /message commands
    this.teamManager = new TeamManager({
      leadSessionId: randomUUID(),
      workspacePath: runtime.workspaceRoot,
      onTeammateMessage: (from, msg) => {
        if (msg.method === 'team.log') {
          const { level, text } = msg.params as { level: string; text: string };
          const prefix = level === 'error' ? chalk.red(`[${from}]`) : chalk.cyan(`[${from}]`);
          this.emitOutput({ type: 'message', content: `${prefix} ${text}` });
        }
      },
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
      onFileModified: (filePath?: string) => this.markFilesModified(filePath),
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
    this.autoReportManager = new AutoReportManager(runtime.config, packageJson.version);
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

    // Initialize MCP client manager
    this.mcpManager = new McpClientManager();

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
      },
      // Team coordination tools
      {
        name: 'create_team',
        description: 'Create a named agent team for parallel work. Auto-profiles the project and returns available agents. Call this first, then add_teammate and create_task.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short team name (e.g., "auth-refactor")' }
          },
          required: ['name']
        },
        requiresApproval: false
      },
      {
        name: 'add_teammate',
        description: 'Spawn a teammate process using an agent definition. The agent_name must match one from the Available Agents list.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Friendly name for this teammate' },
            agent_name: { type: 'string', description: 'Agent definition to use (from Available Agents)' },
            model: { type: 'string', description: 'Optional LLM model override' }
          },
          required: ['name', 'agent_name']
        },
        requiresApproval: false
      },
      {
        name: 'create_task',
        description: 'Add a task to the team task list. Tasks auto-assign to idle teammates.',
        parameters: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Short task title' },
            description: { type: 'string', description: 'Full task description with acceptance criteria' },
            blocked_by: { type: 'array', description: 'Task IDs that must complete first', items: { type: 'string' } }
          },
          required: ['subject', 'description']
        },
        requiresApproval: false
      },
      {
        name: 'team_status',
        description: 'Get current team status: members, tasks, progress, available agents.',
        requiresApproval: false
      },
      {
        name: 'send_team_message',
        description: 'Send a message to a specific teammate.',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Teammate name' },
            content: { type: 'string', description: 'Message content' }
          },
          required: ['to', 'content']
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
          } else if (action.type === 'create_team') {
            // Handle existing team: same name → reuse, different name → replace
            let team = this.teamManager.getTeam();
            let created = false;
            if (team && team.name !== action.name) {
              // Different team requested — shutdown old, create new
              await this.teamManager.shutdown();
              team = null;
            }
            if (!team) {
              team = this.teamManager.createTeam(action.name);
              created = true;
            }
            // Auto-profile the project
            const { ProjectProfiler } = await import('./teams/ProjectProfiler.js');
            const profiler = new ProjectProfiler(this.runtime.workspaceRoot);
            const profile = await profiler.analyze();
            // List available agents
            const { AgentRegistry } = await import('./agents/AgentRegistry.js');
            const registry = AgentRegistry.getInstance();
            await registry.loadAgents();
            const agents = registry.getAllAgents().map(a => `  - ${a.name}: ${a.description}`).join('\n');
            const header = created
              ? `Team "${team.name}" created.`
              : `Team "${team.name}" already active (reusing). Members: ${team.members.length}, Tasks: ${this.teamManager.tasks.listTasks().length}.`;
            result = [
              header,
              `\nProject: ${profile.languages.join(', ')} | Frameworks: ${profile.frameworks.join(', ') || 'none'}`,
              `Signals: ${profile.signals.map(s => `${s.type}(${s.severity})`).join(', ') || 'none'}`,
              `\nAvailable agents:\n${agents || '  (none)'}`,
              `\nNext: call add_teammate for each role, then create_task.`,
            ].join('\n');
          } else if (action.type === 'add_teammate') {
            this.teamManager.addTeammate({ name: action.name, agentName: action.agent_name, model: action.model });
            result = `Teammate "${action.name}" added (agent: ${action.agent_name}). Process spawning.`;
          } else if (action.type === 'create_task') {
            const task = this.teamManager.tasks.createTask({
              subject: action.subject,
              description: action.description,
              blockedBy: action.blocked_by,
            });
            // Auto-assign to idle teammates
            this.teamManager.tryAssignIdleTeammate();
            result = `Task ${task.id}: "${task.subject}" created (status: ${task.status})`;
          } else if (action.type === 'team_status') {
            const team = this.teamManager.getTeam();
            if (!team) {
              result = 'No active team. Use create_team first.';
            } else {
              const status = this.teamManager.getStatus();
              const members = team.members.map(m => `  ${m.name} (${m.agentName}) - ${m.status}`).join('\n');
              const tasks = this.teamManager.tasks.listTasks();
              const taskLines = tasks.map(t => {
                const owner = t.owner ? ` -> ${t.owner}` : '';
                const blocked = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
                return `  [${t.status}] ${t.id}: ${t.subject}${owner}${blocked}`;
              }).join('\n');
              result = `Team: ${team.name} (${status.memberCount} members, ${status.tasksDone}/${status.tasksTotal} done)\n\nMembers:\n${members}\n\nTasks:\n${taskLines || '  (none)'}`;
            }
          } else if (action.type === 'send_team_message') {
            this.teamManager.sendMessageTo(action.to, 'lead', action.content);
            result = `Message sent to ${action.to}.`;
          } else if (McpClientManager.isMcpTool(action.type)) {
            // Ensure MCP servers have finished connecting before dispatching
            if (this.mcpReady) await this.mcpReady;
            // Route MCP tool calls to the MCP client manager
            const parsed = McpClientManager.parseMcpToolName(action.type);
            if (parsed) {
              const { ...mcpArgs } = action as Record<string, unknown>;
              const mcpResult = await this.mcpManager.callTool(parsed.serverName, parsed.toolName, mcpArgs);
              result = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult);
            } else {
              result = `Invalid MCP tool name: ${action.type}`;
            }
          } else {
            result = await this.actionExecutor.execute(action, context);
          }
          // Record action name for auto-mode tracking
          this.recordExecutedAction(action.type);

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

    // Initialize persistent input for queuing messages while agent works.
    // Default to terminal regions so the boxed composer stays visible during turns.
    // Allow disabling via env for troubleshooting terminals with region issues.
    const disableTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS === '0';
    this.persistentInput = createPersistentInput({
      maxQueueSize: 10,
      silentMode: disableTerminalRegions
    });

    this.persistentInput.on('queued', (text: string, count: number) => {
      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      const usingTerminalRegions = this.persistentInputActiveTurn &&
        process.env.AUTOHAND_TERMINAL_REGIONS !== '0' &&
        !this.useInkRenderer;
      if (this.inkRenderer) {
        this.inkRenderer.addQueuedInstruction(text);
      } else if (usingTerminalRegions) {
        // In terminal-regions mode, PersistentInput already renders queued feedback.
        return;
      } else if (this.runtime.spinner) {
        this.runtime.spinner.stop();
        console.log(chalk.cyan(`✓ Queued: "${preview}" (${count} pending)`));
        this.runtime.spinner.start();
        this.lastRenderedStatus = '';
        this.forceRenderSpinner();
      }
    });

    // Handle immediate commands (! shell, / slash) from PersistentInput - bypass queue
    this.persistentInput.on('immediate-command', (text: string) => {
      if (isShellCommand(text)) {
        const cmd = parseShellCommand(text);
        console.log(chalk.gray(`\n$ ${cmd}`));
        const result = executeShellCommand(cmd, this.runtime.workspaceRoot);
        if (result.success) {
          if (result.output) console.log(result.output);
        } else {
          console.log(chalk.red(result.error || 'Command failed'));
        }
      } else if (text.startsWith('/')) {
        const { command, args } = this.parseSlashCommand(text);
        this.handleSlashCommand(command, args)
          .then((handled) => {
            if (handled !== null) {
              console.log(handled);
            }
          })
          .catch((err: Error) => {
            console.log(chalk.red(`\nCommand error: ${err.message}`));
        });
      }
    });

    this.persistentInput.on('plan-mode-toggled', (enabled: boolean) => {
      const statusLine = this.formatStatusLine();
      this.persistentInput.setStatusLine(statusLine);

      const message = enabled
        ? `${chalk.bgCyan.black.bold(' PLAN ')} ${chalk.cyan('Plan mode ON - read-only tools')}`
        : `${chalk.gray('Plan mode')} ${chalk.red('OFF')}`;

      const usingTerminalRegions = this.persistentInputActiveTurn &&
        process.env.AUTOHAND_TERMINAL_REGIONS !== '0' &&
        !this.useInkRenderer;
      if (usingTerminalRegions) {
        this.persistentInput.render();
      }

      if (usingTerminalRegions) {
        this.persistentInput.writeAbove(`${message}\n`);
      } else if (this.runtime.spinner) {
        const wasSpinning = this.runtime.spinner.isSpinning;
        if (wasSpinning) {
          this.runtime.spinner.stop();
        }
        console.log(`\n${message}`);
        if (wasSpinning) {
          this.runtime.spinner.start();
        }
      } else {
        console.log(`\n${message}`);
      }

      this.lastRenderedStatus = '';
      if (!this.inkRenderer) {
        this.forceRenderSpinner();
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
      mcpManager: this.mcpManager,
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
      // Non-interactive mode (RPC/ACP) - guards interactive commands
      isNonInteractive: runtime.isRpcMode === true,
      // Team manager for /team, /tasks, /message commands
      teamManager: this.teamManager,
    };
    this.slashHandler = new SlashCommandHandler(slashContext, SLASH_COMMANDS);
  }

  /**
   * Sync discovered MCP tools with tool definitions exposed to the LLM.
   */
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
    this.contextCompactionEnabled = !this.contextCompactionEnabled;
  }

  isContextCompactionEnabled(): boolean {
    return this.contextCompactionEnabled;
  }

  setContextCompaction(enabled: boolean): void {
    this.contextCompactionEnabled = enabled;
  }

  /** Promise that resolves when background init is complete */
  private initReady: Promise<void> | null = null;
  private initDone = false;
  private mcpStartupAutoConnectServers: string[] = [];
  private mcpStartupConnectStartedAt: number | null = null;
  private mcpStartupSummaryPrinted = false;
  private mcpStartupSummaryPending = false;
  private persistentConsoleBridgeCleanup: (() => void) | null = null;

  async runInteractive(): Promise<void> {
    // Bail out early if stdin is not a TTY - interactive mode requires a terminal
    if (!process.stdin.isTTY) {
      console.error(chalk.red('Interactive mode requires a terminal (TTY). Use --prompt for non-interactive usage.'));
      process.exitCode = 1;
      return;
    }

    // Prepare startup visibility for async MCP connections.
    this.mcpStartupAutoConnectServers = getAutoConnectMcpServerNames(this.runtime.config.mcp?.servers);
    this.mcpStartupConnectStartedAt = null;
    this.mcpStartupSummaryPrinted = false;
    this.mcpStartupSummaryPending = false;
    if (this.runtime.config.mcp?.enabled !== false && this.mcpStartupAutoConnectServers.length > 0) {
      const count = this.mcpStartupAutoConnectServers.length;
      const label = count === 1 ? 'server' : 'servers';
      console.log(chalk.gray(`MCP startup: connecting ${count} ${label} in background...`));
    }

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
        const [gitStatusResult, gitLogResult] = await Promise.all([
          execFileAsync('git', ['status', '-sb'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
          execFileAsync('git', ['log', '--oneline', '-5'], { cwd: workspaceRoot, encoding: 'utf8' }).catch(() => null),
        ]);
        const recentFiles = collector.getCachedFiles().slice(0, 20);
        await engine.generateFromProjectContext({
          gitStatus: gitStatusResult?.stdout.trim() || undefined,
          recentCommits: gitLogResult?.stdout.trim() || undefined,
          recentFiles,
        });
      })();
    }

    // Show prompt immediately - don't wait for init
    await this.runInteractiveLoop();
  }

  /**
   * Background initialization - runs while prompt is visible.
   * Everything here happens concurrently with the user reading/typing.
   * NOTE: Must NOT write to stdout - the prompt is already rendering.
   */
  private async performBackgroundInit(): Promise<void> {
    try {
      // Phase 1: Parallel manager initialization
      await Promise.all([
        this.sessionManager.initialize(),
        this.projectManager.initialize(),
        this.memoryManager.initialize(),
        this.skillsRegistry.initialize(),
        this.hookManager.initialize(),
        this.workspaceFileCollector.collectWorkspaceFiles(),
      ]);

      // Fire MCP connections in background (non-blocking, like Claude Code).
      // Servers connect asynchronously; tools become available once ready.
      // Does NOT block the main init pipeline or user prompt.
      if (this.runtime.config.mcp?.enabled !== false) {
        this.mcpStartupConnectStartedAt = Date.now();
        this.mcpReady = this.mcpManager
          .connectAll(this.runtime.config.mcp?.servers ?? [])
          .then(() => { this.syncMcpTools(); })
          .catch(() => { /* individual server errors already captured by connectAll */ })
          .finally(() => {
            this.mcpStartupSummaryPending = true;
          });
      }

      // Phase 2: Sequential setup that depends on phase 1

      await this.skillsRegistry.setWorkspace(this.runtime.workspaceRoot);
      await this.resetConversationContext();
      this.feedbackManager.startSession();
      const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
      const model = this.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
      await this.sessionManager.createSession(this.runtime.workspaceRoot, model);

      // Phase 3: Telemetry (no stdout output)
      const session = this.sessionManager.getCurrentSession();
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
    await Promise.all([
      this.sessionManager.initialize(),
      this.projectManager.initialize(),
      this.memoryManager.initialize(),
      this.skillsRegistry.initialize(),
      this.hookManager.initialize(),
      // Pre-load workspace files in background for file mentions
      this.workspaceFileCollector.collectWorkspaceFiles(),
    ]);
    // Fire MCP connections in background (non-blocking)
    if (this.runtime.config.mcp?.enabled !== false) {
      this.mcpReady = this.mcpManager
        .connectAll(this.runtime.config.mcp?.servers ?? [])
        .then(() => { this.syncMcpTools(); })
        .catch(() => {})
        .finally(() => {
          this.mcpStartupSummaryPending = true;
        });
    }
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

  async resumeSession(sessionId: string): Promise<void> {
    // Initialize managers and pre-load files in parallel
    await Promise.all([
      this.sessionManager.initialize(),
      this.projectManager.initialize(),
      this.memoryManager.initialize(),
      // Pre-load workspace files in background so prompt appears instantly
      this.workspaceFileCollector.collectWorkspaceFiles(),
    ]);

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

  private lastErrorMessage: string | null = null;
  private consecutiveErrorCount = 0;

  private logQueuedProcessingMessage(instruction: string, remaining = 0): void {
    const preview = `${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}`;
    const headline = chalk.cyan(`▶ Processing queued request: "${preview}"`);
    const detail = remaining > 0 ? chalk.gray(`  ${remaining} more request(s) queued`) : '';
    const usingTerminalRegions = this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0' &&
      !this.useInkRenderer;

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
    while (true) {
      try {
        let instruction: string | null = null;

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
          instruction = await this.promptForInstruction();
        }

        if (!instruction) {
          continue;
        }

        // Handle ! shell commands locally (never send to LLM)
        if (isShellCommand(instruction)) {
          const shellCmd = parseShellCommand(instruction);
          console.log(chalk.gray(`\n$ ${shellCmd}`));
          const result = executeShellCommand(shellCmd, this.runtime.workspaceRoot);
          if (result.success) {
            if (result.output) console.log(result.output);
          } else {
            console.log(chalk.red(result.error || 'Command failed'));
          }
          continue;
        }

        // Ensure background init is complete before processing any instruction.
        // This runs while the user was typing, so it's usually already done.
        await this.ensureInitComplete();
        this.flushMcpStartupSummaryIfPending();

        if (instruction === '/exit' || instruction === '/quit') {
          // Fire-and-forget: don't block quit on telemetry
          this.telemetryManager.trackCommand({ command: instruction }).catch(() => {});
          const trigger = this.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = this.sessionManager.getCurrentSession();
            await this.feedbackManager.promptForFeedback(trigger, session?.metadata.sessionId);
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

        const turnStartTime = Date.now();
        await this.runInstruction(instruction);
        this.flushMcpStartupSummaryIfPending();

        // Start generating next-step suggestion in background.
        // The promise is awaited in promptForInstruction() with a deadline
        // so the LLM call runs concurrently with hooks/notifications below.
        if (this.suggestionEngine) {
          this.pendingSuggestion = this.suggestionEngine.generate(this.conversation.history());
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
          this.lastErrorMessage = null;
          this.consecutiveErrorCount = 0;
          continue;
        }

        const errorMessage = (error as Error).message || 'Unknown error occurred';

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

        console.error(chalk.red('\nAn error occurred:'));
        console.error(chalk.red(errorMessage));
        console.error(chalk.gray(`Error logged to: ${this.errorLogger.getLogPath()}\n`));

        continue;
      }
    }
  }

  private async promptForInstruction(): Promise<string | null> {
    // Use cached workspace files for instant prompt display.
    // Files are pre-loaded during runInteractive() init and cached for 30s.
    // Trigger a background refresh without blocking the prompt.
    const workspaceFiles = this.workspaceFileCollector.getCachedFiles();
    this.workspaceFileCollector.collectWorkspaceFiles().catch(() => {});
    const statusLine = this.formatStatusLine();
    const initialValue = this.promptSeedInput;
    this.promptSeedInput = '';
    // Wait for the pending suggestion LLM call to finish.
    // Startup gets a longer deadline (5s) since the first API call is cold
    // and the user is still reading the banner. Subsequent prompts use 1.5s
    // because the LLM call ran concurrently with the previous turn's output.
    if (this.pendingSuggestion) {
      const deadlineMs = this.isStartupSuggestion ? 5000 : 1500;
      this.isStartupSuggestion = false;
      const deadline = new Promise<void>((r) => setTimeout(r, deadlineMs));
      await Promise.race([this.pendingSuggestion, deadline]).catch(() => {});
      this.pendingSuggestion = null;
    }
    const suggestionText = this.suggestionEngine?.getSuggestion() ?? undefined;
    this.suggestionEngine?.clear();
    const input = await readInstruction(
      workspaceFiles,
      SLASH_COMMANDS,
      statusLine,
      {}, // default IO
      (data, mimeType, filename) => this.imageManager.add(data, mimeType, filename),
      this.runtime.workspaceRoot,
      initialValue,
      suggestionText
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

        const handled = await this.handleSlashCommand(command, args);
        if (handled !== null) {
          // Slash command returned display output - print it, don't send to LLM
          console.log(handled);
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
    const normalized = instruction.trim().toLowerCase();
    if (!normalized) return false;

    // Keep fast-path scoped to obvious casual chat only.
    // All coding/analysis tasks should go through the full ReAct loop.
    if (normalized.length > 200) return false;
    if (normalized.includes('@')) return false;
    if (normalized.startsWith('/')) return false;
    if (normalized.startsWith('!')) return false;

    const codingOrActionKeywords = /\b(file|create|edit|delete|run|fix|implement|refactor|build|test|install|commit|push|read|write|search|find|list|show me|update|add|remove|change|modify|rename|copy|move|execute|deploy|check|analyze|review|debug|inspect|explore|look at|open|save)\b/i;
    if (codingOrActionKeywords.test(normalized)) return false;

    const casualPatterns = [
      /^(hi|hello|hey|yo|sup|hola|bonjour|ola)\b/,
      /^(thanks|thank you|thx|cool|nice|awesome|great|ok|okay)\b/,
      /\b(tell me a joke|another joke|say something funny|make me laugh)\b/,
      /\bwho are you\b/,
      /\bwhat can you do\b/,
      /^good (morning|afternoon|evening)\b/,
    ];

    return casualPatterns.some((pattern) => pattern.test(normalized));
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
      this.lastAssistantResponseForNotification = content;
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
    this.lastAssistantResponseForNotification = '';

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

    const queueEnabled = this.runtime.config.agent?.enableRequestQueue !== false;
    const canUsePersistentInput = process.stdout.isTTY && process.stdin.isTTY && queueEnabled;

    // Initialize UI (InkRenderer or ora spinner)
    // Pass abort controller for InkRenderer to handle ESC/Ctrl+C
    await this.initializeUI(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        this.stopStatusUpdates();
        this.stopUI();
        console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
      }
    }, canUsePersistentInput);

    const shouldUsePersistentInput = canUsePersistentInput && !this.inkRenderer;
    let cleanupConsoleBridge: () => void = () => {};

    if (shouldUsePersistentInput) {
      this.persistentInput.start();
      this.persistentInputActiveTurn = true;
      cleanupConsoleBridge = this.installPersistentConsoleBridge();
      if (this.promptSeedInput && !this.persistentInput.getCurrentInput()) {
        this.persistentInput.setCurrentInput(this.promptSeedInput);
        this.promptSeedInput = '';
      }
      this.persistentInput.setStatusLine(this.formatStatusLine());
    } else {
      this.persistentInputActiveTurn = false;
    }

    // Print user instruction AFTER persistent input is started so it
    // renders inside the scroll region (not overwritten by the fixed region).
    this.printUserInstructionToChatLog(instruction);

    // Only one input owner should handle interrupts:
    // InkRenderer, PersistentInput, or fallback ESC listener.
    const handleCancel = () => {
      if (!canceledByUser) {
        canceledByUser = true;
        this.stopStatusUpdates();
        this.stopUI();
        console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
      }
    };

    const cleanupEsc = this.useInkRenderer
      ? () => {} // No-op, Ink handles input
      : shouldUsePersistentInput
        ? this.setupPersistentInputInterruptHandlers(abortController, handleCancel)
        : this.setupEscListener(abortController, handleCancel, true);
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
      cleanupConsoleBridge();
      cleanupEsc();
      stopPreparation();
      this.stopStatusUpdates();
      const keepPersistentInputForNextTurn =
        this.persistentInputActiveTurn &&
        (this.persistentInput.hasQueued() || this.persistentInput.getCurrentInput().trim().length > 0);
      if (this.persistentInputActiveTurn) {
        this.promptSeedInput = this.persistentInput.getCurrentInput();
      }
      // Stop the spinner BEFORE disabling scroll regions. ora tracks its
      // cursor position relative to the active scroll region; if regions are
      // reset first, ora.stop() moves the cursor to an incorrect absolute
      // row (typically row 1), causing the next prompt to render at the top.
      this.cleanupUI();

      if (this.persistentInputActiveTurn && !keepPersistentInputForNextTurn) {
        this.persistentInput.stop();
        this.persistentInputActiveTurn = false;
      }

      // Ensure the cursor is on a fresh blank line after cleanup so the next
      // prompt box doesn't overwrite the last output row.
      if (process.stdout.isTTY && !this.useInkRenderer) {
        process.stdout.write('\n');
      }

      // Show completion summary (skip if using Ink - it handles this via completionStats)
      if (this.taskStartedAt && !canceledByUser && !this.useInkRenderer) {
        const elapsed = formatElapsedTime(this.taskStartedAt);
        const tokens = formatTokens(this.totalTokensUsed);
        // Count queued instructions from all sources
        const queueCount = this.pendingInkInstructions.length +
          (this.inkRenderer?.getQueueCount() ?? 0) +
          this.persistentInput.getQueueLength();
        const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';
        console.log(chalk.gray(`Completed in ${elapsed} · ${tokens} used${queueStatus}`));
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
    // Clean up persistent input immediately
    this.persistentInput.dispose();

    const session = this.sessionManager.getCurrentSession();

    if (!session) {
      console.log(chalk.gray('Ending Autohand session.'));
      // Fire-and-forget cleanup
      this.mcpManager.disconnectAll().catch(() => {});
      this.telemetryManager.shutdown().catch(() => {});
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

    // Run all network/cleanup ops in parallel with a 2s timeout
    const sessionDuration = Date.now() - this.sessionStartedAt;
    const cleanup = Promise.all([
      this.mcpManager.disconnectAll().catch(() => {}),
      this.hookManager.executeHooks('session-end', {
        sessionId: session.metadata.sessionId,
        sessionEndReason: 'quit',
        duration: sessionDuration,
      }).catch(() => {}),
      this.telemetryManager.syncSession({
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        })),
        metadata: { workspaceRoot: this.runtime.workspaceRoot }
      }).catch(() => {}),
      this.telemetryManager.endSession('completed').catch(() => {}),
    ]);

    // Wait at most 2s for cleanup, then exit regardless
    await Promise.race([
      cleanup,
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);

    this.telemetryManager.shutdown().catch(() => {});
  }

  private async runReactLoop(abortController: AbortController): Promise<void> {
    this.consecutiveCancellations = 0;

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
    let allTools = this.toolManager.toFunctionDefinitions();

    // Gate web tools: only offer web_search/fetch_url/web_repo when a
    // reliable search provider is configured (Brave/Parallel with API key,
    // or Google). DuckDuckGo (the default) is unreliable and causes the LLM
    // to get stuck in retry loops.
    if (!isSearchConfigured()) {
      const WEB_TOOLS = new Set(['web_search', 'fetch_url', 'web_repo']);
      allTools = allTools.filter(t => !WEB_TOOLS.has(t.name));
    }

    if (debugMode) process.stderr.write(`[AGENT DEBUG] Loaded ${allTools.length} tools, maxIterations=${maxIterations}\n`);

    // Start status updates for the main loop
    this.startStatusUpdates();

    // Check if thinking should be shown
    const showThinking = this.runtime.config.ui?.showThinking !== false;
    const identicalCallHardLimit = 6;
    const identicalCallAndResultLimit = 3;
    const forceNoToolsViolationLimit = 2;
    const perToolFailureLimit = 2; // Max consecutive failures for same tool (regardless of args)
    let lastToolCallSignature = '';
    let identicalToolCallCount = 0;
    let lastToolResultSignature = '';
    let identicalToolResultCount = 0;
    let forceNoToolsUntilResponse = false;
    let forceNoToolsViolationCount = 0;
    const toolConsecutiveFailures = new Map<string, number>();

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

      if (forceNoToolsUntilResponse) {
        tools = [];
      }

      // Use ContextManager for smart auto-compaction when enabled
      const model = this.runtime.options.model ?? getProviderConfig(this.runtime.config, this.activeProvider)?.model ?? 'unconfigured';

      if (this.contextCompactionEnabled) {
        // Use tiered context management (70% compress, 80% summarize, 90%+ crop)
        this.contextManager.setModel(model);
        const prepared = await this.contextManager.prepareRequest(tools);

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
            const summary = await this.summarizeRemovedMessages(removed);
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

      // Keep spinner active without switching to a non-boxed status renderer.
      if (this.runtime.spinner && !this.runtime.spinner.isSpinning) {
        this.runtime.spinner.start();
      }
      if (!this.inkRenderer) {
        this.forceRenderSpinner();
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

        // Detect context overflow (400 from API) and auto-compact before retrying
        if (this.isContextOverflowError(errMsg)) {
          // Auto-report context overflow (fire-and-forget)
          this.autoReportManager.reportError(
            llmError instanceof Error ? llmError : new Error(errMsg),
            {
              errorType: 'context_overflow',
              model: this.runtime.options.model,
              provider: this.activeProvider,
              conversationLength: this.conversation.history().length,
              contextUsagePercent: Math.round((1 - this.contextPercentLeft / 100) * 100),
            }
          ).catch(() => {});

          this.runtime.spinner?.stop();
          console.log(chalk.yellow('\n⚠ Context too long for model, auto-compacting...'));

          // Force aggressive crop to ~50% usage
          const currentMessages = this.conversation.history();
          const targetRemove = Math.ceil(currentMessages.length * 0.4);
          const removed = this.conversation.cropHistory('top', targetRemove);

          if (removed.length > 0) {
            const summary = await this.summarizeRemovedMessages(removed);
            this.conversation.addSystemNote(
              `[Auto-Recovery] ${removed.length} messages compacted after context overflow.\n` +
              `Summary: ${summary}`
            );
            console.log(chalk.gray(`   Compacted ${removed.length} messages, retrying...`));
            continue; // Retry the current iteration with compacted context
          }
        }

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
        console.log(chalk.yellow(`  - finishReason: ${completion.finishReason ?? '(none)'}`));
      }

      // Detect truncated responses - some models silently cut off at max_tokens
      if (completion.finishReason === 'length' && !payload.finalResponse) {
        if (debugMode) process.stderr.write(`[AGENT DEBUG] Response truncated (finishReason=length), asking model to continue\n`);
        this.conversation.addSystemNote(
          '[System] Your previous response was truncated due to output length limits. ' +
          'Please continue from where you left off. If you were making a tool call, retry it.'
        );
        continue;
      }

      // Show what the LLM is doing for visibility
      const toolCount = payload.toolCalls?.length ?? 0;
      // Response could come from finalResponse, response, or thought (when no tool calls)
      const hasResponse = Boolean(payload.finalResponse || payload.response || (!toolCount && payload.thought));
      const thoughtPreview = payload.thought?.slice(0, 80) || '';

      if (!payload.toolCalls?.length) {
        forceNoToolsViolationCount = 0;
      }

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
        const toolCallSignature = this.buildToolLoopCallSignature(payload.toolCalls);
        if (toolCallSignature === lastToolCallSignature) {
          identicalToolCallCount += 1;
        } else {
          lastToolCallSignature = toolCallSignature;
          identicalToolCallCount = 1;
          lastToolResultSignature = '';
          identicalToolResultCount = 0;
          forceNoToolsViolationCount = 0;
        }

        if (forceNoToolsUntilResponse) {
          forceNoToolsViolationCount += 1;
          this.conversation.addSystemNote(
            '[Critical Loop Guard] You are still calling tools after being told to stop. ' +
            'Do not call tools again. Provide your finalResponse now.'
          );

          if (forceNoToolsViolationCount >= forceNoToolsViolationLimit) {
            this.stopStatusUpdates();
            const loopFallback =
              'I stopped repeated tool calls to prevent a loop and token waste. ' +
              'Please confirm if you want a direct answer now or a narrower retry instruction.';
            this.lastAssistantResponseForNotification = loopFallback;
            if (this.inkRenderer) {
              this.inkRenderer.setWorking(false);
              this.inkRenderer.setFinalResponse(loopFallback);
            } else {
              this.runtime.spinner?.stop();
              console.log(loopFallback);
            }
            this.emitOutput({ type: 'message', content: loopFallback });
            return;
          }

          continue;
        }

        if (identicalToolCallCount >= identicalCallHardLimit) {
          forceNoToolsUntilResponse = true;
          this.conversation.addSystemNote(
            `[Critical Loop Guard] Repeated tool call sequence detected (${identicalToolCallCount}x). ` +
            `Last sequence: ${this.truncateToolLoopSignature(toolCallSignature)}. ` +
            'Stop calling tools and provide your finalResponse using the current results.'
          );
          continue;
        }

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

          // Detect when ALL tool calls were denied by the user
          const allDenied = results.length > 0 && results.every(r =>
            !r.success && (r.output === 'Tool execution skipped by user.' || r.error === 'Tool execution skipped by user.')
          );
          if (allDenied) {
            const deniedTools = results.map(r => r.tool).join(', ');
            this.conversation.addSystemNote(
              `[IMPORTANT] The user has explicitly declined the following tool call(s): ${deniedTools}. ` +
              `Do NOT retry the same tool(s) with the same arguments. The user said "No". ` +
              `Instead, ask the user how they would like to proceed, or suggest an alternative approach. ` +
              `If there is nothing else to do, provide your final response.`
            );
          }

          // Track per-tool consecutive failures (catches loops where LLM varies args but same tool keeps failing)
          for (const result of results) {
            if (!result.success) {
              const count = (toolConsecutiveFailures.get(result.tool) ?? 0) + 1;
              toolConsecutiveFailures.set(result.tool, count);
              if (count >= perToolFailureLimit) {
                const errorSnippet = (result.error ?? result.output ?? '').slice(0, 200);
                this.conversation.addSystemNote(
                  `[Tool Failure Guard] The "${result.tool}" tool has failed ${count} times consecutively. ` +
                  `Latest error: ${errorSnippet}\n` +
                  `STOP using "${result.tool}". Do NOT retry it with different arguments. Instead:\n` +
                  `- If you can answer from your own knowledge, provide a finalResponse directly.\n` +
                  `- If the tool requires configuration (e.g., API key, provider), tell the user what to configure.\n` +
                  `- If the task cannot be completed without this tool, explain the limitation to the user.`
                );
              }
            } else {
              toolConsecutiveFailures.delete(result.tool);
            }
          }

          // Detect repeated ask_followup_question cancellations — force the LLM to stop asking
          if (this.consecutiveCancellations >= 2) {
            this.conversation.addSystemNote(
              `[CRITICAL] The user has cancelled ask_followup_question ${this.consecutiveCancellations} times in a row. ` +
              `STOP calling ask_followup_question immediately. Do NOT ask the user any more questions. ` +
              `Provide your best final response now using the information you already have.`
            );
          }

          const toolResultSignature = this.buildToolLoopResultSignature(results);
          if (toolResultSignature === lastToolResultSignature) {
            identicalToolResultCount += 1;
          } else {
            lastToolResultSignature = toolResultSignature;
            identicalToolResultCount = 1;
          }

          if (
            identicalToolCallCount >= identicalCallAndResultLimit &&
            identicalToolResultCount >= identicalCallAndResultLimit
          ) {
            forceNoToolsUntilResponse = true;
            this.conversation.addSystemNote(
              '[Critical Loop Guard] Tool calls and outputs are repeating without progress. ' +
              'Stop calling tools and provide your finalResponse now.'
            );
          }
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

      // If response is empty, try to get a proper response
      // This applies on any iteration (including 0) to prevent silent exit on parse failure
      if (!response) {
        // Track consecutive empty responses to prevent infinite loops
        const consecutiveEmptyKey = '__consecutiveEmpty';
        const consecutiveEmpty = ((this as any)[consecutiveEmptyKey] ?? 0) + 1;
        (this as any)[consecutiveEmptyKey] = consecutiveEmpty;

        if (consecutiveEmpty >= 3) {
          // After 3 retries, force a fallback and break out
          if (debugMode) process.stderr.write(`[AGENT DEBUG] Exiting after 3 consecutive empty responses\n`);
          console.log(chalk.yellow('\n⚠ Model not providing response after multiple attempts. Showing available context.'));
          const fallback = payload.thought || 'The model did not provide a clear response. Please try rephrasing your question.';
          this.lastAssistantResponseForNotification = fallback;
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
      this.lastAssistantResponseForNotification = response;

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

    // Try to get a final summary from the LLM instead of hard-throwing
    try {
      this.conversation.addSystemNote(
        '[System] You have used all available iterations. Provide a final summary of what was accomplished and what remains to be done. Do not call any more tools.'
      );

      const summaryCompletion = await this.llm.complete({
        messages: this.conversation.history(),
        temperature: 0.2,
        model: this.runtime.options.model,
        maxTokens: 2000,
      });

      const summaryResponse = summaryCompletion.content?.trim();
      if (summaryResponse) {
        this.lastAssistantResponseForNotification = summaryResponse;
        if (this.inkRenderer) {
          this.inkRenderer.setWorking(false);
          this.inkRenderer.setFinalResponse(summaryResponse);
        } else {
          console.log(summaryResponse);
        }
        this.emitOutput({ type: 'message', content: summaryResponse });
        return;
      }
    } catch {
      // Summary call failed - fall through to static summary
    }

    // Last resort: show a static summary of what was accomplished
    const staticSummary = await this.contextManager.summarizeWithLLM(
      this.conversation.history().slice(1) // skip system prompt
    );
    const fallbackMsg = `Task did not complete within ${maxIterations} iterations.\n\nProgress summary:\n${staticSummary}`;
    this.lastAssistantResponseForNotification = fallbackMsg;
    if (this.inkRenderer) {
      this.inkRenderer.setWorking(false);
      this.inkRenderer.setFinalResponse(fallbackMsg);
    } else {
      console.log(chalk.gray(fallbackMsg));
    }
    this.emitOutput({ type: 'message', content: fallbackMsg });
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

    // Fallback: some models output <tool_call> XML tags in text content
    // instead of using the native tool calling API
    const xmlToolCalls = this.extractXmlToolCalls(completion.content);
    if (xmlToolCalls.length > 0) {
      // Strip <tool_call> blocks from content to extract any surrounding text as thought
      const textOutside = completion.content
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .trim();
      return {
        thought: textOutside || undefined,
        toolCalls: xmlToolCalls
      };
    }

    return this.parseAssistantReactPayload(completion.content);
  }

  /**
   * Extract tool calls from <tool_call> XML tags in text content.
   * Some models output tool calls as:
   *   <tool_call>{"name": "write_file", "arguments": {"path": "...", "contents": "..."}}</tool_call>
   *
   * Handles edge cases:
   * - Multiple tool calls in one response
   * - Truncated/retried tool calls (LLM outputs a partial <tool_call> then restarts)
   * - Unclosed <tool_call> tags (no </tool_call>)
   */
  private extractXmlToolCalls(content: string): ToolCallRequest[] {
    if (!content?.includes('<tool_call>')) return [];

    const calls: ToolCallRequest[] = [];

    // Phase 1: Match closed <tool_call>...</tool_call> pairs
    const closedRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match;

    while ((match = closedRegex.exec(content)) !== null) {
      let inner = match[1].trim();

      // Handle retried output: if inner contains another <tool_call>,
      // the LLM retried mid-stream. Take content after the last tag.
      const lastTagIdx = inner.lastIndexOf('<tool_call>');
      if (lastTagIdx !== -1) {
        inner = inner.substring(lastTagIdx + '<tool_call>'.length).trim();
      }

      const parsed = this.tryParseXmlToolCall(inner);
      if (parsed) calls.push(parsed);
    }

    // Phase 2: Handle unclosed <tool_call> at end of content (no </tool_call>)
    if (calls.length === 0) {
      const lastOpen = content.lastIndexOf('<tool_call>');
      if (lastOpen !== -1) {
        const remaining = content.substring(lastOpen + '<tool_call>'.length).trim();
        // Only attempt if there's JSON-like content
        if (remaining.startsWith('{')) {
          const parsed = this.tryParseXmlToolCall(remaining);
          if (parsed) calls.push(parsed);
        }
      }
    }

    return calls;
  }

  /**
   * Try to parse a single tool call from JSON content extracted from a <tool_call> block.
   */
  private tryParseXmlToolCall(json: string): ToolCallRequest | null {
    try {
      const parsed = JSON.parse(json);
      const name = parsed.name || parsed.tool;
      if (!name) return null;

      // Arguments can be in "arguments" or "args" field, or at top level
      let args = parsed.arguments || parsed.args;
      if (!args || typeof args !== 'object') {
        // Try top-level keys (excluding name/tool/id)
        const topLevel: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (!['name', 'tool', 'id', 'arguments', 'args'].includes(key)) {
            topLevel[key] = value;
          }
        }
        if (Object.keys(topLevel).length > 0) args = topLevel;
      }

      // If arguments is a string (double-encoded JSON), parse it
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { /* keep as-is */ }
      }

      return {
        id: parsed.id || randomUUID(),
        tool: name as AgentAction['type'],
        args
      };
    } catch {
      return null;
    }
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
      '3. Destructive operations (delete_path, run_command with rm/sudo) require explicit user approval. Clearly justify them.',
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
      '### Tool Failure Handling',
      'When a tool fails, do NOT retry the same tool with different arguments. Instead:',
      '1. If the task is simple (jokes, general knowledge, explanations, opinions) — answer directly from your own knowledge without tools.',
      '2. If the tool requires configuration (e.g., web_search needs a search provider API key), tell the user what to configure and answer from your own knowledge if possible.',
      '3. If the tool failure is transient (timeout, network error), you may retry ONCE with the exact same arguments. Do not rephrase and retry.',
      '4. After ANY tool failure, prefer providing a direct finalResponse over calling more tools.',
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
      // 5.1. PLAN MODE
      // ═══════════════════════════════════════════════════════════════════
      '## Plan Mode',
      'When in plan mode (read-only exploration phase), you can only use read-only tools.',
      'Use the `plan` tool to create a structured plan before execution.',
      '',
      '### Plan Format',
      'When using the `plan` tool, the `notes` field MUST contain a numbered step-by-step plan.',
      'Break the task into 3-10 concrete, actionable steps. Each step should be specific enough to execute independently.',
      'NEVER submit a single sentence as the plan - always break it into multiple numbered steps.',
      '',
      'Example plan notes:',
      '"1. Read the existing authentication code in src/auth/\\n2. Create JWT utility module at src/auth/jwt.ts\\n3. Add token generation and validation functions\\n4. Update login endpoint to use JWT\\n5. Write unit tests for JWT module\\n6. Run tests and verify"',
      '',
      'When presenting a plan, always include:',
      '1. **Overview**: Brief summary of what will be accomplished',
      '2. **Steps**: Numbered list of implementation steps',
      '3. **Suggested TODO List**: A checkbox-style task list the user can copy',
      '',
      'For the Suggested TODO List, use markdown checkbox format:',
      '```',
      '## Suggested TODO List',
      '- [ ] First task to complete',
      '- [ ] Second task to complete',
      '- [ ] Third task to complete',
      '```',
      '',
      'This format renders as interactive checkboxes in the UI.',
      'IMPORTANT: Always include the actual TODO items after the heading - never leave the list empty.',
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

    // List available agents for team formation
    const { AgentRegistry } = await import('./agents/AgentRegistry.js');
    const agentRegistry = AgentRegistry.getInstance();
    await agentRegistry.loadAgents();
    const allAgents = agentRegistry.getAllAgents();
    if (allAgents.length > 0) {
      parts.push('', '## Available Agents');
      parts.push('These agents can be spawned as teammates using create_team + add_teammate:');
      for (const agent of allAgents) {
        parts.push(`- **${agent.name}**: ${agent.description}`);
      }
    }

    // Show active team context if exists
    const activeTeam = this.teamManager.getTeam();
    if (activeTeam) {
      parts.push('', '## Active Team: ' + activeTeam.name);
      for (const m of activeTeam.members) {
        parts.push(`- ${m.name} [${m.agentName}] ${m.status}`);
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

    // showFilePalette is statically imported at the top of this file
    const selection = await showFilePalette({
      files: workspaceFiles,
      statusLine: this.formatStatusLine().left,
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
   * Generate a concise summary of removed messages using LLM-powered summarization.
   * Delegates to ContextManager.summarizeWithLLM for rich summaries,
   * falling back to static extraction if LLM is unavailable.
   */
  private async summarizeRemovedMessages(messages: LLMMessage[]): Promise<string> {
    return this.contextManager.summarizeWithLLM(messages);
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

  private buildToolLoopCallSignature(calls: ToolCallRequest[]): string {
    return calls
      .map((call) => {
        const args = call.args === undefined ? '' : this.stableSerializeForLoop(call.args);
        return `${call.tool}:${args}`;
      })
      .sort()
      .join('|');
  }

  private buildToolLoopResultSignature(
    results: Array<{ tool: AgentAction['type']; success: boolean; output?: string; error?: string }>
  ): string {
    return results
      .map((result) => {
        const payload = result.success ? result.output : (result.error ?? result.output ?? '');
        const normalized = this.normalizeToolLoopText(payload);
        return `${result.tool}:${result.success ? 'ok' : 'err'}:${normalized}`;
      })
      .sort()
      .join('|');
  }

  private stableSerializeForLoop(value: unknown): string {
    const normalize = (input: unknown): unknown => {
      if (Array.isArray(input)) {
        return input.map((entry) => normalize(entry));
      }
      if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
          normalized[key] = normalize(record[key]);
        }
        return normalized;
      }
      return input;
    };

    try {
      const serialized = JSON.stringify(normalize(value));
      return serialized ?? String(value);
    } catch {
      return String(value);
    }
  }

  private normalizeToolLoopText(value: string | undefined): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
  }

  private truncateToolLoopSignature(signature: string, maxLength = 180): string {
    if (signature.length <= maxLength) {
      return signature;
    }
    return `${signature.slice(0, Math.max(0, maxLength - 3))}...`;
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
  private async initializeUI(
    abortController?: AbortController,
    onCancel?: () => void,
    suppressSpinner = false
  ): Promise<void> {
    if (this.useInkRenderer && process.stdout.isTTY && process.stdin.isTTY) {
      // createInkRenderer is statically imported at the top of this file
      try {
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
        if (!suppressSpinner) {
          this.initFallbackSpinner();
        }
      }
    } else if (process.stdout.isTTY && !suppressSpinner) {
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
      this.setSpinnerStatus(status);
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
      safeSetRawMode(input, true);
    }
    // promptOnce() pauses stdin during cleanup, so resume to keep queue capture alive mid-turn.
    try {
      input.resume();
    } catch {
      // Best effort, continue without failing interactive turn.
    }
    try {
      input.setEncoding('utf8');
    } catch {
      // Best effort, continue without failing interactive turn.
    }

    let ctrlCCount = 0;
    this.queueInput = '';
    const enableQueue = this.runtime.config.agent?.enableRequestQueue !== false;
    const enableEscQueueInput = enableQueue && !this.persistentInputActiveTurn;
    const rawEnabled = supportsRaw ? Boolean((input as any).isRaw) : false;
    const useLineQueueFallback = enableEscQueueInput && !rawEnabled;
    let lastKeypressAt = 0;
    let lineReader: readline.Interface | null = null;

    const submitQueueInput = () => {
      if (!this.queueInput.trim()) {
        return;
      }

      const text = this.queueInput.trim();
      this.queueInput = '';

      // Shell commands (!) and slash commands (/) execute immediately, never queued
      if (isImmediateCommand(text)) {
        if (isShellCommand(text)) {
          const cmd = parseShellCommand(text);
          console.log(chalk.gray(`\n$ ${cmd}`));
          const result = executeShellCommand(cmd, this.runtime.workspaceRoot);
          if (result.success) {
            if (result.output) console.log(result.output);
          } else {
            console.log(chalk.red(result.error || 'Command failed'));
          }
        } else if (text.startsWith('/')) {
          const { command, args } = this.parseSlashCommand(text);
          this.handleSlashCommand(command, args)
            .then((handled) => {
              if (handled !== null) {
                console.log(handled);
              }
            })
            .catch((err: Error) => {
              console.log(chalk.red(`\nCommand error: ${err.message}`));
            });
        }
        this.updateInputLine();
        return;
      }

      const queue = (this.persistentInput as any).queue as Array<{ text: string; timestamp: number }>;
      if (queue.length >= 10) {
        this.updateInputLine();
        return;
      }
      queue.push({ text, timestamp: Date.now() });

      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      if (this.runtime.spinner) {
        this.runtime.spinner.text = chalk.cyan(`✓ Queued: "${preview}" (${this.persistentInput.getQueueLength()} pending)`);
      }
      this.updateInputLine();
    };

    const ingestTextChunk = (chunk: string) => {
      if (!chunk) {
        return;
      }

      const normalized = chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const hasSubmit = normalized.includes('\n');
      const printable = normalized.replace(/\n/g, '').replace(/[\x00-\x1F\x7F]/g, '');
      if (printable) {
        this.queueInput += printable;
      }

      if (hasSubmit) {
        submitQueueInput();
        return;
      }

      if (printable) {
        this.updateInputLine();
      }
    };

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

      if (enableEscQueueInput) {
        if (useLineQueueFallback) {
          return;
        }

        if (key?.name === 'return' || key?.name === 'enter') {
          submitQueueInput();
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
          lastKeypressAt = Date.now();
        }
        ingestTextChunk(_str);
      }
    };
    const dataHandler = (chunk: string | Buffer) => {
      if (controller.signal.aborted || !enableEscQueueInput) {
        return;
      }
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const now = Date.now();
      // In raw mode, emitKeypressEvents and the data event can both fire for the same bytes.
      // Deduplicate those bursts to avoid double-queuing typed input.
      if (now - lastKeypressAt < 30) {
        return;
      }
      ingestTextChunk(text);
    };
    if (useLineQueueFallback) {
      lineReader = readline.createInterface({
        input,
        crlfDelay: Infinity,
        historySize: 0,
        terminal: false,
      });
      lineReader.on('line', (line) => {
        if (controller.signal.aborted) {
          return;
        }
        this.queueInput = line;
        submitQueueInput();
      });
    }

    input.on('keypress', handler);
    if (enableEscQueueInput && !useLineQueueFallback) {
      input.on('data', dataHandler);
    }

    return () => {
      input.off('keypress', handler);
      if (enableEscQueueInput && !useLineQueueFallback) {
        input.off('data', dataHandler);
      }
      lineReader?.close();
      lineReader = null;
      this.queueInput = ''; // Clear input on cleanup
      if (!wasRaw && supportsRaw) {
        safeSetRawMode(input, false);
      }
    };
  }

  /**
   * Wire ESC/Ctrl+C through PersistentInput while it owns stdin.
   * This prevents dual keypress listeners from racing the cursor state.
   */
  private setupPersistentInputInterruptHandlers(
    controller: AbortController,
    onCancel: () => void
  ): () => void {
    let ctrlCCount = 0;

    const onEscape = () => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort();
      onCancel();
    };

    const onCtrlC = () => {
      if (controller.signal.aborted) {
        return;
      }
      ctrlCCount += 1;
      if (ctrlCCount >= 2) {
        controller.abort();
        onCancel();
      } else {
        console.log(chalk.gray('Press Ctrl+C again to exit.'));
      }
    };

    this.persistentInput.on('escape', onEscape);
    this.persistentInput.on('ctrl-c', onCtrlC);

    return () => {
      this.persistentInput.off('escape', onEscape);
      this.persistentInput.off('ctrl-c', onCtrlC);
    };
  }

  private installPersistentConsoleBridge(): () => void {
    if (this.persistentConsoleBridgeCleanup) {
      return () => {};
    }

    if (!this.persistentInputActiveTurn || process.env.AUTOHAND_TERMINAL_REGIONS === '0') {
      return () => {};
    }

    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;

    const bridgeWriter = (fallback: (...args: any[]) => void) => (...args: any[]) => {
      if (!this.persistentInputActiveTurn || process.env.AUTOHAND_TERMINAL_REGIONS === '0') {
        fallback(...args);
        return;
      }
      const text = formatText(...args);
      this.persistentInput.writeAbove(`${text}\n`);
    };

    console.log = bridgeWriter(originalLog);
    console.info = bridgeWriter(originalInfo);
    console.warn = bridgeWriter(originalWarn);
    console.error = bridgeWriter(originalError);

    const restore = () => {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
      this.persistentConsoleBridgeCleanup = null;
    };

    this.persistentConsoleBridgeCleanup = restore;
    return restore;
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
        this.setSpinnerStatus(status);
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
   * Detect context-overflow errors from API 400 responses.
   * These are recoverable via auto-compaction and retry.
   */
  private isContextOverflowError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      (lower.includes('context') && lower.includes('too long')) ||
      lower.includes('maximum context length') ||
      lower.includes('prompt is too long') ||
      lower.includes('reduce the length')
    );
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

    // Context/payload overflow - retryable (auto-compaction handles recovery)
    if (message.includes('payload too large') ||
        (message.includes('context') && message.includes('too long')) ||
        message.includes('maximum context length') ||
        message.includes('prompt is too long')) {
      return true;
    }

    // Other malformed errors remain non-retryable
    if (message.includes('malformed')) {
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
  markFilesModified(filePath?: string): void {
    this.filesModifiedThisSession = true;
    this.fileModCount++;
    if (filePath) {
      this.modifiedFilePaths.add(filePath);
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
   * Get the permission manager for mode control
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
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
    const verb = this.activityIndicator?.getVerb?.() ?? 'Working';
    const statusLine = `${verb}... (esc to interrupt · ${elapsed} · ${tokens}${queueHint})`;
    const footer = this.formatStatusLine();
    this.persistentInput.setStatusLine(footer);
    const usingTerminalRegions = this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0';
    if (usingTerminalRegions) {
      this.persistentInput.setActivityLine(statusLine);
    }

    if (this.inkRenderer) {
      // InkRenderer handles its own state updates
      this.inkRenderer.setStatus(`${verb}...`);
      this.inkRenderer.setElapsed(elapsed);
      this.inkRenderer.setTokens(tokens);
      return;
    }

    if (usingTerminalRegions) {
      return;
    }

    if (!this.runtime.spinner) return;
    const footerText = footer.left + (footer.right ? ` · ${footer.right}` : '');
    const fullText = this.buildSpinnerStatusText(statusLine, footerText);

    // Only update if something actually changed
    const cacheKey = `${statusLine}|${footerText}`;
    if (cacheKey === this.lastRenderedStatus) return;
    this.lastRenderedStatus = cacheKey;

    this.runtime.spinner.text = fullText;
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
    const usingTerminalRegions = this.persistentInputActiveTurn &&
      process.env.AUTOHAND_TERMINAL_REGIONS !== '0';
    if (usingTerminalRegions) {
      this.persistentInput.setActivityLine(status);
      return;
    }

    if (!this.runtime.spinner) {
      return;
    }

    const footer = this.formatStatusLine();
    const footerText = footer.left + (footer.right ? ` · ${footer.right}` : '');
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
          this.runtime.spinner.start();
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
    if (this.persistentInputActiveTurn && process.env.AUTOHAND_TERMINAL_REGIONS !== '0') {
      this.persistentInput.setActivityLine('');
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
    if (this.useInkRenderer) {
      return;
    }

    const normalized = instruction.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
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
    if (!this.mcpStartupSummaryPending) {
      return;
    }

    this.mcpStartupSummaryPending = false;
    this.printMcpStartupSummaryIfNeeded();
  }

  private printMcpStartupSummaryIfNeeded(): void {
    if (this.mcpStartupSummaryPrinted) {
      return;
    }
    if (this.runtime.config.mcp?.enabled === false) {
      this.mcpStartupSummaryPrinted = true;
      return;
    }
    if (this.mcpStartupAutoConnectServers.length === 0) {
      this.mcpStartupSummaryPrinted = true;
      return;
    }

    this.mcpStartupSummaryPrinted = true;

    const rows = buildMcpStartupSummaryRows(
      this.mcpStartupAutoConnectServers,
      this.mcpManager.listServers()
    );

    const elapsed = this.mcpStartupConnectStartedAt
      ? formatElapsedTime(this.mcpStartupConnectStartedAt)
      : null;

    const connected = rows.filter((row) => row.status === 'connected').length;
    const failed = rows.filter((row) => row.status === 'error').length;
    const disconnected = rows.filter((row) => row.status === 'disconnected').length;
    const summaryParts = [
      `${connected} connected`,
      failed > 0 ? `${failed} failed` : null,
      disconnected > 0 ? `${disconnected} disconnected` : null,
    ].filter(Boolean).join(', ');
    const elapsedSuffix = elapsed ? ` in ${elapsed}` : '';

    console.log(chalk.bold('\n* MCP startup'));
    console.log(chalk.gray(`  Async connection phase complete${elapsedSuffix} (${summaryParts})`));

    for (const row of rows) {
      if (row.status === 'connected') {
        const toolLabel = row.toolCount === 1 ? 'tool' : 'tools';
        console.log(`  ${chalk.green('✓')} ${row.name} connected (${row.toolCount} ${toolLabel})`);
        continue;
      }

      if (row.status === 'error') {
        const errorSuffix = row.error
          ? `: ${truncateMcpStartupError(row.error)}`
          : '';
        console.log(`  ${chalk.red('✖')} ${row.name} failed${errorSuffix}`);
        continue;
      }

      console.log(`  ${chalk.yellow('○')} ${row.name} not connected`);
    }

    console.log();
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

    this.notificationService.notify(
      { body: message, reason: 'confirmation' },
      this.getNotificationGuards()
    ).catch(() => {});

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
      safeSetRawMode(process.stdin as NodeJS.ReadStream, false);
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

    this.notificationService.notify(
      { body: `Question: ${question.slice(0, 100)}`, reason: 'question' },
      this.getNotificationGuards()
    ).catch(() => {});

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
      // showQuestionModal is statically imported at the top of this file

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
      // showPlanAcceptModal is statically imported at the top of this file

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
      planManager.acceptPlan('manual_approve');
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
