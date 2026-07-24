/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { FileActionManager } from '../../actions/filesystem.js';
import { saveConfig, getProviderConfig } from '../../config.js';
import type { LLMProvider } from '../../providers/LLMProvider.js';
import { getOpenRouterModelContextWindow } from '../../providers/modelCapabilities.js';
import { promptInterrupt, promptNotify } from '../../ui/inputPrompt.js';
import { isShellCommand, parseShellCommand } from '../../ui/shellCommand.js';
import { shouldUseInkRenderer } from '../../ui/inkMode.js';
import { getContextWindow } from '../context/tokenizer.js';
import { GitIgnoreParser } from '../../utils/gitIgnore.js';
import { createToolFilter } from '../toolFilter.js';
import { ConversationManager } from '../conversationManager.js';
import { ContextOrchestrator } from '../context/orchestrator.js';
import {
  ToolManager,
  DEFAULT_TOOL_DEFINITIONS,
  GOAL_TOOL_DEFINITIONS,
  type ToolAuthorizationOptions,
  type ToolDefinition,
} from '../toolManager.js';
import { ActionExecutor } from '../actionExecutor.js';
import { SlashCommandHandler } from '../slashCommandHandler.js';
import { routeOutput } from '../immediateCommandRouter.js';
import { SLASH_COMMANDS } from '../slashCommands.js';
import { BARE_SLASH_COMMANDS_DISABLED_MESSAGE } from '../../runtime/bareMode.js';
import { parseYoloPattern, buildPermissionSettingsFromYolo } from '../../permissions/yoloMode.js';
import { SessionManager } from '../../session/SessionManager.js';
import { ProjectManager } from '../../session/ProjectManager.js';
import { createToolsRegistry } from '../toolsRegistry.js';
import type { AgentRuntime, HookEvent, ToolActionOutcome } from '../../types.js';
import { AgentDelegator } from '../agents/AgentDelegator.js';
import { ErrorLogger } from '../errorLogger.js';
import { MemoryManager } from '../../memory/MemoryManager.js';
import { FeedbackManager } from '../../feedback/FeedbackManager.js';
import { TelemetryManager } from '../../telemetry/TelemetryManager.js';
import { SkillsRegistry } from '../../skills/SkillsRegistry.js';
import type { SkillDefinition } from '../../skills/types.js';
import { CommunitySkillsClient } from '../../skills/CommunitySkillsClient.js';
import { CommunitySkillsCache } from '../../skills/CommunitySkillsCache.js';
import { GitHubRegistryFetcher } from '../../skills/GitHubRegistryFetcher.js';
import { fetchRegistryWithFallback, installSkillWithSecurity } from '../../skills/communityInstaller.js';
import { McpClientManager } from '../../mcp/McpClientManager.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from '../../constants.js';
import { createPersistentInput } from '../../ui/persistentInput.js';
import { PermissionManager } from '../../permissions/PermissionManager.js';
import { HookManager } from '../HookManager.js';
import { TeamManager } from '../teams/TeamManager.js';
import { RepeatManager } from '../RepeatManager.js';
import { intervalToCron, shorthandToHuman, shorthandToMs } from '../../commands/repeat.js';
import { ActivityIndicator } from '../../ui/activityIndicator.js';
import { NotificationService, type NotificationOptions } from '../../utils/notification.js';
import { formatPlanModeToggleMessage } from '../../commands/plan.js';
import { formatInteractionModeChangeMessage } from '../../ui/interactionModePresentation.js';
import type { InteractionMode } from './InteractionModeController.js';
import packageJson from '../../../package.json' with { type: 'json' };
import { ImageManager, type ImageMimeType } from '../ImageManager.js';
import type {
  MobileImageAttachment,
  MobilePermissionMode,
} from '../../mobile/MobileHandoffClient.js';
import { IntentDetector } from '../IntentDetector.js';
import { EnvironmentBootstrap } from '../EnvironmentBootstrap.js';
import { CodeQualityPipeline } from '../CodeQualityPipeline.js';
import { WorkspaceFileCollector } from './WorkspaceFileCollector.js';
import { BackgroundProcessRegistry } from './BackgroundProcessRegistry.js';
import { ProviderConfigManager } from './ProviderConfigManager.js';
import { ReactionParser } from './ReactionParser.js';
import { ShellSuggestionProvider } from './ShellSuggestionProvider.js';
import { SimpleChatHandler, type SimpleChatAgent } from './SimpleChatHandler.js';
import { McpStartupCoordinator } from './McpStartupCoordinator.js';
import { MentionResolver } from './MentionResolver.js';
import { AutoReportManager } from '../../reporting/AutoReportManager.js';
import { RemoteFeatureFlagManager } from '../../features/RemoteFeatureFlagManager.js';
import { getFeatureState } from '../../features/featureRegistry.js';
import { isGoalFeatureEnabled } from '../../goals/feature.js';
import { isLikelyFilePathSlashInput } from '../slashInputDetection.js';
import { SuggestionEngine } from '../SuggestionEngine.js';
import { writeAutohandDebugLine } from '../../utils/debugLog.js';
import { configureAgentRegistry, syncDynamicRuntimeExtensions } from './dynamicRuntimeExtensions.js';
import { extensionRuntimeHost } from '../../extensions/ExtensionRuntimeHost.js';
import { ExtensionService } from '../../extensions/ExtensionService.js';
import type {
  MobileClaimedTurnContext,
  MobilePermissionModeChange,
  MobileRelayController,
} from '../../mobile/MobileRelay.js';
import type { PendingPostTurnAction } from './PostTurnActionCoordinator.js';

export interface AgentDependencyHost {
  [key: string]: any;
}

/** Queue an instruction and wake the interactive Ink loop when it is idle. */
export function enqueueInteractiveInstruction(
  host: AgentDependencyHost,
  instruction: string,
): void {
  if (host.inkRenderer) {
    host.inkRenderer.addQueuedInstruction(instruction);
  } else {
    host.pendingInkInstructions.push(instruction);
  }

  const resolver = host.inkInstructionResolver;
  if (resolver) {
    host.inkInstructionResolver = null;
    resolver();
  }
}

/** Queue an exact claimed mobile turn without losing its metadata in Ink's string-only queue. */
export function enqueueClaimedMobileInstruction(
  host: AgentDependencyHost,
  instruction: string,
  mobileTurn: MobileClaimedTurnContext,
): void {
  host.pendingInkInstructions.push({ text: instruction, mobileTurn });

  const resolver = host.inkInstructionResolver;
  if (resolver) {
    host.inkInstructionResolver = null;
    resolver();
  }
}

export function configureMobileRelayController(
  host: AgentDependencyHost,
  relay: MobileRelayController,
): void {
  host.setMobileRelayController?.(relay);
  host.setConfirmationCallback?.((
    message: string,
    context?: { tool?: string; path?: string; command?: string },
  ) => relay.requestPermission(message, context));
  host.setDirectoryAccessCallback?.((path: string, reason?: string) =>
    relay.requestDirectoryAccess(path, reason));
  relay.setSessionControlHandler((command) => {
    if (command === 'cancel') {
      host.cancelCurrentInstruction?.();
    }
  });
  relay.setModelChangeHandler((provider, model) =>
    host.providerConfigManager.applyModelChangeRemote(provider, model));
}

const MOBILE_PERMISSION_SAFETY_RANK: Record<MobilePermissionMode, number> = {
  restricted: 0,
  interactive: 1,
  unrestricted: 2,
};

