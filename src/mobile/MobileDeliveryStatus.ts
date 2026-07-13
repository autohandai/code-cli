/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type {
  MobileDeliveryStatusSnapshot,
  MobileDeploymentStatus,
  MobilePullRequestCheck,
  MobilePullRequestReview,
} from './MobileHandoffClient.js';

const execFileAsync = promisify(execFile);
const GH_TIMEOUT_MS = 8_000;
const MAX_DEPLOYMENTS = 6;
const optionalUrlSchema = z.union([z.string().url(), z.literal('')]).nullable().optional();

export type MobileGitHubCommandRunner = (
  args: readonly string[],
  workspaceRoot: string
) => Promise<string>;

export interface MobilePullRequestMergeRequest {
  pullRequestNumber: number;
  expectedHeadBranch: string;
  method: 'squash';
}

export interface MobilePullRequestMergeResult {
  pullRequestNumber: number;
  status: 'merged' | 'rejected' | 'failed';
  message: string;
}

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  url: z.string().url(),
  headRefName: z.string().min(1),
  baseRefName: z.string().min(1),
  state: z.string().min(1),
  mergeable: z.string().optional(),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  changedFiles: z.number().int().nonnegative().default(0),
  updatedAt: z.string().optional(),
  statusCheckRollup: z.array(z.object({
    databaseId: z.number().int().optional(),
    name: z.string().optional(),
    context: z.string().optional(),
    status: z.string().optional(),
    state: z.string().optional(),
    conclusion: z.string().nullable().optional(),
    detailsUrl: optionalUrlSchema,
    targetUrl: optionalUrlSchema,
  }).passthrough()).default([]),
});

const repositorySchema = z.object({
  nameWithOwner: z.string().regex(/^[^/]+\/[^/]+$/),
});

const deploymentSchema = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  environment: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});

const deploymentStatusSchema = z.object({
  state: z.string().min(1),
  description: z.string().nullable().optional(),
  environment_url: optionalUrlSchema,
  log_url: optionalUrlSchema,
  updated_at: z.string().optional(),
});

