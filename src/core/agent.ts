/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
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
  AgentStatusSnapshot,
  AssistantReactPayload,
  ToolCallRequest,
  ExplorationEvent,
  ProviderName,
  ClientContext
} from '../types.js';

import { AgentDelegator } from './agents/AgentDelegator.js';
import { DEFAULT_TOOL_DEFINITIONS } from './toolManager.js';
import { ErrorLogger } from './errorLogger.js';
import { MemoryManager } from '../memory/MemoryManager.js';
import { FeedbackManager } from '../feedback/FeedbackManager.js';
import { TelemetryManager } from '../telemetry/TelemetryManager.js';
import { PersistentInput, createPersistentInput } from '../ui/persistentInput.js';
import packageJson from '../../package.json' with { type: 'json' };

export class AutohandAgent {
  private mentionContexts: { path: string; contents: string }[] = [];
  private contextWindow: number;
  private contextPercentLeft = 100;
  private ignoreFilter: GitIgnoreParser;
  private statusListener?: (snapshot: AgentStatusSnapshot) => void;
  private conversation: ConversationManager;
  private toolManager: ToolManager;
  private actionExecutor: ActionExecutor;
  private toolsRegistry: ToolsRegistry;
  private slashHandler: SlashCommandHandler;
  private sessionManager: SessionManager;
  private projectManager: ProjectManager;
  private memoryManager: MemoryManager;
  private delegator: AgentDelegator;
  private feedbackManager: FeedbackManager;
  private telemetryManager: TelemetryManager;
  private workspaceFiles: string[] = [];
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;
  private activeProvider: ProviderName;
  private errorLogger: ErrorLogger;

  // Task-level tracking for status line
  private taskStartedAt: number | null = null;
  private totalTokensUsed = 0;
  private statusInterval: NodeJS.Timeout | null = null;

  // Persistent input for always-visible input field
  private persistentInput: PersistentInput;

  // Current queue input (shared between keypress handler and status updates)
  private queueInput = '';

  // Last rendered state to prevent flickering (only update when changed)
  private lastRenderedStatus = '';

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
    this.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => this.resolveWorkspacePath(relativePath),
      confirmDangerousAction: (message) => this.confirmDangerousAction(message),
      onExploration: (entry) => this.recordExploration(entry),
      toolsRegistry: this.toolsRegistry,
      getRegisteredTools: () => this.toolManager?.listDefinitions() ?? [],
      memoryManager: this.memoryManager
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
    this.telemetryManager = new TelemetryManager({
      enabled: runtime.config.telemetry?.enabled !== false,
      apiBaseUrl: runtime.config.telemetry?.apiBaseUrl || 'https://api.autohand.ai',
      enableSessionSync: runtime.config.telemetry?.enableSessionSync !== false
    });

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
      executor: async (action) => {
        const startTime = Date.now();
        try {
          let result: string | undefined;
          if (action.type === 'delegate_task') {
            result = await this.delegator.delegateTask(action.agent_name, action.task);
          } else if (action.type === 'delegate_parallel') {
            result = await this.delegator.delegateParallel(action.tasks);
          } else {
            result = await this.actionExecutor.execute(action);
          }
          // Track successful tool use
          await this.telemetryManager.trackToolUse({
            tool: action.type,
            success: true,
            duration: Date.now() - startTime
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
          throw error;
        }
      },
      confirmApproval: (message) => this.confirmDangerousAction(message),
      definitions: [...DEFAULT_TOOL_DEFINITIONS, ...delegationTools],
      clientContext
    });

    this.sessionManager = new SessionManager();
    this.projectManager = new ProjectManager();

    // Initialize persistent input for queuing messages while agent works
    // Using silent mode to avoid conflicts with ora spinner
    this.persistentInput = createPersistentInput({
      maxQueueSize: 10,
      silentMode: true
    });

