/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { diffLines } from 'diff';
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
import { PermissionManager } from '../permissions/PermissionManager.js';
import type { PermissionContext } from '../permissions/types.js';
import type { ProjectManager } from '../session/ProjectManager.js';
import type { FailureRecord, SuccessRecord } from '../session/types.js';
import type { AgentAction, AgentRuntime, ExplorationEvent } from '../types.js';
import type { FileActionManager } from '../actions/filesystem.js';
import type { ToolDefinition } from './toolManager.js';
import { ToolsRegistry } from './toolsRegistry.js';
import type { MemoryManager } from '../memory/MemoryManager.js';

export interface ActionExecutorOptions {
  runtime: AgentRuntime;
  files: FileActionManager;
  resolveWorkspacePath: (relativePath: string) => string;
  confirmDangerousAction: (message: string) => Promise<boolean>;
  projectManager?: ProjectManager;
  sessionId?: string;
  onExploration?: (entry: ExplorationEvent) => void;
  toolsRegistry?: ToolsRegistry;
  getRegisteredTools?: () => ToolDefinition[];
  permissionManager?: PermissionManager;
  memoryManager?: MemoryManager;
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
  }

  async execute(action: AgentAction): Promise<string | undefined> {
    if (this.runtime.options.dryRun && action.type !== 'search' && action.type !== 'plan') {
      return 'Dry-run mode: skipped mutation';
    }

    switch (action.type) {
      case 'plan':
        return action.notes ?? 'No plan notes provided';
      case 'read_file': {
        if (!action.path) {
          throw new Error('read_file requires a "path" argument.');
        }
        const contents = await this.files.readFile(action.path);
        this.recordExploration('read', action.path);

        // Get character limit from config (default 300)
        const charLimit = this.runtime.config.ui?.readFileCharLimit ?? 300;

        // Display file info
        const lines = contents.split('\n');
        const fileSize = Buffer.byteLength(contents, 'utf8');
        const fileSizeKB = (fileSize / 1024).toFixed(2);

        console.log(chalk.cyan(`\n📄 ${action.path}`));
        console.log(chalk.gray(`   ${lines.length} lines • ${fileSizeKB} KB`));

        // Truncate if needed
        if (contents.length <= charLimit) {
          return contents;
        }

        console.log(chalk.yellow(`   ⚠️  Showing first ${charLimit} characters`));
        return contents.slice(0, charLimit) + `\n\n... (truncated, ${contents.length} total characters)`;
      }
      case 'write_file': {
        if (!action.path) {
          throw new Error('write_file requires a "path" argument.');
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
            // Needs user approval - show preview and ask
            console.log(chalk.cyan(`\n✨ Creating new file: ${action.path}`));
            const preview = newContent.length > 500
              ? newContent.substring(0, 500) + '\n... (truncated)'
              : newContent;
            console.log(chalk.gray(preview));

            const confirmed = await this.confirmDangerousAction(
              `Create new file ${action.path}?`
            );

            // Record decision for session (remember the pattern, not exact path)
            this.permissionManager.recordDecision(permContext, confirmed);

            if (!confirmed) {
              return `Skipped creating ${action.path}`;
            }
          }
        } else if (oldContent !== newContent) {
          // EXISTING FILE - show diff
          console.log(chalk.cyan(`\n📝 ${action.path}:`));
          this.showDiff(oldContent, newContent);
        }

        await this.files.writeFile(action.path, newContent);
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
        this.showDiff(oldContent, newContent);

        await this.files.appendFile(action.path, addition);
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
        this.showDiff(oldContent, newContent);

        return `Patched ${action.path}`;
      }
      case 'tools_registry': {
        const tools = await this.toolsRegistry.listTools(this.getRegisteredTools());
        return JSON.stringify(tools, null, 2);
      }
      case 'search': {
        const hits = this.files.search(action.query, action.path);
        this.recordExploration('search', action.query);
        return hits
          .slice(0, 10)
          .map((hit) => `${hit.file}:${hit.line}: ${hit.text}`)
          .join('\n');
      }
      case 'search_with_context': {
        this.recordExploration('search', action.query);
        return this.files.searchWithContext(action.query, {
          limit: action.limit,
          context: action.context,
          relativePath: action.path
        });
      }
      case 'semantic_search': {
        const results = this.files.semanticSearch(action.query, {
          limit: action.limit,
          window: action.window,
          relativePath: action.path
        });
        if (!results.length) {
          return 'No matches found.';
        }
        return results
          .map((hit) => `${chalk.cyan(hit.file)}\n${hit.snippet}`)
          .join('\n\n');
      }
      case 'create_directory': {
        await this.files.createDirectory(action.path);
        return `Created directory ${action.path}`;
      }
      case 'delete_path': {
        if (!action.path) {
          throw new Error('delete_path requires a "path" argument.');
        }
        const confirmed = await this.confirmDangerousAction(`Delete ${action.path}?`);
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
          this.showDiff(content, result);
          await this.files.writeFile(action.path, result);
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
        const result = await runCommand(
          action.command,
          action.args ?? [],
          this.runtime.workspaceRoot,
          {
            directory: action.directory,
            background: action.background,
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
        return diffFile(this.runtime.workspaceRoot, action.path);
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
        return gitDiffRange(this.runtime.workspaceRoot, {
          range: action.range,
          staged: action.staged,
          paths: action.paths
        });
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
      case 'git_commit':
        return gitCommit(this.runtime.workspaceRoot, {
          message: action.message,
          amend: action.amend,
          allowEmpty: action.allow_empty
        });
      case 'git_add':
        return gitAdd(this.runtime.workspaceRoot, action.paths);
      case 'git_reset':
        return gitReset(this.runtime.workspaceRoot, action.mode, action.ref);
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

        for (const edit of action.edits) {
          if (edit.replace_all) {
            newContent = newContent.replaceAll(edit.old_string, edit.new_string);
          } else {
            const firstIndex = newContent.indexOf(edit.old_string);
            if (firstIndex === -1) {
              throw new Error(`Could not find text to replace: ${edit.old_string.substring(0, 50)}...`);
            }
            newContent = newContent.substring(0, firstIndex) + edit.new_string + newContent.substring(firstIndex + edit.old_string.length);
          }
        }

        if (oldContent !== newContent) {
          this.showDiff(oldContent, newContent);
          await this.files.writeFile(action.file_path, newContent);
        }

        return `Applied ${action.edits.length} edit(s) to ${action.file_path}`;
      }
      case 'todo_write': {
        const todoPath = '.agent/todos.json';

        // Validate tasks is an array
        if (!Array.isArray(action.tasks)) {
          console.log(chalk.yellow('⚠️ todo_write received invalid tasks (not an array), skipping'));
          return 'todo_write skipped: tasks must be an array';
        }

        // Read existing todos or create new
        let existingTodos: typeof action.tasks = [];
        try {
          const content = await this.files.readFile(todoPath);
          const parsed = JSON.parse(content);
          existingTodos = Array.isArray(parsed) ? parsed : [];
        } catch {
          // File doesn't exist, start fresh
        }

        // Merge with new tasks (validate each task has required fields)
        const todoMap = new Map(existingTodos.map(t => [t.id, t]));
        for (const task of action.tasks) {
          if (task && typeof task === 'object' && task.id && task.title) {
            todoMap.set(task.id, task);
          }
        }
        const allTodos = Array.from(todoMap.values());

        // Write back
        await this.files.writeFile(todoPath, JSON.stringify(allTodos, null, 2));

        // Display summary with progress bar
        console.log(chalk.cyan('\n📋 Task Progress:'));

        const total = allTodos.length;
        const completed = allTodos.filter(t => t.status === 'completed').length;
        const inProgress = allTodos.filter(t => t.status === 'in_progress');
        const pending = allTodos.filter(t => t.status === 'pending').length;

        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const barWidth = 20;
        const filled = Math.round((barWidth * percent) / 100);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

        console.log(`  ${chalk.green(bar)} ${percent}%`);
        console.log(chalk.gray(`  ${completed} done · ${inProgress.length} in progress · ${pending} pending`));

        if (inProgress.length > 0) {
          console.log(chalk.yellow('\n  🔄 Active Tasks:'));
          for (const task of inProgress) {
            console.log(`    • ${task.title}`);
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

        // Validate handler (basic security check)
        const dangerousPatterns = ['rm -rf /', 'dd if=', 'mkfs.', ':(){:|:&};:'];
        for (const pattern of dangerousPatterns) {
          if (action.handler.includes(pattern)) {
            throw new Error(`Handler contains dangerous pattern: ${pattern}`);
          }
        }

        // Save to registry
        const saved = await this.toolsRegistry.saveMetaTool({
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

    if (!existing) {
      console.log(chalk.cyan(`Custom command: ${definition.name}`));
      console.log(chalk.gray(definition.description ?? 'No description provided.'));
      console.log(chalk.gray(`Command: ${definition.command} ${(definition.args ?? []).join(' ')}`));
      if (this.isDestructiveCommand(definition.command)) {
        console.log(chalk.red('Warning: command may be destructive.'));
      }
      const answer = await this.confirmDangerousAction('Add and run this custom command?');
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

      // Escape shell special characters in value for safety
      const escapedValue = String(value).replace(/(["`$\\])/g, '\\$1');
      command = command.replace(new RegExp(`\\{\\{${paramName}\\}\\}`, 'g'), escapedValue);
    }

    console.log(chalk.cyan(`\n🔧 Running meta-tool: ${metaTool.name}`));
    console.log(chalk.gray(`   $ ${command}`));

    // Execute via shell
    const result = await runCommand(command, [], this.runtime.workspaceRoot);
    return [`$ ${command}`, result.stdout, result.stderr].filter(Boolean).join('\n');
  }

  private applySearchReplaceBlocks(content: string, blocks: string): string {
    const MARKERS = { search: '<<<<<<< SEARCH', div: '=======', replace: '>>>>>>> REPLACE' };
    let result = content;
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

  private showDiff(oldContent: string, newContent: string, filePath?: string): void {
    const diff = diffLines(oldContent, newContent);

    // Calculate stats
    let additions = 0;
    let deletions = 0;
    for (const part of diff) {
      const lineCount = part.value.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;
      if (part.added) additions += lineCount;
      else if (part.removed) deletions += lineCount;
    }

    // Terminal width for box drawing
    const termWidth = process.stdout.columns || 80;
    const boxWidth = Math.min(termWidth - 4, 100);

    // Box drawing characters
    const box = {
      topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯',
      horizontal: '─', vertical: '│',
      leftT: '├', rightT: '┤'
    };

    // Header
    const statsText = `+${additions} -${deletions}`;
    const headerPadding = boxWidth - 4 - statsText.length;
    console.log(chalk.cyan(`${box.topLeft}${box.horizontal.repeat(boxWidth)}${box.topRight}`));
    console.log(chalk.cyan(box.vertical) +
      chalk.bold.white(' ') +
      chalk.green(`+${additions}`) + chalk.gray(' / ') + chalk.red(`-${deletions}`) +
      ' '.repeat(Math.max(0, headerPadding - 6)) +
      chalk.cyan(box.vertical));
    console.log(chalk.cyan(`${box.leftT}${box.horizontal.repeat(boxWidth)}${box.rightT}`));

    // Diff content with line numbers
    let oldLineNum = 1;
    let newLineNum = 1;
    let outputLines: string[] = [];

    for (const part of diff) {
      const lines = part.value.split('\n').filter((line: string, idx: number, arr: string[]) => {
        return idx < arr.length - 1 || line !== '';
      });

      for (const line of lines) {
        const truncatedLine = line.length > boxWidth - 12
          ? line.substring(0, boxWidth - 15) + '...'
          : line;

        if (part.added) {
          // Green background for additions
          const lineNumStr = String(newLineNum).padStart(4);
          const content = `${chalk.bgGreen.black(` ${lineNumStr} `)} ${chalk.green('▎')} ${chalk.green(truncatedLine)}`;
          outputLines.push(content);
          newLineNum++;
        } else if (part.removed) {
          // Red background for deletions
          const lineNumStr = String(oldLineNum).padStart(4);
          const content = `${chalk.bgRed.white(` ${lineNumStr} `)} ${chalk.red('▎')} ${chalk.red.strikethrough(truncatedLine)}`;
          outputLines.push(content);
          oldLineNum++;
        } else {
          // Context lines - show limited
          if (lines.length <= 6 || lines.indexOf(line) < 2 || lines.indexOf(line) >= lines.length - 2) {
            const lineNumStr = String(oldLineNum).padStart(4);
            const content = `${chalk.gray(` ${lineNumStr} `)} ${chalk.gray('│')} ${chalk.gray(truncatedLine)}`;
            outputLines.push(content);
          } else if (lines.indexOf(line) === 2) {
            outputLines.push(chalk.gray(`      ┆ ···`));
          }
          oldLineNum++;
          newLineNum++;
        }
      }
    }

    // Print diff lines
    for (const line of outputLines) {
      console.log(chalk.cyan(box.vertical) + ' ' + line);
    }

    // Footer with visual stats bar
    console.log(chalk.cyan(`${box.leftT}${box.horizontal.repeat(boxWidth)}${box.rightT}`));

    // Visual change bar
    const total = additions + deletions;
    const barWidth = Math.min(30, boxWidth - 10);
    if (total > 0) {
      const addBar = Math.round((additions / total) * barWidth);
      const delBar = barWidth - addBar;
      const changeBar = chalk.bgGreen(' '.repeat(addBar)) + chalk.bgRed(' '.repeat(delBar));
      console.log(chalk.cyan(box.vertical) + ' ' + changeBar + chalk.gray(` ${total} changes`) + chalk.cyan(box.vertical.padStart(boxWidth - barWidth - 12)));
    }

    console.log(chalk.cyan(`${box.bottomLeft}${box.horizontal.repeat(boxWidth)}${box.bottomRight}`));
    console.log(); // Empty line after diff
  }
}
