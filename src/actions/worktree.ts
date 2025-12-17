/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Advanced Git Worktree Manager
 * Provides intelligent worktree automation for parallel development workflows
 */
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'fs-extra';
import os from 'node:os';

// ============ Types ============

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface WorktreeStatus {
  worktree: WorktreeInfo;
  gitStatus: {
    staged: number;
    modified: number;
    untracked: number;
    conflicts: number;
    ahead: number;
    behind: number;
  };
  isClean: boolean;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: string;
  } | null;
}

export interface WorktreeTemplate {
  name: string;
  description: string;
  pathPattern: string;
  setupCommands?: string[];
  postCreateHook?: string;
}

export interface CreateWorktreeOptions {
  branch?: string;
  newBranch?: boolean;
  baseBranch?: string;
  detach?: boolean;
  force?: boolean;
  template?: string;
  runSetup?: boolean;
}

export interface ParallelResult {
  worktree: string;
  branch: string | null;
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
}

// ============ Default Templates ============

const DEFAULT_TEMPLATES: WorktreeTemplate[] = [
  {
    name: 'feature',
    description: 'Feature branch worktree',
    pathPattern: '../{repo}-feature-{branch}',
    setupCommands: ['npm install || yarn install || pnpm install || true']
  },
  {
    name: 'hotfix',
    description: 'Hotfix branch from main/master',
    pathPattern: '../{repo}-hotfix-{branch}',
    setupCommands: ['npm install || yarn install || pnpm install || true']
  },
  {
    name: 'release',
    description: 'Release branch worktree',
    pathPattern: '../{repo}-release-{branch}',
    setupCommands: ['npm install || yarn install || pnpm install || true']
  },
  {
    name: 'review',
    description: 'PR review worktree',
    pathPattern: '../{repo}-review-{branch}',
    setupCommands: []
  },
  {
    name: 'experiment',
    description: 'Experimental detached worktree',
    pathPattern: '../{repo}-experiment-{timestamp}',
    setupCommands: []
  }
];