    // Listen for queue events to update spinner
    this.persistentInput.on('queued', (text: string, count: number) => {
      const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
      if (this.runtime.spinner) {
        // Briefly show queued message, then restore normal status
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
   * Run a single instruction in command mode (non-interactive)
   * This initializes all necessary context before executing the instruction
   */
  async runCommandMode(instruction: string): Promise<void> {
    // Initialize session and context
    await this.sessionManager.initialize();
    await this.projectManager.initialize();
    await this.memoryManager.initialize();
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

    // Run the instruction
    await this.runInstruction(instruction);

    // End session
    await this.telemetryManager.endSession('completed');
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
          this.conversation.addMessage({
            role: msg.role,
            content: msg.content,
            name: msg.name,
            tool_calls: (msg as any).toolCalls,
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
        // Check for queued requests first
        let instruction: string | null = null;

        if (this.persistentInput.hasQueued()) {
          const queued = this.persistentInput.dequeue();
          if (queued) {
            instruction = queued.text;
            console.log(chalk.cyan(`\n▶ Processing queued request: "${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}"`));

            // Show remaining queue status
            if (this.persistentInput.hasQueued()) {
              console.log(chalk.gray(`  ${this.persistentInput.getQueueLength()} more request(s) queued`));
            }
          }
        }

        // If no queued request, prompt for new input
        if (!instruction) {
          instruction = await this.promptForInstruction();
        }

        if (!instruction) {
          continue;
        }

        if (instruction === '/exit' || instruction === '/quit') {
          // Track command before exiting
          await this.telemetryManager.trackCommand({ command: instruction });
          // Check if we should prompt for feedback on exit
          const trigger = this.feedbackManager.shouldPrompt({ sessionEnding: true });
          if (trigger) {
            const session = this.sessionManager.getCurrentSession();
            await this.feedbackManager.promptForFeedback(trigger, session?.metadata.sessionId);
          }
          await this.closeSession();
          return;
        }

        if (instruction === 'SESSION_RESUMED') {
          // Already handled in resumeSession or runInteractive logic, but keep for safety
          continue;
        }

        // Track slash commands
        const isSlashCommand = instruction.startsWith('/');
        if (isSlashCommand) {
          await this.telemetryManager.trackCommand({ command: instruction.split(' ')[0] });
        }

        await this.runInstruction(instruction);
        this.feedbackManager.recordInteraction();
        this.telemetryManager.recordInteraction();

        // Check for feedback trigger (gratitude, task completion, etc.)
        const feedbackTrigger = this.feedbackManager.shouldPrompt({
          userMessage: instruction,
          taskCompleted: true
        });

        if (feedbackTrigger) {
          const session = this.sessionManager.getCurrentSession();
          // Use quick rating for mid-session prompts to minimize interruption
          if (feedbackTrigger === 'gratitude') {
            await this.feedbackManager.quickRating();
          } else {
            await this.feedbackManager.promptForFeedback(feedbackTrigger, session?.metadata.sessionId);
          }
        }

        console.log();
      } catch (error) {
        // Check if it's a user cancellation (ESC or Ctrl+C)
        const errorObj = error as any;
        const isCancel = errorObj.name === 'ExitPromptError' ||
          errorObj.isCanceled ||
          errorObj.message?.includes('canceled') ||
          errorObj.message?.includes('User force closed') ||
          !errorObj.message; // undefined message often means user cancelled

        if (isCancel) {
          // Graceful cancellation - just continue the loop
          // Silent continue, no message needed
          continue;
        }

        // Log unexpected errors
        await this.errorLogger.log(error as Error, {
          context: 'Interactive loop',
          workspace: this.runtime.workspaceRoot
        });

        // Track error in telemetry
        await this.telemetryManager.trackError({
          type: 'interactive_loop_error',
          message: (error as Error).message,
          stack: (error as Error).stack,
          context: 'Interactive loop'
        });

        // Save session on unexpected error
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
    const input = await readInstruction(this.workspaceFiles, SLASH_COMMANDS, statusLine);
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
      const handled = await this.slashHandler.handle(normalized);
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

    // Initialize task-level tracking
    this.taskStartedAt = Date.now();
    this.totalTokensUsed = 0;

    const spinner = ora({
      text: 'Gathering context...',
      spinner: 'dots'
    }).start();
    this.runtime.spinner = spinner;

    // TODO: Queue feature disabled temporarily - causes flickering due to
    // competing readline handlers. Need to integrate into setupEscListener.
    // if (this.runtime.config.agent?.enableRequestQueue !== false) {
    //   this.persistentInput.start();
    // }

    const abortController = new AbortController();
    let canceledByUser = false;
    let success = true;
    const cleanupEsc = this.setupEscListener(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        this.stopStatusUpdates();
        spinner.stop();
        // this.persistentInput.stop(); // Queue feature disabled
        console.log('\n' + chalk.yellow('Request canceled by user (ESC).'));
      }
    }, true);
    const stopPreparation = this.startPreparationStatus(instruction);
    try {
      const userMessage = await this.buildUserMessage(instruction);
      stopPreparation();
      spinner.text = 'Reasoning with the AI (ReAct loop)...';
      this.conversation.addMessage({ role: 'user', content: userMessage });

      // Save user message to session
      await this.saveUserMessage(instruction);

      this.updateContextUsage(this.conversation.history());
      await this.runReactLoop(abortController);
    } catch (error) {
      success = false;
      if (abortController.signal.aborted) {
        return false;
      }

      // Handle unconfigured provider by prompting for configuration
      if (error instanceof ProviderNotConfiguredError) {
        spinner.stop();
        console.log(chalk.yellow(`\nNo provider is configured yet. Let's set one up!\n`));
        await this.promptModelSelection();
        // After configuration, retry the instruction
        return this.runInstruction(instruction);
      }

      spinner.fail('Session failed');
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      } else {
        console.error(error);
      }
    } finally {
      cleanupEsc();
      stopPreparation();
      this.stopStatusUpdates();
      spinner.stop();

      // Stop the queue input (disabled - see TODO above)
      // this.persistentInput.stop();

      // Show completion summary
      if (this.taskStartedAt && !canceledByUser) {
        const elapsed = this.formatElapsedTime(this.taskStartedAt);
        const tokens = this.formatTokens(this.totalTokensUsed);
        const queueStatus = this.persistentInput.hasQueued()
          ? ` · ${this.persistentInput.getQueueLength()} queued`
          : '';
        console.log(chalk.gray(`\nCompleted in ${elapsed} · ${tokens} used${queueStatus}`));
      }

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

  private async saveToolMessage(name: string, content: string, toolCallId?: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

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
    // Configurable iteration limit (default 100) - context management handles memory
    const maxIterations = this.runtime.config.agent?.maxIterations ?? 100;

    // Get all function definitions for native tool calling
    const allTools = this.toolManager.toFunctionDefinitions();

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
      const completion = await this.llm.complete({
        messages: this.conversation.history(),
        temperature: this.runtime.options.temperature ?? 0.2,
        model: this.runtime.options.model,
        signal: abortController.signal,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined
      });

      // Track token usage from response
      if (completion.usage) {
        this.totalTokensUsed += completion.usage.totalTokens;
      }

      const payload = this.parseAssistantResponse(completion);
      const assistantMessage: LLMMessage = { role: 'assistant', content: completion.content };
      if (completion.toolCalls?.length) {
        assistantMessage.tool_calls = completion.toolCalls;
      }
      this.conversation.addMessage(assistantMessage);
      await this.saveAssistantMessage(completion.content, payload.toolCalls);
      this.updateContextUsage(this.conversation.history(), tools);

      if (payload.toolCalls && payload.toolCalls.length > 0) {
        if (showThinking && payload.thought) {
          this.runtime.spinner?.stop();
          console.log(chalk.gray(`   ${payload.thought}`));
          console.log();
        }
        const cropCalls = payload.toolCalls.filter((call) => call.tool === 'smart_context_cropper');
        const otherCalls = payload.toolCalls.filter((call) => call.tool !== 'smart_context_cropper');

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
            console.log(`\n${chalk.cyan('✂ smart_context_cropper')}\n${chalk.gray(content)}`);
          }
        }

        if (otherCalls.length) {
          this.runtime.spinner?.start('Executing tools...');
          const results = await this.toolManager.execute(otherCalls);
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
            this.updateContextUsage(this.conversation.history(), tools);
            const icon = result.success ? chalk.green('✔') : chalk.red('✖');
            console.log(`\n${icon} ${chalk.bold(result.tool)}`);
            if (content) {
              if (result.success) {
                console.log(chalk.gray(content));
              } else {
                // Make errors more visible with a red box
                console.log(chalk.red('┌─ Error ─────────────────────────────────'));
                console.log(chalk.red('│ ') + chalk.white(content));
                console.log(chalk.red('└─────────────────────────────────────────'));
              }
            }

            // Record success/failure
            if (result.success) {
              await this.projectManager.recordSuccess(this.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId: this.sessionManager.getCurrentSession()?.metadata.sessionId || 'unknown',
                tool: result.tool,
                context: 'Tool execution',
                tags: [result.tool]
              });
            } else {
              await this.projectManager.recordFailure(this.runtime.workspaceRoot, {
                timestamp: new Date().toISOString(),
                sessionId: this.sessionManager.getCurrentSession()?.metadata.sessionId || 'unknown',
                tool: result.tool,
                error: result.error || 'Unknown error',
                context: 'Tool execution',
                tags: [result.tool]
              });
            }
          }
        }

        continue;
      }

      this.stopStatusUpdates();
      this.runtime.spinner?.stop();

      if (showThinking && payload.thought) {
        console.log(chalk.gray(`   ${payload.thought}`));
        console.log();
      }

      const rawResponse = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      const response = this.cleanupModelResponse(rawResponse);
      console.log(response);
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
      return {
        thought: completion.content || undefined,
        toolCalls: completion.toolCalls.map(tc => ({
          id: tc.id,
          tool: tc.function.name as AgentAction['type'],
          args: this.safeParseToolArgs(tc.function.arguments)
        }))
      };
    }
    return this.parseAssistantReactPayload(completion.content);
  }

  /**
   * Safely parse tool arguments from JSON string
   */
  private safeParseToolArgs(json: string): ToolCallRequest['args'] {
    try {
      const parsed = JSON.parse(json);
      // Return the parsed object if it's valid, otherwise undefined
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
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
    const args = entry.args && typeof entry.args === 'object' ? entry.args : undefined;
    return {
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
        `Crop ${direction} ${Math.floor(amount)} message(s) from the conversation?`
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
      'If you need to edit a file, read it first. If you need to fix a bug, read the failing code first. No exceptions.',
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
      '{"thought": "your reasoning here", "toolCalls": [{"tool": "tool_name", "args": {...}}], "finalResponse": "optional final message"}',
      '',
      '- If no tools are required, set toolCalls to an empty array and provide the finalResponse.',
      '- When tools are needed, omit finalResponse until tool outputs (role=tool) arrive, then continue reasoning.',
      '- Never include markdown fences (```json) around the JSON.',
      '- Never hallucinate tools that do not exist.',
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
    this.queueInput = ''; // Reset queue input
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

      // Queue functionality - capture typed input
      if (enableQueue) {
        // Enter - submit to queue
        if (key?.name === 'return' || key?.name === 'enter') {
          if (this.queueInput.trim()) {
            const text = this.queueInput.trim();
            this.queueInput = '';

            // Add to queue
            const queue = (this.persistentInput as any).queue as Array<{ text: string; timestamp: number }>;
            if (queue.length >= 10) {
              // Queue full - show briefly then restore
              return;
            }
            queue.push({ text, timestamp: Date.now() });

            // Show confirmation briefly
            const preview = text.length > 30 ? text.slice(0, 27) + '...' : text;
            if (this.runtime.spinner) {
              this.runtime.spinner.text = chalk.cyan(`✓ Queued: "${preview}" (${this.persistentInput.getQueueLength()} pending)`);
            }
          }
          return;
        }

        // Backspace
        if (key?.name === 'backspace') {
          this.queueInput = this.queueInput.slice(0, -1);
          this.updateInputLine(); // Immediate feedback
          return;
        }

        // Ignore control keys
        if (key?.ctrl || key?.meta) {
          return;
        }

        // Add printable characters
        if (_str) {
          const printable = _str.replace(/[\x00-\x1F\x7F]/g, '');
          if (printable) {
            this.queueInput += printable;
            this.updateInputLine(); // Immediate feedback
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
      if (!this.runtime.spinner) {
        return;
      }
      const elapsed = this.formatElapsedTime(startedAt);
      this.runtime.spinner.text = `Preparing to ${label} (${elapsed} • esc to interrupt)`;
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
    if (!this.runtime.spinner || !this.taskStartedAt) return;

    const elapsed = this.formatElapsedTime(this.taskStartedAt);
    const tokens = this.formatTokens(this.totalTokensUsed);
    const queueCount = this.persistentInput.getQueueLength();
    const queueHint = queueCount > 0 ? ` [${queueCount} queued]` : '';
    const statusLine = `Working... (esc to interrupt · ${elapsed} · ${tokens}${queueHint})`;

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

    const queueStatus = this.persistentInput.hasQueued()
      ? ` · ${this.persistentInput.getQueueLength()} queued`
      : '';

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

  private async confirmDangerousAction(message: string): Promise<boolean> {
    if (this.runtime.options.yes || this.runtime.config.ui?.autoConfirm) {
      return true;
    }

    // Pause persistent input so enquirer can work properly
    this.persistentInput.pause();

    try {
      const answer = await enquirer.prompt<{ confirm: boolean }>([
        {
          type: 'confirm',
          name: 'confirm',
          message,
          initial: false
        }
      ]);
      return answer.confirm;
    } finally {
      // Resume persistent input after confirmation
      this.persistentInput.resume();
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
