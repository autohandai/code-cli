/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import {
  computeSessionStats,
  getAutoResearchDir,
  readConfigJson,
  readLogEntries,
  type ExperimentLogEntry,
  type SessionConfig,
} from './session.js';

export interface FinalizeSessionResult {
  success: boolean;
  filePath?: string;
  manifestPath?: string;
  message: string;
}

export interface FinalizeBranchCommand {
  command: string;
  args: string[];
}

export interface FinalizeBranchPlanEntry {
  run: number;
  description: string;
  branch: string;
  metric: number;
  metricUnit: string;
  commit?: string;
  createBranch?: FinalizeBranchCommand;
  reviewBranch?: FinalizeBranchCommand;
  note?: string;
}

export interface FinalizeBranchPlan {
  session: {
    name: string;
    metricName: string;
    metricUnit: string;
    direction: SessionConfig['direction'];
  };
  generatedAt: string;
  branches: FinalizeBranchPlanEntry[];
  approval: {
    safeDefault: string;
    requiresApproval: string[];
  };
}

/**
 * Write a safe finalization plan for kept auto-research runs.
 *
 * This does not create branches or reset the worktree. It creates reviewable
 * artifacts that name suggested branch/changeset groupings and exact branch
 * creation commands for explicit follow-up approval.
 */
export async function finalizeSession(workspaceRoot: string): Promise<FinalizeSessionResult> {
  const config = await readConfigJson(workspaceRoot);
  if (!config) {
    return {
      success: false,
      message: 'No auto-research session found. Run init_experiment first.',
    };
  }

  const entries = await readLogEntries(workspaceRoot);
  const keptRuns = entries.filter((entry) => entry.status === 'kept');
  if (keptRuns.length === 0) {
    return {
      success: false,
      message: 'No kept auto-research runs found. Run log_experiment with status "kept" before finalizing.',
    };
  }

  const filePath = path.join(getAutoResearchDir(workspaceRoot), 'finalize.md');
  const manifestPath = path.join(getAutoResearchDir(workspaceRoot), 'finalize-branches.json');
  const generatedAt = new Date().toISOString();
  const branchPlan = buildBranchPlan(config, keptRuns, generatedAt);

  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, renderFinalizeReport(config, entries, keptRuns, branchPlan, manifestPath), 'utf-8');
  await fs.writeJson(manifestPath, branchPlan, { spaces: 2 });

  return {
    success: true,
    filePath,
    manifestPath,
    message: `Finalize plan written to ${filePath}. Branch manifest written to ${manifestPath}. Review both before creating branches or destructive changes.`,
  };
}

function buildBranchPlan(
  config: SessionConfig,
  keptRuns: ExperimentLogEntry[],
  generatedAt: string
): FinalizeBranchPlan {
  const sessionSlug = slugify(config.name);
  return {
    session: {
      name: config.name,
      metricName: config.metricName,
      metricUnit: config.metricUnit,
      direction: config.direction,
    },
    generatedAt,
    branches: keptRuns.map((entry) => buildBranchPlanEntry(entry, sessionSlug, config.metricUnit)),
    approval: {
      safeDefault: 'finalizeSession writes plan files only and performs no git operations.',
      requiresApproval: [
        'creating or switching branches',
        'resetting history',
        'deleting branches or artifacts',
        'force-updating branch refs',
        'cherry-picking commits into an existing branch',
      ],
    },
  };
}

function buildBranchPlanEntry(
  entry: ExperimentLogEntry,
  sessionSlug: string,
  metricUnit: string
): FinalizeBranchPlanEntry {
  const branch = `autoresearch/${sessionSlug}-run-${entry.run}`;
  const base: FinalizeBranchPlanEntry = {
    run: entry.run,
    description: entry.description,
    branch,
    metric: entry.metric,
    metricUnit,
  };

  if (!entry.commit) {
    return {
      ...base,
      note: 'No commit hash was recorded for this kept run; create a branch after identifying the intended commit.',
    };
  }

  if (!isCommitHash(entry.commit)) {
    return {
      ...base,
      commit: entry.commit,
      note: 'Recorded commit is not a hex commit hash; verify it before creating a branch.',
    };
  }

  return {
    ...base,
    commit: entry.commit,
    createBranch: {
      command: 'git',
      args: ['branch', branch, entry.commit],
    },
    reviewBranch: {
      command: 'git',
      args: ['switch', branch],
    },
  };
}

