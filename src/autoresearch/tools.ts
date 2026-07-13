/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import { runCommand } from '../actions/command.js';
import { AutoResearchManager } from './manager.js';
import {
  appendLogEntry,
  computeSessionStats,
  readConfigJson,
  readLogEntries,
  readMeasureSh,
  writeConfigJson,
  writeMeasureSh,
  writePromptMd,
  type ExperimentLogEntry,
  type OptimizationDirection,
  type SessionConfig,
  type SubagentDelegationConfig,
} from './session.js';

export const MAX_LOG_OUTPUT_CHARS = 4000;
export const DEFAULT_EXPERIMENT_TIMEOUT_MS = 10 * 60 * 1000;

export interface InitExperimentInput {
  name: string;
  metricName: string;
  metricUnit: string;
  direction: OptimizationDirection;
  measureScript: string;
  maxIterations?: number;
  timeoutMs?: number;
  subagents?: SubagentDelegationConfig;
  filesInScope?: string[];
  checksScript?: string;
}

export interface RunExperimentResult {
  success: boolean;
  metric?: number;
  output: string;
  error?: string;
  checksFailed?: boolean;
}

export interface LogExperimentInput {
  metric: number;
  status: ExperimentLogEntry['status'];
  description: string;
  commit?: string;
  output?: string;
  hypothesis?: string;
  learned?: string;
  nextFocus?: string;
}

export interface LogExperimentResult {
  success: boolean;
  summary?: string;
  error?: string;
}