/** Apply a mobile-selected permission mode through the session's canonical mode setter. */
export function applyMobilePermissionMode(
  host: {
    applyAcpMode(mode: MobilePermissionMode): void;
    getPermissionMode(): MobilePermissionMode;
    getInteractionMode?(): InteractionMode;
    setInteractionMode?(mode: InteractionMode): InteractionMode;
    notifyUser?(message: string): void;
  },
  mode: MobilePermissionMode,
): MobilePermissionModeChange {
  const previousMode = host.getPermissionMode();
  const previousInteractionMode = host.getInteractionMode?.();
  const restorePreviousState = (): void => {
    if (host.getPermissionMode() !== previousMode) {
      host.applyAcpMode(previousMode);
    }
    if (
      previousInteractionMode !== undefined
      && host.getInteractionMode?.() !== previousInteractionMode
    ) {
      host.setInteractionMode?.(previousInteractionMode);
    }
    const restored = host.getPermissionMode() === previousMode
      && (
        previousInteractionMode === undefined
        || host.getInteractionMode?.() === previousInteractionMode
      );
    if (!restored) {
      throw new Error(
        'Failed to restore the previous permission mode after abandoning mobile work.',
      );
    }
  };
  try {
    host.applyAcpMode(mode);
  } catch (error) {
    const failedMode = host.getPermissionMode();
    if (MOBILE_PERMISSION_SAFETY_RANK[previousMode] <= MOBILE_PERMISSION_SAFETY_RANK[failedMode]) {
      try {
        restorePreviousState();
      } catch (restoreError) {
        throw new Error(
          restoreError instanceof Error
            ? restoreError.message
            : 'Failed to restore the previous permission mode after abandoning mobile work.',
          { cause: error },
        );
      }
    }
    throw error;
  }
  const appliedMode = host.getPermissionMode();
  const appliedInteractionMode = host.getInteractionMode?.();
  if (appliedMode === mode && previousMode !== appliedMode) {
    try {
      host.notifyUser?.(`Autohand Mobile changed this session permission mode to ${mode}.`);
    } catch {
      // Local notification failures must not reclassify an applied permission change.
    }
  }
  return {
    previousMode,
    appliedMode,
    rollbackIfCurrent: () => {
      if (host.getPermissionMode() !== appliedMode) return false;
      if (
        appliedInteractionMode !== undefined
        && host.getInteractionMode?.() !== appliedInteractionMode
      ) {
        return false;
      }
      if (
        previousMode === appliedMode
        && previousInteractionMode === appliedInteractionMode
      ) {
        return true;
      }
      if (MOBILE_PERMISSION_SAFETY_RANK[previousMode] > MOBILE_PERMISSION_SAFETY_RANK[appliedMode]) {
        return false;
      }
      restorePreviousState();
      return true;
    },
  };
}

