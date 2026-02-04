/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { showModal, showInput, type ModalOption } from '../ui/ink/components/Modal.js';
import { diffLines } from 'diff';
import { highlightLine, detectLanguage } from '../ui/syntaxHighlight.js';
import { getTheme, isThemeInitialized, hexToRgb } from '../ui/theme/index.js';
import { addDependency, removeDependency } from '../actions/dependencies.js';
import { runCommand } from '../actions/command.js';
import { listDirectoryTree, fileStats as getFileStats, checksumFile } from '../actions/metadata.js';
import {
  diffFile,
  checkoutFile,
  gitStatus,
  gitListUntracked,
  gitDiffRange,
  applyGitPatch,
  gitListWorktrees,
  gitAddWorktree,
  gitRemoveWorktree,
  // Stash operations
  gitStash,
  gitStashList,
  gitStashPop,
  gitStashApply,
  gitStashDrop,
  // Branch operations
  gitBranch,
  gitSwitch,
  // Cherry-pick operations
  gitCherryPick,
  gitCherryPickAbort,
  gitCherryPickContinue,
  // Rebase operations
  gitRebase,
  gitRebaseAbort,
  gitRebaseContinue,
  gitRebaseSkip,
  // Merge operations
  gitMerge,
  gitMergeAbort,
  // Commit operations
  gitCommit,
  gitAdd,
  gitReset,
  getAutoCommitInfo,
  executeAutoCommit,
  // Log operations
  gitLog,
  // Remote operations
  gitFetch,
  gitPull,
  gitPush
} from '../actions/git.js';
import { WorktreeManager } from '../actions/worktree.js';
import { applyFormatter } from '../actions/formatters.js';
import { loadCustomCommand, saveCustomCommand } from './customCommands.js';
import { webSearch, fetchUrl, getPackageInfo, formatSearchResults, formatPackageInfo } from '../actions/web.js';
import { webRepo, formatRepoInfo, formatRepoDir } from '../actions/webRepo.js';
import { PermissionManager } from '../permissions/PermissionManager.js';
import type { PermissionContext } from '../permissions/types.js';
import type { ProjectManager } from '../session/ProjectManager.js';
import type { AgentAction, AgentRuntime, ExplorationEvent, ToolExecutionContext, ToolOutputChunk } from '../types.js';
import type { FileActionManager } from '../actions/filesystem.js';
import type { ToolDefinition } from './toolManager.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type { MemoryManager } from '../memory/MemoryManager.js';
import { SecurityScanner } from './SecurityScanner.js';
import { execSync } from 'node:child_process';
import { PlanFileStorage } from '../modes/planMode/PlanFileStorage.js';
import type { Plan, PlanStep } from '../modes/planMode/types.js';
import { randomUUID } from 'node:crypto';

/** Response from permission-request hook */
export interface PermissionHookResponse {
  /** Decision from hook */
  decision?: 'allow' | 'deny' | 'ask' | 'block';
  /** Reason for decision */
  reason?: string;
  /** Modified tool input */
  updatedInput?: Record<string, unknown>;
}

export interface ActionExecutorOptions {
  runtime: AgentRuntime;
  files: FileActionManager;
  resolveWorkspacePath: (relativePath: string) => string;
  confirmDangerousAction: (message: string, context?: { tool?: string; path?: string; command?: string }) => Promise<boolean>;
  projectManager?: ProjectManager;
  sessionId?: string;
  onExploration?: (entry: ExplorationEvent) => void;
  toolsRegistry?: ToolsRegistry;
  getRegisteredTools?: () => ToolDefinition[];
  permissionManager?: PermissionManager;
  memoryManager?: MemoryManager;
  onToolOutput?: (chunk: ToolOutputChunk) => void;
  onFileModified?: () => void;
  /** Callback to handle ask_followup_question tool - delegates to agent for TUI coordination */
  onAskFollowup?: (question: string, suggestedAnswers?: string[]) => Promise<string>;
  /** Callback when a plan is created - allows agent to store plan and ask for acceptance */
  onPlanCreated?: (plan: Plan, filePath: string) => Promise<string>;
  /** Callback to check permission hooks before prompting user */
  onPermissionRequest?: (context: {
    tool: string;
    path?: string;
    command?: string;
    args?: Record<string, unknown>;
  }) => Promise<PermissionHookResponse | undefined>;
}

type AgentExecutorDeps = ActionExecutorOptions;

export class ActionExecutor {
  private readonly runtime: AgentExecutorDeps['runtime'];
  private readonly files: AgentExecutorDeps['files'];
  private readonly resolveWorkspacePath: AgentExecutorDeps['resolveWorkspacePath'];
  private readonly confirmDangerousAction: AgentExecutorDeps['confirmDangerousAction'];
  private readonly projectManager?: ProjectManager;
  private readonly sessionId?: string;
  private readonly logExploration?: (entry: ExplorationEvent) => void;
  private readonly toolsRegistry: ToolsRegistry;
  private readonly getRegisteredTools: () => ToolDefinition[];
  private readonly permissionManager: PermissionManager;
  private readonly memoryManager?: MemoryManager;
  private readonly onToolOutput?: (chunk: ToolOutputChunk) => void;
  private readonly onFileModified?: () => void;
  private readonly onAskFollowup?: AgentExecutorDeps['onAskFollowup'];
  private readonly onPlanCreated?: AgentExecutorDeps['onPlanCreated'];
  private readonly onPermissionRequest?: AgentExecutorDeps['onPermissionRequest'];
  private readonly securityScanner: SecurityScanner;
  private readonly searchCache: Map<string, string> = new Map();

  constructor(private readonly deps: AgentExecutorDeps) {
    this.runtime = deps.runtime;
    this.files = deps.files;
    this.resolveWorkspacePath = deps.resolveWorkspacePath;
    this.confirmDangerousAction = deps.confirmDangerousAction;
    this.projectManager = deps.projectManager;
    this.sessionId = deps.sessionId;
    this.logExploration = deps.onExploration;
    this.toolsRegistry = deps.toolsRegistry ?? new ToolsRegistry();
    this.getRegisteredTools = deps.getRegisteredTools ?? (() => []);
    this.permissionManager = deps.permissionManager ?? new PermissionManager(deps.runtime.config.permissions);
    this.memoryManager = deps.memoryManager;
    this.onToolOutput = deps.onToolOutput;
    this.onFileModified = deps.onFileModified;
    this.onAskFollowup = deps.onAskFollowup;
    this.onPlanCreated = deps.onPlanCreated;
    this.onPermissionRequest = deps.onPermissionRequest;
    this.securityScanner = new SecurityScanner();
  }

  /**
   * Check permission hooks before prompting user.
   * Returns true if allowed, false if denied/blocked, undefined if should ask user.
   */
  private async checkPermissionHook(context: {
    tool: string;
    path?: string;
    command?: string;
    args?: Record<string, unknown>;
  }): Promise<{ allowed?: boolean; blocked?: boolean; reason?: string; updatedInput?: Record<string, unknown> }> {
    if (!this.onPermissionRequest) {
      return {}; // No hook handler, defer to normal flow
    }

    const hookResponse = await this.onPermissionRequest(context);
    if (!hookResponse?.decision) {
      return {}; // No decision from hook
    }

    switch (hookResponse.decision) {
      case 'allow':
        return { allowed: true, updatedInput: hookResponse.updatedInput };
      case 'deny':
        return { allowed: false, reason: hookResponse.reason ?? 'Denied by hook' };
      case 'block':
        return { blocked: true, reason: hookResponse.reason ?? 'Blocked by hook' };
      case 'ask':
      default:
        return {}; // Continue with normal prompt flow
    }
  }