interface LocalHookResult {
  exists: boolean;
  passed: boolean;
  phase?: 'before' | 'after';
  output: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

/**
 * Create a new auto-research session by writing config, benchmark script,
 * and a starter prompt document.
 */
export async function initExperiment(
  workspaceRoot: string,
  input: InitExperimentInput
): Promise<{ success: boolean; message: string }> {
  const config: SessionConfig = {
    name: input.name,
    metricName: input.metricName,
    metricUnit: input.metricUnit,
    direction: input.direction,
    maxIterations: input.maxIterations ?? 30,
    timeoutMs: normalizeTimeoutMs(input.timeoutMs),
    ...(input.subagents ? { subagents: input.subagents } : {}),
  };
  const subagentPlan = buildSubagentPlan(input.subagents);

  await writeConfigJson(workspaceRoot, config);
  await writeMeasureSh(workspaceRoot, input.measureScript);
  if (input.checksScript) {
    await fs.writeFile(path.join(workspaceRoot, '.auto', 'checks.sh'), input.checksScript, { mode: 0o755 });
  }
  await writePromptMd(workspaceRoot, {
    goal: input.name,
    metricName: input.metricName,
    metricUnit: input.metricUnit,
    direction: input.direction,
    filesInScope: input.filesInScope ?? [],
    tried: [],
    deadEnds: [],
    wins: [],
    ...(subagentPlan.length > 0 ? { subagentPlan } : {}),
  });

  return {
    success: true,
    message: `Initialized auto-research session "${input.name}" optimizing ${input.metricName} (${input.metricUnit}) — ${input.direction} is better.`,
  };
}

function buildSubagentPlan(subagents?: SubagentDelegationConfig): string[] {
  if (!subagents) {
    return [];
  }

  const plan: string[] = [];
  if (subagents.ideaGeneration) {
    plan.push('Use delegate_task or delegate_parallel for idea generation before selecting an experiment.');
  }
  if (subagents.measurementAnalysis) {
    plan.push('Use delegate_task for measurement analysis when benchmark results are noisy or surprising.');
  }
  if (subagents.finalization) {
    plan.push('Use delegate_task during finalization to review kept runs and branch grouping recommendations.');
  }

  return plan;
}

/**
 * Run the session benchmark script and extract the metric value.
 */
export async function runExperiment(
  workspaceRoot: string,
  description: string
): Promise<RunExperimentResult> {
  const config = await readConfigJson(workspaceRoot);
  if (!config) {
    return {
      success: false,
      output: '',
      error: 'No auto-research session found. Run init_experiment first.',
    };
  }

  const measureScript = await readMeasureSh(workspaceRoot);
  if (!measureScript) {
    return {
      success: false,
      output: '',
      error: 'No .auto/measure.sh script found. Run init_experiment first.',
    };
  }

  try {
    const timeoutMs = getExperimentTimeoutMs(config);
    const beforeHook = await runLocalIterationHook(workspaceRoot, 'before.sh', config.workingDir, timeoutMs);
    if (beforeHook.exists && !beforeHook.passed) {
      return {
        success: false,
        output: formatRunOutput('', beforeHook),
        error: beforeHook.timedOut
          ? `Auto-research before hook timed out after ${timeoutMs}ms.`
          : `Auto-research before hook failed with exit code ${beforeHook.exitCode ?? 'unknown'}.`,
      };
    }

    const measurePath = path.join(workspaceRoot, '.auto', 'measure.sh');
    const result = await runCommand('bash', [measurePath], workspaceRoot, {
      directory: config.workingDir,
      timeout: timeoutMs,
      shell: false,
    });
    const output = result.stdout + result.stderr;
    const afterHook = await runLocalIterationHook(workspaceRoot, 'after.sh', config.workingDir, timeoutMs);

    if (isTimeoutResult(result)) {
      return {
        success: false,
        output: formatRunOutput(output, beforeHook, afterHook),
        error: `Benchmark timed out after ${timeoutMs}ms.`,
      };
    }

    if (result.code !== 0) {
      return {
        success: false,
        output: formatRunOutput(output, beforeHook, afterHook),
        error: `Benchmark failed with exit code ${result.code}: ${result.stderr || result.stdout}`,
      };
    }

    const metric = parseMetricOutput(output, config.metricName);

    if (metric === undefined) {
      return {
        success: false,
        output: formatRunOutput(output, beforeHook, afterHook),
        error: `Benchmark output did not contain METRIC ${config.metricName}=<number>.`,
      };
    }

    if (afterHook.exists && !afterHook.passed) {
      return {
        success: false,
        metric,
        output: formatRunOutput(output, beforeHook, afterHook),
        error: afterHook.timedOut
          ? `Auto-research after hook timed out after ${timeoutMs}ms.`
          : `Auto-research after hook failed with exit code ${afterHook.exitCode ?? 'unknown'}.`,
      };
    }

    const checks = await runBackpressureChecks(workspaceRoot, config.workingDir, timeoutMs);
    if (checks.exists && !checks.passed) {
      return {
        success: true,
        metric,
        checksFailed: true,
        output: formatRunOutput(
          `Experiment: ${description}\n\nBenchmark output:\n${output}\n\nBackpressure checks failed:\n${checks.output}`,
          beforeHook,
          afterHook
        ),
      };
    }

    return {
      success: true,
      metric,
      output: formatRunOutput(
        `Experiment: ${description}\n\nBenchmark output:\n${output}${checks.exists ? `\n\nBackpressure checks passed:\n${checks.output}` : ''}`,
        beforeHook,
        afterHook
      ),
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runLocalIterationHook(
  workspaceRoot: string,
  filename: 'before.sh' | 'after.sh',
  workingDir: string | undefined,
  timeoutMs: number
): Promise<LocalHookResult> {
  const hookPath = path.join(workspaceRoot, '.auto', 'hooks', filename);
  if (!(await fs.pathExists(hookPath))) {
    return { exists: false, passed: true, output: '' };
  }

  const phase = filename === 'before.sh' ? 'before' : 'after';
  const result = await runCommand('bash', [hookPath], workspaceRoot, {
    directory: workingDir,
    timeout: timeoutMs,
    shell: false,
    env: {
      AUTO_RESEARCH_WORKSPACE: workspaceRoot,
      AUTO_RESEARCH_HOOK: phase,
    },
  });

  return {
    exists: true,
    passed: result.code === 0,
    phase,
    output: result.stdout + result.stderr,
    exitCode: result.code,
    timedOut: isTimeoutResult(result),
  };
}

function formatRunOutput(output: string, ...hooks: LocalHookResult[]): string {
  const hookSections = hooks
    .map(formatLocalHookOutput)
    .filter((section) => section.length > 0);

  return [output, ...hookSections].filter((section) => section.length > 0).join('\n\n');
}

function formatLocalHookOutput(hook: LocalHookResult): string {
  if (!hook.exists) {
    return '';
  }

  const hookName = hook.phase === 'before' ? 'Before' : 'After';
  const label = hook.output.trim().length > 0 ? hook.output.trim() : '(no output)';
  return `${hookName} hook ${hook.passed ? 'output' : 'failed'}:\n${label}`;
}

function parseMetricOutput(output: string, metricName: string): number | undefined {
  const numberPattern = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const regex = new RegExp(`METRIC\\s+${escapeRegex(metricName)}\\s*=\\s*(${numberPattern})`);
  const match = output.match(regex);
  if (!match) {
    return undefined;
  }
  const metric = Number.parseFloat(match[1]);
  return Number.isFinite(metric) ? metric : undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface CheckResult {
  exists: boolean;
  passed: boolean;
  output: string;
  timedOut?: boolean;
}

async function runBackpressureChecks(
  workspaceRoot: string,
  workingDir: string | undefined,
  timeoutMs: number
): Promise<CheckResult> {
  const checksPath = path.join(workspaceRoot, '.auto', 'checks.sh');
  if (!(await fs.pathExists(checksPath))) {
    return { exists: false, passed: true, output: '' };
  }

  const result = await runCommand('bash', ['.auto/checks.sh'], workspaceRoot, {
    directory: workingDir,
    timeout: timeoutMs,
    shell: false,
  });

  const output = result.stdout + result.stderr;
  return {
    exists: true,
    passed: result.code === 0,
    output,
    timedOut: isTimeoutResult(result),
  };
}

function normalizeTimeoutMs(timeoutMs?: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs !== undefined && timeoutMs > 0
    ? Math.floor(timeoutMs)
    : DEFAULT_EXPERIMENT_TIMEOUT_MS;
}

function getExperimentTimeoutMs(config: SessionConfig): number {
  return normalizeTimeoutMs(config.timeoutMs);
}

function isTimeoutResult(result: { code: number | null; signal?: NodeJS.Signals | null }): boolean {
  return result.code === null && result.signal === 'SIGTERM';
}

/**
 * Append an experiment result to .auto/log.jsonl and return a summary.
 */
export async function logExperiment(
  workspaceRoot: string,
  input: LogExperimentInput
): Promise<LogExperimentResult> {
  const config = await readConfigJson(workspaceRoot);
  if (!config) {
    return {
      success: false,
      error: 'No auto-research session found. Run init_experiment first.',
    };
  }

  const previous = await readLogEntries(workspaceRoot);
  const run = previous.length + 1;

  const entry: ExperimentLogEntry = {
    run,
    status: input.status,
    metric: input.metric,
    description: input.description,
    commit: input.commit,
    outputExcerpt: input.output !== undefined ? truncateOutputExcerpt(input.output) : undefined,
    hypothesis: input.hypothesis,
    learned: input.learned,
    nextFocus: input.nextFocus,
    timestamp: new Date().toISOString(),
  };

  await appendLogEntry(workspaceRoot, entry);
  await new AutoResearchManager(workspaceRoot).recordLoggedIteration(run);

  const allEntries = [...previous, entry];
  const stats = computeSessionStats(allEntries, config.direction);

  const lines = [
    `Recorded run ${run}: ${input.status}`,
    `  description: ${input.description}`,
    `  metric: ${input.metric} ${config.metricUnit}`,
  ];

  if (stats.bestMetric !== undefined) {
    lines.push(`  best: ${stats.bestMetric} ${config.metricUnit} (run ${stats.bestRun})`);
  }

  if (stats.confidence !== undefined) {
    lines.push(`  confidence: ${stats.confidence.toFixed(2)} (MAD ${stats.mad?.toFixed(2)})`);
  }

  return {
    success: true,
    summary: lines.join('\n'),
  };
}

function truncateOutputExcerpt(output: string): string {
  if (output.length <= MAX_LOG_OUTPUT_CHARS) {
    return output;
  }

  let marker = formatTruncationMarker(output.length - MAX_LOG_OUTPUT_CHARS);
  let headLength = 0;
  let tailLength = 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const available = MAX_LOG_OUTPUT_CHARS - marker.length;
    headLength = Math.max(0, Math.floor(available / 2));
    tailLength = Math.max(0, available - headLength);

    const omitted = output.length - headLength - tailLength;
    const nextMarker = formatTruncationMarker(omitted);
    if (nextMarker === marker) {
      break;
    }
    marker = nextMarker;
  }

  return `${output.slice(0, headLength)}${marker}${output.slice(output.length - tailLength)}`;
}

function formatTruncationMarker(omittedCharacters: number): string {
  return `\n\n[... truncated ${omittedCharacters} characters ...]\n\n`;
}