function renderFinalizeReport(
  config: SessionConfig,
  entries: ExperimentLogEntry[],
  keptRuns: ExperimentLogEntry[],
  branchPlan: FinalizeBranchPlan,
  manifestPath: string
): string {
  const stats = computeSessionStats(entries, config.direction);
  const lines: string[] = [
    '# Auto-research Finalize Plan',
    '',
    `Session: ${config.name}`,
    `Metric: ${config.metricName} (${config.metricUnit}) - ${config.direction} is better`,
    `Kept runs: ${keptRuns.length}`,
    `Best run: ${stats.bestRun || 'n/a'}`,
    `Best metric: ${formatMetric(stats.bestMetric, config.metricUnit)}`,
  ];

  if (stats.confidence !== undefined) {
    lines.push(`Confidence: ${stats.confidence.toFixed(2)} (MAD ${stats.mad?.toFixed(2)})`);
  }

  lines.push(
    '',
    `Branch manifest: ${formatRelativeAutoPath(manifestPath)}`,
    '',
    '## Reviewable Changesets',
    '',
    'These are suggested branch groupings for review. No branch operations were performed by this command.',
    ''
  );

  for (const entry of keptRuns) {
    const branchEntry = branchPlan.branches.find((candidate) => candidate.run === entry.run);
    lines.push(
      `### run ${entry.run}: ${entry.description}`,
      '',
      `- Suggested branch: ${branchEntry?.branch ?? `autoresearch/${slugify(config.name)}-run-${entry.run}`}`,
      `- Metric: ${formatMetric(entry.metric, config.metricUnit)}`,
      `- Commit: ${entry.commit ?? 'not recorded'}`,
      `- Timestamp: ${entry.timestamp || 'not recorded'}`
    );

    if (branchEntry?.createBranch) {
      lines.push(`- Create branch: \`${formatCommand(branchEntry.createBranch)}\``);
      lines.push(`- Review branch: \`${formatCommand(branchEntry.reviewBranch!)}\``);
    } else if (branchEntry?.note) {
      lines.push(`- Branch command: ${branchEntry.note}`);
    }

    appendOptionalLine(lines, 'Hypothesis', entry.hypothesis);
    appendOptionalLine(lines, 'Learned', entry.learned);
    appendOptionalLine(lines, 'Next focus', entry.nextFocus);
    lines.push('');
  }

  lines.push(
    '## Approval Gate',
    '',
    'This command only wrote plan artifacts. Ask before creating or switching branches, resetting history, deleting artifacts, force-updating refs, cherry-picking into an existing branch, or performing any destructive branch operation.',
    ''
  );

  return lines.join('\n');
}

function appendOptionalLine(lines: string[], label: string, value?: string): void {
  if (value && value.trim().length > 0) {
    lines.push(`- ${label}: ${value}`);
  }
}

function formatMetric(metric: number, unit: string): string {
  return `${metric} ${unit}`.trim();
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'session';
}

function isCommitHash(value: string): boolean {
  return /^[a-f0-9]{6,40}$/i.test(value);
}

function formatCommand(command: FinalizeBranchCommand): string {
  return [command.command, ...command.args.map(shellQuote)].join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._/@:-]+$/.test(value) && !value.startsWith('-')) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatRelativeAutoPath(filePath: string): string {
  const autoIndex = filePath.lastIndexOf(`${path.sep}.auto${path.sep}`);
  return autoIndex >= 0 ? filePath.slice(autoIndex + 1) : filePath;
}
