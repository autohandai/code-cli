/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Project tracker — queries GitHub issues and PRs via gh CLI.
 */

import { execFile } from 'node:child_process';

/** JSON fields requested per action */
const ISSUE_LIST_FIELDS = 'number,title,state,assignees,labels,createdAt,url';
const ISSUE_VIEW_FIELDS = 'number,title,state,body,assignees,labels,comments,createdAt,milestone,author,url';
const PR_LIST_FIELDS = 'number,title,state,author,baseRefName,headRefName,labels,createdAt,isDraft,url';
const PR_VIEW_FIELDS = 'number,title,state,body,author,baseRefName,headRefName,labels,comments,latestReviews,statusCheckRollup,mergeable,additions,deletions,createdAt,isDraft,url';

interface ProjectTrackerAction {
  type: 'project_tracker';
  action: 'list_issues' | 'get_issue' | 'list_prs' | 'get_pr' | 'get_user';
  number?: number;
  state?: 'open' | 'closed' | 'merged' | 'all';
  assignee?: string;
  author?: string;
  labels?: string;
  base?: string;
  limit?: number;
  repo?: string;
}

/**
 * Execute a gh CLI command and return stdout.
 * Throws with a user-friendly message on failure.
 */
async function runGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    }, (err, stdout, stderr) => {
      if (!err) {
        resolve(stdout);
        return;
      }

      const error = err as Error & { code?: string };

      // gh not installed
      if (error.code === 'ENOENT' || error.message?.includes('command not found')) {
        reject(new Error('gh CLI is not installed. Install it from https://cli.github.com'));
        return;
      }

      // Auth / API errors — pass through gh's stderr
      const errMsg = stderr || error.message || 'Unknown error';
      if (errMsg.includes('auth login') || errMsg.includes('not logged')) {
        reject(new Error("gh CLI is not authenticated. Run 'gh auth login' first."));
        return;
      }

      reject(new Error(`gh command failed: ${errMsg.trim()}`));
    });
  });
}

/**
 * Main entry point for the project_tracker tool.
 */
export async function projectTracker(action: ProjectTrackerAction): Promise<string> {
  // --- Parameter validation ---
  if (action.action === 'get_issue' || action.action === 'get_pr') {
    if (action.number == null) {
      return `Error: The 'number' parameter is required for ${action.action}`;
    }
    if (!Number.isInteger(action.number) || action.number <= 0) {
      return `Error: The 'number' parameter must be a positive integer`;
    }
  }

  if (action.state === 'merged' && action.action === 'list_issues') {
    return `Error: The 'merged' state is only valid for list_prs`;
  }

  // --- Build and execute gh command ---
  try {
    switch (action.action) {
      case 'list_issues':
        return await listIssues(action);
      case 'get_issue':
        return await getIssue(action);
      case 'list_prs':
        return await listPrs(action);
      case 'get_pr':
        return await getPr(action);
      case 'get_user':
        return await getUser();
      default:
        return `Error: Unknown action: ${(action as any).action}. Valid actions: list_issues, get_issue, list_prs, get_pr, get_user`;
    }
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function listIssues(action: ProjectTrackerAction): Promise<string> {
  const args = ['issue', 'list', '--json', ISSUE_LIST_FIELDS];
  args.push('--limit', String(action.limit ?? 20));
  if (action.state) args.push('--state', action.state);
  if (action.assignee) args.push('--assignee', action.assignee);
  if (action.labels) args.push('--label', action.labels);
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getIssue(action: ProjectTrackerAction): Promise<string> {
  const args = ['issue', 'view', String(action.number), '--json', ISSUE_VIEW_FIELDS];
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function listPrs(action: ProjectTrackerAction): Promise<string> {
  const args = ['pr', 'list', '--json', PR_LIST_FIELDS];
  args.push('--limit', String(action.limit ?? 20));
  if (action.state) args.push('--state', action.state);
  if (action.author) args.push('--author', action.author);
  if (action.base) args.push('--base', action.base);
  if (action.labels) args.push('--label', action.labels);
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getPr(action: ProjectTrackerAction): Promise<string> {
  const args = ['pr', 'view', String(action.number), '--json', PR_VIEW_FIELDS];
  if (action.repo) args.push('-R', action.repo);
  return runGh(args);
}

async function getUser(): Promise<string> {
  try {
    const stdout = await runGh(['api', 'user', '--jq', '.login']);
    return `Authenticated as: ${stdout.trim()}`;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Let installation/auth errors pass through from runGh
    if (msg.includes('not installed') || msg.includes('not authenticated')) {
      throw err;
    }
    throw new Error("Failed to get GitHub user. Ensure gh is authenticated: run 'gh auth status'");
  }
}
