/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';

/** Session files live in a single `.auto/` folder at the workspace root. */
const AUTO_DIR_NAME = '.auto';

/** Direction of optimization. */
export type OptimizationDirection = 'lower' | 'higher';

/** Optional subagent delegation phases for an auto-research session. */
export interface SubagentDelegationConfig {
  ideaGeneration?: boolean;
  measurementAnalysis?: boolean;
  finalization?: boolean;
}

/** Persisted session configuration. */
export interface SessionConfig {
  /** Human-readable session name. */
  name: string;
  /** Metric being optimized, e.g. "total_ms". */
  metricName: string;
  /** Unit suffix for display, e.g. "ms" or "KB". */
  metricUnit: string;
  /** Whether a smaller or larger metric is better. */
  direction: OptimizationDirection;
  /** Hard cap on the number of experiments. */
  maxIterations?: number;
  /** Maximum runtime for benchmark, check, and local hook scripts in milliseconds. */
  timeoutMs?: number;
  /** Optional override for the working directory used by the benchmark. */
  workingDir?: string;
  /** Optional delegation phases that should use existing subagent tools. */
  subagents?: SubagentDelegationConfig;
}

/** Living document describing the experiment session. */
export interface PromptDocument {
  /** What the session is trying to optimize. */
  goal: string;
  metricName: string;
  metricUnit: string;
  direction: OptimizationDirection;
  /** Files the agent may edit. */
  filesInScope?: string[];
  /** High-level ideas already attempted. */
  tried?: string[];
  /** Ideas that did not work out. */
  deadEnds?: string[];
  /** Successful changes worth keeping. */
  wins?: string[];
  /** Delegation guidance for existing subagent tools. */
  subagentPlan?: string[];
}

/** Status of a single experiment run. */
export type ExperimentStatus =
  | 'pending'
  | 'kept'
  | 'discarded'
  | 'checks_failed'
  | 'crashed';

/** Single line in `.auto/log.jsonl`. */
export interface ExperimentLogEntry {
  /** 1-based run number. */
  run: number;
  status: ExperimentStatus;
  /** Numeric metric extracted from the benchmark output. */
  metric: number;
  /** Human-readable description of the change. */
  description: string;
  /** Git commit hash when the run was recorded. */
  commit?: string;
  /** Bounded stdout/stderr excerpt captured from the benchmark or checks. */
  outputExcerpt?: string;
  /** Hypothesis that led to this run. */
  hypothesis?: string;
  /** Reflection on the outcome. */
  learned?: string;
  /** Suggested next focus area. */
  nextFocus?: string;
  /** ISO timestamp when the entry was written. */
  timestamp: string;
}

/** Summary statistics derived from the experiment log. */
export interface SessionStats {
  baselineMetric: number;
  bestMetric: number;
  bestRun: number;
  runCount: number;
  /** |best improvement| / MAD, only meaningful with 3+ runs. */
  confidence?: number;
  /** Median absolute deviation of all metrics. */
  mad?: number;
}

/**
 * Resolve the absolute path to the `.auto/` directory for a workspace.
 */
export function getAutoResearchDir(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, AUTO_DIR_NAME);
}

function sessionPath(workspaceRoot: string, filename: string): string {
  return path.join(getAutoResearchDir(workspaceRoot), filename);
}

/**
 * Ensure the `.auto/` directory exists.
 */
export async function ensureSessionDir(workspaceRoot: string): Promise<void> {
  await fs.ensureDir(getAutoResearchDir(workspaceRoot));
}

/**
 * Write the living prompt document for the session.
 */
export async function writePromptMd(
  workspaceRoot: string,
  doc: PromptDocument
): Promise<void> {
  await ensureSessionDir(workspaceRoot);
  const lines: string[] = [
    `# ${doc.goal}`,
    '',
    `**Metric:** ${doc.metricName} (${doc.metricUnit}) — ${doc.direction} is better`,
    '',
  ];

  if (doc.filesInScope && doc.filesInScope.length > 0) {
    lines.push('## Files in scope', '');
    for (const file of doc.filesInScope) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  lines.push('## Tried', '');
  for (const item of doc.tried ?? []) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## Dead ends', '');
  for (const item of doc.deadEnds ?? []) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  lines.push('## Wins', '');
  for (const item of doc.wins ?? []) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  if (doc.subagentPlan && doc.subagentPlan.length > 0) {
    lines.push('## Subagent delegation', '');
    for (const item of doc.subagentPlan) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  await fs.writeFile(sessionPath(workspaceRoot, 'prompt.md'), lines.join('\n'), 'utf-8');
}

/**
 * Parse a prompt.md file back into a structured document.
 * Returns `null` if the file does not exist.
 */
export async function readPromptMd(workspaceRoot: string): Promise<PromptDocument | null> {
  const filePath = sessionPath(workspaceRoot, 'prompt.md');
  if (!(await fs.pathExists(filePath))) {
    return null;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  const doc: PromptDocument = {
    goal: '',
    metricName: '',
    metricUnit: '',
    direction: 'lower',
    filesInScope: [],
    tried: [],
    deadEnds: [],
    wins: [],
  };

  const listBuffers: Record<string, string[]> = {
    tried: [],
    'dead ends': [],
    wins: [],
    'files in scope': [],
    'subagent delegation': [],
  };

  let currentSection: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      doc.goal = line.slice(2).trim();
      continue;
    }

    if (line.startsWith('**Metric:**')) {
      const match = line.match(/\*\*Metric:\*\*\s*([^()]+)\s*\(([^)]+)\)\s*—\s*(lower|higher)/i);
      if (match) {
        doc.metricName = match[1].trim();
        doc.metricUnit = match[2].trim();
        doc.direction = match[3].toLowerCase() as OptimizationDirection;
      }
      continue;
    }

    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim().toLowerCase();
      continue;
    }

    if (line.startsWith('- ') && currentSection && currentSection in listBuffers) {
      listBuffers[currentSection].push(line.slice(2).trim());
    }
  }

  doc.filesInScope = listBuffers['files in scope'];
  doc.tried = listBuffers.tried;
  doc.deadEnds = listBuffers['dead ends'];
  doc.wins = listBuffers.wins;
  if (listBuffers['subagent delegation'].length > 0) {
    doc.subagentPlan = listBuffers['subagent delegation'];
  }

  return doc;
}