// ============ WorktreeManager Class ============

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly repoName: string;
  private templates: WorktreeTemplate[];

  constructor(cwd: string) {
    this.repoRoot = this.findGitRoot(cwd);
    this.repoName = path.basename(this.repoRoot);
    this.templates = [...DEFAULT_TEMPLATES];
  }

  // ============ Core Operations ============

  /**
   * List all worktrees with detailed information
   */
  list(): WorktreeInfo[] {
    const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || 'Failed to list worktrees');
    }

    return this.parseWorktreeList(result.stdout);
  }

  /**
   * Get comprehensive status of all worktrees
   */
  async statusAll(): Promise<WorktreeStatus[]> {
    const worktrees = this.list();
    const statuses: WorktreeStatus[] = [];

    for (const wt of worktrees) {
      if (wt.bare) continue;

      try {
        const status = await this.getWorktreeStatus(wt);
        statuses.push(status);
      } catch (error) {
        // Worktree might be in a bad state
        statuses.push({
          worktree: wt,
          gitStatus: { staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0 },
          isClean: false,
          lastCommit: null
        });
      }
    }

    return statuses;
  }

  /**
   * Smart worktree creation with templates
   */
  async create(options: CreateWorktreeOptions): Promise<{ path: string; branch: string }> {
    const branch = options.branch || `worktree-${Date.now()}`;
    const template = options.template ? this.getTemplate(options.template) : null;

    // Determine the worktree path
    let worktreePath: string;
    if (template) {
      worktreePath = this.resolvePath(template.pathPattern, branch);
    } else {
      worktreePath = path.join(path.dirname(this.repoRoot), `${this.repoName}-${branch}`);
    }

    // Ensure parent directory exists
    await fs.ensureDir(path.dirname(worktreePath));

    // Build git worktree add command
    const args = ['worktree', 'add'];

    if (options.newBranch) {
      args.push('-b', branch);
      if (options.baseBranch) {
        args.push(worktreePath, options.baseBranch);
      } else {
        args.push(worktreePath);
      }
    } else if (options.detach) {
      args.push('--detach', worktreePath);
      if (options.branch) {
        args.push(options.branch);
      }
    } else {
      args.push(worktreePath);
      if (options.branch) {
        args.push(options.branch);
      }
    }

    if (options.force) {
      args.splice(2, 0, '--force');
    }

    const result = spawnSync('git', args, {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || 'Failed to create worktree');
    }

    // Run setup commands if template specifies them
    if (template?.setupCommands && options.runSetup !== false) {
      for (const cmd of template.setupCommands) {
        await this.runInWorktree(worktreePath, cmd);
      }
    }

    return { path: worktreePath, branch };
  }

  /**
   * Remove a worktree with cleanup
   */
  async remove(worktreePath: string, options: { force?: boolean; deleteBranch?: boolean } = {}): Promise<string> {
    const absolutePath = path.isAbsolute(worktreePath)
      ? worktreePath
      : path.resolve(this.repoRoot, worktreePath);

    // Get branch info before removal
    const worktrees = this.list();
    const wt = worktrees.find(w => w.path === absolutePath);
    const branchToDelete = wt?.branch;

    const args = ['worktree', 'remove'];
    if (options.force) {
      args.push('--force');
    }
    args.push(absolutePath);

    const result = spawnSync('git', args, {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error(result.stderr || 'Failed to remove worktree');
    }

    // Optionally delete the branch
    if (options.deleteBranch && branchToDelete) {
      const deleteResult = spawnSync('git', ['branch', '-d', branchToDelete], {
        cwd: this.repoRoot,
        encoding: 'utf8'
      });

      if (deleteResult.status === 0) {
        return `Removed worktree and deleted branch ${branchToDelete}`;
      }
    }

    return `Removed worktree at ${absolutePath}`;
  }

  // ============ Advanced Operations ============

  /**
   * Find and clean up stale/merged worktrees
   */
  async cleanup(options: {
    dryRun?: boolean;
    removeMerged?: boolean;
    removeStale?: boolean;
  } = {}): Promise<{ removed: string[]; wouldRemove: string[] }> {
    const worktrees = this.list();
    const mainBranch = this.getMainBranch();
    const toRemove: WorktreeInfo[] = [];

    for (const wt of worktrees) {
      if (wt.bare || wt.path === this.repoRoot) continue;

      // Check if prunable (stale)
      if (options.removeStale !== false && wt.prunable) {
        toRemove.push(wt);
        continue;
      }

      // Check if branch is merged into main
      if (options.removeMerged && wt.branch) {
        const isMerged = this.isBranchMerged(wt.branch, mainBranch);
        if (isMerged) {
          toRemove.push(wt);
        }
      }
    }

    if (options.dryRun) {
      return { removed: [], wouldRemove: toRemove.map(w => w.path) };
    }

    const removed: string[] = [];
    for (const wt of toRemove) {
      try {
        await this.remove(wt.path, { force: true, deleteBranch: options.removeMerged });
        removed.push(wt.path);
      } catch {
        // Skip if removal fails
      }
    }

    // Prune worktree metadata
    spawnSync('git', ['worktree', 'prune'], { cwd: this.repoRoot });

    return { removed, wouldRemove: [] };
  }

  /**
   * Run a command in parallel across all worktrees
   */
  async runParallel(
    command: string,
    options: {
      filter?: (wt: WorktreeInfo) => boolean;
      timeout?: number;
      maxConcurrent?: number;
    } = {}
  ): Promise<ParallelResult[]> {
    const worktrees = this.list().filter(wt => !wt.bare);
    const filtered = options.filter ? worktrees.filter(options.filter) : worktrees;
    const maxConcurrent = options.maxConcurrent || os.cpus().length;
    const timeout = options.timeout || 300000; // 5 minutes default

    const results: ParallelResult[] = [];
    const running: Promise<void>[] = [];

    for (const wt of filtered) {
      const task = (async () => {
        const start = Date.now();
        try {
          const output = await this.runInWorktreeWithTimeout(wt.path, command, timeout);
          results.push({
            worktree: wt.path,
            branch: wt.branch,
            success: true,
            output,
            exitCode: 0,
            duration: Date.now() - start
          });
        } catch (error: any) {
          results.push({
            worktree: wt.path,
            branch: wt.branch,
            success: false,
            output: '',
            error: error.message,
            exitCode: error.exitCode || 1,
            duration: Date.now() - start
          });
        }
      })();

      running.push(task);

      // Limit concurrency
      if (running.length >= maxConcurrent) {
        await Promise.race(running);
      }
    }

    await Promise.all(running);
    return results;
  }

  /**
   * Sync changes from main branch to all worktrees
   */
  async syncAll(options: {
    strategy?: 'rebase' | 'merge';
    mainBranch?: string;
    dryRun?: boolean;
  } = {}): Promise<{ synced: string[]; failed: string[]; skipped: string[] }> {
    const mainBranch = options.mainBranch || this.getMainBranch();
    const strategy = options.strategy || 'rebase';
    const worktrees = this.list().filter(wt => !wt.bare && wt.branch && wt.branch !== mainBranch);

    // First, fetch latest
    spawnSync('git', ['fetch', '--all'], { cwd: this.repoRoot });

    const synced: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    for (const wt of worktrees) {
      // Check if worktree is clean
      const status = await this.getWorktreeStatus(wt);
      if (!status.isClean) {
        skipped.push(`${wt.path} (has uncommitted changes)`);
        continue;
      }

      if (options.dryRun) {
        synced.push(wt.path);
        continue;
      }

      try {
        const cmd = strategy === 'rebase'
          ? `git rebase origin/${mainBranch}`
          : `git merge origin/${mainBranch}`;

        await this.runInWorktree(wt.path, cmd);
        synced.push(wt.path);
      } catch (error) {
        // Abort if rebase/merge failed
        try {
          await this.runInWorktree(wt.path, `git ${strategy} --abort`);
        } catch {
          // Ignore abort errors
        }
        failed.push(`${wt.path}: ${(error as Error).message}`);
      }
    }

    return { synced, failed, skipped };
  }

  /**
   * Create a worktree for a PR review
   */
  async createForPR(prNumber: number | string, remote = 'origin'): Promise<{ path: string; branch: string }> {
    const branch = `pr-${prNumber}`;

    // Fetch the PR
    const fetchResult = spawnSync('git', ['fetch', remote, `pull/${prNumber}/head:${branch}`], {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (fetchResult.status !== 0) {
      throw new Error(`Failed to fetch PR #${prNumber}: ${fetchResult.stderr}`);
    }

    return this.create({
      branch,
      template: 'review',
      runSetup: true
    });
  }

  /**
   * Switch to a worktree (opens in current terminal context)
   */
  getWorktreePath(branchOrPath: string): string | null {
    const worktrees = this.list();

    // Check if it's a direct path match
    const byPath = worktrees.find(wt => wt.path === branchOrPath || wt.path.endsWith(branchOrPath));
    if (byPath) return byPath.path;

    // Check if it's a branch name
    const byBranch = worktrees.find(wt => wt.branch === branchOrPath);
    if (byBranch) return byBranch.path;

    return null;
  }

  // ============ Template Management ============

  getTemplates(): WorktreeTemplate[] {
    return [...this.templates];
  }

  getTemplate(name: string): WorktreeTemplate | null {
    return this.templates.find(t => t.name === name) || null;
  }

  addTemplate(template: WorktreeTemplate): void {
    const existing = this.templates.findIndex(t => t.name === template.name);
    if (existing >= 0) {
      this.templates[existing] = template;
    } else {
      this.templates.push(template);
    }
  }

  // ============ Helper Methods ============

  private findGitRoot(cwd: string): string {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8'
    });

    if (result.status !== 0) {
      throw new Error('Not a git repository');
    }

    return result.stdout.trim();
  }

  private parseWorktreeList(output: string): WorktreeInfo[] {
    const worktrees: WorktreeInfo[] = [];
    const entries = output.trim().split('\n\n');

    for (const entry of entries) {
      if (!entry.trim()) continue;

      const lines = entry.split('\n');
      const info: Partial<WorktreeInfo> = {
        bare: false,
        detached: false,
        locked: false,
        prunable: false
      };

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          info.path = line.slice(9);
        } else if (line.startsWith('HEAD ')) {
          info.head = line.slice(5);
        } else if (line.startsWith('branch ')) {
          info.branch = line.slice(7).replace('refs/heads/', '');
        } else if (line === 'bare') {
          info.bare = true;
        } else if (line === 'detached') {
          info.detached = true;
        } else if (line.startsWith('locked')) {
          info.locked = true;
        } else if (line.startsWith('prunable')) {
          info.prunable = true;
        }
      }

      if (info.path && info.head) {
        worktrees.push(info as WorktreeInfo);
      }
    }

    return worktrees;
  }

  private async getWorktreeStatus(wt: WorktreeInfo): Promise<WorktreeStatus> {
    // Get git status
    const statusResult = spawnSync('git', ['status', '--porcelain=v1', '-b'], {
      cwd: wt.path,
      encoding: 'utf8'
    });

    const lines = statusResult.stdout.trim().split('\n');
    const branchLine = lines[0] || '';
    const fileLines = lines.slice(1);

    let ahead = 0;
    let behind = 0;
    const aheadBehindMatch = branchLine.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/);
    if (aheadBehindMatch) {
      ahead = parseInt(aheadBehindMatch[1] || '0', 10);
      behind = parseInt(aheadBehindMatch[2] || aheadBehindMatch[3] || '0', 10);
    }

    let staged = 0, modified = 0, untracked = 0, conflicts = 0;
    for (const line of fileLines) {
      if (!line) continue;
      const x = line[0];
      const y = line[1];

      if (x === 'U' || y === 'U' || (x === 'D' && y === 'D') || (x === 'A' && y === 'A')) {
        conflicts++;
      } else {
        if (x !== ' ' && x !== '?') staged++;
        if (y === 'M' || y === 'D') modified++;
        if (x === '?') untracked++;
      }
    }

    // Get last commit
    const logResult = spawnSync('git', ['log', '-1', '--format=%H|%s|%an|%ai'], {
      cwd: wt.path,
      encoding: 'utf8'
    });

    let lastCommit: WorktreeStatus['lastCommit'] = null;
    if (logResult.status === 0 && logResult.stdout.trim()) {
      const [hash, message, author, date] = logResult.stdout.trim().split('|');
      lastCommit = { hash, message, author, date };
    }

    return {
      worktree: wt,
      gitStatus: { staged, modified, untracked, conflicts, ahead, behind },
      isClean: staged === 0 && modified === 0 && untracked === 0 && conflicts === 0,
      lastCommit
    };
  }

  private getMainBranch(): string {
    // Try to detect the main branch
    const result = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (result.status === 0) {
      return result.stdout.trim().replace('refs/remotes/origin/', '');
    }

    // Fallback: check for main or master
    const branches = spawnSync('git', ['branch', '-l', 'main', 'master'], {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (branches.stdout.includes('main')) return 'main';
    if (branches.stdout.includes('master')) return 'master';
    return 'main';
  }

  private isBranchMerged(branch: string, into: string): boolean {
    const result = spawnSync('git', ['branch', '--merged', into], {
      cwd: this.repoRoot,
      encoding: 'utf8'
    });

    if (result.status !== 0) return false;

    return result.stdout.split('\n').some(line =>
      line.trim() === branch || line.trim() === `* ${branch}`
    );
  }

  private resolvePath(pattern: string, branch: string): string {
    const timestamp = Date.now().toString();
    const sanitizedBranch = branch.replace(/[^a-zA-Z0-9-_]/g, '-');

    return path.resolve(
      this.repoRoot,
      pattern
        .replace('{repo}', this.repoName)
        .replace('{branch}', sanitizedBranch)
        .replace('{timestamp}', timestamp)
    );
  }

  private async runInWorktree(worktreePath: string, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });

      child.on('close', code => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const error = new Error(stderr || `Command failed with code ${code}`);
          (error as any).exitCode = code;
          reject(error);
        }
      });
    });
  }

  private async runInWorktreeWithTimeout(worktreePath: string, command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', ['-c', command], {
        cwd: worktreePath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });

      child.on('close', code => {
        clearTimeout(timer);
        if (killed) return;

        if (code === 0) {
          resolve(stdout);
        } else {
          const error = new Error(stderr || `Command failed with code ${code}`);
          (error as any).exitCode = code;
          reject(error);
        }
      });
    });
  }
}

// ============ Convenience Functions ============

export function createWorktreeManager(cwd: string): WorktreeManager {
  return new WorktreeManager(cwd);
}

export function listWorktreesAdvanced(cwd: string): WorktreeInfo[] {
  return new WorktreeManager(cwd).list();
}

export async function getWorktreeStatusAll(cwd: string): Promise<WorktreeStatus[]> {
  return new WorktreeManager(cwd).statusAll();
}

export async function cleanupWorktrees(cwd: string, options?: Parameters<WorktreeManager['cleanup']>[0]): Promise<ReturnType<WorktreeManager['cleanup']>> {
  return new WorktreeManager(cwd).cleanup(options);
}

export async function runAcrossWorktrees(
  cwd: string,
  command: string,
  options?: Parameters<WorktreeManager['runParallel']>[1]
): Promise<ParallelResult[]> {
  return new WorktreeManager(cwd).runParallel(command, options);
}

export async function syncWorktrees(
  cwd: string,
  options?: Parameters<WorktreeManager['syncAll']>[0]
): Promise<ReturnType<WorktreeManager['syncAll']>> {
  return new WorktreeManager(cwd).syncAll(options);
}
