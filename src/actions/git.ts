/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';

/**
 * Git safety configuration to prevent dangerous operations
 */
export const GIT_SAFETY = {
  /** Branches where force push is blocked */
  PROTECTED_BRANCHES: ['main', 'master', 'develop', 'production', 'staging'],
  /** Maximum commits to push at once (to prevent accidental mass pushes) */
  MAX_COMMITS_PER_PUSH: 50,
};

/**
 * Get the current branch name
 */
function getCurrentBranch(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.stdout?.trim() || '';
}

/**
 * Get count of commits ahead of remote
 */
function getCommitsAhead(cwd: string, remote: string = 'origin', branch?: string): number {
  const currentBranch = branch || getCurrentBranch(cwd);
  if (!currentBranch) return 0;

  const result = spawnSync('git', ['rev-list', '--count', `${remote}/${currentBranch}..HEAD`], {
    cwd,
    encoding: 'utf8'
  });
  return parseInt(result.stdout?.trim() || '0', 10) || 0;
}

export function applyGitPatch(cwd: string, patch: string): string {
  const result = spawnSync('git', ['apply', '-'], {
    cwd,
    input: patch,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git apply failed');
  }
  return result.stdout ?? '';
}

export function diffFile(cwd: string, file: string): string {
  const result = spawnSync('git', ['diff', '--', file], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git diff failed for ${file}`);
  }
  return result.stdout || 'No diff';
}

export function checkoutFile(cwd: string, file: string): void {
  const result = spawnSync('git', ['checkout', '--', file], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git checkout failed for ${file}`);
  }
}

export function gitStatus(cwd: string): string {
  const result = spawnSync('git', ['status', '-sb'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git status failed');
  }
  return result.stdout || 'clean';
}

export function gitListUntracked(cwd: string): string {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git ls-files failed');
  }
  return result.stdout || '';
}

export interface GitDiffRangeOptions {
  range?: string;
  staged?: boolean;
  paths?: string[];
}

export function gitDiffRange(cwd: string, options: GitDiffRangeOptions = {}): string {
  const args = ['diff'];
  if (options.staged) {
    args.push('--staged');
  }
  if (options.range) {
    args.push(options.range);
  }
  if (options.paths?.length) {
    args.push('--', ...options.paths);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git diff failed');
  }
  return result.stdout || 'No diff output.';
}

export function gitListWorktrees(cwd: string): string {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree list failed');
  }
  return result.stdout || 'No worktrees.';
}

export function gitAddWorktree(cwd: string, pathArg: string, ref?: string): string {
  const args = ['worktree', 'add', pathArg];
  if (ref) {
    args.push(ref);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree add failed');
  }
  return result.stdout || `Added worktree at ${pathArg}`;
}

export function gitRemoveWorktree(cwd: string, pathArg: string, force = false): string {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(pathArg);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git worktree remove failed');
  }
  return result.stdout || `Removed worktree ${pathArg}`;
}

// ============ Stash Operations ============

export interface GitStashOptions {
  message?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
}

export function gitStash(cwd: string, options: GitStashOptions = {}): string {
  const args = ['stash', 'push'];
  if (options.includeUntracked) {
    args.push('--include-untracked');
  }
  if (options.keepIndex) {
    args.push('--keep-index');
  }
  if (options.message) {
    args.push('-m', options.message);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git stash failed');
  }
  return result.stdout || result.stderr || 'Stashed changes';
}