  async execute(action: AgentAction, context?: ToolExecutionContext): Promise<string | undefined> {
    if (this.runtime.options.dryRun && action.type !== 'search' && action.type !== 'plan') {
      return 'Dry-run mode: skipped mutation';
    }

    switch (action.type) {
      case 'plan': {
        const notes = action.notes ?? '';
        if (!notes) {
          return 'No plan notes provided';
        }

        const storage = new PlanFileStorage();

        // Clean up plans older than 30 days
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const existingPlanIds = await storage.listPlans();
        let cleanedCount = 0;

        for (const planId of existingPlanIds) {
          const existingPlan = await storage.loadPlan(planId);
          if (existingPlan && (now - existingPlan.createdAt) > THIRTY_DAYS_MS) {
            await storage.deletePlan(planId);
            cleanedCount++;
          }
        }

        if (cleanedCount > 0) {
          console.log(chalk.gray(`\n🧹 Cleaned up ${cleanedCount} plan(s) older than 30 days`));
        }

        // Check for incomplete plans (pending or in_progress steps)
        const refreshedPlanIds = await storage.listPlans();
        const incompletePlans: Array<{ plan: Plan; pendingCount: number; inProgressCount: number }> = [];

        for (const planId of refreshedPlanIds) {
          const existingPlan = await storage.loadPlan(planId);
          if (existingPlan) {
            const pendingCount = existingPlan.steps.filter(s => s.status === 'pending').length;
            const inProgressCount = existingPlan.steps.filter(s => s.status === 'in_progress').length;

            if (pendingCount > 0 || inProgressCount > 0) {
              incompletePlans.push({ plan: existingPlan, pendingCount, inProgressCount });
            }
          }
        }

        // If there are incomplete plans, ask user if they want to resume one
        if (incompletePlans.length > 0 && this.onAskFollowup) {
          console.log(chalk.yellow(`\n📋 Found ${incompletePlans.length} incomplete plan(s):`));

          for (const { plan, pendingCount, inProgressCount } of incompletePlans) {
            const age = Math.floor((now - plan.createdAt) / (1000 * 60 * 60 * 24));
            const ageStr = age === 0 ? 'today' : age === 1 ? '1 day ago' : `${age} days ago`;
            const statusStr = inProgressCount > 0
              ? `${inProgressCount} in progress, ${pendingCount} pending`
              : `${pendingCount} pending`;
            console.log(chalk.gray(`   • ${plan.id} (${ageStr}) - ${plan.steps.length} steps, ${statusStr}`));
          }
          console.log();

          // Build suggested answers
          const suggestedAnswers = [
            'Create new plan',
            ...incompletePlans.slice(0, 3).map(({ plan }) => `Resume: ${plan.id}`)
          ];

          const answer = await this.onAskFollowup(
            'Would you like to resume an incomplete plan or create a new one?',
            suggestedAnswers
          );

          const answerText = answer.replace(/<\/?answer>/g, '').trim();

          // Check if user wants to resume an existing plan
          if (answerText.toLowerCase().includes('resume:') || answerText.toLowerCase().startsWith('resume')) {
            // Extract plan ID from answer
            const resumeMatch = answerText.match(/resume[:\s]+(\S+)/i);
            if (resumeMatch) {
              const planIdToResume = resumeMatch[1];
              const planToResume = incompletePlans.find(p => p.plan.id === planIdToResume);

              if (planToResume) {
                const filePath = `${storage.getPlansDirectory()}/${planToResume.plan.id}.md`;
                console.log(chalk.cyan(`\n📋 Resuming plan: ${planToResume.plan.id}`));
                console.log(chalk.gray(`   File: ${filePath}\n`));

                if (this.onPlanCreated) {
                  return this.onPlanCreated(planToResume.plan, filePath);
                }

                return `Resumed plan ${planToResume.plan.id}\n\nSteps:\n${planToResume.plan.steps.map(s => {
                  const status = s.status === 'completed' ? '✓' : s.status === 'in_progress' ? '>' : '○';
                  return `${status} ${s.number}. ${s.description}`;
                }).join('\n')}`;
              }
            }
          }

          // User chose to create new plan or answer didn't match resume pattern
          console.log(chalk.cyan('\n📋 Creating new plan...'));
        }

        // Parse notes into PlanStep[] - look for numbered lines
        const lines = notes.split('\n');
        const steps: PlanStep[] = [];
        let stepNumber = 0;

        for (const line of lines) {
          const trimmed = line.trim();
          // Match patterns like "1. Do something" or "- Step one" or "* Task"
          const numberedMatch = trimmed.match(/^(\d+)[.)]\s*(.+)$/);
          const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);

          if (numberedMatch) {
            stepNumber = parseInt(numberedMatch[1], 10);
            steps.push({
              number: stepNumber,
              description: numberedMatch[2].trim(),
              status: 'pending'
            });
          } else if (bulletMatch) {
            stepNumber++;
            steps.push({
              number: stepNumber,
              description: bulletMatch[1].trim(),
              status: 'pending'
            });
          }
        }

        // If no steps were parsed, treat the whole text as a single step
        if (steps.length === 0) {
          steps.push({
            number: 1,
            description: notes.substring(0, 200),
            status: 'pending'
          });
        }

        // Create Plan object
        const plan: Plan = {
          id: `plan-${randomUUID().split('-')[0]}`,
          steps,
          rawText: notes,
          createdAt: Date.now()
        };

        // Save plan to file
        const filePath = await storage.savePlan(plan);

        console.log(chalk.cyan(`\n📋 Plan created with ${steps.length} step(s)`));
        console.log(chalk.gray(`   Saved to: ${filePath}\n`));

        // If callback is provided, notify agent for acceptance flow
        if (this.onPlanCreated) {
          return this.onPlanCreated(plan, filePath);
        }

        // Fallback: just return the file path and steps summary
        return `Plan saved to ${filePath}\n\nSteps:\n${steps.map(s => `${s.number}. ${s.description}`).join('\n')}`;
      }
      case 'read_file': {
        if (!action.path) {
          throw new Error('read_file requires a "path" argument.');
        }

        const offset = typeof action.offset === 'number' ? action.offset : 0;
        const limit = typeof action.limit === 'number' ? action.limit : 0;

        const fullContents = await this.files.readFile(action.path);
        this.recordExploration('read', action.path);

        const allLines = fullContents.split('\n');
        const totalLines = allLines.length;
        const fileSize = Buffer.byteLength(fullContents, 'utf8');
        const fileSizeKB = (fileSize / 1024).toFixed(2);

        // Large file thresholds
        const MAX_LINES = 2000;
        const MAX_SIZE_BYTES = 80 * 1024;
        const CHUNK_SIZE = 500; // Lines per chunk for smart reading

        // If offset/limit specified, use chunked reading
        if (offset > 0 || limit > 0) {
          const effectiveLimit = limit > 0 ? limit : CHUNK_SIZE;
          const startLine = Math.min(offset, totalLines);
          const endLine = Math.min(startLine + effectiveLimit, totalLines);
          const chunk = allLines.slice(startLine, endLine).join('\n');

          console.log(chalk.cyan(`\n📄 ${action.path}`));
          console.log(chalk.gray(`   Lines ${startLine + 1}-${endLine} of ${totalLines} (${fileSizeKB} KB total)`));

          if (endLine < totalLines) {
            console.log(chalk.yellow(`   ${totalLines - endLine} more lines remaining`));
          }

          return chunk;
        }

        // Check if file is too large for single read - use smart chunking
        if (totalLines > MAX_LINES || fileSize > MAX_SIZE_BYTES) {
          console.log(chalk.cyan(`\n📄 ${action.path}`));
          console.log(chalk.yellow(`   ⚠ Large file: ${totalLines} lines • ${fileSizeKB} KB`));
          console.log(chalk.gray(`   Smart chunking: outline + first ${CHUNK_SIZE} lines`));

          // Extract file structure/outline
          const outline = this.extractFileOutline(allLines, action.path);

          // Get first chunk of actual content
          const firstChunk = allLines.slice(0, CHUNK_SIZE).join('\n');

          // Build smart response with outline and first chunk
          const response = [
            `=== FILE OUTLINE (${action.path}) ===`,
            `Total: ${totalLines} lines • ${fileSizeKB} KB`,
            '',
            outline,
            '',
            `=== CONTENT (lines 1-${CHUNK_SIZE}) ===`,
            firstChunk,
            '',
            `=== NAVIGATION ===`,
            `Showing lines 1-${CHUNK_SIZE} of ${totalLines}`,
            `To read more sections, use: read_file with offset=<line> limit=${CHUNK_SIZE}`,
            `Example: read_file path="${action.path}" offset=${CHUNK_SIZE} limit=${CHUNK_SIZE}`
          ].join('\n');

          return response;
        }

        console.log(chalk.cyan(`\n📄 ${action.path}`));
        console.log(chalk.gray(`   ${totalLines} lines • ${fileSizeKB} KB`));

        return fullContents;
      }
      case 'write_file': {
        if (!action.path) {
          // Log what we received for debugging
          const receivedKeys = Object.keys(action).filter(k => k !== 'type').join(', ') || 'none';
          throw new Error(`write_file requires a "path" argument. Received arguments: [${receivedKeys}]`);
        }
        const filePath = this.resolveWorkspacePath(action.path);
        const fs = await import('fs-extra');
        const exists = this.files.root && await fs.pathExists(filePath);
        const oldContent = exists ? await this.files.readFile(action.path) : '';
        const newContent = this.pickText(action.contents, action.content) ?? '';

        if (!exists) {
          // NEW FILE CREATION - check permission system
          const permContext: PermissionContext = {
            tool: 'write_file',
            path: action.path
          };

          const decision = this.permissionManager.checkPermission(permContext);

          if (decision.reason === 'blacklisted' || decision.reason === 'mode_restricted') {
            // Explicitly denied
            return `Blocked: Cannot create ${action.path} (${decision.reason})`;
          }

          if (decision.allowed) {
            // Whitelisted or already approved in this session - proceed
            console.log(chalk.cyan(`\n✨ Creating: ${action.path}`));
          } else {
            // Check permission hooks first
            const hookResult = await this.checkPermissionHook({
              tool: 'write_file',
              path: action.path,
              args: { content: newContent }
            });

            if (hookResult.blocked) {
              return `Blocked: ${hookResult.reason}`;
            }

            if (hookResult.allowed !== undefined) {
              // Hook made a decision
              if (hookResult.allowed) {
                console.log(chalk.cyan(`\n✨ Creating: ${action.path}`));
                await this.permissionManager.recordDecision(permContext, true);
              } else {
                await this.permissionManager.recordDecision(permContext, false);
                return `Denied: ${hookResult.reason}`;
              }
            } else {
              // Needs user approval - show preview and ask
              console.log(chalk.cyan(`\n✨ Creating new file: ${action.path}`));
              const preview = newContent.length > 500
                ? newContent.substring(0, 500) + '\n... (truncated)'
                : newContent;
              console.log(chalk.gray(preview));

              const confirmed = await this.confirmDangerousAction(
                `Create new file ${action.path}?`,
                { tool: 'write_file', path: action.path }
              );

              // Record decision and persist to config
              await this.permissionManager.recordDecision(permContext, confirmed);

              if (!confirmed) {
                return `Skipped creating ${action.path}`;
              }
            }
          }
        } else if (oldContent !== newContent) {
          // EXISTING FILE - show diff
          console.log(chalk.cyan(`\n📝 ${action.path}:`));
          this.showDiff(oldContent, newContent, action.path);
        }

        await this.files.writeFile(action.path, newContent);
        this.onFileModified?.();
        return exists ? `Updated ${action.path}` : `Created ${action.path}`;
      }
      case 'append_file': {
        if (!action.path) {
          throw new Error('append_file requires a "path" argument.');
        }
        const addition = this.pickText(action.contents, action.content) ?? '';
        const oldContent = await this.files.readFile(action.path).catch(() => '');
        const newContent = oldContent + addition;

        console.log(chalk.cyan(`\n📝 ${action.path}:`));
        this.showDiff(oldContent, newContent, action.path);

        await this.files.appendFile(action.path, addition);
        this.onFileModified?.();
        return `Appended to ${action.path}`;
      }
      case 'apply_patch': {
        if (!action.path) {
          throw new Error('apply_patch requires a "path" argument.');
        }
        const oldContent = await this.files.readFile(action.path).catch(() => '');
        const patch = this.pickText(action.patch, action.diff);
        if (!patch) {
          throw new Error('apply_patch requires patch or diff content.');
        }

        console.log(chalk.cyan(`\n🔧 ${action.path}:`));
        console.log(chalk.gray('Applying patch...'));

        await this.files.applyPatch(action.path, patch);

        const newContent = await this.files.readFile(action.path);
        this.showDiff(oldContent, newContent, action.path);
        this.onFileModified?.();

        return `Patched ${action.path}`;
      }
      case 'tools_registry': {
        const tools = await this.toolsRegistry.listTools(this.getRegisteredTools());
        return JSON.stringify(tools, null, 2);
      }
      case 'search': {
        const cacheKey = `search:${action.query}:${action.path || ''}`;
        if (this.searchCache.has(cacheKey)) {
          return `[Cached] ${this.searchCache.get(cacheKey)}`;
        }
        const hits = this.files.search(action.query, action.path);
        this.recordExploration('search', action.query);
        const result = hits
          .slice(0, 10)
          .map((hit) => `${hit.file}:${hit.line}: ${hit.text}`)
          .join('\n');
        this.searchCache.set(cacheKey, result);
        return result;
      }
      case 'search_with_context': {
        const cacheKey = `search_ctx:${action.query}:${action.path || ''}:${action.limit || ''}:${action.context || ''}`;
        if (this.searchCache.has(cacheKey)) {
          return `[Cached] ${this.searchCache.get(cacheKey)}`;
        }
        this.recordExploration('search', action.query);
        const result = this.files.searchWithContext(action.query, {
          limit: action.limit,
          context: action.context,
          relativePath: action.path
        });
        this.searchCache.set(cacheKey, result);
        return result;
      }
      case 'semantic_search': {
        const cacheKey = `semantic:${action.query}:${action.path || ''}:${action.limit || ''}:${action.window || ''}`;
        if (this.searchCache.has(cacheKey)) {
          return `[Cached] ${this.searchCache.get(cacheKey)}`;
        }
        const results = this.files.semanticSearch(action.query, {
          limit: action.limit,
          window: action.window,
          relativePath: action.path
        });
        if (!results.length) {
          this.searchCache.set(cacheKey, 'No matches found.');
          return 'No matches found.';
        }
        const result = results
          .map((hit) => `${chalk.cyan(hit.file)}\n${hit.snippet}`)
          .join('\n\n');
        this.searchCache.set(cacheKey, result);
        return result;
      }
      case 'create_directory': {
        await this.files.createDirectory(action.path);
        return `Created directory ${action.path}`;
      }
      case 'delete_path': {
        if (!action.path) {
          throw new Error('delete_path requires a "path" argument.');
        }
        const confirmed = await this.confirmDangerousAction(
          `Delete ${action.path}?`,
          { tool: 'delete_path', path: action.path }
        );
        if (!confirmed) {
          return `Skipped deleting ${action.path}`;
        }
        await this.files.deletePath(action.path);
        return `Deleted ${action.path}`;
      }
      case 'rename_path': {
        if (!action.from || !action.to) {
          throw new Error('rename_path requires "from" and "to" arguments.');
        }
        await this.files.renamePath(action.from, action.to);
        return `Renamed ${action.from} -> ${action.to}`;
      }
      case 'copy_path': {
        if (!action.from || !action.to) {
          throw new Error('copy_path requires "from" and "to" arguments.');
        }
        await this.files.copyPath(action.from, action.to);
        return `Copied ${action.from} -> ${action.to}`;
      }
      case 'search_replace': {
        const content = await this.files.readFile(action.path);
        const result = this.applySearchReplaceBlocks(content, action.blocks);
        if (content !== result) {
          console.log(chalk.cyan(`\n🔄 ${action.path}:`));
          this.showDiff(content, result, action.path);
          await this.files.writeFile(action.path, result);
          this.onFileModified?.();
        }
        return `Updated ${action.path}`;
      }
      case 'format_file': {
        if (!action.path) {
          throw new Error('format_file requires a "path" argument.');
        }
        await this.files.formatFile(action.path, (contents, file) => applyFormatter(action.formatter, contents, file));
        return `Formatted ${action.path} (${action.formatter})`;
      }
      case 'run_command': {
        if (!action.command || typeof action.command !== 'string') {
          return 'Error: run_command requires a "command" argument (string)';
        }

        const shouldStreamOutput = Boolean(
          this.onToolOutput &&
          context?.toolCallId &&
          !action.background &&
          process.env.AUTOHAND_STREAM_TOOL_OUTPUT === '1'
        );
        const emitOutput = (stream: 'stdout' | 'stderr', data: string): void => {
          if (!shouldStreamOutput) {
            return;
          }
          this.onToolOutput?.({
            tool: action.type,
            toolCallId: context?.toolCallId,
            stream,
            data
          });
        };

        const result = await runCommand(
          action.command,
          action.args ?? [],
          this.runtime.workspaceRoot,
          {
            directory: action.directory,
            background: action.background,
            onStdout: (chunk) => emitOutput('stdout', chunk),
            onStderr: (chunk) => emitOutput('stderr', chunk),
          }
        );

        // Build output header with description if provided
        const cmdStr = `${action.command} ${(action.args ?? []).join(' ')}`.trim();
        const header = action.description
          ? `$ ${action.description}\n> ${cmdStr}`
          : `$ ${cmdStr}`;

        // Add directory info if not workspace root
        const dirInfo = action.directory ? `[dir: ${action.directory}]` : '';

        // Build output parts
        const parts = [
          dirInfo ? `${header} ${dirInfo}` : header,
          result.stdout,
          result.stderr,
        ].filter(Boolean);

        // Add background PID info if running in background
        if (result.backgroundPid) {
          parts.push(`[Background PID: ${result.backgroundPid}]`);
        }

        return parts.join('\n');
      }
      case 'add_dependency': {
        await addDependency(this.runtime.workspaceRoot, action.name, action.version, { dev: action.dev });
        return `Added dependency ${action.name}@${action.version}${action.dev ? ' (dev)' : ''}`;
      }
      case 'remove_dependency': {
        await removeDependency(this.runtime.workspaceRoot, action.name, { dev: action.dev });
        return `Removed dependency ${action.name}${action.dev ? ' (dev)' : ''}`;
      }
      case 'list_tree': {
        const treeRoot = this.resolveWorkspacePath(action.path ?? '.');
        const lines = await listDirectoryTree(treeRoot, {
          depth: action.depth,
          workspaceRoot: this.runtime.workspaceRoot
        });
        this.recordExploration('list', action.path ?? '.');
        return lines.join('\n');
      }
      case 'file_stats': {
        if (!action.path) {
          throw new Error('file_stats requires a "path" argument.');
        }
        this.resolveWorkspacePath(action.path);
        const stats = await getFileStats(this.runtime.workspaceRoot, action.path);
        return stats ? JSON.stringify(stats, null, 2) : `No stats for ${action.path}`;
      }
      case 'checksum': {
        if (!action.path) {
          throw new Error('checksum requires a "path" argument.');
        }
        this.resolveWorkspacePath(action.path);
        const sum = await checksumFile(this.runtime.workspaceRoot, action.path, action.algorithm);
        return `${action.algorithm ?? 'sha256'} ${action.path}: ${sum}`;
      }
      case 'git_diff': {
        if (!action.path) {
          throw new Error('git_diff requires a "path" argument.');
        }
        this.resolveWorkspacePath(action.path);
        const rawDiff = diffFile(this.runtime.workspaceRoot, action.path);
        // Return colorized diff for display
        return this.colorizeGitDiff(rawDiff);
      }
      case 'git_checkout': {
        if (!action.path) {
          throw new Error('git_checkout requires a "path" argument.');
        }
        this.resolveWorkspacePath(action.path);
        checkoutFile(this.runtime.workspaceRoot, action.path);
        return `Restored ${action.path} from git.`;
      }
      case 'git_status':
        return gitStatus(this.runtime.workspaceRoot);
      case 'git_list_untracked':
        return gitListUntracked(this.runtime.workspaceRoot) || 'No untracked files.';
      case 'git_diff_range': {
        const rawDiff = gitDiffRange(this.runtime.workspaceRoot, {
          range: action.range,
          staged: action.staged,
          paths: action.paths
        });
        // Return colorized diff for display
        return this.colorizeGitDiff(rawDiff);
      }
      case 'git_apply_patch': {
        const patch = this.pickText(action.patch, action.diff);
        if (!patch) {
          throw new Error('git_apply_patch requires patch or diff content.');
        }
        applyGitPatch(this.runtime.workspaceRoot, patch);
        return 'Applied git patch.';
      }
      case 'git_worktree_list':
        return gitListWorktrees(this.runtime.workspaceRoot);
      case 'git_worktree_add': {
        const worktreePath = this.resolveWorkspacePath(action.path);
        return gitAddWorktree(this.runtime.workspaceRoot, worktreePath, action.ref);
      }
      case 'git_worktree_remove': {
        const worktreePath = this.resolveWorkspacePath(action.path);
        return gitRemoveWorktree(this.runtime.workspaceRoot, worktreePath, action.force);
      }
      // Advanced Worktree Operations
      case 'git_worktree_status_all': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        const statuses = await manager.statusAll();

