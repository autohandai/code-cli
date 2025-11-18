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
import { saveConfig } from '../config.js';
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
import type {
  AgentRuntime,
  AgentAction,
  LLMMessage,
  AgentStatusSnapshot,
  AssistantReactPayload,
  ToolCallRequest,
  ExplorationEvent
} from '../types.js';

export class AutohandAgent {
  private mentionContexts: { path: string; contents: string }[] = [];
  private contextWindow: number;
  private contextPercentLeft = 100;
  private ignoreFilter: GitIgnoreParser;
  private statusListener?: (snapshot: AgentStatusSnapshot) => void;
  private conversation: ConversationManager;
  private toolManager: ToolManager;
  private actionExecutor: ActionExecutor;
  private slashHandler: SlashCommandHandler;
  private workspaceFiles: string[] = [];
  private isInstructionActive = false;
  private hasPrintedExplorationHeader = false;

  constructor(
    private readonly llm: OpenRouterClient,
    private readonly files: FileActionManager,
    private readonly runtime: AgentRuntime
  ) {
    const model = runtime.options.model ?? runtime.config.openrouter.model;
    this.contextWindow = getContextWindow(model);
    this.ignoreFilter = new GitIgnoreParser(runtime.workspaceRoot, []);
    this.conversation = ConversationManager.getInstance();
    this.resetConversationContext();
    this.actionExecutor = new ActionExecutor({
      runtime,
      files,
      resolveWorkspacePath: (relativePath) => this.resolveWorkspacePath(relativePath),
      confirmDangerousAction: (message) => this.confirmDangerousAction(message),
      onExploration: (entry) => this.recordExploration(entry)
    });
    this.toolManager = new ToolManager({
      executor: (action) => this.actionExecutor.execute(action),
      confirmApproval: (message) => this.confirmDangerousAction(message)
    });
    this.slashHandler = new SlashCommandHandler({
      listWorkspaceFiles: () => this.listWorkspaceFiles(),
      printGitDiff: () => this.printGitDiff(),
      undoLastMutation: () => this.undoLastMutation(),
      promptModelSelection: () => this.promptModelSelection(),
      promptApprovalMode: () => this.promptApprovalMode(),
      createAgentsFile: () => this.createAgentsFile(),
      resetConversation: () => this.resetConversationContext()
    }, SLASH_COMMANDS);
  }

  async runInteractive(): Promise<void> {
    while (true) {
      const instruction = await this.promptForInstruction();
      if (!instruction) {
        continue;
      }

      if (instruction === '/exit' || instruction === '/quit') {
        console.log(chalk.gray('Ending Autohand session.'));
        return;
      }

      await this.runInstruction(instruction);
      console.log();
    }
  }

  private async promptForInstruction(): Promise<string | null> {
    this.workspaceFiles = await this.collectWorkspaceFiles();
    const statusLine = this.formatStatusLine();
    const input = await readInstruction(this.workspaceFiles, SLASH_COMMANDS, statusLine);
    if (input === null) {
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
    const current = this.runtime.options.model ?? this.runtime.config.openrouter.model;
    const answer = await enquirer.prompt<{ model: string }>([
      {
        type: 'input',
        name: 'model',
        message: 'Enter the OpenRouter model ID to use',
        initial: current
      }
    ]);

    if (answer.model && answer.model !== current) {
      this.runtime.options.model = answer.model;
      this.runtime.config.openrouter.model = answer.model;
      this.llm.setDefaultModel(answer.model);
      await saveConfig(this.runtime.config);
      this.contextWindow = getContextWindow(answer.model);
      this.contextPercentLeft = 100;
      this.emitStatus();
      console.log(chalk.green(`Using model ${answer.model} (persisted to config).`));
    } else {
      console.log(chalk.gray('Model unchanged.'));
    }
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

  private async runReactLoop(abortController: AbortController): Promise<void> {
    const maxIterations = 8;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      this.runtime.spinner?.start('Awaiting assistant response...');
      const completion = await this.llm.complete({
        messages: this.conversation.history(),
        temperature: this.runtime.options.temperature ?? 0.2,
        model: this.runtime.options.model,
        signal: abortController.signal
      });

      const payload = this.parseAssistantReactPayload(completion.content);
      this.conversation.addMessage({ role: 'assistant', content: completion.content });
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
            this.updateContextUsage(this.conversation.history());
            const icon = result.success ? chalk.green('✔') : chalk.red('✖');
            console.log(`\n${icon} ${chalk.bold(result.tool)}`);
            if (content) {
              console.log(chalk.gray(content));
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
    const tools = [
      'read_file',
      'write_file',
      'append_file',
      'apply_patch',
      'search',
      'create_directory',
      'delete_path',
      'rename_path',
      'copy_path',
      'replace_in_file',
      'run_command',
      'add_dependency',
      'remove_dependency',
      'format_file',
      'search_with_context',
      'list_tree',
      'file_stats',
      'checksum',
      'git_diff',
      'git_checkout',
      'git_status',
      'git_list_untracked',
      'git_diff_range',
      'git_apply_patch',
      'git_worktree_list',
      'git_worktree_add',
      'git_worktree_remove',
      'custom_command'
    ].join(', ');

    return [
      'You are Autohand, a CLI-first coding assistant that must follow the ReAct (Reason + Act) pattern.',
      'Phases: think about the request, decide whether to call tools, execute them, interpret the results, and only then respond.',
      `Available tools: ${tools}. Use them exactly by name with structured args.`,
      'Always reply with JSON: {"thought":"string","toolCalls":[{"tool":"tool_name","args":{...}}],"finalResponse":"string"}.',
      'If no tools are required, set toolCalls to an empty array and provide the finalResponse.',
      'When tools are needed, omit finalResponse until tool outputs (role=tool) arrive, then continue reasoning.',
      'Respect workspace safety; destructive operations require explicit approval and should be clearly justified in your thought.',
      'Never include markdown fences around the JSON and never hallucinate tools that do not exist.'
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
    return {
      model: this.runtime.options.model ?? this.runtime.config.openrouter.model,
      workspace: this.runtime.workspaceRoot,
      contextPercent: this.contextPercentLeft
    };
  }
}