function normalizeMcpToolOutcome(result: unknown): ToolActionOutcome {
  if (typeof result === 'string') {
    return { success: true, output: result };
  }

  const output = result === undefined ? undefined : JSON.stringify(result);
  if (isPlainRecord(result) && result.isError === true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const contentErrors = content.flatMap((item) =>
      isPlainRecord(item) && item.type === 'text' && typeof item.text === 'string'
        ? [item.text]
        : []
    );
    const error = typeof result.error === 'string' && result.error.trim().length > 0
      ? result.error
      : contentErrors.join('\n').trim() || 'MCP tool reported a failure.';
    return {
      success: false,
      kind: 'operational',
      error,
      ...(output === undefined ? {} : { output }),
    };
  }
  return output === undefined ? { success: true } : { success: true, output };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function initializeAgentDependencies(
  host: AgentDependencyHost,
  llm: LLMProvider,
  files: FileActionManager,
  runtime: AgentRuntime
): void {
    const initialProvider = runtime.config.provider ?? 'openrouter';
    const providerSettings = getProviderConfig(runtime.config, initialProvider);
    const model = runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
    host.contextWindow = getContextWindow(model, providerSettings?.contextWindow);
    if (!runtime.options.bare && initialProvider === 'openrouter' && !providerSettings?.contextWindow && model !== 'unconfigured') {
      void getOpenRouterModelContextWindow(model)
        .then((contextWindow) => {
          if (!contextWindow || contextWindow === host.contextWindow) return;
          host.contextWindow = contextWindow;
          host.contextOrchestrator?.setContextWindow?.(contextWindow);
          if (host.conversation) {
            host.updateContextUsage?.(host.conversation.history());
          }
        })
        .catch(() => {
          // Provider metadata is best-effort; local inference remains the fallback.
        });
    }
    host.interactiveAutomodeEnabled = runtime.options.interactiveAutoMode === true;
    host.ignoreFilter = new GitIgnoreParser(runtime.workspaceRoot, []);
    host.workspaceFileCollector = new WorkspaceFileCollector(runtime.workspaceRoot, host.ignoreFilter);
    host.backgroundProcessRegistry = new BackgroundProcessRegistry();
    host.mentionResolver = new MentionResolver({
      getWorkspaceRoot: () => host.runtime.workspaceRoot,
      files: host.files,
      collectWorkspaceFiles: () => host.workspaceFileCollector.collectWorkspaceFiles(),
      getStatusLine: () => host.formatStatusLine().left,
      logWarning: (message) => console.log(message),
    });
    host.conversation = ConversationManager.getInstance();
    host.shellSuggestionProvider = new ShellSuggestionProvider({
      runtime: host.runtime,
      conversation: host.conversation,
      getLlm: () => host.llm,
      getParallelismLimit: () => host.getParallelismLimit(),
    });
    host.simpleChatHandler = new SimpleChatHandler(host as unknown as SimpleChatAgent);
    const featureGatedToolDefinitions = isGoalFeatureEnabled(runtime.config)
      ? [...DEFAULT_TOOL_DEFINITIONS, ...GOAL_TOOL_DEFINITIONS]
      : DEFAULT_TOOL_DEFINITIONS;

    // Initialize suggestion engine if enabled in config.
    // Derive allowed tools from the user's permission config so suggestions
    // only propose actions the user can actually execute.
    if (!runtime.options.bare && runtime.config.ui?.promptSuggestions !== false) {
      const permMode = runtime.config.permissions?.mode ?? 'interactive';
      const context = permMode === 'restricted' ? 'restricted' as const : 'cli' as const;
      const toolFilter = createToolFilter(context);
      const blacklist = runtime.config.permissions?.blacklist ?? [];
      const fullyBlockedTools = new Set(
        blacklist.filter(e => !e.includes(':')).map(e => e.trim())
      );
      const toolNames = featureGatedToolDefinitions
        .map(t => t.name)
        .filter(name => toolFilter.isAllowed(name) && !fullyBlockedTools.has(name));
      host.suggestionEngine = new SuggestionEngine(host.llm, {
        allowedTools: toolNames,
        debugLogger: (message: string) => host.writeDebugLine(message),
      });
    }

    const agentRegistry = configureAgentRegistry(runtime);
    const pluginDir = (runtime.config as typeof runtime.config & { pluginDir?: string }).pluginDir;
    const toolsRegistry = createToolsRegistry(runtime.workspaceRoot, pluginDir ?? AUTOHAND_PATHS.tools);
    host.toolsRegistry = toolsRegistry;
    host.extensionService = new ExtensionService({
      projectRoot: join(runtime.workspaceRoot, PROJECT_DIR_NAME, 'extensions'),
      loadOptions: () => ({
        reservedToolNames: toolsRegistry
          .listMetaTools({ includeDisabled: true })
          .map((tool) => tool.name),
        reservedAgentNames: agentRegistry
          .getAllAgents()
          .filter((agent) => agent.source !== 'extension')
          .map((agent) => agent.name),
        reservedSkillNames: (host.skillsRegistry.listSkills() as SkillDefinition[])
          .filter((skill) => skill.source !== 'extension')
          .map((skill) => skill.name),
      }),
    });
    host.memoryManager = new MemoryManager(runtime.workspaceRoot);

    // Initialize context orchestrator for auto-compaction
    // Default enabled, can be toggled with --no-cc or /cc command
    host.contextOrchestrator = new ContextOrchestrator({
      model,
      contextWindow: host.contextWindow,
      conversationManager: host.conversation,
      llm: host.llm,
      memoryManager: host.memoryManager,
      enabled: runtime.options.contextCompact !== false,
      onCrop: (count, reason) => {
        if (host.contextOrchestrator.isEnabled() && count > 0) {
          console.log(chalk.cyan(`ℹ Context optimized: ${reason}`));
        }
      },
      onWarning: (usage) => {
        console.log(chalk.yellow(`⚠ Context at ${Math.round(usage.usagePercent * 100)}%`));
      },
      onOverflow: (usage) => {
        console.log(chalk.yellow(`⚠ Context overflow at ${Math.round(usage.usagePercent * 100)}%`));
      },
      onHookEvent: async ({ event, ...context }) => {
        await host.hookManager.executeHooks(event, context);
      },
    });

    // Initialize new feature modules
    host.imageManager = new ImageManager();
    host.intentDetector = new IntentDetector();
    host.environmentBootstrap = new EnvironmentBootstrap();
    host.codeQualityPipeline = new CodeQualityPipeline();
    host.notificationService = new NotificationService();
    host.reactionParser = new ReactionParser({
      cleanupModelResponse: (content) => host.cleanupModelResponse(content),
    });

    host.activityIndicator = new ActivityIndicator({
      activityVerbs: runtime.config.ui?.activityVerbs,
      activityVerbsEnabled: runtime.config.ui?.activityVerbsEnabled,
      activitySymbol: runtime.config.ui?.activitySymbol,
    });

    // Create permission manager with persistence callback and local project support
    host.permissionManager = new PermissionManager({
      settings: runtime.config.permissions,
      workspaceRoot: runtime.workspaceRoot,
      onPersist: async (settings) => {
        runtime.config.permissions = settings;
        await saveConfig(runtime.config);
      }
    });
    host.basePermissionMode = host.permissionManager.getMode();
    host.syncInteractiveAutomodePermissions();

    // Initialize local project settings (async, but non-blocking)
    host.permissionManager.initLocalSettings().catch(() => {
      // Ignore errors - local settings are optional
    });

    // Create hook manager with persistence callback
    host.hookManager = new HookManager({
      settings: runtime.config.hooks,
      workspaceRoot: runtime.workspaceRoot,
      onPersist: async () => {
        runtime.config.hooks = host.hookManager.getSettings();
        await saveConfig(runtime.config);
      },
      onHookOutput: (result) => {
        // In RPC mode, stdout must only contain JSON-RPC messages
        // Hook output would break the protocol, so suppress it
        if (runtime.isRpcMode) {
          return;
        }
        // Suppress hook output when a modal is active to avoid corrupting
        // the alternate screen buffer. The output will be shown after the
        // modal closes via onAfterModal.
        if (host.modalActive) {
          return;
        }
        // Route hook output through promptNotify so it renders above the
        // active composer instead of interleaving with readline output.
        if (result.stdout && !result.response) {
          promptNotify(chalk.dim(`[hook:${result.hook.event}] ${result.stdout}`));
        }
        if (result.stderr && !result.blockingError) {
          promptNotify(chalk.yellow(`[hook:${result.hook.event}] ${result.stderr}`));
        }
      }
    });
    host.notificationService.setListener(async (options: Readonly<NotificationOptions>) => {
      await host.hookManager.executeHooks('notification', {
        notificationType: options.reason,
        notificationMessage: options.body,
      });
    });

    // Initialize repeat manager for /repeat recurring prompts
    host.repeatManager = new RepeatManager();
  host.repeatManager.onTrigger(async (job: any) => {
      // Emit schedule_triggered event for ACP/RPC clients
      host.emitOutput({ type: 'schedule_triggered', content: job.prompt, scheduleId: job.id });

      // If the agent is busy processing an instruction, queue for later.
      // The main loop will pick it up when the current turn finishes.
      if (host.isInstructionActive) {
        host.pendingInkInstructions.push(job.prompt);
        return;
      }

      // In non-interactive modes (RPC/ACP), run the instruction directly
      if (host.runtime.isRpcMode) {
        await host.runInstruction(job.prompt);
        return;
      }

      // Agent is idle in interactive mode — interrupt the blocking prompt
      // so the main loop can process the instruction through the normal flow.
      promptInterrupt(job.prompt);
    });

    // Initialize team manager for /team, /tasks, /message commands
    host.teamManager = new TeamManager({
      leadSessionId: randomUUID(),
      workspacePath: runtime.workspaceRoot,
      onTeammateMessage: (from, msg) => {
        if (msg.method === 'team.log') {
          const { level, text } = msg.params as { level: string; text: string };
          const prefix = level === 'error' ? chalk.red(`[${from}]`) : chalk.cyan(`[${from}]`);
          host.emitOutput({ type: 'message', content: `${prefix} ${text}` });
        }
      },
      onHookEvent: async (event, context) => {
        await host.hookManager.executeHooks(event, context);
      },
    });

    host.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => host.resolveWorkspacePath(relativePath),
      confirmDangerousAction: async (message, context) => {
        const result = await host.confirmDangerousAction(message, context);
        return result.decision === 'allow_once' || result.decision === 'allow_session' || result.decision === 'allow_always_project' || result.decision === 'allow_always_user';
      },
      onExploration: (entry) => host.recordExploration(entry),
      onToolOutput: (chunk) => host.handleToolOutput(chunk),
      toolsRegistry: host.toolsRegistry,
      getRegisteredTools: () => host.toolManager?.listDefinitions() ?? [],
      memoryManager: host.memoryManager,
      permissionManager: host.permissionManager,
      onFileModified: (filePath, changeType, toolCallId) => {
        host.markFilesModified(filePath, changeType, toolCallId);
      },
      backgroundProcessRegistry: host.backgroundProcessRegistry,
      onAskFollowup: (question, suggestedAnswers) => host.executeAskFollowupQuestion(question, suggestedAnswers),
      onPlanCreated: (plan, filePath) => host.handlePlanCreated(plan, filePath),
      onPermissionRequest: async (context) => {
        const results = await host.hookManager.executeHooks('permission-request', {
          tool: context.tool,
          path: context.path,
          command: context.command,
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
      },
      onReviewHook: async (event, context) => {
        await host.hookManager.executeHooks(event as any, {
          reviewPath: context.reviewPath,
          reviewScope: context.reviewScope,
          reviewInstructions: context.reviewInstructions,
          reviewError: context.reviewError,
        });
      },
      onAutoresearchHook: async (event, context) => {
        await host.hookManager.executeHooks(event as HookEvent, {
          ...context,
          autoresearchAttemptId: context.attemptId,
          autoresearchDecision: context.decision,
        });
      },
      onGoalWrittenCompleted: async (context) => {
        await host.hookManager.executeHooks('goal-written:completed', {
          goalId: context.goalId,
          goalObjective: context.goalObjective,
          goalSource: context.goalSource,
        });
      },
      onModalPause: async <T>(fn: () => Promise<T>) => host.withModalPause(fn),
      onLiveCommandStart: (command) => host.inkRenderer?.startLiveCommand(command) ?? '',
      onLiveCommandOutput: (id, stream, chunk) => host.inkRenderer?.appendLiveCommandOutput(id, stream, chunk),
      onLiveCommandFinish: (id, success, error) =>
        host.inkRenderer?.finishLiveCommand(id, success, error),
      onLiveCommandRemove: (id) => host.inkRenderer?.removeLiveCommand(id),
      onRequestDirectoryAccess: async (path, reason) => host.requestDirectoryAccess(path, reason),
      onMetaToolCreated: () => {
        host.toolManager?.replaceRuntimeMetaTools(host.toolsRegistry.toToolDefinitions());
      },
    });

    const toolAuthorization = {
      permissionManager: host.permissionManager,
      resolvePermissionContext: (action) => host.actionExecutor.getPermissionContext(action),
      runPreToolHooks: (context) => {
        const hookContext = {
          tool: context.tool,
          toolCallId: context.toolCallId,
          args: context.args,
          path: context.path,
        };
        return context.signal === undefined
          ? host.hookManager.executeHooks('pre-tool', hookContext)
          : host.hookManager.executeHooks('pre-tool', hookContext, { signal: context.signal });
      },
      runPermissionRequestHooks: (context) => {
        const hookContext = {
          tool: context.tool,
          toolCallId: context.toolCallId,
          args: context.args,
          ...(context.path === undefined ? {} : { path: context.path }),
          ...(context.command === undefined ? {} : { command: context.command }),
          permissionType: 'tool_approval' as const,
        };
        return context.signal === undefined
          ? host.hookManager.executeHooks('permission-request', hookContext)
          : host.hookManager.executeHooks('permission-request', hookContext, { signal: context.signal });
      },
      onAdditionalContext: (context) => {
        host.conversation.addSystemNote(context, '[Pre-tool Hook Context]');
      },
    } satisfies ToolAuthorizationOptions;

    host.activeProvider = runtime.config.provider ?? 'openrouter';
    const initialDebugProviderSettings = getProviderConfig(host.runtime.config, host.activeProvider);
    const initialDebugModel = host.runtime.options.model ?? initialDebugProviderSettings?.model ?? 'unconfigured';
    writeAutohandDebugLine(
      `[DEBUG] Initial provider: ${host.activeProvider}, model: ${initialDebugModel}`,
      host.writeDebugLine?.bind(host)
    );
    // Determine client context for delegation
    const delegatorContext = runtime.options.clientContext
      ?? (runtime.options.restricted ? 'restricted' : 'cli');
    host.delegator = new AgentDelegator(llm, host.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3,
      featureConfig: runtime.config,
      authorization: toolAuthorization,
      confirmApproval: (message, context) => host.confirmDangerousAction(message, context),
      getToolDefinitions: () => host.toolManager?.listDefinitions() ?? [],
      onSubagentStop: async (context) => {
        await host.hookManager.executeHooks('subagent-stop', {
          subagentId: context.subagentId,
          subagentName: context.subagentName,
          subagentType: context.subagentType,
          subagentSuccess: context.success,
          subagentError: context.error,
          subagentDuration: context.duration
        });
      }
    });
    host.errorLogger = new ErrorLogger(packageJson.version);
    host.autoReportManager = new AutoReportManager(runtime.config, packageJson.version);
    host.feedbackManager = new FeedbackManager({
      apiBaseUrl: runtime.config.api?.baseUrl || 'https://api.autohand.ai',
      cliVersion: packageJson.version
    });
    host.skillsRegistry = new SkillsRegistry(AUTOHAND_PATHS.skills);
    host.telemetryManager = new TelemetryManager({
      enabled: runtime.config.telemetry?.enabled === true,
      apiBaseUrl: runtime.config.telemetry?.apiBaseUrl || 'https://api.autohand.ai',
      enableSessionSync: runtime.config.telemetry?.enableSessionSync !== false,
      companySecret: runtime.config.telemetry?.companySecret || runtime.config.api?.companySecret || '',
      authToken: runtime.config.auth?.token,
      clientVersion: packageJson.version
    });
    host.featureFlagManager = new RemoteFeatureFlagManager(runtime.config);
    if (!runtime.options.bare) {
      host.featureFlagManager.refreshFeatureFlags().catch(() => {});
    }

    // Initialize community skills client
    const communitySettings = runtime.config.communitySkills ?? {};
    host.communityClient = new CommunitySkillsClient({
      apiBaseUrl: runtime.config.api?.baseUrl || 'https://api.autohand.ai',
      enabled: communitySettings.enabled !== false,
    });

    // Initialize MCP client manager
    host.mcpManager = new McpClientManager();
    host.mcpStartupCoordinator = new McpStartupCoordinator({
      isEnabled: () => host.runtime.config.mcp?.enabled !== false,
      getConfiguredServers: () => host.runtime.config.mcp?.servers,
      getRuntimeServers: () => host.mcpManager.listServers(),
    });

    // Wire telemetry and community client to skills registry
    host.skillsRegistry.setTelemetryManager(host.telemetryManager);
    host.skillsRegistry.setCommunityClient(host.communityClient);

    // Initialize provider config manager for model selection and configuration
    host.providerConfigManager = new ProviderConfigManager(
      runtime,
      () => host.llm,
      (newLlm) => { host.llm = newLlm; },
      () => host.activeProvider,
      (provider) => {
        host.activeProvider = provider;
        host.syncProviderModelStatusLine(provider);
        const providerSettings = getProviderConfig(host.runtime.config, provider);
        const model = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
        writeAutohandDebugLine(`[DEBUG] Provider changed: ${provider}, model: ${model}`, host.writeDebugLine?.bind(host));
      },
      () => host.delegator,
      (newDelegator) => { host.delegator = newDelegator; },
      host.telemetryManager,
      host.actionExecutor,
      (contextWindow) => {
        host.contextWindow = contextWindow;
        const provider = host.activeProvider ?? host.runtime.config.provider ?? 'openrouter';
        const providerSettings = getProviderConfig(host.runtime.config, provider);
        const activeModel = host.runtime.options.model ?? providerSettings?.model ?? 'unconfigured';
        host.contextOrchestrator.setModel(activeModel);
        host.contextOrchestrator.setContextWindow(contextWindow);
        host.updateContextUsage?.(host.conversation.history());
      },
      () => { host.contextPercentLeft = 100; },
      () => host.emitStatus()
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
        name: 'task_get',
        description: 'Get a task from the active team by ID.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to retrieve' }
          },
          required: ['task_id']
        },
        requiresApproval: false
      },
      {
        name: 'task_list',
        description: 'List tasks from the active team, optionally filtered by status or owner.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: 'Optional status filter', enum: ['pending', 'in_progress', 'completed'] },
            owner: { type: 'string', description: 'Optional owner filter' }
          }
        },
        requiresApproval: false
      },
      {
        name: 'task_update',
        description: 'Update an existing team task.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to update' },
            subject: { type: 'string', description: 'Updated task title' },
            description: { type: 'string', description: 'Updated task description' },
            blocked_by: { type: 'array', description: 'Updated dependency task IDs', items: { type: 'string' } },
            status: { type: 'string', description: 'Updated task status', enum: ['pending', 'in_progress', 'completed'] }
          },
          required: ['task_id']
        },
        requiresApproval: false
      },
      {
        name: 'task_stop',
        description: 'Stop an active team task and return it to pending.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to stop' }
          },
          required: ['task_id']
        },
        requiresApproval: false
      },
      {
        name: 'task_output',
        description: 'Store the latest progress note or output for a team task.',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to update' },
            output: { type: 'string', description: 'Latest progress note, result, or output summary' }
          },
          required: ['task_id', 'output']
        },
        requiresApproval: false
      },
      {
        name: 'skill',
        description: 'List, inspect, activate, or deactivate loaded skills. Activated skills are added to the session prompt.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Skill operation to perform', enum: ['list', 'info', 'activate', 'deactivate'] },
            name: { type: 'string', description: 'Skill name for info, activate, or deactivate' }
          },
          required: ['command']
        },
        requiresApproval: false
      },
      {
        name: 'sleep',
        description: 'Pause execution briefly while waiting for another system or process to settle.',
        parameters: {
          type: 'object',
          properties: {
            seconds: { type: 'number', description: 'Seconds to wait (maximum 300)' },
            reason: { type: 'string', description: 'Optional short reason for the wait' }
          },
          required: ['seconds']
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

    host.toolManager = new ToolManager({
      maxConcurrency: runtime.config.agent?.parallelToolConcurrency ?? 5,
      executor: async (action, context) => {
        const startTime = Date.now();
        const toolId = context?.toolCallId ?? `tool_${randomUUID()}`;
        let toolSuccess = false;
        let toolOutput: string | undefined;
        let toolError: string | undefined;

        try {
          // Emit tool_start only after ToolManager's canonical authorization.
          host.emitOutput({
            type: 'tool_start',
            toolId,
            toolName: action.type,
            toolArgs: action as Record<string, unknown>,
          });

          let outcome: ToolActionOutcome | undefined;
          let result: string | undefined;
          if (action.type === 'delegate_task') {
            outcome = await host.delegator.delegateTaskForTool(action.agent_name, action.task);
          } else if (action.type === 'delegate_parallel') {
            outcome = await host.delegator.delegateParallelForTool(action.tasks);
          } else if (action.type === 'create_team') {
            // Handle existing team: same name → reuse, different name → replace
            let team = host.teamManager.getTeam();
            let created = false;
            if (team && team.name !== action.name) {
              // Different team requested — shutdown old, create new
              await host.teamManager.shutdown();
              team = null;
            }
            if (!team) {
              team = host.teamManager.createTeam(action.name);
              created = true;
            }
            // Auto-profile the project
            const { ProjectProfiler } = await import('../teams/ProjectProfiler.js');
            const profiler = new ProjectProfiler(host.runtime.workspaceRoot);
            const profile = await profiler.analyze();
            // List available agents
            const { AgentRegistry } = await import('../agents/AgentRegistry.js');
            const registry = AgentRegistry.getInstance();
            await registry.loadAgents();
            const agents = registry.getAllAgents().map(a => `  - ${a.name}: ${a.description}`).join('\n');
            const header = created
              ? `Team "${team.name}" created.`
              : `Team "${team.name}" already active (reusing). Members: ${team.members.length}, Tasks: ${host.teamManager.tasks.listTasks().length}.`;
            result = [
              header,
              `\nProject: ${profile.languages.join(', ')} | Frameworks: ${profile.frameworks.join(', ') || 'none'}`,
              `Signals: ${profile.signals.map(s => `${s.type}(${s.severity})`).join(', ') || 'none'}`,
              `\nAvailable agents:\n${agents || '  (none)'}`,
              `\nNext: call add_teammate for each role, then create_task.`,
            ].join('\n');
          } else if (action.type === 'add_teammate') {
            host.teamManager.addTeammate({ name: action.name, agentName: action.agent_name, model: action.model });
            result = `Teammate "${action.name}" added (agent: ${action.agent_name}). Process spawning.`;
          } else if (action.type === 'create_task') {
            const task = host.teamManager.tasks.createTask({
              subject: action.subject,
              description: action.description,
              blockedBy: action.blocked_by,
            });
            // Auto-assign to idle teammates
            host.teamManager.tryAssignIdleTeammate();
            result = `Task ${task.id}: "${task.subject}" created (status: ${task.status})`;
          } else if (action.type === 'task_get') {
            const task = host.teamManager.tasks.getTask(action.task_id);
            if (task) {
              result = JSON.stringify(task, null, 2);
            } else {
              const error = `Task "${action.task_id}" not found.`;
              outcome = { success: false, kind: 'validation', error, output: error };
            }
          } else if (action.type === 'task_list') {
            const filtered = host.teamManager.tasks
              .listTasks()
              .filter((task: any) => !action.status || task.status === action.status)
              .filter((task: any) => !action.owner || task.owner === action.owner);
            result = JSON.stringify(filtered, null, 2);
          } else if (action.type === 'task_update') {
            const task = host.teamManager.tasks.updateTask(action.task_id, {
              subject: action.subject,
              description: action.description,
              blockedBy: action.blocked_by,
              status: action.status,
            });
            result = `Task ${task.id} updated.\n${JSON.stringify(task, null, 2)}`;
          } else if (action.type === 'task_stop') {
            const existingTask = host.teamManager.tasks.getTask(action.task_id);
            if (!existingTask) {
              const error = `Task "${action.task_id}" not found.`;
              outcome = { success: false, kind: 'validation', error, output: error };
            } else {
              const previousOwner = existingTask.owner;
              const task = host.teamManager.tasks.stopTask(action.task_id);
              if (previousOwner) {
                try {
                  host.teamManager.sendMessageTo(
                    previousOwner,
                    'lead',
                    `Stop working on ${task.id} (${task.subject}) and return to idle.`,
                  );
                } catch {
                  // Best-effort notification only; task state update is authoritative.
                }
              }
              result = `Task ${task.id} stopped and returned to pending.\n${JSON.stringify(task, null, 2)}`;
            }
          } else if (action.type === 'task_output') {
            const task = host.teamManager.tasks.setTaskOutput(action.task_id, action.output);
            result = `Task ${task.id} output updated.\n${JSON.stringify(task, null, 2)}`;
          } else if (action.type === 'skill') {
            outcome = host.handleSkillTool(action);
          } else if (action.type === 'sleep') {
            result = await host.executeSleepTool(action.seconds, action.reason);
          } else if (action.type === 'team_status') {
            const team = host.teamManager.getTeam();
            if (!team) {
              const error = 'No active team. Use create_team first.';
              outcome = { success: false, kind: 'validation', error, output: error };
            } else {
              const status = host.teamManager.getStatus();
              const members = team.members.map((m: any) => `  ${m.name} (${m.agentName}) - ${m.status}`).join('\n');
              const tasks = host.teamManager.tasks.listTasks();
              const taskLines = tasks.map((t: any) => {
                const owner = t.owner ? ` -> ${t.owner}` : '';
                const blocked = t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(', ')})` : '';
                return `  [${t.status}] ${t.id}: ${t.subject}${owner}${blocked}`;
              }).join('\n');
              result = `Team: ${team.name} (${status.memberCount} members, ${status.tasksDone}/${status.tasksTotal} done)\n\nMembers:\n${members}\n\nTasks:\n${taskLines || '  (none)'}`;
            }
          } else if (action.type === 'send_team_message') {
            host.teamManager.sendMessageTo(action.to, 'lead', action.content);
            result = `Message sent to ${action.to}.`;
          } else if (action.type === 'enter_worktree') {
            result = await host.enterSessionWorktree(action.name);
          } else if (action.type === 'exit_worktree') {
            result = await host.exitSessionWorktree(action.keep);
          } else if (action.type === 'cron_create') {
            const cron = intervalToCron(action.interval);
            const expiresInMs = action.expires_in ? shorthandToMs(action.expires_in) : undefined;
            const expiryLabel = action.expires_in ? shorthandToHuman(action.expires_in) : '3 days';
            const job = host.repeatManager.schedule(
              action.prompt,
              cron.intervalMs,
              cron.cronExpression,
              cron.humanReadable,
              {
                maxRuns: action.max_runs,
                expiresInMs,
              },
            );
            const lines = [
              'Recurring job scheduled.',
              `Job ID: ${job.id}`,
              `Prompt: ${job.prompt}`,
              `Cadence: ${cron.humanReadable}`,
              `Cron: ${cron.cronExpression}`,
            ];
            if (action.max_runs !== undefined) {
              lines.push(`Limit: ${action.max_runs} runs`);
            }
            if (cron.roundedNote) {
              lines.push(`Note: ${cron.roundedNote}`);
            }
            lines.push(`Expires: ${expiryLabel}`);
            result = lines.join('\n');
          } else if (action.type === 'cron_delete') {
            const cancelled = host.repeatManager.cancel(action.schedule_id);
            if (cancelled) {
              result = `Cancelled schedule ${action.schedule_id}.`;
            } else {
              const error = `No active schedule found with ID "${action.schedule_id}".`;
              outcome = { success: false, kind: 'validation', error, output: error };
            }
          } else if (action.type === 'list_schedules') {
            const jobs = host.repeatManager.list();
            if (jobs.length === 0) {
              result = 'No active scheduled jobs.';
            } else {
              const lines = jobs.map((j: any) =>
                `[${j.id}] "${j.prompt}" — ${j.humanInterval} (runs: ${j.runCount}${j.maxRuns ? '/' + j.maxRuns : ''}, expires: ${new Date(j.expiresAt).toLocaleString()})`
              ).join('\n');
              result = `${lines}\n\nTo cancel a job, tell the user to run: /repeat cancel <job-id>`;
            }
          } else if (action.type === 'cancel_schedule') {
            const id = (action as { schedule_id: string }).schedule_id;
            if (!id) {
              const error = 'schedule_id is required.';
              outcome = { success: false, kind: 'validation', error, output: `Error: ${error}` };
            } else {
              const cancelled = host.repeatManager.cancel(id);
              if (cancelled) {
                result = `Cancelled schedule ${id}.`;
              } else {
                const error = `No active schedule found with ID "${id}".`;
                outcome = { success: false, kind: 'validation', error, output: error };
              }
            }
          } else if (action.type === 'exit_plan_mode') {
            outcome = await host.handleExitPlanMode((action as { summary?: string }).summary);
          } else if (action.type === 'install_agent_skill') {
            const skillName = (action as { name: string }).name;
            if (!skillName) {
              const error = 'install_agent_skill requires a "name" argument.';
              outcome = { success: false, kind: 'validation', error, output: `Error: ${error}` };
            } else {
              const scope = (action as { scope?: 'project' | 'user' }).scope ?? 'project';
              const activate = (action as { activate?: boolean }).activate !== false;
              const cache = new CommunitySkillsCache();
              const fetcher = new GitHubRegistryFetcher();
              const registry = await fetchRegistryWithFallback(cache, fetcher);
              if (!registry) {
                const error = 'Failed to fetch community skills registry. Please check your internet connection.';
                outcome = { success: false, kind: 'operational', error, output: error };
              } else {
                const skill = fetcher.findSkill(registry.skills, skillName);
                if (!skill) {
                  const similar = fetcher.findSimilarSkills(registry.skills, skillName, 3);
                  let msg = `Skill not found: "${skillName}".`;
                  if (similar.length > 0) {
                    msg += `\nDid you mean: ${similar.map((s) => s.name).join(', ')}`;
                  }
                  outcome = { success: false, kind: 'validation', error: msg, output: msg };
                } else {
                  const installResult = await installSkillWithSecurity(
                    {
                      skillsRegistry: host.skillsRegistry,
                      workspaceRoot: host.runtime.workspaceRoot,
                      hookManager: host.hookManager,
                      isNonInteractive: true,
                    },
                    skill,
                    cache,
                    fetcher,
                    scope,
                  );
                  const targetDir = scope === 'project'
                    ? join(host.runtime.workspaceRoot, PROJECT_DIR_NAME, 'skills')
                    : AUTOHAND_PATHS.skills;
                  const installed = await host.skillsRegistry.isSkillInstalled(skill.id, targetDir);
                  if (!installed) {
                    outcome = {
                      success: false,
                      kind: 'operational',
                      error: `Skill installation did not complete for ${skill.name}.`,
                      output: installResult,
                    };
                  } else if (activate) {
                    // Try to activate after successful install
                    try {
                      const activateResult = host.skillsRegistry.activateSkill(skill.id);
                      if (activateResult) {
                        result = `${installResult}\n\nActivated skill: ${skill.name}`;
                      } else {
                        result = `${installResult}\n\nNote: skill installed but could not be activated automatically.`;
                      }
                    } catch {
                      result = `${installResult}\n\nNote: skill installed but activation failed.`;
                    }
                  } else {
                    result = installResult;
                  }
                }
              }
            }
          } else if (McpClientManager.isMcpTool(action.type)) {
            // Ensure MCP servers have finished connecting before dispatching
            if (host.mcpReady) await host.mcpReady;
            // Route MCP tool calls to the MCP client manager
            const parsed = McpClientManager.parseMcpToolName(action.type);
            if (parsed) {
              const { ...mcpArgs } = action as Record<string, unknown>;
              const mcpResult = await host.mcpManager.callTool(
                parsed.serverName,
                parsed.toolName,
                mcpArgs,
                { signal: context?.signal },
              );
              outcome = normalizeMcpToolOutcome(mcpResult);
            } else {
              const error = `Invalid MCP tool name: ${action.type}`;
              outcome = { success: false, kind: 'validation', error, output: error };
            }
          } else {
            outcome = await host.actionExecutor.executeForTool(action, context);
          }
          const finalOutcome: ToolActionOutcome = outcome
            ?? (result === undefined ? { success: true } : { success: true, output: result });
          const readableOutput = finalOutcome.success
            ? finalOutcome.output
            : finalOutcome.output ?? finalOutcome.error;

          // Record action name for auto-mode tracking
          host.recordExecutedAction(action.type);

          // Track the same explicit outcome used by hooks and transports.
          await host.telemetryManager.trackToolUse({
            tool: action.type,
            success: finalOutcome.success,
            duration: Date.now() - startTime,
            ...(finalOutcome.success ? {} : { error: finalOutcome.error }),
          });

          const postToolContext = {
            tool: action.type,
            toolCallId: toolId,
            args: action as Record<string, unknown>,
            success: finalOutcome.success,
            output: readableOutput,
            duration: Date.now() - startTime,
          };
          if (context?.signal === undefined) {
            await host.hookManager.executeHooks('post-tool', postToolContext);
          } else {
            await host.hookManager.executeHooks('post-tool', postToolContext, { signal: context.signal });
          }

          toolSuccess = finalOutcome.success;
          toolOutput = readableOutput;
          toolError = finalOutcome.success ? undefined : finalOutcome.error;

          return finalOutcome;
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : String(error);
          const errorMessage = rawMessage.trim() || 'Tool execution failed.';
          toolOutput = errorMessage;
          toolError = errorMessage;

          // Track failed tool use
          await host.telemetryManager.trackToolUse({
            tool: action.type,
            success: false,
            duration: Date.now() - startTime,
            error: errorMessage
          });

          // Execute post-tool hooks (failure)
          const failedPostToolContext = {
            tool: action.type,
            toolCallId: toolId,
            args: action as Record<string, unknown>,
            success: false,
            output: errorMessage,
            duration: Date.now() - startTime,
          };
          if (context?.signal === undefined) {
            await host.hookManager.executeHooks('post-tool', failedPostToolContext);
          } else {
            await host.hookManager.executeHooks('post-tool', failedPostToolContext, { signal: context.signal });
          }

          return {
            success: false,
            kind: context?.signal?.aborted === true
              || (error instanceof Error && error.name === 'AbortError')
              ? 'aborted'
              : 'operational',
            error: errorMessage,
          } satisfies ToolActionOutcome;
        } finally {
          // Every emitted tool_start has one terminal event with the same ID.
          host.emitOutput({
            type: 'tool_end',
            toolId,
            toolName: action.type,
            toolSuccess,
            toolOutput,
            toolError,
          });
        }
      },
      confirmApproval: (message, context) => host.confirmDangerousAction(message, context),
      definitions: [...featureGatedToolDefinitions, ...delegationTools],
      clientContext,
      customPolicy,
      authorization: toolAuthorization,
    });

    host.sessionManager = new SessionManager();
    host.projectManager = new ProjectManager();

    // Ink 7 + React 19 is the default interactive UI. Do not let stale
    // config.ui.useInkRenderer values force the legacy composer.
    host.useInkRenderer = shouldUseInkRenderer()
      && runtime.isRpcMode !== true
      && runtime.isCommandMode !== true
      && !runtime.options?.prompt;

    // Initialize UIManager based on config
    host.initializeUIManager();

    // Initialize persistent input for queuing messages while agent works.
    // Default to terminal regions so the boxed composer stays visible during turns.
    // Allow disabling via env for troubleshooting terminals with region issues.
    // TODO: Migrate to use UIManager exclusively - this is kept for backward compatibility during transition
    const disableTerminalRegions = process.env.AUTOHAND_TERMINAL_REGIONS === '0';
    host.persistentInput = createPersistentInput({
      maxQueueSize: 10,
      silentMode: disableTerminalRegions,
      workspaceRoot: host.runtime.workspaceRoot,
      resolveShellSuggestion: (input) => host.resolveLlmShellSuggestion(input),
      suggestionProvider: () => host.suggestionEngine?.getNextPromptSuggestion() ?? undefined,
      onCycleInteractionMode: () => host.cycleInteractionMode(),
    });

    host.persistentInput.on('queued', (text: string, count: number) => {
      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      const usingTerminalRegions = host.isUsingTerminalRegionsForActiveTurn();
      if (host.inkRenderer) {
        host.inkRenderer.addQueuedInstruction(text);
      } else if (usingTerminalRegions) {
        // In terminal-regions mode, PersistentInput already renders queued feedback.
        return;
      } else if (host.runtime.spinner) {
        host.runtime.spinner.stop();
        console.log(chalk.cyan(`✓ Queued: "${preview}" (${count} pending)`));
        host.runtime.spinner.start();
        host.lastRenderedStatus = '';
        host.forceRenderSpinner();
      }
    });

    // Handle immediate commands (! shell, / slash) from PersistentInput - bypass queue.
    // Route output through writeAbove() when terminal regions are active so it
    // appears in the scroll region above the fixed input box (not on top of it).
    host.persistentInput.on('immediate-command', (text: string) => {
      const routeOpts = {
        persistentInputActiveTurn: host.persistentInputActiveTurn,
        terminalRegionsDisabled: process.env.AUTOHAND_TERMINAL_REGIONS === '0',
        writeAbove: (t: string) => host.persistentInput.writeAbove(t),
      };

      if (isShellCommand(text)) {
        const cmd = parseShellCommand(text);
        host.executeImmediateShellCommandForComposer(cmd, routeOpts)
          .then((result: any) => {
            if (!result.success) {
              routeOutput(chalk.red(result.error || 'Command failed'), routeOpts);
            }
          })
          .catch((error: Error) => {
            routeOutput(chalk.red(error.message || 'Command failed'), routeOpts);
          });
      } else if (text.startsWith('/') && !isLikelyFilePathSlashInput(text)) {
        if (host.runtime.options.bare) {
          routeOutput(chalk.gray(BARE_SLASH_COMMANDS_DISABLED_MESSAGE), routeOpts);
          return;
        }

        const { command, args } = host.parseSlashCommand(text);
        host.handleSlashCommand(command, args)
          .then((handled: any) => {
            if (handled !== null) {
              routeOutput(handled, routeOpts);
            }
          })
          .catch((err: Error) => {
            routeOutput(chalk.red(`\nCommand error: ${err.message}`), routeOpts);
        });
      }
    });

    const displayInteractionModeChange = (message: string) => {
      const statusLine = host.formatStatusLine();
      host.persistentInput.setStatusLine(statusLine);

      const usingTerminalRegions = host.isUsingTerminalRegionsForActiveTurn();
      if (usingTerminalRegions) {
        host.persistentInput.render();
      }

      if (usingTerminalRegions) {
        host.persistentInput.writeAbove(`${message}\n`);
      } else if (host.runtime.spinner) {
        const wasSpinning = host.runtime.spinner.isSpinning;
        if (wasSpinning) {
          host.runtime.spinner.stop();
        }
        console.log(`\n${message}`);
        if (wasSpinning) {
          host.runtime.spinner.start();
        }
      } else {
        console.log(`\n${message}`);
      }

      host.lastRenderedStatus = '';
      if (!host.inkRenderer) {
        host.forceRenderSpinner();
      }
    };

    host.persistentInput.on('plan-mode-toggled', (enabled: boolean) => {
      displayInteractionModeChange(formatPlanModeToggleMessage(enabled));
    });

    host.persistentInput.on('interaction-mode-changed', (mode: InteractionMode) => {
      displayInteractionModeChange(formatInteractionModeChangeMessage(mode));
    });

    // Create context object with getter for currentSession (dynamic access)
    const sessionMgr = host.sessionManager;
    const filesMgr = host.files;
    const runtimeRef = host.runtime;
    const slashContext = {
      promptModelSelection: () => host.providerConfigManager.promptModelSelection(),
      createAgentsFile: () => host.createAgentsFile(),
      sessionManager: host.sessionManager,
      memoryManager: host.memoryManager,
      permissionManager: host.permissionManager,
      hookManager: host.hookManager,
      skillsRegistry: host.skillsRegistry,
      toolsRegistry: host.toolsRegistry,
      extensionService: host.extensionService,
      refreshDynamicExtensions: async () => {
        await syncDynamicRuntimeExtensions(host, host.runtime);
      },
      mcpManager: host.mcpManager,
      backgroundProcessRegistry: host.backgroundProcessRegistry,
      llm: host.llm,
      workspaceRoot: runtime.workspaceRoot,
      get model() {
        const provider = host.activeProvider ?? runtime.config.provider ?? 'openrouter';
        const providerSettings = getProviderConfig(runtime.config, provider);
        return runtime.options.model ?? providerSettings?.model ?? model;
      },
      resetConversation: async () => {
        await host.resetConversationContext();
        await host.injectSessionBootstrap();
      },
      restoreSession: async (sessionId: string) => {
        await host.restoreSessionState(sessionId);
      },
      undoFileMutation: () => host.files.undoLast(),
      removeLastTurn: () => host.conversation.removeLastTurn(),
      // Status command context
      get provider() {
        return host.activeProvider;
      },
      config: runtime.config,
      getContextPercentLeft: () => host.contextPercentLeft,
      getTotalTokensUsed: () => {
        const currentTurnTokens = host.currentTurnActualUsage?.kind === 'actual'
          ? host.currentTurnActualUsage.totalTokens
          : 0;
        return (host.sessionActualTokensUsed ?? host.sessionTokensUsed ?? 0) + currentTurnTokens;
      },
      getTokenUsageStatus: () => host.sessionTokenUsageUnavailable ? 'unavailable' as const : 'actual' as const,
      getContextWindow: () => host.contextWindow,
      isFeatureEnabled: (key: string, localDefault?: boolean) => {
        const configDefault = getFeatureState(runtime.config, key)?.enabled ?? false;
        return host.featureFlagManager?.isFeatureEnabled?.(key, localDefault ?? configDefault)
          ?? localDefault
          ?? configDefault;
      },
      trackFeatureActivation: (key: string, metadata?: Record<string, unknown>) => {
        void host.featureFlagManager?.trackFeatureActivation?.(key, metadata);
      },
      refreshFeatureGatedTools: () => {
        const enabled = isGoalFeatureEnabled(runtime.config);
        for (const definition of GOAL_TOOL_DEFINITIONS) {
          if (enabled) {
            host.toolManager.register(definition);
          } else {
            host.toolManager.unregister(definition.name);
          }
        }
      },
      refreshStatusLine: () => {
        const statusLine = host.formatStatusLine();
        host.persistentInput?.setStatusLine?.(statusLine);
        host.syncProviderModelStatusLine?.();
        host.persistentInput?.render?.();
      },
      isInteractiveAutomodeEnabled: () => host.interactiveAutomodeEnabled,
      setInteractiveAutomodeEnabled: (enabled: boolean) => host.setInteractiveAutomodeEnabled(enabled),
      getInteractionMode: () => host.getInteractionMode(),
      setInteractionMode: (mode: InteractionMode) => host.setInteractionMode(mode),
      // Share command needs current session - use getter for dynamic access
      get currentSession() {
        return sessionMgr.getCurrentSession() ?? undefined;
      },
      // Add-dir command context
      fileManager: host.files,
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
      toggleContextCompaction: () => host.toggleContextCompaction(),
      isContextCompactionEnabled: () => host.isContextCompactionEnabled(),
      // Non-interactive mode (RPC/ACP) - guards interactive commands
      isNonInteractive: runtime.isRpcMode === true,
      onBeforeModal: async () => {
        writeAutohandDebugLine(
          `[DEBUG] onBeforeModal: inkRenderer exists=${!!host.inkRenderer}, persistentInputActive=${host.persistentInputActiveTurn}`,
          host.writeDebugLine?.bind(host)
        );
        host.modalActive = true;
        if (host.inkRenderer) {
          host.inkRenderer.pause();
          // Yield a macrotask so React 19's Scheduler flushes any pending passive
          // effect cleanup from the just-unmounted Ink instance. Without this, the
          // modal's useInput effect can run before the previous Composer's cleanup,
          // causing both to appear simultaneously.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (host.persistentInputActiveTurn) {
          host.persistentInput.pauseForModal();
        }
      },
      onAfterModal: async () => {
        writeAutohandDebugLine(
          `[DEBUG] onAfterModal: inkRenderer exists=${!!host.inkRenderer}, persistentInputActive=${host.persistentInputActiveTurn}`,
          host.writeDebugLine?.bind(host)
        );
        host.modalActive = false;
        if (host.persistentInputActiveTurn) {
          try {
            host.persistentInput.resumeFromModal();
          } catch {
            // Best effort — continue to resume InkRenderer
          }
        }
        if (host.inkRenderer) {
          await host.inkRenderer.resume();
        }
        writeAutohandDebugLine('[DEBUG] onAfterModal completed', host.writeDebugLine?.bind(host));
      },
      // After /learn recommends a skill, seed the next prompt with the install command
      onTopRecommendation: (slug: string) => {
        host.promptSeedInput = `/skills install @${slug}`;
      },
      // Team manager for /team, /tasks, /message commands
      teamManager: host.teamManager,
      // Repeat manager for /repeat recurring prompt scheduling
      repeatManager: host.repeatManager,
      // Queue an instruction to be sent to the LLM silently (e.g. /review)
      queueInstruction: (instruction: string, postTurnAction?: PendingPostTurnAction) => {
        host.pendingInkInstructions.push(
          postTurnAction ? { text: instruction, postTurnAction } : instruction,
        );
      },
      requestResearchPublication: (reportPath: string) =>
        host.requestResearchPublication(reportPath),
      // Queue a remote instruction as if the user typed it into the interactive composer.
      enqueueInstruction: (instruction: string) => {
        enqueueInteractiveInstruction(host, instruction);
      },
      enqueueMobileInstruction: (instruction: string, mobileTurn: MobileClaimedTurnContext) => {
        enqueueClaimedMobileInstruction(host, instruction, mobileTurn);
      },
      enqueueInstructionWithImages: (instruction: string, images: MobileImageAttachment[]) => {
        const placeholders = images.map((image) => {
          const data = Buffer.from(image.data, 'base64');
          const id = host.imageManager.add(data, image.mimeType as ImageMimeType, image.filename);
          return host.imageManager.formatPlaceholder(id);
        });
        const instructionWithImages = placeholders.length > 0
          ? `${instruction}\n\n${placeholders.join('\n')}`
          : instruction;

        enqueueInteractiveInstruction(host, instructionWithImages);
      },
      enqueueMobileInstructionWithImages: (
        instruction: string,
        images: MobileImageAttachment[],
        mobileTurn: MobileClaimedTurnContext,
      ) => {
        const placeholders = images.map((image) => {
          const data = Buffer.from(image.data, 'base64');
          const id = host.imageManager.add(data, image.mimeType as ImageMimeType, image.filename);
          return host.imageManager.formatPlaceholder(id);
        });
        const instructionWithImages = placeholders.length > 0
          ? `${instruction}\n\n${placeholders.join('\n')}`
          : instruction;

        enqueueClaimedMobileInstruction(host, instructionWithImages, mobileTurn);
      },
      onMobileRelayReady: (relay: MobileRelayController) => {
        configureMobileRelayController(host, relay);
      },
      onMobileConnected: (message: string) => {
        host.notifyUser?.(message);
      },
      onMobileDisconnected: (message: string) => {
        host.notifyUser?.(message);
      },
      applyMobilePermissionMode: (mode: MobilePermissionMode) =>
        applyMobilePermissionMode({
          applyAcpMode: (selectedMode) => host.applyAcpMode(selectedMode),
          getPermissionMode: () => {
            const effectiveMode = host.permissionManager.getMode();
            return effectiveMode === 'restricted' || effectiveMode === 'unrestricted'
              ? effectiveMode
              : 'interactive';
          },
          getInteractionMode: () => host.getInteractionMode(),
          setInteractionMode: (selectedMode) => host.setInteractionMode(selectedMode),
          notifyUser: (message) => host.notifyUser?.(message),
        }, mode),
      // Set/clear YOLO mode for /yolo and /no-yolo commands
      setYoloMode: (pattern: string | undefined) => {
        host.runtime.options.yolo = pattern;
        if (pattern) {
          try {
            const yoloPattern = parseYoloPattern(pattern);
            const settings = buildPermissionSettingsFromYolo(yoloPattern);
            if (settings.mode === 'unrestricted') {
              host.permissionManager.setMode('unrestricted');
              host.runtime.options.unrestricted = true;
              host.runtime.options.yes = true;
            } else {
              host.permissionManager.setMode('interactive');
              host.runtime.options.unrestricted = false;
              host.runtime.options.yes = false;
            }
          } catch {
            // Ignore malformed patterns
          }
        } else {
          host.permissionManager.setMode(host.basePermissionMode ?? 'interactive');
          host.runtime.options.unrestricted = false;
          host.runtime.options.yes = false;
        }
      },
      // Clear terminal / Ink UI for /clear and /new
      clearScreen: () => {
        if (host.inkRenderer?.isRunning()) {
          host.inkRenderer.resetAndClearScreen();
        } else {
          process.stdout.write('\x1b[2J\x1b[H');
        }
      },
    };
    host.slashHandler = new SlashCommandHandler(
      slashContext,
      host.runtime.options.bare ? [] : SLASH_COMMANDS,
      host.runtime.options.bare ? undefined : extensionRuntimeHost,
    );
  }

  /**
   * Sync discovered MCP tools with tool definitions exposed to the LLM.
   */