        if (statuses.length === 0) {
          return 'No worktrees found.';
        }

        const lines: string[] = [chalk.cyan('📊 Worktree Status Summary:'), ''];
        for (const status of statuses) {
          const branchName = status.worktree.branch || '(detached)';
          const cleanIcon = status.isClean ? chalk.green('✓') : chalk.yellow('!');
          const syncInfo = status.gitStatus.ahead > 0 || status.gitStatus.behind > 0
            ? chalk.gray(` [↑${status.gitStatus.ahead} ↓${status.gitStatus.behind}]`)
            : '';

          lines.push(`${cleanIcon} ${chalk.bold(branchName)}${syncInfo}`);
          lines.push(chalk.gray(`   ${status.worktree.path}`));

          if (!status.isClean) {
            const changes: string[] = [];
            if (status.gitStatus.staged > 0) changes.push(`${status.gitStatus.staged} staged`);
            if (status.gitStatus.modified > 0) changes.push(`${status.gitStatus.modified} modified`);
            if (status.gitStatus.untracked > 0) changes.push(`${status.gitStatus.untracked} untracked`);
            if (status.gitStatus.conflicts > 0) changes.push(chalk.red(`${status.gitStatus.conflicts} conflicts`));
            lines.push(chalk.yellow(`   ${changes.join(', ')}`));
          }

          if (status.lastCommit) {
            lines.push(chalk.gray(`   Last commit: ${status.lastCommit.message.substring(0, 50)}`));
          }
          lines.push('');
        }

