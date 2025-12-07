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
import { OpenRouterClient } from '../openrouter.js';
import { readInstruction } from '../ui/inputPrompt.js';
import { showFilePalette } from '../ui/filePalette.js';
import { getContextWindow, estimateMessagesTokens } from '../utils/context.js';
import { GitIgnoreParser } from '../utils/gitIgnore.js';
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
  AgentStatusSnapshot,
  AssistantReactPayload,
  ToolCallRequest,
  ExplorationEvent,
  ProviderName
} from '../types.js';

import { AgentDelegator } from './agents/AgentDelegator.js';
import { DEFAULT_TOOL_DEFINITIONS } from './toolManager.js';
import { ErrorLogger } from './errorLogger.js';

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
  private delegator: AgentDelegator;
  private workspaceFiles: string[] = [];
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;
  private activeProvider: ProviderName;
  private errorLogger: ErrorLogger;

  constructor(
    private llm: OpenRouterClient,
    private readonly files: FileActionManager,
    private readonly runtime: AgentRuntime
  ) {
    const initialProvider = runtime.config.provider ?? 'openrouter';
    const providerSettings = getProviderConfig(runtime.config, initialProvider);
    const model = runtime.options.model ?? providerSettings.model;
    this.contextWindow = getContextWindow(model);
    this.ignoreFilter = new GitIgnoreParser(runtime.workspaceRoot, []);
    this.conversation = ConversationManager.getInstance();
    this.toolsRegistry = new ToolsRegistry();
    this.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => this.resolveWorkspacePath(relativePath),
      confirmDangerousAction: (message) => this.confirmDangerousAction(message),
      onExploration: (entry) => this.recordExploration(entry),
      toolsRegistry: this.toolsRegistry,
      getRegisteredTools: () => this.toolManager?.listDefinitions() ?? []
    });

    this.activeProvider = runtime.config.provider ?? 'openrouter';
    this.delegator = new AgentDelegator(llm, this.actionExecutor);
    this.errorLogger = new ErrorLogger('0.1.0'); // TODO: Get from package.json

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

    this.toolManager = new ToolManager({
      executor: async (action) => {
        if (action.type === 'delegate_task') {
          return this.delegator.delegateTask(action.agent_name, action.task);
        }
        if (action.type === 'delegate_parallel') {
          return this.delegator.delegateParallel(action.tasks);
        }
        return this.actionExecutor.execute(action);
      },
      confirmApproval: (message) => this.confirmDangerousAction(message),
      definitions: [...DEFAULT_TOOL_DEFINITIONS, ...delegationTools]
    });

    this.sessionManager = new SessionManager();
    this.projectManager = new ProjectManager();
    this.slashHandler = new SlashCommandHandler({
      promptModelSelection: () => this.promptModelSelection(),
      createAgentsFile: () => this.createAgentsFile(),
      sessionManager: this.sessionManager,
      llm: this.llm
    }, SLASH_COMMANDS);
    this.resetConversationContext();
  }

  async runInteractive(): Promise<void> {
    // Initialize session
    await this.sessionManager.initialize();
    await this.projectManager.initialize();
    const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
    const model = this.runtime.options.model ?? providerSettings.model;
    await this.sessionManager.createSession(this.runtime.workspaceRoot, model);

    await this.runInteractiveLoop();
  }

  async resumeSession(sessionId: string): Promise<void> {
    // Initialize session
    await this.sessionManager.initialize();
    await this.projectManager.initialize();

    try {
      const session = await this.sessionManager.loadSession(sessionId);

      // Restore context
      this.resetConversationContext();
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
            name: msg.name
          });
        }
      }

      await this.injectProjectKnowledge();
      this.updateContextUsage(this.conversation.history());

      console.log(chalk.cyan(`\n📂 Resumed session ${sessionId}`));

      // Start interactive loop
      await this.runInteractiveLoop();
    } catch (error) {
      console.error(chalk.red(`Failed to resume session: ${(error as Error).message}`));
      // Fallback to new session
      const providerSettings = getProviderConfig(this.runtime.config, this.activeProvider);
      const model = this.runtime.options.model ?? providerSettings.model;
      await this.sessionManager.createSession(this.runtime.workspaceRoot, model);
      await this.runInteractiveLoop();
    }
  }

  private async runInteractiveLoop(): Promise<void> {
    while (true) {
      try {
        const instruction = await this.promptForInstruction();
        if (!instruction) {
          continue;
        }

        if (instruction === '/exit' || instruction === '/quit') {
          await this.closeSession();
          return;
        }

        if (instruction === 'SESSION_RESUMED') {
          // Already handled in resumeSession or runInteractive logic, but keep for safety
          continue;
        }

        await this.runInstruction(instruction);
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

    if (normalized) {
      normalized = await this.resolveMentions(normalized);
      return normalized;
    }
    return null;
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
    const entries = await fs.readdir(current);
    for (const entry of entries) {
      const full = path.join(current, entry);
      const rel = path.relative(this.runtime.workspaceRoot, full);
      if (rel === '' || this.shouldSkipPath(rel) || this.ignoreFilter.isIgnored(rel)) {
        continue;
      }
      const stats = await fs.stat(full);
      if (stats.isDirectory()) {
        await this.walkWorkspace(full, acc);
      } else if (stats.isFile()) {
        acc.push(rel);
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
      const currentModel = this.runtime.options.model ?? currentSettings.model;

      // For Ollama, try to fetch available models
      if (provider === 'ollama') {
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

    this.runtime.config.provider = provider;
    this.runtime.options.model = newModel;
    this.setProviderModel(provider, newModel);
    this.resetLlmClient(provider, newModel);
    await saveConfig(this.runtime.config);
    this.contextWindow = getContextWindow(newModel);
    this.contextPercentLeft = 100;
    this.emitStatus();
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

  async runInstruction(instruction: string): Promise<void> {
    this.isInstructionActive = true;
    this.clearExplorationLog();
    const spinner = ora({
      text: 'Gathering context...',
      spinner: 'dots'
    }).start();
    this.runtime.spinner = spinner;
    const abortController = new AbortController();
    let canceledByUser = false;
    const cleanupEsc = this.setupEscListener(abortController, () => {
      if (!canceledByUser) {
        canceledByUser = true;
        spinner.stop();
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
      if (abortController.signal.aborted) {
        return;
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
      spinner.stop();
      this.isInstructionActive = false;
      this.clearExplorationLog();
    }
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

  private async saveToolMessage(name: string, content: string): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) return;

    const message: SessionMessage = {
      role: 'tool',
      content,
      name,
      timestamp: new Date().toISOString()
    };
    await session.append(message);
  }

  private async closeSession(): Promise<void> {
    const session = this.sessionManager.getCurrentSession();
    if (!session) {
      console.log(chalk.gray('Ending Autohand session.'));
      return;
    }

    // Generate summary from last few messages
    const messages = session.getMessages();
    const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0];
    const summary = lastUserMsg?.content.slice(0, 60) || 'Session complete';

    await this.sessionManager.closeSession(summary);

    console.log(chalk.gray('\nEnding Autohand session.\n'));
    console.log(chalk.cyan(`💾 Session saved: ${session.metadata.sessionId}`));
    console.log(chalk.gray(`   Resume with: autohand resume ${session.metadata.sessionId}\n`));
  }

  private async runReactLoop(abortController: AbortController): Promise<void> {
    const maxIterations = 8;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      this.runtime.spinner?.start('Working ...');
      const completion = await this.llm.complete({
        messages: this.conversation.history(),
        temperature: this.runtime.options.temperature ?? 0.2,
        model: this.runtime.options.model,
        signal: abortController.signal
      });

      const payload = this.parseAssistantReactPayload(completion.content);
      this.conversation.addMessage({ role: 'assistant', content: completion.content });
      await this.saveAssistantMessage(completion.content, payload.toolCalls);
      this.updateContextUsage(this.conversation.history());

      if (payload.toolCalls && payload.toolCalls.length > 0) {
        if (payload.thought) {
          this.runtime.spinner?.stop();
          console.log(chalk.gray(`   ${payload.thought}`));
          console.log();
        }
        const cropCalls = payload.toolCalls.filter((call) => call.tool === 'smart_context_cropper');
        const otherCalls = payload.toolCalls.filter((call) => call.tool !== 'smart_context_cropper');

        if (cropCalls.length) {
          for (const call of cropCalls) {
            const content = await this.handleSmartContextCrop(call);
            this.conversation.addMessage({ role: 'tool', name: 'smart_context_cropper', content });
            await this.saveToolMessage('smart_context_cropper', content);
            this.updateContextUsage(this.conversation.history());
            console.log(`\n${chalk.cyan('✂ smart_context_cropper')}\n${chalk.gray(content)}`);
          }
        }

        if (otherCalls.length) {
          this.runtime.spinner?.start('Executing tools...');
          const results = await this.toolManager.execute(otherCalls);
          for (const result of results) {
            const content = result.success
              ? result.output ?? '(no output)'
              : result.error ?? result.output ?? 'Tool failed without error message';
            this.conversation.addMessage({ role: 'tool', name: result.tool, content });
            await this.saveToolMessage(result.tool, content);
            this.updateContextUsage(this.conversation.history());
            const icon = result.success ? chalk.green('✔') : chalk.red('✖');
            console.log(`\n${icon} ${chalk.bold(result.tool)}`);
            if (content) {
              console.log(chalk.gray(content));
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

      this.runtime.spinner?.stop();

      if (payload.thought) {
        console.log(chalk.gray(`   ${payload.thought}`));
        console.log();
      }

      const response = (payload.finalResponse ?? payload.response ?? completion.content).trim();
      console.log(response);
      return;
    }
    throw new Error('Reached maximum recursion depth while orchestrating tool calls.');
  }

  private parseAssistantReactPayload(raw: string): AssistantReactPayload {
    const jsonBlock = this.extractJson(raw);
    if (!jsonBlock) {
      return { finalResponse: raw.trim() };
    }
    try {
      const parsed = JSON.parse(jsonBlock) as AssistantReactPayload & { toolCalls?: unknown };
      return {
        thought: parsed.thought,
        toolCalls: this.normalizeToolCalls(parsed.toolCalls),
        finalResponse: parsed.finalResponse ?? parsed.response ?? undefined,
        response: parsed.response
      };
    } catch {
      return { finalResponse: raw.trim() };
    }
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

  private buildSystemPrompt(): string {
    const toolNames = this.toolManager?.listToolNames() ?? [];
    const tools = toolNames.join(', ');

    return [
      // ═══════════════════════════════════════════════════════════════════
      // 1. IDENTITY & CORE STANDARDS
      // ═══════════════════════════════════════════════════════════════════
      'You are Autohand, an expert AI software engineer built for the command line.',
      'You are the best engineer in the world. You write code that is clean, efficient, maintainable, and easy to understand.',
      'You are a master of your craft and can solve any problem with precision and elegance.',
      'Your goal: Gather necessary information, clarify uncertainties, and decisively execute. Never stop until the task is fully complete.',
      '',

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
      '1. Write code using `write_file`, `replace_in_file`, `apply_patch`, or `multi_file_edit`.',
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

      // ═══════════════════════════════════════════════════════════════════
      // 4. REACT PATTERN & TOOL USAGE
      // ═══════════════════════════════════════════════════════════════════
      '## ReAct Pattern (Reason + Act)',
      'You must follow the ReAct loop: think about the request, decide whether to call tools, execute them, interpret the results, and only then respond.',
      '',
      '### Tool Discovery',
      'When choosing tools, first call `tools_registry` to fetch the full merged list (built-in + meta). Never invent tools beyond what it returns.',
      tools ? `Known tools: ${tools}. Use them exactly by name with structured args.` : 'Tools are resolved at runtime. Use tools_registry to inspect them.',
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
      // 6. REPOSITORY CONVENTIONS
      // ═══════════════════════════════════════════════════════════════════
      '## Repository Conventions',
      'Match existing code style, patterns, and naming conventions. Review similar modules before adding new ones.',
      'Respect framework/library choices already present. Avoid superfluous documentation; keep changes consistent with repo standards.',
      'Implement changes in the simplest way possible. Prefer clarity over cleverness.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 7. SAFETY & APPROVALS
      // ═══════════════════════════════════════════════════════════════════
      '## Safety',
      'Destructive operations (delete_path, run_command with rm/sudo/dd) require explicit user approval.',
      'Clearly justify risky actions in your "thought" field before calling them.',
      'Respect workspace boundaries: never escape the workspace root.',
      'Do not commit broken code. If you break the build, fix it before declaring success.',
      '',

      // ═══════════════════════════════════════════════════════════════════
      // 8. COMPLETION CRITERIA
      // ═══════════════════════════════════════════════════════════════════
      '## Definition of Done',
      'A task is complete only when:',
      '- All requested functionality is implemented',
      '- The code follows repository conventions',
      '- The build passes (if applicable)',
      '- Tests pass (if applicable)',
      '- You have verified your changes with git_diff or similar',
      '',
      'Do not stop until all criteria are met. Do not ask the user to complete your work.'
    ].join('\n');
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
      .filter((entry) => !entry.startsWith('.git'))
      .slice(0, 20);

    return {
      workspaceRoot: this.runtime.workspaceRoot,
      gitStatus,
      recentFiles
    };
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

    const handler = (_str: string, key: readline.Key) => {
      if (controller.signal.aborted) {
        return;
      }
      if (key?.name === 'escape') {
        controller.abort();
        onCancel();
        return;
      }
      if (ctrlCInterrupt && key?.name === 'c' && key.ctrl) {
        ctrlCCount += 1;
        if (ctrlCCount >= 2) {
          controller.abort();
          onCancel();
        } else {
          console.log(chalk.gray('Press Ctrl+C again to exit.'));
        }
      }
    };
    input.on('keypress', handler);

    return () => {
      input.off('keypress', handler);
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

  private updateContextUsage(messages: LLMMessage[]): void {
    if (!this.contextWindow) {
      return;
    }
    const usage = estimateMessagesTokens(messages);
    const percent = Math.max(0, Math.min(1 - usage / this.contextWindow, 1));
    this.contextPercentLeft = Math.round(percent * 100);
    this.emitStatus();
  }

  private formatStatusLine(): string {
    const percent = Number.isFinite(this.contextPercentLeft)
      ? Math.max(0, Math.min(100, this.contextPercentLeft))
      : 100;
    return `${percent}% context left · / for commands · @ to mention files`;
  }

  private resetConversationContext(): void {
    this.conversation.reset(this.buildSystemPrompt());
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
    const settings = getProviderConfig(this.runtime.config, provider);
    this.llm = new OpenRouterClient({
      apiKey: settings.apiKey ?? '',
      baseUrl: settings.baseUrl,
      model
    });
    this.llm.setDefaultModel(model);
    this.delegator = new AgentDelegator(this.llm, this.actionExecutor);
  }

  private async confirmDangerousAction(message: string): Promise<boolean> {
    if (this.runtime.options.yes || this.runtime.config.ui?.autoConfirm) {
      return true;
    }
    const answer = await enquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message,
        initial: false
      }
    ]);
    return answer.confirm;
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
      model: this.runtime.options.model ?? providerSettings.model,
      workspace: this.runtime.workspaceRoot,
      contextPercent: this.contextPercentLeft
    };
  }
}