export function gitStashList(cwd: string): string {
  const result = spawnSync('git', ['stash', 'list'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git stash list failed');
  }
  return result.stdout || 'No stashes';
}

export function gitStashPop(cwd: string, stashRef?: string): string {
  const args = ['stash', 'pop'];
  if (stashRef) {
    args.push(stashRef);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git stash pop failed');
  }
  return result.stdout || 'Applied and dropped stash';
}

export function gitStashApply(cwd: string, stashRef?: string): string {
  const args = ['stash', 'apply'];
  if (stashRef) {
    args.push(stashRef);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git stash apply failed');
  }
  return result.stdout || 'Applied stash';
}

export function gitStashDrop(cwd: string, stashRef?: string): string {
  const args = ['stash', 'drop'];
  if (stashRef) {
    args.push(stashRef);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git stash drop failed');
  }
  return result.stdout || 'Dropped stash';
}

// ============ Branch Operations ============

export function gitBranch(cwd: string, branchName?: string, options: { delete?: boolean; force?: boolean } = {}): string {
  const args = ['branch'];
  if (options.delete) {
    args.push(options.force ? '-D' : '-d');
  }
  if (branchName) {
    args.push(branchName);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git branch failed');
  }
  return result.stdout || 'Branch operation completed';
}

export function gitSwitch(cwd: string, branchName: string, options: { create?: boolean } = {}): string {
  const args = ['switch'];
  if (options.create) {
    args.push('-c');
  }
  args.push(branchName);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git switch failed');
  }
  return result.stdout || `Switched to ${branchName}`;
}

// ============ Cherry-pick Operations ============

export interface GitCherryPickOptions {
  noCommit?: boolean;
  mainline?: number;
}

export function gitCherryPick(cwd: string, commits: string[], options: GitCherryPickOptions = {}): string {
  const args = ['cherry-pick'];
  if (options.noCommit) {
    args.push('--no-commit');
  }
  if (options.mainline !== undefined) {
    args.push('-m', String(options.mainline));
  }
  args.push(...commits);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git cherry-pick failed');
  }
  return result.stdout || `Cherry-picked ${commits.join(', ')}`;
}