        return lines.join('\n');
      }
      case 'git_worktree_cleanup': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        const result = await manager.cleanup({
          dryRun: action.dry_run,
          removeMerged: action.remove_merged,
          removeStale: action.remove_stale
        });

        if (action.dry_run) {
          if (result.wouldRemove.length === 0) {
            return 'No worktrees to clean up.';
          }
          return `Would remove ${result.wouldRemove.length} worktree(s):\n${result.wouldRemove.map(p => `  - ${p}`).join('\n')}`;
        }

        if (result.removed.length === 0) {
          return 'No worktrees were cleaned up.';
        }
        return `Cleaned up ${result.removed.length} worktree(s):\n${result.removed.map(p => `  - ${p}`).join('\n')}`;
      }
      case 'git_worktree_run_parallel': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        console.log(chalk.cyan(`\n🔄 Running "${action.command}" across all worktrees...\n`));

        const results = await manager.runParallel(action.command, {
          timeout: action.timeout,
          maxConcurrent: action.max_concurrent
        });

        const lines: string[] = [];
        let successCount = 0;
        let failCount = 0;

        for (const result of results) {
          const branchName = result.branch || '(detached)';
          const statusIcon = result.success ? chalk.green('✓') : chalk.red('✗');
          const duration = `${(result.duration / 1000).toFixed(1)}s`;

          lines.push(`${statusIcon} ${chalk.bold(branchName)} (${duration})`);

          if (result.success) {
            successCount++;
            if (result.output.trim()) {
              lines.push(chalk.gray(result.output.trim().split('\n').map(l => `   ${l}`).join('\n')));
            }
          } else {
            failCount++;
            lines.push(chalk.red(`   Error: ${result.error}`));
          }
          lines.push('');
        }

        lines.unshift(
          chalk.cyan(`📊 Results: ${successCount} succeeded, ${failCount} failed`),
          ''
        );

        return lines.join('\n');
      }
      case 'git_worktree_sync': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        const result = await manager.syncAll({
          strategy: action.strategy,
          mainBranch: action.main_branch,
          dryRun: action.dry_run
        });

        const lines: string[] = [chalk.cyan('🔄 Worktree Sync Results:'), ''];

        if (result.synced.length > 0) {
          lines.push(chalk.green(`Synced (${result.synced.length}):`));
          for (const path of result.synced) {
            lines.push(`  ✓ ${path}`);
          }
          lines.push('');
        }

        if (result.skipped.length > 0) {
          lines.push(chalk.yellow(`Skipped (${result.skipped.length}):`));
          for (const info of result.skipped) {
            lines.push(`  ⊘ ${info}`);
          }
          lines.push('');
        }

        if (result.failed.length > 0) {
          lines.push(chalk.red(`Failed (${result.failed.length}):`));
          for (const info of result.failed) {
            lines.push(`  ✗ ${info}`);
          }
        }

        return lines.join('\n');
      }
      case 'git_worktree_create_for_pr': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        const result = await manager.createForPR(action.pr_number, action.remote);
        return `Created worktree for PR #${action.pr_number}:\n  Path: ${result.path}\n  Branch: ${result.branch}`;
      }
      case 'git_worktree_create_from_template': {
        const manager = new WorktreeManager(this.runtime.workspaceRoot);
        const templates = manager.getTemplates();
        const template = templates.find(t => t.name === action.template);

        if (!template) {
          const available = templates.map(t => t.name).join(', ');
          throw new Error(`Unknown template "${action.template}". Available: ${available}`);
        }

        console.log(chalk.cyan(`\n📁 Creating worktree from template "${action.template}"...`));
        console.log(chalk.gray(`   Template: ${template.description}`));

        const result = await manager.create({
          branch: action.branch,
          newBranch: true,
          baseBranch: action.base_branch,
          template: action.template,
          runSetup: action.run_setup
        });

        return `Created worktree from template "${action.template}":\n  Path: ${result.path}\n  Branch: ${result.branch}`;
      }
      // Git Stash Operations
      case 'git_stash':
        return gitStash(this.runtime.workspaceRoot, {
          message: action.message,
          includeUntracked: action.include_untracked,
          keepIndex: action.keep_index
        });
      case 'git_stash_list':
        return gitStashList(this.runtime.workspaceRoot);
      case 'git_stash_pop':
        return gitStashPop(this.runtime.workspaceRoot, action.stash_ref);
      case 'git_stash_apply':
        return gitStashApply(this.runtime.workspaceRoot, action.stash_ref);
      case 'git_stash_drop':
        return gitStashDrop(this.runtime.workspaceRoot, action.stash_ref);
      // Git Branch Operations
      case 'git_branch':
        return gitBranch(this.runtime.workspaceRoot, action.branch_name, {
          delete: action.delete,
          force: action.force
        });
      case 'git_switch':
        return gitSwitch(this.runtime.workspaceRoot, action.branch_name, {
          create: action.create
        });
      // Git Cherry-pick Operations
      case 'git_cherry_pick':
        return gitCherryPick(this.runtime.workspaceRoot, action.commits, {
          noCommit: action.no_commit,
          mainline: action.mainline
        });
      case 'git_cherry_pick_abort':
        return gitCherryPickAbort(this.runtime.workspaceRoot);
      case 'git_cherry_pick_continue':
        return gitCherryPickContinue(this.runtime.workspaceRoot);
      // Git Rebase Operations
      case 'git_rebase':
        return gitRebase(this.runtime.workspaceRoot, action.upstream, {
          onto: action.onto,
          autosquash: action.autosquash
        });
      case 'git_rebase_abort':
        return gitRebaseAbort(this.runtime.workspaceRoot);
      case 'git_rebase_continue':
        return gitRebaseContinue(this.runtime.workspaceRoot);
      case 'git_rebase_skip':
        return gitRebaseSkip(this.runtime.workspaceRoot);
      // Git Merge Operations
      case 'git_merge':
        return gitMerge(this.runtime.workspaceRoot, action.branch, {
          noCommit: action.no_commit,
          noFastForward: action.no_ff,
          squash: action.squash,
          message: action.message
        });
      case 'git_merge_abort':
        return gitMergeAbort(this.runtime.workspaceRoot);
      // Git Commit Operations
      case 'git_commit': {
        // Security scan before commit
        const scanResult = await this.scanBeforeCommit();
        if (scanResult) {
          return scanResult; // Return error message if blocked
        }
        return gitCommit(this.runtime.workspaceRoot, {
          message: action.message,
          amend: action.amend,
          allowEmpty: action.allow_empty
        });
      }
      case 'git_add':
        return gitAdd(this.runtime.workspaceRoot, action.paths);
      case 'git_reset':
        return gitReset(this.runtime.workspaceRoot, action.mode, action.ref);
      case 'auto_commit': {
        // Security scan before commit
        const autoCommitScanResult = await this.scanBeforeCommit();
        if (autoCommitScanResult) {
          return autoCommitScanResult; // Return error message if blocked
        }

        // Get commit info and auto-generate message
        const info = getAutoCommitInfo(this.runtime.workspaceRoot);

        if (!info.canCommit) {
          console.log(chalk.yellow(`\n⚠ ${info.error}`));
          return info.error || 'Cannot commit';
        }

        // Use provided message or auto-generated one
        let commitMessage = action.message || info.suggestedMessage;

        // Show changes summary
        console.log(chalk.cyan('\n📝 Changes to commit:'));
        info.filesChanged.slice(0, 10).forEach(file => {
          console.log(chalk.gray(`   ${file}`));
        });
        if (info.filesChanged.length > 10) {
          console.log(chalk.gray(`   ... and ${info.filesChanged.length - 10} more files`));
        }
        console.log();
        console.log(chalk.cyan('Suggested commit message:'));
        console.log(chalk.white(`   ${commitMessage}`));
        console.log();

        // Ask for confirmation with y/n/e
        const options: ModalOption[] = [
          { label: 'Yes - commit with this message', value: 'y' },
          { label: 'Edit - modify the message', value: 'e' },
          { label: 'No - cancel commit', value: 'n' }
        ];

        const modalResult = await showModal({
          title: 'Commit with this message?',
          options
        });

        if (!modalResult || modalResult.value === 'n') {
          console.log(chalk.yellow('Commit cancelled.'));
          return 'Commit cancelled by user';
        }

        if (modalResult.value === 'e') {
          const editedMessage = await showInput({
            title: 'Enter commit message:',
            defaultValue: commitMessage
          });

          if (editedMessage) {
            commitMessage = editedMessage;
          }
        }

        // Execute the commit
        const result = executeAutoCommit(this.runtime.workspaceRoot, commitMessage, action.stage_all !== false);

        if (result.success) {
          console.log(chalk.green(`\n✓ ${result.message}`));
          return result.message;
        } else {
          console.log(chalk.red(`\n✗ ${result.message}`));
          return result.message;
        }
      }
      // Git Log Operations
      case 'git_log':
        return gitLog(this.runtime.workspaceRoot, {
          maxCount: action.max_count,
          oneline: action.oneline,
          graph: action.graph,
          all: action.all
        });
      // Git Remote Operations
      case 'git_fetch':
        return gitFetch(this.runtime.workspaceRoot, action.remote, action.branch);
      case 'git_pull':
        return gitPull(this.runtime.workspaceRoot, action.remote, action.branch);
      case 'git_push':
        return gitPush(this.runtime.workspaceRoot, action.remote, action.branch, {
          force: action.force,
          setUpstream: action.set_upstream
        });
      case 'custom_command':
        return this.executeCustomCommand(action);
      case 'multi_file_edit': {
        const oldContent = await this.files.readFile(action.file_path);
        let newContent = oldContent;

        console.log(chalk.cyan(`\n✏️  ${action.file_path}:`));
        console.log(chalk.gray(`Applying ${action.edits.length} edit(s)...`));

        for (let i = 0; i < action.edits.length; i++) {
          const edit = action.edits[i];
          if (edit.replace_all) {
            const count = (newContent.match(new RegExp(this.escapeRegex(edit.old_string), 'g')) || []).length;
            if (count === 0) {
              console.log(chalk.yellow(`  ⚠ Edit ${i + 1}: No occurrences found to replace`));
              console.log(chalk.gray(`    Looking for: "${edit.old_string.substring(0, 60)}${edit.old_string.length > 60 ? '...' : ''}"`));
              const similar = this.findSimilarText(newContent, edit.old_string);
              if (similar) {
                console.log(chalk.gray(`    Similar text found: "${similar.substring(0, 60)}${similar.length > 60 ? '...' : ''}"`));
              }
              continue; // Skip this edit but continue with others
            }
            newContent = newContent.replaceAll(edit.old_string, edit.new_string);
            console.log(chalk.green(`  ✓ Edit ${i + 1}: Replaced ${count} occurrence(s)`));
          } else {
            // Try exact match first
            let firstIndex = newContent.indexOf(edit.old_string);

            // If not found, try normalizing unicode characters
            if (firstIndex === -1) {
              const normalizedOld = this.normalizeText(edit.old_string);
              const normalizedContent = this.normalizeText(newContent);
              const normalizedIndex = normalizedContent.indexOf(normalizedOld);

              if (normalizedIndex !== -1) {
                // Find the actual position by counting characters
                console.log(chalk.yellow(`  ⚠ Edit ${i + 1}: Found match with normalized text (unicode chars differ)`));
                // Extract the actual text from the original content
                const actualOldString = this.extractMatchingText(newContent, normalizedContent, normalizedOld, normalizedIndex);
                if (actualOldString) {
                  firstIndex = newContent.indexOf(actualOldString);
                  if (firstIndex !== -1) {
                    newContent = newContent.substring(0, firstIndex) + edit.new_string + newContent.substring(firstIndex + actualOldString.length);
                    console.log(chalk.green(`  ✓ Edit ${i + 1}: Applied with normalized match`));
                    continue;
                  }
                }
              }
            }

            if (firstIndex === -1) {
              console.log(chalk.red(`  ✗ Edit ${i + 1}: Could not find text to replace`));
              console.log(chalk.gray(`    Looking for (${edit.old_string.length} chars):`));
              console.log(chalk.gray(`    "${edit.old_string.substring(0, 80)}${edit.old_string.length > 80 ? '...' : ''}"`));

              // Try to find similar text
              const similar = this.findSimilarText(newContent, edit.old_string);
              if (similar) {
                console.log(chalk.yellow(`    Did you mean:`));
                console.log(chalk.yellow(`    "${similar.substring(0, 80)}${similar.length > 80 ? '...' : ''}"`));
              }

              // Show hex codes for debugging tricky characters
              if (edit.old_string.length < 100) {
                const nonAscii = edit.old_string.match(/[^\x20-\x7E\n\r\t]/g);
                if (nonAscii && nonAscii.length > 0) {
                  console.log(chalk.gray(`    Non-ASCII chars: ${nonAscii.map(c => `'${c}' (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}`));
                }
              }

              throw new Error(`Could not find text to replace in edit ${i + 1}. See details above.`);
            }
            newContent = newContent.substring(0, firstIndex) + edit.new_string + newContent.substring(firstIndex + edit.old_string.length);
            console.log(chalk.green(`  ✓ Edit ${i + 1}: Applied successfully`));
          }
        }

        if (oldContent !== newContent) {
          this.showDiff(oldContent, newContent, action.file_path);
          await this.files.writeFile(action.file_path, newContent);
          this.onFileModified?.();
        }

        return `Applied ${action.edits.length} edit(s) to ${action.file_path}`;
      }
      case 'todo_write': {
        const todoPath = '.autohand/agent/todos.json';

        // Validate tasks is an array
        if (!Array.isArray(action.tasks)) {
          console.log(chalk.yellow('⚠️ todo_write received invalid tasks (not an array), skipping'));
          return 'todo_write skipped: tasks must be an array';
        }

        // Filter out null/undefined tasks and validate required fields
        const validTasks = action.tasks.filter((task: any) => {
          if (!task) return false; // Skip null/undefined
          const hasId = !!task.id;
          const hasContent = !!(task.content || task.title);
          return hasId && hasContent; // Require both id and content/title
        });

        // Normalize tasks: LLM sends {content, status, activeForm} but we store {id, title, status, activeForm}
        // Preserve any extra properties the task might have
        const normalizedTasks = validTasks.map((task: any) => {
          // Support both formats: {content, status, activeForm} and {id, title, status}
          const content = task.content || task.title || '';
          const title = content;

          return {
            ...task, // Preserve extra properties like priority, tags, etc.
            id: task.id,
            title,
            content, // Keep original content field
            status: task.status || 'pending',
            activeForm: task.activeForm || title,
            description: task.description
          };
        });

        // For todo_write, the LLM sends the COMPLETE updated list, not incremental updates
        // So we replace the entire todo list instead of merging
        const allTodos = normalizedTasks;

        // Write back
        await this.files.writeFile(todoPath, JSON.stringify(allTodos, null, 2));

        // Display summary with progress bar
        console.log(chalk.cyan('\n📋 Task Progress:'));

        const total = allTodos.length;
        const completed = allTodos.filter((t: any) => t.status === 'completed').length;
        const inProgress = allTodos.filter((t: any) => t.status === 'in_progress');
        const pending = allTodos.filter((t: any) => t.status === 'pending').length;

        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const barWidth = 20;
        const filled = Math.round((barWidth * percent) / 100);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

        console.log(`  ${chalk.green(bar)} ${percent}%`);
        console.log(chalk.gray(`  ${completed} done · ${inProgress.length} in progress · ${pending} pending`));

        if (inProgress.length > 0) {
          console.log(chalk.yellow('\n  🔄 Active Tasks:'));
          for (const task of inProgress) {
            console.log(`    • ${(task as any).title || (task as any).content}`);
          }
        }
        console.log();

        return `Updated task list: ${percent}% complete (${completed}/${total})`;
      }
      case 'save_memory': {
        if (!this.memoryManager) {
          return 'Memory manager not available';
        }
        const level = action.level ?? 'user';
        await this.memoryManager.store(action.fact, level);
        console.log(chalk.green(`\n💾 Memory saved (${level} level): "${action.fact.slice(0, 60)}${action.fact.length > 60 ? '...' : ''}"`));
        return `Saved to ${level} memory: ${action.fact}`;
      }
      case 'recall_memory': {
        if (!this.memoryManager) {
          return 'Memory manager not available';
        }
        const memories = await this.memoryManager.recall(action.query, action.level);
        if (memories.length === 0) {
          return action.query
            ? `No memories found matching "${action.query}"`
            : 'No memories stored yet';
        }
        const formatted = memories.map(m => `- [${m.level}] ${m.content}`).join('\n');
        console.log(chalk.cyan(`\n🧠 Recalled ${memories.length} memor${memories.length === 1 ? 'y' : 'ies'}:`));
        console.log(chalk.gray(formatted));
        return formatted;
      }
      case 'create_meta_tool': {
        // Validate required fields
        if (!action.name || !action.description || !action.handler) {
          throw new Error('create_meta_tool requires name, description, and handler');
        }

        // Check for conflicts with built-in tools
        const builtInNames = this.getRegisteredTools().map(t => t.name);
        if (builtInNames.includes(action.name as typeof builtInNames[number])) {
          throw new Error(`Cannot create meta-tool "${action.name}": conflicts with built-in tool`);
        }

        // Validate handler (comprehensive security check)
        const dangerousPatterns: Array<{ pattern: RegExp; description: string }> = [
          // Destructive file operations
          { pattern: /rm\s+(-[rf]+\s+)*\/(?!\w)/i, description: 'rm with root path' },
          { pattern: /rm\s+.*--no-preserve-root/i, description: 'rm --no-preserve-root' },
          { pattern: /dd\s+.*(?:of|if)=\/dev\/[sh]d/i, description: 'dd to disk device' },
          { pattern: /mkfs\./i, description: 'filesystem format' },
          { pattern: /wipefs/i, description: 'disk wipe' },

          // Privilege escalation
          { pattern: /\bsudo\s/i, description: 'sudo command' },
          { pattern: /\bsu\s+-?\s*\w/i, description: 'su command' },
          { pattern: /chmod\s+[0-7]*7[0-7]*/i, description: 'world-writable chmod' },
          { pattern: /chown\s+root/i, description: 'chown to root' },

          // Remote code execution
          { pattern: /curl\s+.*\|\s*(ba)?sh/i, description: 'curl | bash' },
          { pattern: /wget\s+.*\|\s*(ba)?sh/i, description: 'wget | sh' },
          { pattern: /\beval\s+[`$]/i, description: 'eval with expansion' },

          // Fork bomb and resource exhaustion
          { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, description: 'fork bomb' },
          { pattern: /while\s+true.*do.*done/i, description: 'infinite loop' },

          // Reverse shell indicators
          { pattern: /nc\s+.*-e\s*\/bin/i, description: 'netcat reverse shell' },
          { pattern: /ncat\s+.*-e\s*\/bin/i, description: 'ncat reverse shell' },
          { pattern: /bash\s+-i\s+>&?\s*\/dev\/tcp/i, description: 'bash reverse shell' },

          // Dangerous network operations
          { pattern: /iptables\s+-F/i, description: 'flush firewall rules' },

          // Crypto operations that could lock out user
          { pattern: /gpg\s+.*--encrypt.*-r\s+\S+\s+\//i, description: 'gpg encrypt root' },
        ];

        for (const { pattern, description } of dangerousPatterns) {
          if (pattern.test(action.handler)) {
            throw new Error(`Handler contains dangerous pattern: ${description}`);
          }
        }

        // Save to registry
        await this.toolsRegistry.saveMetaTool({
          name: action.name,
          description: action.description,
          parameters: action.parameters ?? { type: 'object', properties: {} },
          handler: action.handler,
          source: 'agent'
        });

        console.log(chalk.green(`\n🔧 Created meta-tool: ${action.name}`));
        console.log(chalk.gray(`   ${action.description}`));
        console.log(chalk.gray(`   Handler: ${action.handler}`));

        return `Created meta-tool "${action.name}" - available in this and future sessions`;
      }
      // Web Search Operations
      case 'web_search': {
        if (!action.query) {
          throw new Error('web_search requires a "query" argument.');
        }
        console.log(chalk.cyan(`\n🔍 Searching web: "${action.query}"...`));
        const results = await webSearch(action.query, {
          maxResults: action.max_results,
          searchType: action.search_type
        });
        const formatted = formatSearchResults(results);
        console.log(chalk.gray(formatted.split('\n').slice(0, 10).join('\n')));
        if (results.length > 3) {
          console.log(chalk.gray('   ...'));
        }
        return formatted;
      }
      case 'fetch_url': {
        if (!action.url) {
          throw new Error('fetch_url requires a "url" argument.');
        }
        console.log(chalk.cyan(`\n🌐 Fetching: ${action.url}...`));
        const content = await fetchUrl(action.url, {
          maxLength: action.max_length
        });
        // Show preview
        const preview = content.slice(0, 500);
        console.log(chalk.gray(preview + (content.length > 500 ? '\n   ... (truncated)' : '')));
        return content;
      }
      case 'package_info': {
        if (!action.package_name) {
          throw new Error('package_info requires a "package_name" argument.');
        }
        const registryLabel = action.registry ? ` (${action.registry})` : '';
        console.log(chalk.cyan(`\n📦 Getting package info: ${action.package_name}${action.version ? `@${action.version}` : ''}${registryLabel}...`));
        const info = await getPackageInfo(action.package_name, {
          registry: action.registry,
          version: action.version
        });
        const formatted = formatPackageInfo(info);
        console.log(chalk.gray(formatted));
        return formatted;
      }
      case 'web_repo': {
        if (!action.repo) {
          throw new Error('web_repo requires a "repo" argument.');
        }
        if (!action.operation) {
          throw new Error('web_repo requires an "operation" argument (info, list, or fetch).');
        }
        console.log(chalk.cyan(`\n🔗 ${action.operation}: ${action.repo}${action.path ? ` → ${action.path}` : ''}...`));

        const result = await webRepo({
          repo: action.repo,
          operation: action.operation,
          path: action.path,
          branch: action.branch
        });

        let formattedResult: string;
        switch (result.type) {
          case 'info':
            formattedResult = formatRepoInfo(result.data);
            break;
          case 'list':
            formattedResult = formatRepoDir(result.data, result.path);
            break;
          case 'fetch':
            formattedResult = result.data;
            break;
        }

        // Show preview
        const previewResult = formattedResult.slice(0, 500);
        console.log(chalk.gray(previewResult + (formattedResult.length > 500 ? '\n   ... (truncated)' : '')));
        return formattedResult;
      }
      // User interaction
      case 'ask_followup_question': {
        if (!action.question) {
          throw new Error('ask_followup_question requires a "question" parameter.');
        }

        // Delegate to agent via callback for proper TUI coordination
        if (this.onAskFollowup) {
          return this.onAskFollowup(action.question, action.suggested_answers);
        }

        // Fallback to Modal if no callback provided (legacy mode)
        console.log(chalk.cyan('\n❓ ' + action.question + '\n'));

        if (Array.isArray(action.suggested_answers) && action.suggested_answers.length > 0) {
          // Use select prompt with suggested answers
          const options: ModalOption[] = action.suggested_answers.map((answer, i) => ({
            label: `${i + 1}. ${answer}`,
            value: answer
          }));

          // Add "Other" option for custom input
          options.push({
            label: `${options.length + 1}. Other (type your own answer)`,
            value: '__other__'
          });

          const result = await showModal({
            title: 'Select an answer:',
            options
          });

          const selected = result?.value;

          if (!selected) {
            console.log(chalk.yellow('\nAnswer cancelled.\n'));
            return '<answer>No answer provided</answer>';
          }

          if (selected === '__other__') {
            // Fall through to text input for custom answer
            const answer = await showInput({
              title: 'Your answer:'
            });

            if (!answer) {
              console.log(chalk.yellow('\nAnswer cancelled.\n'));
              return '<answer>No answer provided</answer>';
            }

            console.log(chalk.green(`\n✓ Answer: ${answer}\n`));
            return `<answer>${answer}</answer>`;
          }

          console.log(chalk.green(`\n✓ Answer: ${selected}\n`));
          return `<answer>${selected}</answer>`;
        } else {
          // Use text input for free-form answer
          const answer = await showInput({
            title: 'Your answer:'
          });

          const finalAnswer = answer || 'No answer provided';
          console.log(chalk.green(`\n✓ Answer: ${finalAnswer}\n`));
          return `<answer>${finalAnswer}</answer>`;
        }
      }
      default: {
        // Check if this is a dynamic meta-tool
        const actionType = (action as AgentAction).type;
        const metaTool = this.toolsRegistry.getMetaTool(actionType);

        if (metaTool) {
          return this.executeMetaTool(metaTool, action as Record<string, unknown>);
        }

        throw new Error(`Unsupported action type ${actionType}`);
      }
    }
  }

  private pickText(...values: Array<unknown>): string | undefined {
    for (const value of values) {
      if (typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Extract file outline/structure for smart chunking of large files.
   * Identifies imports, classes, functions, and key sections with line numbers.
   */
  private extractFileOutline(lines: string[], filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const outline: string[] = [];

    // Language-specific patterns
    const patterns: { [key: string]: RegExp[] } = {
      ts: [
        /^(import|export)\s+/,
        /^(export\s+)?(async\s+)?function\s+(\w+)/,
        /^(export\s+)?(abstract\s+)?class\s+(\w+)/,
        /^(export\s+)?interface\s+(\w+)/,
        /^(export\s+)?type\s+(\w+)/,
        /^(export\s+)?enum\s+(\w+)/,
        /^(export\s+)?const\s+(\w+)\s*[=:]/,
      ],
      js: [
        /^(import|export)\s+/,
        /^(export\s+)?(async\s+)?function\s+(\w+)/,
        /^(export\s+)?class\s+(\w+)/,
        /^(export\s+)?const\s+(\w+)\s*=/,
        /^module\.exports/,
      ],
      py: [
        /^(from|import)\s+/,
        /^(async\s+)?def\s+(\w+)/,
        /^class\s+(\w+)/,
        /^(\w+)\s*=\s*(lambda|def)/,
      ],
      rs: [
        /^(use|mod)\s+/,
        /^(pub\s+)?(async\s+)?fn\s+(\w+)/,
        /^(pub\s+)?struct\s+(\w+)/,
        /^(pub\s+)?enum\s+(\w+)/,
        /^(pub\s+)?trait\s+(\w+)/,
        /^impl\s+/,
      ],
      go: [
        /^import\s+/,
        /^func\s+(\w+|\(\w+\s+\*?\w+\)\s+\w+)/,
        /^type\s+(\w+)\s+(struct|interface)/,
        /^var\s+(\w+)/,
        /^const\s+/,
      ],
    };

    // Get patterns for file type
    const langPatterns = patterns[ext] || patterns['ts'] || [];
    if (['tsx', 'jsx', 'mts', 'cts'].includes(ext)) {
      langPatterns.push(...(patterns['ts'] || []));
    }

    let importStart = -1;
    let importEnd = -1;

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }

      const lineNum = idx + 1;

      // Track import section
      if (/^(import|from|use|require)\s+/.test(trimmed)) {
        if (importStart === -1) {
          importStart = lineNum;
        }
        importEnd = lineNum;
        return;
      }

      // After imports, check for other patterns
      for (const pattern of langPatterns) {
        if (pattern.test(trimmed) && !/^(import|from|use)\s+/.test(trimmed)) {
          // Extract meaningful identifier
          let identifier = trimmed.slice(0, 60);
          if (identifier.length < trimmed.length) identifier += '...';
          outline.push(`  ${String(lineNum).padStart(4)}: ${identifier}`);
          break;
        }
      }
    });

    // Build final outline
    const result: string[] = [];

    if (importStart !== -1) {
      result.push(`Imports: lines ${importStart}-${importEnd}`);
    }

    if (outline.length > 0) {
      result.push('');
      result.push('Definitions:');
      result.push(...outline.slice(0, 50)); // Limit to 50 items
      if (outline.length > 50) {
        result.push(`  ... and ${outline.length - 50} more`);
      }
    }

    return result.length > 0 ? result.join('\n') : 'No structure detected';
  }

  private recordExploration(kind: ExplorationEvent['kind'], target?: string | null): void {
    if (!target) {
      return;
    }
    this.logExploration?.({ kind, target });
  }

  private async executeCustomCommand(action: Extract<AgentAction, { type: 'custom_command' }>): Promise<string> {
    const existing = await loadCustomCommand(action.name);
    const definition = existing ?? {
      name: action.name,
      command: action.command,
      args: action.args,
      description: action.description,
      dangerous: action.dangerous
    };

    // Validate command is present
    if (!definition.command || typeof definition.command !== 'string') {
      return `Error: custom_command "${action.name}" requires a "command" argument (string)`;
    }

    if (!existing) {
      console.log(chalk.cyan(`Custom command: ${definition.name}`));
      console.log(chalk.gray(definition.description ?? 'No description provided.'));
      console.log(chalk.gray(`Command: ${definition.command} ${(definition.args ?? []).join(' ')}`));
      if (this.isDestructiveCommand(definition.command)) {
        console.log(chalk.red('Warning: command may be destructive.'));
      }
      const answer = await this.confirmDangerousAction(
        'Add and run this custom command?',
        { tool: 'run_command', command: definition.command }
      );
      if (!answer) {
        return 'Custom command rejected by user.';
      }
      await saveCustomCommand(definition);
    }

    const result = await runCommand(definition.command, definition.args ?? [], this.runtime.workspaceRoot);
    return [`$ ${definition.command} ${(definition.args ?? []).join(' ')}`, result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n');
  }

  private isDestructiveCommand(command: string): boolean {
    const lowered = command.toLowerCase();
    return lowered.includes('rm ') || lowered.includes('sudo ') || lowered.includes('dd ');
  }

  /**
   * Shell metacharacters that could enable command injection
   */
  private static readonly SHELL_METACHARACTERS = /[|;&$`><(){}[\]!#*?~'"\\]/;

  /**
   * Safely escape a value for shell interpolation
   * Uses single quotes which prevent all shell expansion except for single quotes themselves
   */
  private shellEscape(value: string): string {
    // Single-quote the value and escape any embedded single quotes
    // 'foo' -> 'foo'
    // foo'bar -> 'foo'"'"'bar'
    return "'" + value.replace(/'/g, "'\"'\"'") + "'";
  }

  /**
   * Execute a dynamic meta-tool by substituting {{param}} placeholders
   */
  private async executeMetaTool(
    metaTool: import('./toolsRegistry.js').MetaToolDefinition,
    args: Record<string, unknown>
  ): Promise<string> {
    // Replace {{param}} placeholders in handler template
    let command = metaTool.handler;

    // Extract all {{param}} placeholders
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = placeholderRegex.exec(metaTool.handler)) !== null) {
      const paramName = match[1];
      const value = args[paramName];

      if (value === undefined || value === null) {
        throw new Error(`Missing required parameter "${paramName}" for meta-tool "${metaTool.name}"`);
      }

      const stringValue = String(value);

      // Security: Check for shell metacharacters and properly escape
      let safeValue: string;
      if (ActionExecutor.SHELL_METACHARACTERS.test(stringValue)) {
        // Use proper shell escaping via single quotes
        safeValue = this.shellEscape(stringValue);
        console.log(chalk.yellow(`   ⚠ Parameter "${paramName}" contains shell metacharacters, escaped for safety`));
      } else {
        // Simple alphanumeric values don't need escaping
        safeValue = stringValue;
      }

      command = command.replace(new RegExp(`\\{\\{${paramName}\\}\\}`, 'g'), safeValue);
    }

    console.log(chalk.cyan(`\n🔧 Running meta-tool: ${metaTool.name}`));
    console.log(chalk.gray(`   $ ${command}`));

    // Execute via shell (meta-tools expect shell syntax for piping, etc.)
    const result = await runCommand(command, [], this.runtime.workspaceRoot, { shell: true });
    return [`$ ${command}`, result.stdout, result.stderr].filter(Boolean).join('\n');
  }

  private applySearchReplaceBlocks(content: string, blocks: string): string {
    let result = content;

    // Try simple format first: SEARCH:...\nREPLACE:...
    // This is what some LLMs produce
    if (blocks.includes('SEARCH:') && blocks.includes('REPLACE:') && !blocks.includes('<<<<<<< SEARCH')) {
      const searchIdx = blocks.indexOf('SEARCH:');
      const replaceIdx = blocks.indexOf('REPLACE:');

      if (searchIdx !== -1 && replaceIdx !== -1 && replaceIdx > searchIdx) {
        const searchText = blocks.slice(searchIdx + 7, replaceIdx).trim();
        const replaceText = blocks.slice(replaceIdx + 8).trim();

        const idx = result.indexOf(searchText);
        if (idx === -1) {
          throw new Error(`SEARCH text not found: "${searchText.slice(0, 50)}..."`);
        }

        result = result.slice(0, idx) + replaceText + result.slice(idx + searchText.length);
        return result;
      }
    }

    // Git-style format: <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
    const MARKERS = { search: '<<<<<<< SEARCH', div: '=======', replace: '>>>>>>> REPLACE' };
    let remaining = blocks;

    while (remaining.includes(MARKERS.search)) {
      const searchStart = remaining.indexOf(MARKERS.search);
      const divPos = remaining.indexOf(MARKERS.div, searchStart);
      const replaceEnd = remaining.indexOf(MARKERS.replace, divPos);

      if (divPos === -1 || replaceEnd === -1) {
        throw new Error('Malformed SEARCH/REPLACE block');
      }

      const searchText = remaining.slice(searchStart + MARKERS.search.length, divPos).replace(/^\n/, '').replace(/\n$/, '');
      const replaceText = remaining.slice(divPos + MARKERS.div.length, replaceEnd).replace(/^\n/, '').replace(/\n$/, '');

      const idx = result.indexOf(searchText);
      if (idx === -1) {
        throw new Error(`SEARCH text not found: "${searchText.slice(0, 50)}..."`);
      }

      result = result.slice(0, idx) + replaceText + result.slice(idx + searchText.length);
      remaining = remaining.slice(replaceEnd + MARKERS.replace.length);
    }

    return result;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Normalize text by converting common unicode variants to ASCII equivalents
   */
  private normalizeText(text: string): string {
    return text
      // Em-dash and en-dash to regular dash
      .replace(/[\u2014\u2013]/g, '-')
      // Smart quotes to regular quotes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      // Ellipsis to three dots
      .replace(/\u2026/g, '...')
      // Non-breaking space to regular space
      .replace(/\u00A0/g, ' ')
      // Zero-width characters
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
  }

  /**
   * Extract the actual text from original content that matches a normalized position
   */
  private extractMatchingText(
    originalContent: string,
    normalizedContent: string,
    normalizedSearch: string,
    normalizedIndex: number
  ): string | null {
    // Map normalized index back to original index
    // This is tricky because normalization can change string lengths
    // We'll use a character-by-character mapping approach

    let origIdx = 0;
    let normIdx = 0;

    // Find the original start index
    while (normIdx < normalizedIndex && origIdx < originalContent.length) {
      const origChar = originalContent[origIdx];
      const normChar = this.normalizeText(origChar);
      origIdx++;
      normIdx += normChar.length;
    }

    const startIdx = origIdx;

    // Find the original end index
    const targetNormEnd = normalizedIndex + normalizedSearch.length;
    while (normIdx < targetNormEnd && origIdx < originalContent.length) {
      const origChar = originalContent[origIdx];
      const normChar = this.normalizeText(origChar);
      origIdx++;
      normIdx += normChar.length;
    }

    return originalContent.substring(startIdx, origIdx);
  }

  /**
   * Find text similar to the search string in the content
   * Uses a simple approach: look for lines that share significant words
   */
  private findSimilarText(content: string, search: string): string | null {
    // Extract significant words from search (3+ chars, not common words)
    const commonWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out']);
    const searchWords = search
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length >= 3 && !commonWords.has(w))
      .slice(0, 5); // Limit to first 5 significant words

    if (searchWords.length === 0) return null;

    const lines = content.split('\n');
    let bestMatch: { line: string; score: number } | null = null;

    for (const line of lines) {
      const lineLower = line.toLowerCase();
      let score = 0;

      for (const word of searchWords) {
        if (lineLower.includes(word)) {
          score++;
        }
      }

      // Also check for partial string match
      const searchStart = search.substring(0, Math.min(20, search.length)).toLowerCase();
      if (lineLower.includes(searchStart)) {
        score += 2;
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { line: line.trim(), score };
      }
    }

    return bestMatch && bestMatch.score >= 2 ? bestMatch.line : null;
  }

  /**
   * Colorize raw git diff output with green for additions and red for removals
   */
  private colorizeGitDiff(diffOutput: string): string {
    const useTheme = isThemeInitialized();
    const theme = useTheme ? getTheme() : null;

    if (!diffOutput || diffOutput === 'No diff') {
      return theme ? theme.fg('muted', 'No changes') : chalk.gray('No changes');
    }

    const termWidth = process.stdout.columns || 100;
    const lines = diffOutput.split('\n');
    const colorizedLines: string[] = [];

    // Stats tracking
    let additions = 0;
    let deletions = 0;

    // Get theme colors if available
    const addedColor = theme?.getColor('diffAdded') || '#4caf50';
    const removedColor = theme?.getColor('diffRemoved') || '#f44336';
    const contextColor = theme?.getColor('diffContext') || '#9e9e9e';
    const accentColor = theme?.getColor('accent') || '#00bcd4';

    // Calculate dim background colors from theme
    const addedRgb = hexToRgb(addedColor);
    const removedRgb = hexToRgb(removedColor);
    const addBgR = addedRgb ? Math.floor(addedRgb.r * 0.15) : 30;
    const addBgG = addedRgb ? Math.floor(addedRgb.g * 0.2) : 50;
    const addBgB = addedRgb ? Math.floor(addedRgb.b * 0.15) : 30;
    const remBgR = removedRgb ? Math.floor(removedRgb.r * 0.25) : 60;
    const remBgG = removedRgb ? Math.floor(removedRgb.g * 0.15) : 30;
    const remBgB = removedRgb ? Math.floor(removedRgb.b * 0.15) : 30;

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        colorizedLines.push(chalk.bold(line));
      } else if (line.startsWith('@@')) {
        colorizedLines.push(chalk.hex(accentColor)(line));
      } else if (line.startsWith('+')) {
        additions++;
        const content = line.slice(1);
        const prefix = chalk.bgHex(addedColor).black(' + ');
        const lineContent = chalk.bgRgb(addBgR, addBgG, addBgB)(` ${content} `.padEnd(Math.max(termWidth - 5, content.length + 2)));
        colorizedLines.push(prefix + lineContent);
      } else if (line.startsWith('-')) {
        deletions++;
        const content = line.slice(1);
        const prefix = chalk.bgHex(removedColor).white(' - ');
        const lineContent = chalk.bgRgb(remBgR, remBgG, remBgB)(` ${content} `.padEnd(Math.max(termWidth - 5, content.length + 2)));
        colorizedLines.push(prefix + lineContent);
      } else if (line.startsWith('diff --git')) {
        colorizedLines.push(chalk.bold.hex(accentColor)(line));
      } else if (line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
        colorizedLines.push(chalk.hex(contextColor)(line));
      } else {
        colorizedLines.push(chalk.hex(contextColor)('   ') + line);
      }
    }

    // Add stats header
    const addText = additions === 1 ? '1 line' : `${additions} lines`;
    const delText = deletions === 1 ? '1 line' : `${deletions} lines`;
    const statsLine = chalk.hex(contextColor)(`  Added ${chalk.hex(addedColor)(addText)}, removed ${chalk.hex(removedColor)(delText)}\n`);

    return statsLine + colorizedLines.join('\n');
  }

  /**
   * Scan staged changes for secrets before commit
   * @returns Error message if blocked, undefined if safe to proceed
   */
  private async scanBeforeCommit(): Promise<string | undefined> {
    try {
      // Get staged diff
      const diff = execSync('git diff --cached', {
        cwd: this.runtime.workspaceRoot,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });

      if (!diff.trim()) {
        return undefined; // No staged changes
      }

      // Scan for secrets
      const result = this.securityScanner.scanDiff(diff);

      // Display results
      console.log(this.securityScanner.formatDisplay(result));

      // Block if high-severity secrets found
      if (this.securityScanner.shouldBlockCommit(result)) {
        return `[BLOCKED] Commit blocked: ${result.blockedCount} high-severity secret(s) detected. Remove secrets before committing.`;
      }

      return undefined; // Safe to proceed
    } catch {
      // If git command fails, proceed without blocking
      console.log(chalk.yellow('\n[WARN] Could not scan for secrets (git diff failed)'));
      return undefined;
    }
  }

  private showDiff(oldContent: string, newContent: string, filePath?: string): void {
    const diff = diffLines(oldContent, newContent);
    const contextLines = 3;

    // Detect language for syntax highlighting
    const lang = filePath ? detectLanguage(filePath) : 'text';
    const shouldHighlight = lang !== 'text';

    // Check if theme is available
    const useTheme = isThemeInitialized();
    const theme = useTheme ? getTheme() : null;

    // Calculate stats
    let additions = 0;
    let deletions = 0;
    for (const part of diff) {
      const lineCount = part.value.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;
      if (part.added) additions += lineCount;
      else if (part.removed) deletions += lineCount;
    }

    const termWidth = process.stdout.columns || 100;

    // Header with stats using theme colors
    const addText = additions === 1 ? '1 line' : `${additions} lines`;
    const delText = deletions === 1 ? '1 line' : `${deletions} lines`;
    if (theme) {
      console.log(theme.fg('muted', `  Added ${theme.fg('diffAdded', addText)}, removed ${theme.fg('diffRemoved', delText)}`));
    } else {
      console.log(chalk.gray(`  Added ${chalk.green(addText)}, removed ${chalk.red(delText)}`));
    }

    interface DiffHunk {
      oldStart: number;
      newStart: number;
      changes: Array<{ line: string; type: 'add' | 'remove' | 'context'; oldNum?: number; newNum?: number }>;
    }

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 1;
    let newLineNum = 1;
    let contextBuffer: Array<{ line: string; oldNum: number; newNum: number }> = [];

    for (const part of diff) {
      const lines = part.value.split('\n').filter((line: string, idx: number, arr: string[]) => {
        return idx < arr.length - 1 || line !== '';
      });

      if (!part.added && !part.removed) {
        if (currentHunk) {
          const trailing = lines.slice(0, contextLines);
          for (const line of trailing) {
            currentHunk.changes.push({ line, type: 'context', oldNum: oldLineNum, newNum: newLineNum });
            oldLineNum++;
            newLineNum++;
          }

          if (lines.length > contextLines * 2) {
            hunks.push(currentHunk);
            currentHunk = null;
            const skipped = lines.length - trailing.length;
            oldLineNum += skipped - contextLines;
            newLineNum += skipped - contextLines;
            contextBuffer = lines.slice(-contextLines).map((line, i) => ({
              line,
              oldNum: oldLineNum + i,
              newNum: newLineNum + i
            }));
            oldLineNum += contextLines;
            newLineNum += contextLines;
          } else {
            for (let i = contextLines; i < lines.length; i++) {
              currentHunk.changes.push({ line: lines[i], type: 'context', oldNum: oldLineNum, newNum: newLineNum });
              oldLineNum++;
              newLineNum++;
            }
          }
        } else {
          contextBuffer = lines.slice(-contextLines).map((line, i) => ({
            line,
            oldNum: oldLineNum + lines.length - contextLines + i,
            newNum: newLineNum + lines.length - contextLines + i
          }));
          oldLineNum += lines.length;
          newLineNum += lines.length;
        }
      } else {
        if (!currentHunk) {
          currentHunk = {
            oldStart: contextBuffer.length > 0 ? contextBuffer[0].oldNum : oldLineNum,
            newStart: contextBuffer.length > 0 ? contextBuffer[0].newNum : newLineNum,
            changes: contextBuffer.map(c => ({ line: c.line, type: 'context' as const, oldNum: c.oldNum, newNum: c.newNum }))
          };
          contextBuffer = [];
        }

        if (part.added) {
          for (const line of lines) {
            currentHunk.changes.push({ line, type: 'add', newNum: newLineNum });
            newLineNum++;
          }
        } else {
          for (const line of lines) {
            currentHunk.changes.push({ line, type: 'remove', oldNum: oldLineNum });
            oldLineNum++;
          }
        }
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    // Render hunks with syntax highlighting and background colors
    for (const hunk of hunks) {
      for (const change of hunk.changes) {
        const lineNum = change.type === 'add' ? change.newNum : change.oldNum;
        const lineNumStr = String(lineNum || 0).padStart(3);

        // Apply syntax highlighting to the line content
        const highlighted = shouldHighlight ? highlightLine(change.line, lang) : change.line;

        if (theme) {
          // Use theme colors
          const addedColor = theme.getColor('diffAdded');
          const removedColor = theme.getColor('diffRemoved');
          const contextColor = theme.getColor('diffContext');

          if (change.type === 'add') {
            // Green prefix + dim green background for content
            const addedRgb = hexToRgb(addedColor);
            const bgR = addedRgb ? Math.floor(addedRgb.r * 0.15) : 30;
            const bgG = addedRgb ? Math.floor(addedRgb.g * 0.2) : 50;
            const bgB = addedRgb ? Math.floor(addedRgb.b * 0.15) : 30;
            const prefix = chalk.bgHex(addedColor).black(` ${lineNumStr} + `);
            const content = chalk.bgRgb(bgR, bgG, bgB)(` ${highlighted} `.padEnd(Math.max(termWidth - 10, change.line.length + 2)));
            console.log(prefix + content);
          } else if (change.type === 'remove') {
            // Red prefix + dim red background for content
            const removedRgb = hexToRgb(removedColor);
            const bgR = removedRgb ? Math.floor(removedRgb.r * 0.25) : 60;
            const bgG = removedRgb ? Math.floor(removedRgb.g * 0.15) : 30;
            const bgB = removedRgb ? Math.floor(removedRgb.b * 0.15) : 30;
            const prefix = chalk.bgHex(removedColor).white(` ${lineNumStr} - `);
            const content = chalk.bgRgb(bgR, bgG, bgB)(` ${highlighted} `.padEnd(Math.max(termWidth - 10, change.line.length + 2)));
            console.log(prefix + content);
          } else {
            // Context lines
            console.log(chalk.hex(contextColor)(` ${lineNumStr}   `) + ` ${highlighted}`);
          }
        } else {
          // Fallback to hardcoded chalk colors
          if (change.type === 'add') {
            const prefix = chalk.bgGreen.black(` ${lineNumStr} + `);
            const content = chalk.bgRgb(30, 50, 30)(` ${highlighted} `.padEnd(Math.max(termWidth - 10, change.line.length + 2)));
            console.log(prefix + content);
          } else if (change.type === 'remove') {
            const prefix = chalk.bgRed.white(` ${lineNumStr} - `);
            const content = chalk.bgRgb(60, 30, 30)(` ${highlighted} `.padEnd(Math.max(termWidth - 10, change.line.length + 2)));
            console.log(prefix + content);
          } else {
            console.log(chalk.gray(` ${lineNumStr}   `) + ` ${highlighted}`);
          }
        }
      }
    }

    console.log();
  }
}