/**
 * Write the benchmark script. The script is responsible for emitting
 * `METRIC <name>=<number>` lines on stdout.
 */
export async function writeMeasureSh(
  workspaceRoot: string,
  script: string
): Promise<void> {
  await ensureSessionDir(workspaceRoot);
  const filePath = sessionPath(workspaceRoot, 'measure.sh');
  await fs.writeFile(filePath, script, { mode: 0o755 });
}

/**
 * Read the benchmark script, returning `null` if it does not exist.
 */
export async function readMeasureSh(workspaceRoot: string): Promise<string | null> {
  const filePath = sessionPath(workspaceRoot, 'measure.sh');
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  return fs.readFile(filePath, 'utf-8');
}

/**
 * Persist session configuration.
 */
export async function writeConfigJson(
  workspaceRoot: string,
  config: SessionConfig
): Promise<void> {
  await ensureSessionDir(workspaceRoot);
  await fs.writeJson(sessionPath(workspaceRoot, 'config.json'), config, { spaces: 2 });
}

/**
 * Read session configuration, returning `null` if it does not exist.
 */
export async function readConfigJson(workspaceRoot: string): Promise<SessionConfig | null> {
  const filePath = sessionPath(workspaceRoot, 'config.json');
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  try {
    return (await fs.readJson(filePath)) as SessionConfig;
  } catch {
    return null;
  }
}

/**
 * Append a single experiment entry to `.auto/log.jsonl`.
 */
export async function appendLogEntry(
  workspaceRoot: string,
  entry: ExperimentLogEntry
): Promise<void> {
  await ensureSessionDir(workspaceRoot);
  const filePath = sessionPath(workspaceRoot, 'log.jsonl');
  const line = JSON.stringify(entry) + '\n';
  await fs.writeFile(filePath, line, { flag: 'a' });
}

/**
 * Read all experiment entries from `.auto/log.jsonl`.
 */
export async function readLogEntries(workspaceRoot: string): Promise<ExperimentLogEntry[]> {
  const filePath = sessionPath(workspaceRoot, 'log.jsonl');
  if (!(await fs.pathExists(filePath))) {
    return [];
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  return lines.map((line) => JSON.parse(line) as ExperimentLogEntry);
}

/**
 * Remove all session state files while keeping the `.auto/` directory.
 */
export async function clearSession(workspaceRoot: string): Promise<void> {
  const dir = getAutoResearchDir(workspaceRoot);
  if (!(await fs.pathExists(dir))) {
    return;
  }

  const files = await fs.readdir(dir);
  await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file);
      await fs.remove(filePath);
    })
  );
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute median absolute deviation for a list of numbers.
 */
function computeMad(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const m = median(values);
  const deviations = values.map((v) => Math.abs(v - m));
  return median(deviations);
}

/**
 * Derive summary statistics from completed experiment entries.
 */
export function computeSessionStats(
  entries: ExperimentLogEntry[],
  direction: OptimizationDirection
): SessionStats {
  const completed = entries.filter(
    (e) => e.status === 'kept' || e.status === 'discarded'
  );
  const runCount = completed.length;
  const baselineMetric = completed.length > 0 ? completed[0].metric : 0;

  let bestMetric = baselineMetric;
  let bestRun = completed.length > 0 ? completed[0].run : 0;

  for (const entry of completed) {
    const isBetter =
      direction === 'lower' ? entry.metric < bestMetric : entry.metric > bestMetric;
    if (isBetter) {
      bestMetric = entry.metric;
      bestRun = entry.run;
    }
  }

  const stats: SessionStats = {
    baselineMetric,
    bestMetric,
    bestRun,
    runCount,
  };

  if (runCount >= 3) {
    const metrics = completed.map((e) => e.metric);
    const mad = computeMad(metrics);
    const improvement = Math.abs(
      direction === 'lower' ? baselineMetric - bestMetric : bestMetric - baselineMetric
    );
    stats.mad = mad;
    stats.confidence = mad > 0 ? improvement / mad : 0;
  }

  return stats;
}