export function gitCherryPickAbort(cwd: string): string {
  const result = spawnSync('git', ['cherry-pick', '--abort'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git cherry-pick --abort failed');
  }
  return 'Cherry-pick aborted';
}

export function gitCherryPickContinue(cwd: string): string {
  const result = spawnSync('git', ['cherry-pick', '--continue'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git cherry-pick --continue failed');
  }
  return 'Cherry-pick continued';
}

// ============ Rebase Operations ============

export interface GitRebaseOptions {
  onto?: string;
  interactive?: boolean;
  autosquash?: boolean;
}

export function gitRebase(cwd: string, upstream: string, options: GitRebaseOptions = {}): string {
  const currentBranch = getCurrentBranch(cwd);

  // SAFETY: Warn when rebasing a protected branch
  if (GIT_SAFETY.PROTECTED_BRANCHES.includes(currentBranch)) {
    throw new Error(
      `Rebasing protected branch "${currentBranch}" is blocked. ` +
      `Protected branches should not be rebased as it rewrites history. ` +
      `Use merge instead, or switch to a feature branch first.`
    );
  }

  const args = ['rebase'];
  if (options.onto) {
    args.push('--onto', options.onto);
  }
  if (options.autosquash) {
    args.push('--autosquash');
  }
  // Note: --interactive is not supported in non-TTY mode
  args.push(upstream);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rebase failed');
  }
  return result.stdout || `Rebased onto ${upstream}`;
}

export function gitRebaseAbort(cwd: string): string {
  const result = spawnSync('git', ['rebase', '--abort'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rebase --abort failed');
  }
  return 'Rebase aborted';
}

export function gitRebaseContinue(cwd: string): string {
  const result = spawnSync('git', ['rebase', '--continue'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rebase --continue failed');
  }
  return 'Rebase continued';
}

export function gitRebaseSkip(cwd: string): string {
  const result = spawnSync('git', ['rebase', '--skip'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git rebase --skip failed');
  }
  return 'Skipped commit and continued rebase';
}

// ============ Merge Operations ============

export interface GitMergeOptions {
  noCommit?: boolean;
  noFastForward?: boolean;
  squash?: boolean;
  message?: string;
}

export function gitMerge(cwd: string, branch: string, options: GitMergeOptions = {}): string {
  // SAFETY: Validate branch exists locally or as a known remote branch
  const localBranches = spawnSync('git', ['branch', '--list'], { cwd, encoding: 'utf8' });
  const remoteBranches = spawnSync('git', ['branch', '-r', '--list'], { cwd, encoding: 'utf8' });
  const allBranches = (localBranches.stdout || '') + (remoteBranches.stdout || '');

  // Check if branch exists (locally or remotely)
  const branchExists = allBranches.split('\n').some(b =>
    b.trim().replace('* ', '') === branch ||
    b.trim() === `origin/${branch}` ||
    b.trim() === branch
  );

  if (!branchExists) {
    throw new Error(
      `Branch "${branch}" not found locally or in remotes. ` +
      `For security, only existing branches can be merged. Run 'git fetch' first if the branch exists remotely.`
    );
  }

  const args = ['merge'];
  if (options.noCommit) {
    args.push('--no-commit');
  }
  if (options.noFastForward) {
    args.push('--no-ff');
  }
  if (options.squash) {
    args.push('--squash');
  }
  if (options.message) {
    args.push('-m', options.message);
  }
  args.push(branch);
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git merge failed');
  }
  return result.stdout || `Merged ${branch}`;
}

export function gitMergeAbort(cwd: string): string {
  const result = spawnSync('git', ['merge', '--abort'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git merge --abort failed');
  }
  return 'Merge aborted';
}

// ============ Commit Operations ============

export interface GitCommitOptions {
  message: string;
  amend?: boolean;
  allowEmpty?: boolean;
}

export function gitCommit(cwd: string, options: GitCommitOptions): string {
  const args = ['commit', '-m', options.message];
  if (options.amend) {
    args.push('--amend');
  }
  if (options.allowEmpty) {
    args.push('--allow-empty');
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git commit failed');
  }
  return result.stdout || 'Committed';
}

export function gitAdd(cwd: string, paths: string[]): string {
  const args = ['add', ...paths];
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git add failed');
  }
  return result.stdout || `Staged ${paths.join(', ')}`;
}

export function gitReset(cwd: string, mode: 'soft' | 'mixed' | 'hard' = 'mixed', ref?: string): string {
  // Safety check: block hard reset on protected branches
  if (mode === 'hard') {
    const currentBranch = getCurrentBranch(cwd);
    if (GIT_SAFETY.PROTECTED_BRANCHES.includes(currentBranch)) {
      throw new Error(
        `Hard reset on protected branch "${currentBranch}" is blocked for safety.\n` +
        `Protected branches: ${GIT_SAFETY.PROTECTED_BRANCHES.join(', ')}\n` +
        `Use soft or mixed reset instead, or switch to a feature branch.`
      );
    }
  }

  const args = ['reset', `--${mode}`];
  if (ref) {
    args.push(ref);
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git reset failed');
  }
  return result.stdout || `Reset ${mode}${ref ? ` to ${ref}` : ''}`;
}

export interface AutoCommitInfo {
  canCommit: boolean;
  error?: string;
  filesChanged: string[];
  suggestedMessage: string;
  diffSummary: string;
}

export interface AutoCommitResult {
  success: boolean;
  message: string;
  filesChanged: number;
  commitHash?: string;
}

/**
 * Check if directory is a git repository
 */
export function isGitRepository(cwd: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Initialize a new git repository
 */
export function gitInit(cwd: string): { success: boolean; message: string } {
  const result = spawnSync('git', ['init'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    return { success: false, message: result.stderr || 'git init failed' };
  }
  return { success: true, message: result.stdout?.trim() || 'Initialized git repository' };
}

/**
 * Get information about pending changes and generate a suggested commit message
 */
export function getAutoCommitInfo(cwd: string): AutoCommitInfo {
  // Check if this is a git repository
  if (!isGitRepository(cwd)) {
    return {
      canCommit: false,
      error: 'Not a git repository',
      filesChanged: [],
      suggestedMessage: '',
      diffSummary: ''
    };
  }

  // Get status to check for changes
  const statusResult = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  if (statusResult.status !== 0) {
    return {
      canCommit: false,
      error: 'Failed to get git status',
      filesChanged: [],
      suggestedMessage: '',
      diffSummary: ''
    };
  }

  const changes = statusResult.stdout?.trim().split('\n').filter(Boolean) || [];
  if (changes.length === 0) {
    return {
      canCommit: false,
      error: 'No changes to commit',
      filesChanged: [],
      suggestedMessage: '',
      diffSummary: ''
    };
  }

  // Parse changes to categorize them
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const renamed: string[] = [];

  for (const change of changes) {
    const status = change.substring(0, 2);
    const file = change.substring(3).trim();

    if (status.includes('A') || status === '??') {
      added.push(file);
    } else if (status.includes('M')) {
      modified.push(file);
    } else if (status.includes('D')) {
      deleted.push(file);
    } else if (status.includes('R')) {
      renamed.push(file);
    }
  }

  // Get diff summary for context
  const diffStatResult = spawnSync('git', ['diff', '--stat', 'HEAD'], { cwd, encoding: 'utf8' });
  const diffSummary = diffStatResult.stdout?.trim() || '';

  // Generate suggested commit message
  const suggestedMessage = generateCommitMessage(added, modified, deleted, renamed);

  return {
    canCommit: true,
    filesChanged: changes.map(c => c.substring(3).trim()),
    suggestedMessage,
    diffSummary
  };
}

/**
 * Generate a commit message based on the changes
 */
function generateCommitMessage(added: string[], modified: string[], deleted: string[], renamed: string[]): string {
  const parts: string[] = [];

  // Determine the primary action
  const totalChanges = added.length + modified.length + deleted.length + renamed.length;

  if (totalChanges === 1) {
    // Single file change - be specific
    if (added.length === 1) {
      return `feat: Add ${added[0]}`;
    } else if (modified.length === 1) {
      return `update: Modify ${modified[0]}`;
    } else if (deleted.length === 1) {
      return `chore: Remove ${deleted[0]}`;
    } else if (renamed.length === 1) {
      return `refactor: Rename ${renamed[0]}`;
    }
  }

  // Multiple changes - summarize
  if (added.length > 0) {
    parts.push(`add ${added.length} file${added.length > 1 ? 's' : ''}`);
  }
  if (modified.length > 0) {
    parts.push(`update ${modified.length} file${modified.length > 1 ? 's' : ''}`);
  }
  if (deleted.length > 0) {
    parts.push(`remove ${deleted.length} file${deleted.length > 1 ? 's' : ''}`);
  }
  if (renamed.length > 0) {
    parts.push(`rename ${renamed.length} file${renamed.length > 1 ? 's' : ''}`);
  }

  // Try to detect common patterns
  const allFiles = [...added, ...modified];
  const hasTests = allFiles.some(f => f.includes('test') || f.includes('spec'));
  const hasDocs = allFiles.some(f => f.includes('.md') || f.includes('doc'));
  const hasConfig = allFiles.some(f => f.includes('config') || f.includes('.json') || f.includes('.yaml'));

  let prefix = 'chore';
  if (added.length > modified.length && added.length > deleted.length) {
    prefix = 'feat';
  } else if (hasTests) {
    prefix = 'test';
  } else if (hasDocs) {
    prefix = 'docs';
  } else if (hasConfig) {
    prefix = 'chore';
  } else if (modified.length > 0) {
    prefix = 'update';
  }

  return `${prefix}: ${parts.join(', ')}`;
}

/**
 * Execute the actual commit with the given message
 */
export function executeAutoCommit(cwd: string, message: string, stageAll = true): AutoCommitResult {
  // Get current changes count
  const statusResult = spawnSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  const changes = statusResult.stdout?.trim().split('\n').filter(Boolean) || [];

  // Stage all changes if requested
  if (stageAll) {
    const addResult = spawnSync('git', ['add', '-A'], { cwd, encoding: 'utf8' });
    if (addResult.status !== 0) {
      return {
        success: false,
        message: `Failed to stage changes: ${addResult.stderr}`,
        filesChanged: 0
      };
    }
  }

  // Create the commit
  const commitResult = spawnSync('git', ['commit', '-m', message], { cwd, encoding: 'utf8' });
  if (commitResult.status !== 0) {
    return {
      success: false,
      message: `Failed to commit: ${commitResult.stderr}`,
      filesChanged: changes.length
    };
  }

  // Get the commit hash
  const hashResult = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8' });
  const commitHash = hashResult.stdout?.trim();

  return {
    success: true,
    message: `Committed ${changes.length} file(s): ${commitHash}`,
    filesChanged: changes.length,
    commitHash
  };
}

/**
 * @deprecated Use getAutoCommitInfo + executeAutoCommit instead
 */
export function autoCommit(cwd: string, options: { message: string; stageAll?: boolean }): AutoCommitResult {
  return executeAutoCommit(cwd, options.message, options.stageAll);
}

// ============ Log Operations ============

export interface GitLogOptions {
  maxCount?: number;
  oneline?: boolean;
  graph?: boolean;
  all?: boolean;
}

export function gitLog(cwd: string, options: GitLogOptions = {}): string {
  const args = ['log'];
  if (options.maxCount) {
    args.push(`-n${options.maxCount}`);
  }
  if (options.oneline) {
    args.push('--oneline');
  }
  if (options.graph) {
    args.push('--graph');
  }
  if (options.all) {
    args.push('--all');
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git log failed');
  }
  return result.stdout || 'No commits';
}

// ============ Remote Operations ============

export function gitFetch(cwd: string, remote?: string, branch?: string): string {
  const args = ['fetch'];
  if (remote) {
    args.push(remote);
    if (branch) {
      args.push(branch);
    }
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git fetch failed');
  }
  return result.stdout || result.stderr || 'Fetched';
}

export function gitPull(cwd: string, remote?: string, branch?: string): string {
  const args = ['pull'];
  if (remote) {
    args.push(remote);
    if (branch) {
      args.push(branch);
    }
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git pull failed');
  }
  return result.stdout || 'Pulled';
}

export function gitPush(cwd: string, remote?: string, branch?: string, options: { force?: boolean; setUpstream?: boolean } = {}): string {
  const targetRemote = remote || 'origin';
  const targetBranch = branch || getCurrentBranch(cwd);

  // SAFETY: Block force push to protected branches
  if (options.force && GIT_SAFETY.PROTECTED_BRANCHES.includes(targetBranch)) {
    throw new Error(
      `Force push to protected branch "${targetBranch}" is blocked. ` +
      `Protected branches: ${GIT_SAFETY.PROTECTED_BRANCHES.join(', ')}`
    );
  }

  // SAFETY: Warn if pushing too many commits at once
  const commitsAhead = getCommitsAhead(cwd, targetRemote, targetBranch);
  if (commitsAhead > GIT_SAFETY.MAX_COMMITS_PER_PUSH) {
    throw new Error(
      `Too many commits to push (${commitsAhead}). Maximum allowed: ${GIT_SAFETY.MAX_COMMITS_PER_PUSH}. ` +
      `This limit exists to prevent accidental large pushes. Push manually if intentional.`
    );
  }

  const args = ['push'];
  if (options.force) {
    // Use --force-with-lease for safer force pushing (prevents overwriting others' work)
    args.push('--force-with-lease');
  }
  if (options.setUpstream) {
    args.push('--set-upstream');
  }
  if (remote) {
    args.push(remote);
    if (branch) {
      args.push(branch);
    }
  }
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'git push failed');
  }
  return result.stdout || result.stderr || 'Pushed';
}
