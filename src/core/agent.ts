/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ora from 'ora';
import enquirer from 'enquirer';
import readline from 'node:readline';
import { FileActionManager } from '../actions/filesystem.js';
import { saveConfig, getProviderConfig } from '../config.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import { ProviderFactory, ProviderNotConfiguredError } from '../providers/ProviderFactory.js';
import { readInstruction } from '../ui/inputPrompt.js';
import { showFilePalette } from '../ui/filePalette.js';
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
import { ToolManager } from './toolManager.js';
import { ActionExecutor } from './actionExecutor.js';
import { SlashCommandHandler } from './slashCommandHandler.js';
import { SessionManager } from '../session/SessionManager.js';
import { ProjectManager } from '../session/ProjectManager.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type { SessionMessage, WorkspaceState } from '../session/types.js';
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
import { DEFAULT_TOOL_DEFINITIONS } from './toolManager.js';
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
import { formatToolOutputForDisplay } from '../ui/toolOutput.js';
import { createInkRenderer, type InkRenderer } from '../ui/ink/InkRenderer.js';
import { PermissionManager } from '../permissions/PermissionManager.js';
import { confirm as unifiedConfirm, isExternalCallbackEnabled } from '../ui/promptCallback.js';
import packageJson from '../../package.json' with { type: 'json' };
// New feature modules
import { ImageManager } from './ImageManager.js';
import { IntentDetector, type Intent, type IntentResult } from './IntentDetector.js';
import { EnvironmentBootstrap, type BootstrapResult } from './EnvironmentBootstrap.js';
import { CodeQualityPipeline, type QualityResult } from './CodeQualityPipeline.js';

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
  private delegator: AgentDelegator;
  private feedbackManager: FeedbackManager;
  private telemetryManager: TelemetryManager;
  private skillsRegistry: SkillsRegistry;
  private communityClient: CommunitySkillsClient;
  private workspaceFiles: string[] = [];
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
    this.conversation = ConversationManager.getInstance();
    this.toolsRegistry = new ToolsRegistry();
    this.memoryManager = new MemoryManager(runtime.workspaceRoot);

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
      onFileModified: () => this.markFilesModified()
    });

    this.activeProvider = runtime.config.provider ?? 'openrouter';
    // Determine client context for delegation
    const delegatorContext = runtime.options.clientContext
      ?? (runtime.options.restricted ? 'restricted' : 'cli');
    this.delegator = new AgentDelegator(llm, this.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3
    });
    this.errorLogger = new ErrorLogger(packageJson.version);
    this.feedbackManager = new FeedbackManager();
    this.skillsRegistry = new SkillsRegistry(AUTOHAND_PATHS.skills);
    this.telemetryManager = new TelemetryManager({
      enabled: runtime.config.telemetry?.enabled !== false,
      apiBaseUrl: runtime.config.telemetry?.apiBaseUrl || 'https://api.autohand.ai',
      enableSessionSync: runtime.config.telemetry?.enableSessionSync !== false
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

    const delegationTools = [
      {
        name: 'delegate_task' as const,
        description: 'Delegate a task to a specialized sub-agent (synchronous)',
        requiresApproval: false
      },
      {
        name: 'delegate_parallel' as const,
        description: 'Run multiple sub-agents in parallel (max 5)',
        requiresApproval: false
      }
    ];

    // Determine client context - restricted mode maps to 'restricted' context
    const clientContext = runtime.options.clientContext
      ?? (runtime.options.restricted ? 'restricted' : 'cli');

    this.toolManager = new ToolManager({
      executor: async (action, context) => {
        const startTime = Date.now();
        const toolId = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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
      clientContext
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

    this.slashHandler = new SlashCommandHandler({
      promptModelSelection: () => this.promptModelSelection(),
      createAgentsFile: () => this.createAgentsFile(),
      sessionManager: this.sessionManager,
      memoryManager: this.memoryManager,
      permissionManager: this.permissionManager,
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
      getTotalTokensUsed: () => this.totalTokensUsed
    }, SLASH_COMMANDS);
  }

  async runInteractive(): Promise<void> {
    // Initialize session
    await this.sessionManager.initialize();
    await this.projectManager.initialize();
    await this.memoryManager.initialize();
    await this.skillsRegistry.initialize();
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

    await this.runInteractiveLoop();
  }

  /**
   * Initialize the agent for RPC mode (no interactive loop or command mode)
   */
  async initializeForRPC(): Promise<void> {
    await this.sessionManager.initialize();
    await this.projectManager.initialize();
    await this.memoryManager.initialize();
    await this.skillsRegistry.initialize();
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
  }

  async runCommandMode(instruction: string): Promise<void> {
    await this.initializeForRPC();
    await this.runInstruction(instruction);

    if (this.runtime.options.autoCommit) {
      await this.performAutoCommit();
    }

    await this.telemetryManager.endSession('completed');
  }

  private async performAutoCommit(): Promise<void> {
    const info = getAutoCommitInfo(this.runtime.workspaceRoot);

    if (!info.canCommit) {
      if (info.error !== 'No changes to commit') {
        console.log(chalk.yellow(`\n⚠ Cannot auto-commit: ${info.error}`));
      }
      return;
    }

    console.log(chalk.cyan('\n📝 Auto-commit: Changes detected'));
    info.filesChanged.slice(0, 5).forEach(file => {
      console.log(chalk.gray(`   ${file}`));
    });
    if (info.filesChanged.length > 5) {
      console.log(chalk.gray(`   ... and ${info.filesChanged.length - 5} more files`));
    }

    const commitMessage = info.suggestedMessage;

    if (this.runtime.options.yes) {
      console.log(chalk.cyan(`Commit message: ${commitMessage}`));
      const result = executeAutoCommit(this.runtime.workspaceRoot, commitMessage);
      if (result.success) {
        console.log(chalk.green(`✓ ${result.message}`));
      } else {
        console.log(chalk.red(`✗ ${result.message}`));
      }
      return;
    }

    console.log(chalk.cyan(`Suggested message: ${commitMessage}`));

    const { choice } = await enquirer.prompt<{ choice: string }>({
      type: 'select',
      name: 'choice',
      message: 'Commit these changes?',
      choices: [
        { name: 'y', message: 'Yes - commit with this message' },
        { name: 'e', message: 'Edit - modify the message' },
        { name: 'n', message: 'No - skip commit' }
      ]
    });

    if (choice === 'n') {
      console.log(chalk.gray('Skipped auto-commit.'));
      return;
    }

    let finalMessage = commitMessage;
    if (choice === 'e') {
      const { editedMessage } = await enquirer.prompt<{ editedMessage: string }>({
        type: 'input',
        name: 'editedMessage',
        message: 'Enter commit message:',
        initial: commitMessage
      });
      finalMessage = editedMessage;
    }

    const result = executeAutoCommit(this.runtime.workspaceRoot, finalMessage);
    if (result.success) {
      console.log(chalk.green(`✓ ${result.message}`));
    } else {
      console.log(chalk.red(`✗ ${result.message}`));
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

        await this.runInstruction(instruction);
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
    this.workspaceFiles = await this.collectWorkspaceFiles();
    const statusLine = this.formatStatusLine();
    const input = await readInstruction(
      this.workspaceFiles,
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
      const { Select } = enquirer as any;
      const prompt = new Select({
        name: 'level',
        message: 'Where should this memory be stored?',
        choices: [
          { name: 'project', message: 'Project level (.autohand/memory/) - specific to this project' },
          { name: 'user', message: 'User level (~/.autohand/memory/) - available in all projects' }
        ]
      });

      const level = await prompt.run() as 'project' | 'user';

      // Check for similar memories first
      const similar = await this.memoryManager.findSimilar(content, level);
      if (similar && similar.score >= 0.6) {
        console.log();
        console.log(chalk.yellow('Found similar existing memory:'));
        console.log(chalk.gray(`  "${similar.entry.content}"`));

        const { Confirm } = enquirer as any;
        const confirmPrompt = new Confirm({
          name: 'update',
          message: 'Update the existing memory instead of creating a new one?'
        });

        const shouldUpdate = await confirmPrompt.run();
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

  private async listWorkspaceFiles(): Promise<void> {
    const entries = await fs.readdir(this.runtime.workspaceRoot);
    const sorted = entries.sort((a, b) => a.localeCompare(b));
    console.log('\n' + chalk.cyan('Workspace files:'));
    console.log(sorted.map((entry) => ` - ${entry}`).join('\n'));
    console.log();
  }

  private async collectWorkspaceFiles(): Promise<string[]> {
    const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: this.runtime.workspaceRoot,
      encoding: 'utf8'
    });
    const files: string[] = [];
    const ignoreFilter = this.ignoreFilter;
    if (git.status === 0 && git.stdout) {
      git.stdout
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean)
        .forEach((file) => {
          if (!ignoreFilter.isIgnored(file)) {
            files.push(file);
          }
        });
      return files;
    }

    await this.walkWorkspace(this.runtime.workspaceRoot, files);
    return files;
  }

  private async walkWorkspace(current: string, acc: string[]): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      // Directory doesn't exist or can't be read
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry);
      const rel = path.relative(this.runtime.workspaceRoot, full);
      if (rel === '' || this.shouldSkipPath(rel) || this.ignoreFilter.isIgnored(rel)) {
        continue;
      }
      try {
        const stats = await fs.stat(full);
        if (stats.isDirectory()) {
          await this.walkWorkspace(full, acc);
        } else if (stats.isFile()) {
          acc.push(rel);
        }
      } catch {
        // File doesn't exist or can't be accessed, skip it
        continue;
      }
    }
  }

  private shouldSkipPath(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return (
      normalized.startsWith('.git') ||
      normalized.startsWith('node_modules') ||
      normalized.startsWith('dist') ||
      normalized.startsWith('build') ||
      normalized.startsWith('.next')
    );
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

  private async promptModelSelection(): Promise<void> {
    try {
      // Show all providers with status indicators
      const allProviders: ProviderName[] = ['openrouter', 'ollama', 'llamacpp', 'openai'];
      const providerChoices = allProviders.map(name => {
        const isConfigured = this.isProviderConfigured(name);
        const indicator = isConfigured ? chalk.green('●') : chalk.red('○');
        const current = name === this.activeProvider ? chalk.cyan(' (current)') : '';
        return {
          name,
          message: `${indicator} ${name}${current}`,
          value: name
        };
      });

      const providerAnswer = await enquirer.prompt<{ provider: ProviderName }>([
        {
          type: 'select',
          name: 'provider',
          message: 'Choose an LLM provider',
          choices: providerChoices
        }
      ]);

      const selectedProvider = providerAnswer.provider;

      // Check if provider needs configuration
      if (!this.isProviderConfigured(selectedProvider)) {
        console.log(chalk.yellow(`\n${selectedProvider} is not configured yet. Let's set it up!\n`));
        await this.configureProvider(selectedProvider);
        return;
      }

      // Provider is configured, let them change the model
      await this.changeProviderModel(selectedProvider);
    } catch (error) {
      // Handle cancellation gracefully (ESC or Ctrl+C)
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      // Re-throw unexpected errors
      throw error;
    }
  }

  private isProviderConfigured(provider: ProviderName): boolean {
    const config = this.runtime.config[provider];
    if (!config) return false;

    // For cloud providers, check API key
    if (provider === 'openrouter' || provider === 'openai') {
      return !!config.apiKey && config.apiKey !== 'replace-me';
    }

    // For local providers, just check if model is set
    return !!config.model;
  }

  private async configureProvider(provider: ProviderName): Promise<void> {
    switch (provider) {
      case 'openrouter':
        await this.configureOpenRouter();
        break;
      case 'ollama':
        await this.configureOllama();
        break;
      case 'llamacpp':
        await this.configureLlamaCpp();
        break;
      case 'openai':
        await this.configureOpenAI();
        break;
    }
  }

  private async configureOpenRouter(): Promise<void> {
    try {
      console.log(chalk.cyan('OpenRouter Configuration'));
      console.log(chalk.gray('Get your API key at: https://openrouter.ai/keys\n'));

      const answers = await enquirer.prompt<{ apiKey: string; model: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenRouter API key'
        },
        {
          type: 'input',
          name: 'model',
          message: 'Enter the model ID',
          initial: 'anthropic/claude-3.5-sonnet'
        }
      ]);

      this.runtime.config.openrouter = {
        apiKey: answers.apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model: answers.model
      };

      this.runtime.config.provider = 'openrouter';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openrouter', answers.model);

      console.log(chalk.green('\n✓ OpenRouter configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      throw error;
    }
  }

  private async configureOllama(): Promise<void> {
    try {
      console.log(chalk.cyan('Ollama Configuration'));
      console.log(chalk.gray('Make sure Ollama is running: ollama serve\n'));

      // Try to fetch available models
      const ollamaUrl = 'http://localhost:11434';
      let availableModels: string[] = [];

      try {
        const response = await fetch(`${ollamaUrl}/api/tags`);
        if (response.ok) {
          const data = await response.json();
          availableModels = data.models?.map((m: any) => m.name) || [];
        }
      } catch {
        console.log(chalk.yellow('⚠ Could not connect to Ollama. Make sure it\'s running.\n'));
      }

      let modelAnswer;
      if (availableModels.length > 0) {
        console.log(chalk.green(`Found ${availableModels.length} model(s)\n`));
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model',
            choices: availableModels
          }
        ]);
      } else {
        modelAnswer = await enquirer.prompt<{ model: string }>([
          {
            type: 'input',
            name: 'model',
            message: 'Enter the model name (e.g., llama3.2:latest)',
            initial: 'llama3.2:latest'
          }
        ]);
      }

      this.runtime.config.ollama = {
        baseUrl: ollamaUrl,
        model: modelAnswer.model
      };

      this.runtime.config.provider = 'ollama';
      this.runtime.options.model = modelAnswer.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('ollama', modelAnswer.model);

      console.log(chalk.green('\n✓ Ollama configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      throw error;
    }
  }

  private async configureLlamaCpp(): Promise<void> {
    try {
      console.log(chalk.cyan('llama.cpp Configuration'));
      console.log(chalk.gray('Make sure llama.cpp server is running: ./server -m model.gguf\n'));

      const answers = await enquirer.prompt<{ port: string; model: string }>([
        {
          type: 'input',
          name: 'port',
          message: 'Server port',
          initial: '8080'
        },
        {
          type: 'input',
          name: 'model',
          message: 'Model name/description',
          initial: 'llama-model'
        }
      ]);

      this.runtime.config.llamacpp = {
        baseUrl: `http://localhost:${answers.port}`,
        port: parseInt(answers.port),
        model: answers.model
      };

      this.runtime.config.provider = 'llamacpp';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('llamacpp', answers.model);

      console.log(chalk.green('\n✓ llama.cpp configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      throw error;
    }
  }

  private async configureOpenAI(): Promise<void> {
    try {
      console.log(chalk.cyan('OpenAI Configuration'));
      console.log(chalk.gray('Get your API key at: https://platform.openai.com/api-keys\n'));

      const modelChoices = [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo'
      ];

      const answers = await enquirer.prompt<{ apiKey: string; model: string }>([
        {
          type: 'password',
          name: 'apiKey',
          message: 'Enter your OpenAI API key'
        },
        {
          type: 'select',
          name: 'model',
          message: 'Select a model',
          choices: modelChoices
        }
      ]);

      this.runtime.config.openai = {
        apiKey: answers.apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model: answers.model
      };

      this.runtime.config.provider = 'openai';
      this.runtime.options.model = answers.model;
      await saveConfig(this.runtime.config);
      this.resetLlmClient('openai', answers.model);

      console.log(chalk.green('\n✓ OpenAI configured successfully!'));
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nConfiguration cancelled.'));
        return;
      }
      throw error;
    }
  }

  private async changeProviderModel(provider: ProviderName): Promise<void> {
    try {
      const currentSettings = getProviderConfig(this.runtime.config, provider);
      const currentModel = this.runtime.options.model ?? currentSettings?.model ?? '';

      // For Ollama, try to fetch available models
      if (provider === 'ollama' && currentSettings?.baseUrl) {
        try {
          const response = await fetch(`${currentSettings.baseUrl}/api/tags`);
          if (response.ok) {
            const data = await response.json();
            const models = data.models?.map((m: any) => m.name) || [];
            if (models.length > 0) {
              const answer = await enquirer.prompt<{ model: string }>([
                {
                  type: 'select',
                  name: 'model',
                  message: 'Select a model',
                  choices: models,
                  initial: models.indexOf(currentModel)
                }
              ]);
              await this.applyModelChange(provider, answer.model, currentModel);
              return;
            }
          }
        } catch {
          // Fall through to manual input
        }
      }

      // For OpenAI, show the predefined list
      if (provider === 'openai') {
        const models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        const answer = await enquirer.prompt<{ model: string }>([
          {
            type: 'select',
            name: 'model',
            message: 'Select a model',
            choices: models,
            initial: Math.max(0, models.indexOf(currentModel))
          }
        ]);
        await this.applyModelChange(provider, answer.model, currentModel);
        return;
      }

      // For other providers, manual input
      const answer = await enquirer.prompt<{ model: string }>([
        {
          type: 'input',
          name: 'model',
          message: 'Enter the model ID to use',
          initial: currentModel
        }
      ]);

      await this.applyModelChange(provider, answer.model?.trim(), currentModel);
    } catch (error) {
      if ((error as any).name === 'ExitPromptError' || (error as Error).message?.includes('canceled')) {
        console.log(chalk.gray('\nModel change cancelled.'));
        return;
      }
      throw error;
    }
  }

  private async applyModelChange(provider: ProviderName, newModel: string, currentModel: string): Promise<void> {
    if (!newModel || (newModel === currentModel && provider === this.activeProvider)) {
      console.log(chalk.gray('Model unchanged.'));
      return;
    }

    const previousModel = this.runtime.options.model;
    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    this.setProviderModel(provider, newModel);
    this.resetLlmClient(provider, newModel);
    await saveConfig(this.runtime.config);
    this.contextWindow = getContextWindow(newModel);
    this.contextPercentLeft = 100;
    this.emitStatus();

    // Track model switch
    await this.telemetryManager.trackModelSwitch({
      fromModel: previousModel,
      toModel: newModel,
      provider
    });

    console.log(chalk.green(`✓ Using ${provider} model ${newModel}`));
  }

  private async promptApprovalMode(): Promise<void> {
    const answer = await enquirer.prompt<{ mode: 'confirm' | 'prompt' }>([
      {
        type: 'select',
        name: 'mode',
        message: 'Choose confirmation mode',
        choices: [
          { name: 'confirm', message: 'Require approval before risky actions' },
          { name: 'prompt', message: 'Auto-confirm actions (dangerous)' }
        ],
        initial: this.runtime.options.yes ? 'prompt' : 'confirm'
      }
    ]);

    this.runtime.options.yes = answer.mode === 'prompt';
    console.log(
      answer.mode === 'prompt'
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
    const template = `# Project Autopilot\n\nDescribe how Autohand should work in this repo. Include framework commands, testing requirements, and any constraints.\n`;
    await fs.writeFile(target, template, 'utf8');
    console.log(chalk.green('Created AGENTS.md template. Customize it to guide the agent.'));
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
    this.initializeUI(abortController, () => {
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
        await this.promptModelSelection();
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
        const elapsed = this.formatElapsedTime(this.taskStartedAt);
        const tokens = this.formatTokens(this.totalTokensUsed);
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
    process.stderr.write(`[AGENT DEBUG] runReactLoop started\n`);
    // Configurable iteration limit (default 100) - context management handles memory
    const maxIterations = this.runtime.config.agent?.maxIterations ?? 100;

    // Get all function definitions for native tool calling
    const allTools = this.toolManager.toFunctionDefinitions();
    process.stderr.write(`[AGENT DEBUG] Loaded ${allTools.length} tools, maxIterations=${maxIterations}\n`);

    // Start status updates for the main loop
    this.startStatusUpdates();

    // Check if thinking should be shown
    const showThinking = this.runtime.config.ui?.showThinking !== false;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      // Filter tools by relevance to reduce token overhead
      const messages = this.conversation.history();
      const tools = filterToolsByRelevance(allTools, messages);

      // Check context usage and auto-crop if needed
      const model = this.runtime.options.model ?? getProviderConfig(this.runtime.config, this.activeProvider)?.model ?? 'unconfigured';
      const contextUsage = calculateContextUsage(
        messages,
        tools,
        model
      );

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

      // Show iteration progress for long-running tasks (every 10 steps after step 10)
      if (iteration >= 10 && iteration % 10 === 0) {
        this.runtime.spinner?.start(`Working... (step ${iteration + 1})`);
      } else {
        this.runtime.spinner?.start('Working ...');
      }
      // Get messages with images included for multimodal support
      const messagesWithImages = this.getMessagesWithImages();

      process.stderr.write(`[AGENT DEBUG] Calling LLM with ${messagesWithImages.length} messages, ${tools.length} tools\n`);

      let completion;
      try {
        completion = await this.llm.complete({
          messages: messagesWithImages,
          temperature: this.runtime.options.temperature ?? 0.2,
          model: this.runtime.options.model,
          signal: abortController.signal,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          maxTokens: 16000  // Allow large outputs for file generation
        });
        process.stderr.write(`[AGENT DEBUG] LLM returned: content length=${completion.content?.length ?? 0}, toolCalls=${completion.toolCalls?.length ?? 0}\n`);
      } catch (llmError) {
        const errMsg = llmError instanceof Error ? llmError.message : String(llmError);
        const errStack = llmError instanceof Error ? llmError.stack : '';
        process.stderr.write(`[AGENT DEBUG] LLM ERROR: ${errMsg}\n`);
        process.stderr.write(`[AGENT DEBUG] LLM STACK: ${errStack}\n`);
        throw llmError;
      }

      // Track token usage from response and immediately update UI
      if (completion.usage) {
        this.totalTokensUsed += completion.usage.totalTokens;
        // Immediately render updated token count
        this.forceRenderSpinner();
      }

      const payload = this.parseAssistantResponse(completion);
      process.stderr.write(`[AGENT DEBUG] Parsed payload: finalResponse=${!!payload.finalResponse}, thought=${!!payload.thought}, toolCalls=${payload.toolCalls?.length ?? 0}\n`);
      const assistantMessage: LLMMessage = { role: 'assistant', content: completion.content };
      if (completion.toolCalls?.length) {
        assistantMessage.tool_calls = completion.toolCalls;
      }
      this.conversation.addMessage(assistantMessage);
      await this.saveAssistantMessage(completion.content, payload.toolCalls);
      this.updateContextUsage(this.conversation.history(), tools);

      // Debug: show what the model returned (helps diagnose response issues)
      if (process.env.AUTOHAND_DEBUG) {
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
          outputLines.push(this.formatToolResultsBatch(results, charLimit, otherCalls, thought));
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
      const response = this.cleanupModelResponse(rawResponse.trim());

      // If response is empty and we've done work (iteration > 0), try to get a proper response
      // But limit retries to prevent infinite loops
      if (!response && iteration > 0) {
        // Track consecutive empty responses to prevent infinite loops
        const consecutiveEmptyKey = '__consecutiveEmpty';
        const consecutiveEmpty = ((this as any)[consecutiveEmptyKey] ?? 0) + 1;
        (this as any)[consecutiveEmptyKey] = consecutiveEmpty;

        if (consecutiveEmpty >= 3) {
          // After 3 retries, force a fallback and break out
          process.stderr.write(`[AGENT DEBUG] Exiting after 3 consecutive empty responses\n`);
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
      if (payload.thought) {
        this.emitOutput({ type: 'thinking', thought: payload.thought });
      }
      this.emitOutput({ type: 'message', content: response });

      if (this.inkRenderer) {
        // InkRenderer: set final response
        if (showThinking && payload.thought) {
          this.inkRenderer.setThinking(payload.thought);
        }
        // Update final stats before stopping (session totals for completionStats)
        this.inkRenderer.setElapsed(this.formatElapsedTime(this.sessionStartedAt));
        this.inkRenderer.setTokens(this.formatTokens(this.sessionTokensUsed + this.totalTokensUsed));
        this.inkRenderer.setWorking(false);
        this.inkRenderer.setFinalResponse(response);
      } else {
        // Ora mode: stop spinner and output
        this.runtime.spinner?.stop();
        if (showThinking && payload.thought && !payload.thought.trim().startsWith('{')) {
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
          // Log raw tool call for debugging
          const rawArgs = tc.function.arguments;
          if (!rawArgs || rawArgs === '{}' || rawArgs === '') {
            console.error(chalk.yellow(`⚠ Tool "${tc.function.name}" has empty/missing arguments`));
            console.error(chalk.gray(`  Raw arguments: "${rawArgs}"`));
          }
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

  private formatToolSignature(def: import('./toolManager.js').ToolDefinition): string {
    const params = def.parameters;
    if (!params || !params.properties || Object.keys(params.properties).length === 0) {
      return `- ${def.name}() - ${def.description}`;
    }

    const required = new Set(params.required ?? []);
    const args = Object.entries(params.properties)
      .map(([name, prop]) => {
        const optional = required.has(name) ? '' : '?';
        return `${name}${optional}: ${prop.type}`;
      })
      .join(', ');

    return `- ${def.name}(${args}) - ${def.description}`;
  }

  private async buildSystemPrompt(): Promise<string> {
    const toolDefs = this.toolManager?.listDefinitions() ?? [];
    const toolSignatures = toolDefs.map(def => this.formatToolSignature(def)).join('\n');

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

    return parts.join('\n');
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

    if (!this.workspaceFiles.length) {
      return normalizedSeed || null;
    }

    const selection = await showFilePalette({
      files: this.workspaceFiles,
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
    const label = this.formatExplorationLabel(event.kind);
    console.log(`  ${chalk.cyan(label)} ${event.target}`);
  }

  private clearExplorationLog(): void {
    this.hasPrintedExplorationHeader = false;
  }

  private formatExplorationLabel(kind: ExplorationEvent['kind']): string {
    switch (kind) {
      case 'read':
        return 'Read';
      case 'search':
        return 'Search';
      default:
        return 'List';
    }
  }

  /**
   * Format tool results as a single batched output string.
   * This reduces flicker by consolidating multiple console.log calls into one.
   */
  private formatToolResultsBatch(
    results: Array<{ tool: AgentAction['type']; success: boolean; output?: string; error?: string }>,
    charLimit: number,
    toolCalls?: ToolCallRequest[],
    thought?: string
  ): string {
    const lines: string[] = [];

    // Show thought before first tool if present (skip JSON)
    if (thought && !thought.trim().startsWith('{')) {
      lines.push(chalk.white(thought));
      lines.push('');
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const content = result.success
        ? result.output ?? '(no output)'
        : result.error ?? result.output ?? 'Tool failed without error message';

      // Extract args from tool call
      const call = toolCalls?.[i];
      const filePath = call?.args?.path as string | undefined;
      const command = call?.args?.command as string | undefined;
      const commandArgs = call?.args?.args as string[] | undefined;

      const display = result.success
        ? formatToolOutputForDisplay({ tool: result.tool, content, charLimit, filePath, command, commandArgs })
        : { output: content, truncated: false, totalChars: content.length };

      const icon = result.success ? chalk.green('✔') : chalk.red('✖');
      lines.push(`${icon} ${chalk.bold(result.tool)}`);

      if (content) {
        if (result.success) {
          lines.push(chalk.gray(display.output));
        } else {
          // Error box
          lines.push(chalk.red('┌─ Error ─────────────────────────────────'));
          lines.push(chalk.red('│ ') + chalk.white(content));
          lines.push(chalk.red('└─────────────────────────────────────────'));
        }
      }
      lines.push(''); // blank line between tools
    }

    return lines.join('\n');
  }

  /**
   * Initialize the UI for a new instruction.
   * Uses InkRenderer when enabled, otherwise falls back to ora spinner.
   */
  private initializeUI(abortController?: AbortController, onCancel?: () => void): void {
    if (this.useInkRenderer && process.stdout.isTTY && process.stdin.isTTY) {
      // Create and start InkRenderer (only in TTY mode)
      this.inkRenderer = createInkRenderer({
        onInstruction: (text) => {
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
      this.inkRenderer.setElapsed(this.formatElapsedTime(this.sessionStartedAt));
      this.inkRenderer.setTokens(this.formatTokens(this.sessionTokensUsed + this.totalTokensUsed));
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
    readline.emitKeypressEvents(input);
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
    const label = this.describeInstruction(instruction);
    const startedAt = Date.now();
    const update = () => {
      const elapsed = this.formatElapsedTime(startedAt);
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

  private describeInstruction(instruction: string): string {
    const normalized = instruction.trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return 'work';
    }
    return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized;
  }

  private formatElapsedTime(startedAt: number): string {
    const diff = Date.now() - startedAt;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k tokens`;
    }
    return `${tokens} tokens`;
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
    if (message.includes('payload too large') ||
        message.includes('context too long')) {
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

    const elapsed = this.formatElapsedTime(this.taskStartedAt);
    // Show session total tokens (includes current task + previous tasks in session)
    const sessionTotal = this.sessionTokensUsed + this.totalTokensUsed;
    const tokens = this.formatTokens(sessionTotal);
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

    this.emitStatus();
  }

  private formatStatusLine(): string {
    const percent = Number.isFinite(this.contextPercentLeft)
      ? Math.max(0, Math.min(100, this.contextPercentLeft))
      : 100;

    const queueCount = this.inkRenderer?.getQueueCount() ?? this.persistentInput.getQueueLength();
    const queueStatus = queueCount > 0 ? ` · ${queueCount} queued` : '';

    return `${percent}% context left · / for commands · @ to mention files${queueStatus}`;
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
    return providers.length ? providers : ['openrouter'];
  }

  private setProviderModel(provider: ProviderName, model: string): void {
    const cfgMap: Record<ProviderName, any> = {
      openrouter: this.runtime.config.openrouter ?? (this.runtime.config.openrouter = { apiKey: '', model }),
      ollama: this.runtime.config.ollama ?? (this.runtime.config.ollama = { model }),
      llamacpp: this.runtime.config.llamacpp ?? (this.runtime.config.llamacpp = { model }),
      openai: this.runtime.config.openai ?? (this.runtime.config.openai = { model })
    };
    cfgMap[provider].model = model;
    this.activeProvider = provider;
  }

  private resetLlmClient(provider: ProviderName, model: string): void {
    // Update config to use the selected provider and model
    this.runtime.config.provider = provider;
    const providerConfig = this.runtime.config[provider];
    if (providerConfig) {
      providerConfig.model = model;
    }

    // Create new provider using factory
    this.llm = ProviderFactory.create(this.runtime.config);
    this.llm.setModel(model);
    // Recreate delegator with context inheritance
    const delegatorContext = this.runtime.options.clientContext
      ?? (this.runtime.options.restricted ? 'restricted' : 'cli');
    this.delegator = new AgentDelegator(this.llm, this.actionExecutor, {
      clientContext: delegatorContext,
      maxDepth: 3
    });
    this.activeProvider = provider;
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

    // Reset stdin to cooked mode for enquirer
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
   * When set, this callback is used instead of the default enquirer prompt
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
      contextPercent: this.contextPercentLeft
    };
  }
}