const defaultRunner: MobileGitHubCommandRunner = async (args, workspaceRoot) => {
  const { stdout } = await execFileAsync('gh', [...args], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
};

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function normalizeCheckStatus(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'pending';
  if (['success', 'successful', 'passed', 'completed'].includes(normalized)) return 'passed';
  if (['failure', 'failed', 'error', 'cancelled', 'timed_out', 'action_required'].includes(normalized)) {
    return 'failed';
  }
  return normalized;
}

function mapPullRequestCheck(
  check: z.infer<typeof pullRequestSchema>['statusCheckRollup'][number],
  index: number
): MobilePullRequestCheck {
  const name = check.name || check.context || `Check ${index + 1}`;
  const url = check.detailsUrl || check.targetUrl || undefined;
  return {
    id: check.databaseId ? String(check.databaseId) : `${name}:${url || index}`,
    name,
    status: normalizeCheckStatus(check.conclusion || check.state || check.status),
    detail: check.conclusion || check.state || check.status || undefined,
    url,
  };
}

async function collectPullRequest(
  workspaceRoot: string,
  runner: MobileGitHubCommandRunner
): Promise<MobilePullRequestReview | null> {
  try {
    const output = await runner([
      'pr',
      'view',
      '--json',
      'number,title,url,headRefName,baseRefName,state,mergeable,additions,deletions,changedFiles,updatedAt,statusCheckRollup',
    ], workspaceRoot);
    const parsed = pullRequestSchema.safeParse(parseJson(output));
    if (!parsed.success) return null;
    const pullRequest = parsed.data;
    return {
      id: String(pullRequest.number),
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      headBranch: pullRequest.headRefName,
      baseBranch: pullRequest.baseRefName,
      status: pullRequest.state.toLowerCase(),
      mergeable: pullRequest.mergeable
        ? pullRequest.mergeable.toUpperCase() === 'MERGEABLE'
        : undefined,
      additions: pullRequest.additions,
      deletions: pullRequest.deletions,
      changedFiles: pullRequest.changedFiles,
      checks: pullRequest.statusCheckRollup.map(mapPullRequestCheck),
      updatedAt: pullRequest.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function mergeMobilePullRequest(
  workspaceRoot: string,
  request: MobilePullRequestMergeRequest,
  runner: MobileGitHubCommandRunner = defaultRunner
): Promise<MobilePullRequestMergeResult> {
  const pullRequest = await collectPullRequest(workspaceRoot, runner);
  if (!pullRequest || pullRequest.number !== request.pullRequestNumber) {
    return {
      pullRequestNumber: request.pullRequestNumber,
      status: 'rejected',
      message: 'The current workspace pull request no longer matches the reviewed PR.',
    };
  }
  if (pullRequest.headBranch !== request.expectedHeadBranch) {
    return {
      pullRequestNumber: request.pullRequestNumber,
      status: 'rejected',
      message: 'The pull request head branch changed after mobile review.',
    };
  }
  const checksPassed = pullRequest.checks.length > 0
    && pullRequest.checks.every((check) => ['passed', 'success', 'successful', 'completed'].includes(check.status));
  if (pullRequest.mergeable !== true || !checksPassed || pullRequest.status !== 'open') {
    return {
      pullRequestNumber: request.pullRequestNumber,
      status: 'rejected',
      message: 'The pull request is not currently open, mergeable, and passing all reported checks.',
    };
  }

  try {
    await runner(['pr', 'merge', String(request.pullRequestNumber), '--squash'], workspaceRoot);
    return {
      pullRequestNumber: request.pullRequestNumber,
      status: 'merged',
      message: `Pull request #${request.pullRequestNumber} was squash merged.`,
    };
  } catch (error) {
    return {
      pullRequestNumber: request.pullRequestNumber,
      status: 'failed',
      message: error instanceof Error ? error.message : 'GitHub CLI could not merge the pull request.',
    };
  }
}

async function collectDeployments(
  workspaceRoot: string,
  runner: MobileGitHubCommandRunner
): Promise<MobileDeploymentStatus[]> {
  try {
    const repositoryOutput = await runner(['repo', 'view', '--json', 'nameWithOwner'], workspaceRoot);
    const repository = repositorySchema.safeParse(parseJson(repositoryOutput));
    if (!repository.success) return [];

    const deploymentsOutput = await runner([
      'api',
      `repos/${repository.data.nameWithOwner}/deployments?per_page=${MAX_DEPLOYMENTS}`,
    ], workspaceRoot);
    const deployments = z.array(deploymentSchema).safeParse(parseJson(deploymentsOutput));
    if (!deployments.success) return [];

    return await Promise.all(deployments.data.map(async (deployment): Promise<MobileDeploymentStatus> => {
      const id = String(deployment.id);
      let latestStatus: z.infer<typeof deploymentStatusSchema> | undefined;
      try {
        const statusOutput = await runner([
          'api',
          `repos/${repository.data.nameWithOwner}/deployments/${encodeURIComponent(id)}/statuses?per_page=1`,
        ], workspaceRoot);
        const statuses = z.array(deploymentStatusSchema).safeParse(parseJson(statusOutput));
        latestStatus = statuses.success ? statuses.data[0] : undefined;
      } catch {
        latestStatus = undefined;
      }

      const environment = deployment.environment || undefined;
      return {
        id,
        name: environment || `Deployment ${id}`,
        environment,
        status: latestStatus?.state.toLowerCase() || 'pending',
        detail: latestStatus?.description || deployment.description || undefined,
        previewURL: latestStatus?.environment_url || undefined,
        logsURL: latestStatus?.log_url || undefined,
        updatedAt: latestStatus?.updated_at || deployment.updated_at,
      };
    }));
  } catch {
    return [];
  }
}

export async function collectMobileDeliveryStatus(
  workspaceRoot: string,
  runner: MobileGitHubCommandRunner = defaultRunner
): Promise<MobileDeliveryStatusSnapshot> {
  const [pullRequest, deployments] = await Promise.all([
    collectPullRequest(workspaceRoot, runner),
    collectDeployments(workspaceRoot, runner),
  ]);
  return { pullRequest, deployments };
}
