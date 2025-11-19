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
  gitRemoveWorktree
} from '../actions/git.js';
import { applyFormatter } from '../actions/formatters.js';
import { loadCustomCommand, saveCustomCommand } from './customCommands.js';
import type { ProjectManager } from '../session/ProjectManager.js';
import type { FailureRecord, SuccessRecord } from '../session/types.js';
import type { AgentAction, AgentRuntime, ExplorationEvent } from '../types.js';
import type { FileActionManager } from '../actions/filesystem.js';

export interface ActionExecutorOptions {
  runtime: AgentRuntime;
  files: FileActionManager;
  resolveWorkspacePath: (relativePath: string) => string;
  confirmDangerousAction: (message: string) => Promise<boolean>;
  projectManager?: ProjectManager;
  sessionId?: string;
  onExploration?: (entry: ExplorationEvent) => void;
}

export class ActionExecutor {
  private readonly runtime: AgentExecutorDeps['runtime'];
  private readonly files: AgentExecutorDeps['files'];
  private readonly resolveWorkspacePath: AgentExecutorDeps['resolveWorkspacePath'];
  private readonly confirmDangerousAction: AgentExecutorDeps['confirmDangerousAction'];
  private readonly projectManager?: ProjectManager;
  private readonly sessionId?: string;
  private readonly logExploration?: (entry: ExplorationEvent) => void;

  constructor(private readonly deps: AgentExecutorDeps) {
    this.runtime = deps.runtime;
    this.files = deps.files;
    this.resolveWorkspacePath = deps.resolveWorkspacePath;
    this.confirmDangerousAction = deps.confirmDangerousAction;
    this.projectManager = deps.projectManager;
    this.sessionId = deps.sessionId;
    this.logExploration = deps.onExploration;
  }

  async execute(action: AgentAction): Promise<string | undefined> {
    if (this.runtime.options.dryRun && action.type !== 'search' && action.type !== 'plan') {
      return 'Dry-run mode: skipped mutation';
    }

    switch (action.type) {
      case 'plan':
        return action.notes ?? 'No plan notes provided';
      case 'read_file': {
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
        const filePath = this.resolveWorkspacePath(action.path);
        const exists = await this.files.root && (await import('fs-extra')).pathExists(filePath);
        const oldContent = exists ? await this.files.readFile(action.path) : '';
        const newContent = this.pickText(action.contents, action.content) ?? '';

        if (exists && oldContent !== newContent) {
          console.log(chalk.cyan(`\n📝 ${action.path}:`));
          this.showDiff(oldContent, newContent);
        }

        await this.files.writeFile(action.path, newContent);
        return exists ? `Updated ${action.path}` : `Created ${action.path}`;
      }
      case 'append_file': {
        const addition = this.pickText(action.contents, action.content) ?? '';
        const oldContent = await this.files.readFile(action.path).catch(() => '');
        const newContent = oldContent + addition;

        console.log(chalk.cyan(`\n📝 ${action.path}:`));
        this.showDiff(oldContent, newContent);

        await this.files.appendFile(action.path, addition);
        return `Appended to ${action.path}`;
      }
      case 'apply_patch': {
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
      case 'create_directory': {
        await this.files.createDirectory(action.path);
        return `Created directory ${action.path}`;
      }
      case 'delete_path': {
        const confirmed = await this.confirmDangerousAction(`Delete ${action.path}?`);
        if (!confirmed) {
          return `Skipped deleting ${action.path}`;
        }
        await this.files.deletePath(action.path);
        return `Deleted ${action.path}`;
      }
      case 'rename_path': {
        await this.files.renamePath(action.from, action.to);
        return `Renamed ${action.from} -> ${action.to}`;
      }
      case 'copy_path': {
        await this.files.copyPath(action.from, action.to);
        return `Copied ${action.from} -> ${action.to}`;
      }
      case 'replace_in_file': {
        const oldContent = await this.files.readFile(action.path);
        const newContent = oldContent.replace(action.search as any, action.replace);

        if (oldContent !== newContent) {
          console.log(chalk.cyan(`\n🔄 ${action.path}:`));
          this.showDiff(oldContent, newContent);
        }

        await this.files.replaceInFile(action.path, action.search, action.replace);
        return `Updated ${action.path}`;
      }
      case 'format_file': {
        await this.files.formatFile(action.path, (contents, file) => applyFormatter(action.formatter, contents, file));
        return `Formatted ${action.path} (${action.formatter})`;
      }
      case 'run_command': {
        const result = await runCommand(action.command, action.args ?? [], this.runtime.workspaceRoot);
        return [`$ ${action.command} ${(action.args ?? []).join(' ')}`, result.stdout, result.stderr].filter(Boolean).join('\n');
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
        const lines = await listDirectoryTree(treeRoot, { depth: action.depth });
        this.recordExploration('list', action.path ?? '.');
        return lines.join('\n');
      }
      case 'file_stats': {
        this.resolveWorkspacePath(action.path);
        const stats = await getFileStats(this.runtime.workspaceRoot, action.path);
        return stats ? JSON.stringify(stats, null, 2) : `No stats for ${action.path}`;
      }
      case 'checksum': {
        this.resolveWorkspacePath(action.path);
        const sum = await checksumFile(this.runtime.workspaceRoot, action.path, action.algorithm);
        return `${action.algorithm ?? 'sha256'} ${action.path}: ${sum}`;
      }
      case 'git_diff': {
        this.resolveWorkspacePath(action.path);
        return diffFile(this.runtime.workspaceRoot, action.path);
      }
      case 'git_checkout': {
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

        // Read existing todos or create new
        let existingTodos: typeof action.tasks = [];
        try {
          const content = await this.files.readFile(todoPath);
          existingTodos = JSON.parse(content);
        } catch {
          // File doesn't exist, start fresh
        }

        // Merge with new tasks
        const todoMap = new Map(existingTodos.map(t => [t.id, t]));
        for (const task of action.tasks) {
          todoMap.set(task.id, task);
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
      default:
        throw new Error(`Unsupported action type ${(action as AgentAction).type}`);
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
    let definition = existing ?? {
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

  private showDiff(oldContent: string, newContent: string): void {
    const diff = diffLines(oldContent, newContent);

    let lineNumber = 0;
    for (const part of diff) {
      const lines = part.value.split('\n').filter((line: string, idx: number, arr: string[]) => {
        // Filter out the last empty line if it exists
        return idx < arr.length - 1 || line !== '';
      });

      for (const line of lines) {
        if (part.added) {
          console.log(chalk.green(`+ ${line}`));
        } else if (part.removed) {
          console.log(chalk.red(`- ${line}`));
        } else {
          lineNumber++;
          // Only show a few context lines
          if (lines.length <= 3 || lines.indexOf(line) < 2 || lines.indexOf(line) >= lines.length - 2) {
            console.log(chalk.gray(`  ${line}`));
          } else if (lines.indexOf(line) === 2) {
            console.log(chalk.gray('  ...'));
          }
        }
      }
    }
    console.log(); // Empty line after diff
  }
}

type AgentExecutorDeps = ActionExecutorOptions;
