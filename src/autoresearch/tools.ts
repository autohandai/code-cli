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
  assertCleanReplayableBaseline,
  candidateReplayObjectIds,
  captureCandidate,
  createEnvironmentFingerprint,
  restoreCandidateWorkingTree,
  verifyCandidateCommit,
} from './candidate.js';
import {
  evaluatorPathsForWorkspace,
  evaluateWorkspace,
  objectivesFromConfig,
  samplingFromConfig,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_SAMPLES,
  DEFAULT_MIN_SAMPLES,
} from './evaluator.js';
import {
  LedgerStore,
  createLedgerId,
  loadLedgerEvents,
  type CandidateRecord,
  type DecisionRecord,
  type EvaluationRecord,
  type JsonValue,
  type LedgerEvent,
} from './ledger.js';
import { createPersistedDecision } from './decisionRecord.js';
import { pruneArtifacts } from './analysis.js';
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
  type ExperimentConstraintConfig,
  type ExperimentRetentionConfig,
  type ExperimentSamplingConfig,
  type OptimizationDirection,
  type SecondaryObjectiveConfig,
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
  secondaryObjectives?: SecondaryObjectiveConfig[];
  constraints?: ExperimentConstraintConfig[];
  sampling?: Partial<ExperimentSamplingConfig>;
  retention?: ExperimentRetentionConfig;
  environmentAllowlist?: string[];
  /** Explicit compatibility escape hatch for pre-ledger/non-Git callers. */
  replayable?: boolean;
}

export interface RunExperimentResult {
  success: boolean;
  metric?: number;
  output: string;
  error?: string;
  checksFailed?: boolean;
  attemptId?: string;
  metrics?: Record<string, number>;
  samples?: EvaluationRecord['samples'];
  decision?: DecisionRecord;
}

export interface LogExperimentInput {
  attemptId?: string;
  metric?: number;
  status?: ExperimentLogEntry['status'];
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

export interface InitExperimentResult {
  success: boolean;
  message: string;
  baselineAttemptId?: string;
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
  input: InitExperimentInput,
  signal?: AbortSignal
): Promise<InitExperimentResult> {
  if (input.replayable === false) {
    return initLegacyExperiment(workspaceRoot, input);
  }

  try {
    const baseline = await assertCleanReplayableBaseline(workspaceRoot);
    const sampling = normalizeSampling(input.sampling);
    const config: SessionConfig = {
      name: input.name,
      metricName: input.metricName,
      metricUnit: input.metricUnit,
      direction: input.direction,
      ledgerVersion: 1,
      baselineCommit: baseline.baseCommit,
      materializedCommit: baseline.baseCommit,
      secondaryObjectives: input.secondaryObjectives ?? [],
      constraints: input.constraints ?? [],
      sampling,
      retention: input.retention,
      environmentAllowlist: input.environmentAllowlist ?? [],
      filesInScope: input.filesInScope ?? [],
      maxIterations: input.maxIterations ?? 30,
      timeoutMs: normalizeTimeoutMs(input.timeoutMs),
      ...(input.subagents ? { subagents: input.subagents } : {}),
    };
    validateReplayableConfig(config);

    // Validate the allowlist before creating any persistent ledger artifacts.
    const beforeHookScript = await readOptionalScript(path.join(workspaceRoot, '.auto', 'hooks', 'before.sh'));
    const afterHookScript = await readOptionalScript(path.join(workspaceRoot, '.auto', 'hooks', 'after.sh'));
    const evaluatorScripts: Record<string, string> = { measure: input.measureScript };
    if (input.checksScript !== undefined) evaluatorScripts.checks = input.checksScript;
    if (beforeHookScript !== undefined) evaluatorScripts.beforeHook = beforeHookScript;
    if (afterHookScript !== undefined) evaluatorScripts.afterHook = afterHookScript;
    const environment = await createEnvironmentFingerprint(
      workspaceRoot,
      evaluatorScripts,
      config.environmentAllowlist ?? []
    );

    await resetReplayableSessionArtifacts(workspaceRoot);
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

    const store = new LedgerStore(workspaceRoot);
    const attemptId = createLedgerId('attempt');
    const configObject = await store.putObject(JSON.stringify(config));
    const measureObject = await store.putObject(input.measureScript);
    const checksObject = input.checksScript === undefined
      ? undefined
      : await store.putObject(input.checksScript);
    const beforeHookObject = beforeHookScript === undefined ? undefined : await store.putObject(beforeHookScript);
    const afterHookObject = afterHookScript === undefined ? undefined : await store.putObject(afterHookScript);
    const baselineCandidate: CandidateRecord = {
      schemaVersion: 1,
      type: 'candidate',
      id: createLedgerId('event'),
      attemptId,
      timestamp: new Date().toISOString(),
      context: { baseline: true },
      description: 'zero-diff baseline',
      baseCommit: baseline.baseCommit,
      parentAttemptId: null,
      patchObject: null,
      untrackedFiles: [],
      changedPaths: [],
      evaluator: {
        configObject,
        measureObject,
        ...(checksObject ? { checksObject } : {}),
        ...(beforeHookObject ? { beforeHookObject } : {}),
        ...(afterHookObject ? { afterHookObject } : {}),
      },
      environment,
    };
    await store.append(baselineCandidate);
    const evaluated = await evaluateWorkspace({
      workspaceRoot,
      attemptId,
      config,
      paths: evaluatorPathsForWorkspace(workspaceRoot),
      store,
      evaluatorMode: 'original',
      context: { baseline: true },
      signal,
    });
    const baselinePassed = evaluated.evaluation.execution.outcome === 'passed';
    const decision = createPersistedDecision({
      attemptId,
      evaluation: evaluated.evaluation,
      source: 'original',
      outcome: baselinePassed ? 'accepted' : executionOutcomeToDecision(evaluated.evaluation),
      materialized: baselinePassed,
      primaryImprovement: 0,
      confidence: 0,
      constraintResults: [],
      explanation: baselinePassed
        ? 'Zero-diff baseline captured and materialized at the session base commit.'
        : evaluated.evaluation.execution.error ?? 'Zero-diff baseline evaluation failed.',
      context: { baseline: true },
    });
    await store.append(decision);
    if (signal?.aborted) throw createAbortError();
    if (!baselinePassed) {
      return {
        success: false,
        message: evaluated.evaluation.execution.error ?? 'Zero-diff baseline evaluation failed.',
        baselineAttemptId: attemptId,
      };
    }
    return {
      success: true,
      baselineAttemptId: attemptId,
      message: `Initialized replayable auto-research session "${input.name}" with baseline ${attemptId}, optimizing ${input.metricName} (${input.metricUnit}) — ${input.direction} is better.`,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function initLegacyExperiment(
  workspaceRoot: string,
  input: InitExperimentInput
): Promise<InitExperimentResult> {
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
  description: string,
  signal?: AbortSignal
): Promise<RunExperimentResult> {
  const config = await readConfigJson(workspaceRoot);
  if (!config?.ledgerVersion) {
    return runLegacyExperiment(workspaceRoot, description, signal);
  }
  return runLedgerExperiment(workspaceRoot, config, description, signal);
}

async function runLedgerExperiment(
  workspaceRoot: string,
  config: SessionConfig,
  description: string,
  signal?: AbortSignal
): Promise<RunExperimentResult> {
  const store = new LedgerStore(workspaceRoot);
  let candidate: CandidateRecord | undefined;
  let retainCandidate = false;
  try {
    const events = await store.load();
    await assertAcceptedLineageAdvanced(workspaceRoot, config, events);
    const reference = findLatestMaterializedEvaluation(events);
    if (!reference) {
      return { success: false, output: '', error: 'Replayable session has no materialized baseline evaluation.' };
    }
    candidate = await captureCandidate(workspaceRoot, {
      description,
      expectedBaseCommit: config.materializedCommit ?? config.baselineCommit ?? '',
      parentAttemptId: reference.attemptId,
      filesInScope: config.filesInScope,
      evaluator: {
        config: config as unknown as Record<string, JsonValue>,
        measureScript: await requireMeasureScript(workspaceRoot),
        checksScript: await readOptionalScript(path.join(workspaceRoot, '.auto', 'checks.sh')),
        beforeHookScript: await readOptionalScript(path.join(workspaceRoot, '.auto', 'hooks', 'before.sh')),
        afterHookScript: await readOptionalScript(path.join(workspaceRoot, '.auto', 'hooks', 'after.sh')),
      },
      environmentAllowlist: config.environmentAllowlist ?? [],
    });
    const evaluated = await evaluateWorkspace({
      workspaceRoot,
      attemptId: candidate.attemptId,
      config,
      paths: evaluatorPathsForWorkspace(workspaceRoot),
      store,
      evaluatorMode: 'original',
      referenceAggregates: reference.aggregates,
      signal,
    });
    const engine = evaluated.provisionalDecision;
    const executionOutcome = evaluated.evaluation.execution.outcome;
    const outcome = executionOutcome === 'passed'
      ? engine?.outcome === 'sampling' || engine === undefined
        ? 'inconclusive'
        : engine.outcome
      : executionOutcomeToDecision(evaluated.evaluation);
    const materialized = outcome === 'accepted';
    const decision = createPersistedDecision({
      attemptId: candidate.attemptId,
      evaluation: evaluated.evaluation,
      source: 'original',
      outcome,
      materialized,
      primaryImprovement: engine?.primaryImprovement ?? 0,
      confidence: engine?.confidence ?? 0,
      constraintResults: engine?.constraintResults ?? [],
      explanation: engine?.explanation
        ?? evaluated.evaluation.execution.error
        ?? `Evaluator finished with ${executionOutcome}.`,
    });
    await store.append(decision);
    retainCandidate = materialized;
    if (!materialized) {
      await restoreCandidateWorkingTree(workspaceRoot, candidate);
    }
    if (
      config.retention?.maxArtifactBytes !== undefined
      || config.retention?.maxArtifactAgeDays !== undefined
    ) {
      await pruneArtifacts(workspaceRoot, { dryRun: false, includeProtected: false });
    }
    const primaryMetric = evaluated.evaluation.aggregates[config.metricName]?.median;
    const metrics = Object.fromEntries(Object.entries(evaluated.evaluation.aggregates)
      .map(([name, aggregate]) => [name, aggregate.median]));
    const success = executionOutcome === 'passed' || executionOutcome === 'checks_failed';
    if (signal?.aborted) throw createAbortError();
    return {
      success,
      attemptId: candidate.attemptId,
      metric: primaryMetric,
      metrics,
      samples: evaluated.evaluation.samples,
      decision,
      checksFailed: outcome === 'checks_failed' ? true : undefined,
      output: formatLedgerRunOutput(description, evaluated, decision),
      error: success ? undefined : evaluated.evaluation.execution.error,
    };
  } catch (error) {
    let recoveryError: string | undefined;
    if (candidate && !retainCandidate) {
      try {
        await restoreCandidateWorkingTree(workspaceRoot, candidate);
      } catch (restoreError) {
        recoveryError = restoreError instanceof Error ? restoreError.message : String(restoreError);
      }
    }
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      if (recoveryError) {
        throw new Error(`Autoresearch execution was cancelled, but candidate recovery failed: ${recoveryError}`);
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      error: recoveryError ? `${message} Candidate recovery also failed: ${recoveryError}` : message,
    };
  }
}

async function runLegacyExperiment(
  workspaceRoot: string,
  description: string,
  signal?: AbortSignal
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
    const beforeHook = await runLocalIterationHook(
      workspaceRoot,
      'before.sh',
      config.workingDir,
      timeoutMs,
      signal
    );
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
      signal,
    });
    const output = result.stdout + result.stderr;
    const afterHook = await runLocalIterationHook(
      workspaceRoot,
      'after.sh',
      config.workingDir,
      timeoutMs,
      signal
    );

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

    const checks = await runBackpressureChecks(workspaceRoot, config.workingDir, timeoutMs, signal);
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
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
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
  timeoutMs: number,
  signal?: AbortSignal
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
    signal,
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
  timeoutMs: number,
  signal?: AbortSignal
): Promise<CheckResult> {
  const checksPath = path.join(workspaceRoot, '.auto', 'checks.sh');
  if (!(await fs.pathExists(checksPath))) {
    return { exists: false, passed: true, output: '' };
  }

  const result = await runCommand('bash', ['.auto/checks.sh'], workspaceRoot, {
    directory: workingDir,
    timeout: timeoutMs,
    shell: false,
    signal,
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

  if (config.ledgerVersion && input.attemptId) {
    return logLedgerExperiment(workspaceRoot, config, { ...input, attemptId: input.attemptId });
  }
  if (input.metric === undefined || input.status === undefined) {
    return {
      success: false,
      error: config.ledgerVersion
        ? 'Ledger-backed log_experiment requires attemptId.'
        : 'Legacy log_experiment requires metric and status.',
    };
  }

  return logLegacyExperiment(workspaceRoot, config, {
    ...input,
    metric: input.metric,
    status: input.status,
  });
}

async function logLegacyExperiment(
  workspaceRoot: string,
  config: SessionConfig,
  input: LogExperimentInput & { metric: number; status: ExperimentLogEntry['status'] }
): Promise<LogExperimentResult> {

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

async function logLedgerExperiment(
  workspaceRoot: string,
  config: SessionConfig,
  input: LogExperimentInput & { attemptId: string }
): Promise<LogExperimentResult> {
  const events = await loadLedgerEvents(workspaceRoot);
  const candidate = events.find((event): event is CandidateRecord =>
    event.type === 'candidate' && event.attemptId === input.attemptId
  );
  const decisions = events.filter((event): event is DecisionRecord =>
    event.type === 'decision' && event.attemptId === input.attemptId
  );
  const decision = [...decisions].reverse().find((event) => event.source === 'original')
    ?? decisions.at(-1);
  if (!candidate || !decision) {
    return { success: false, error: `Unknown ledger attempt: ${input.attemptId}` };
  }
  const evaluation = events.find((event): event is EvaluationRecord =>
    event.type === 'evaluation' && event.id === decision.evaluationId
  );
  if (!evaluation) {
    return { success: false, error: `Decision ${decision.id} references a missing evaluation.` };
  }
  const previous = await readLogEntries(workspaceRoot);
  const existing = previous.find((entry) => entry.attemptId === input.attemptId);
  if (existing) {
    return { success: true, summary: `Attempt ${input.attemptId} is already projected as run ${existing.run}: ${existing.status}.` };
  }

  const status = decisionOutcomeToLegacyStatus(decision.outcome);
  const metric = evaluation.aggregates[config.metricName]?.median;
  if (metric === undefined) {
    return { success: false, error: `Evaluation ${evaluation.id} has no ${config.metricName} aggregate.` };
  }
  let materializedCommit: string | undefined;
  if (decision.outcome === 'accepted') {
    if (!input.commit) {
      return {
        success: false,
        error: `Accepted attempt ${input.attemptId} requires its exact Git commit before log_experiment can project it.`,
      };
    }
    try {
      materializedCommit = await verifyMaterializedCommit(workspaceRoot, input.commit);
      await verifyCandidateMaterialization(workspaceRoot, candidate);
      await verifyCandidateCommit(workspaceRoot, candidate, materializedCommit);
      await writeConfigJson(workspaceRoot, { ...config, materializedCommit });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const metrics = Object.fromEntries(Object.entries(evaluation.aggregates)
    .map(([name, aggregate]) => [name, aggregate.median]));
  const entry: ExperimentLogEntry = {
    run: previous.length + 1,
    status,
    metric,
    description: input.description || candidate.description,
    commit: materializedCommit,
    outputExcerpt: input.output === undefined ? undefined : truncateOutputExcerpt(input.output),
    hypothesis: input.hypothesis,
    learned: input.learned,
    nextFocus: input.nextFocus,
    timestamp: new Date().toISOString(),
    attemptId: input.attemptId,
    metrics,
    decision: decision.outcome,
    replayable: await isCandidateReplayable(workspaceRoot, candidate),
    materialized: decision.materialized,
    driftWarnings: evaluation.driftWarnings,
  };
  await appendLogEntry(workspaceRoot, entry);
  await new AutoResearchManager(workspaceRoot).recordLoggedIteration(entry.run);
  return {
    success: true,
    summary: [
      `Recorded run ${entry.run}: ${status} (engine: ${decision.outcome})`,
      `  attempt: ${input.attemptId}`,
      `  description: ${entry.description}`,
      `  metric: ${metric} ${config.metricUnit}`,
      materializedCommit ? `  materialization: ${materializedCommit}` : undefined,
    ].filter((line): line is string => line !== undefined).join('\n'),
  };
}

function normalizeSampling(input?: Partial<ExperimentSamplingConfig>): ExperimentSamplingConfig {
  const minSamples = Number.isInteger(input?.minSamples) && (input?.minSamples ?? 0) > 0
    ? input!.minSamples!
    : DEFAULT_MIN_SAMPLES;
  const maxSamples = Number.isInteger(input?.maxSamples) && (input?.maxSamples ?? 0) > 0
    ? Math.max(minSamples, input!.maxSamples!)
    : DEFAULT_MAX_SAMPLES;
  const confidenceThreshold = Number.isFinite(input?.confidenceThreshold)
    && (input?.confidenceThreshold ?? 0) > 0
    ? input!.confidenceThreshold!
    : DEFAULT_CONFIDENCE_THRESHOLD;
  return { minSamples, maxSamples, confidenceThreshold };
}

function createAbortError(): Error {
  const error = new Error('Autoresearch execution aborted.');
  error.name = 'AbortError';
  return error;
}

async function resetReplayableSessionArtifacts(workspaceRoot: string): Promise<void> {
  const autoDir = path.join(workspaceRoot, '.auto');
  await Promise.all([
    'config.json',
    'prompt.md',
    'measure.sh',
    'checks.sh',
    'log.jsonl',
    'dashboard.html',
    'finalize.md',
    'finalize-branches.json',
    'ledger',
  ].map((entry) => fs.remove(path.join(autoDir, entry))));
}

function validateReplayableConfig(config: SessionConfig): void {
  const objectives = objectivesFromConfig(config);
  const names = new Set<string>();
  for (const objective of objectives) {
    if (!objective.name.trim()) throw new Error('Autoresearch objective names cannot be empty.');
    if (names.has(objective.name)) throw new Error(`Duplicate autoresearch objective: ${objective.name}.`);
    names.add(objective.name);
  }
  for (const constraint of config.constraints ?? []) {
    if (!names.has(constraint.metricName)) {
      throw new Error(`Constraint references unknown objective ${constraint.metricName}.`);
    }
    if (!Number.isFinite(constraint.threshold)) {
      throw new Error(`Constraint ${constraint.metricName} threshold must be finite.`);
    }
  }
  samplingFromConfig(config);
  if (
    config.retention?.maxArtifactBytes !== undefined
    && (!Number.isFinite(config.retention.maxArtifactBytes) || config.retention.maxArtifactBytes < 0)
  ) {
    throw new Error('maxArtifactBytes must be a non-negative finite number.');
  }
  if (
    config.retention?.maxArtifactAgeDays !== undefined
    && (!Number.isFinite(config.retention.maxArtifactAgeDays) || config.retention.maxArtifactAgeDays < 0)
  ) {
    throw new Error('maxArtifactAgeDays must be a non-negative finite number.');
  }
}

function findLatestMaterializedEvaluation(events: LedgerEvent[]): EvaluationRecord | undefined {
  const decisions = events.filter((event): event is DecisionRecord =>
    event.type === 'decision'
    && event.source === 'original'
    && event.outcome === 'accepted'
    && event.materialized
  );
  for (const decision of decisions.reverse()) {
    const evaluation = events.find((event): event is EvaluationRecord =>
      event.type === 'evaluation' && event.id === decision.evaluationId
    );
    if (evaluation) return evaluation;
  }
  return undefined;
}

async function assertAcceptedLineageAdvanced(
  workspaceRoot: string,
  config: SessionConfig,
  events: LedgerEvent[]
): Promise<void> {
  const latestAccepted = [...events].reverse().find((event): event is DecisionRecord =>
    event.type === 'decision' && event.source === 'original' && event.outcome === 'accepted'
  );
  if (!latestAccepted) return;
  const candidate = events.find((event): event is CandidateRecord =>
    event.type === 'candidate' && event.attemptId === latestAccepted.attemptId
  );
  if (!candidate || candidate.context.baseline === true) return;
  const projected = (await readLogEntries(workspaceRoot)).find((entry) =>
    entry.attemptId === latestAccepted.attemptId && entry.commit
  );
  if (!projected?.commit || config.materializedCommit !== projected.commit) {
    throw new Error(
      `Accepted attempt ${latestAccepted.attemptId} must be committed and recorded with log_experiment before another candidate can run.`
    );
  }
}

function executionOutcomeToDecision(evaluation: EvaluationRecord): DecisionRecord['outcome'] {
  switch (evaluation.execution.outcome) {
    case 'checks_failed': return 'checks_failed';
    case 'benchmark_failed':
    case 'cancelled': return 'crashed';
    case 'passed': return 'inconclusive';
  }
}

function decisionOutcomeToLegacyStatus(outcome: DecisionRecord['outcome']): ExperimentLogEntry['status'] {
  switch (outcome) {
    case 'accepted': return 'kept';
    case 'rejected':
    case 'inconclusive': return 'discarded';
    case 'checks_failed': return 'checks_failed';
    case 'crashed': return 'crashed';
  }
}

async function requireMeasureScript(workspaceRoot: string): Promise<string> {
  const script = await readMeasureSh(workspaceRoot);
  if (script === null) throw new Error('No .auto/measure.sh script found. Run init_experiment first.');
  return script;
}

async function readOptionalScript(scriptPath: string): Promise<string | undefined> {
  return fs.readFile(scriptPath, 'utf8').catch(() => undefined);
}

function formatLedgerRunOutput(
  description: string,
  evaluated: Awaited<ReturnType<typeof evaluateWorkspace>>,
  decision: DecisionRecord
): string {
  const metricLines = Object.entries(evaluated.evaluation.aggregates)
    .map(([name, aggregate]) => `  ${name}: median ${aggregate.median}, MAD ${aggregate.mad}, samples ${aggregate.sampleCount}`);
  return [
    `Experiment: ${description}`,
    `Attempt: ${decision.attemptId}`,
    `Decision: ${decision.outcome}`,
    `Confidence: ${decision.confidence}`,
    decision.explanation,
    'Metrics:',
    ...metricLines,
    evaluated.output ? `\nBenchmark output:\n${evaluated.output}` : '',
  ].filter(Boolean).join('\n');
}

async function verifyMaterializedCommit(workspaceRoot: string, commit: string): Promise<string> {
  if (!/^[a-f0-9]{7,64}$/i.test(commit)) {
    throw new Error(`Invalid materialized commit ${commit}: expected a hexadecimal commit hash.`);
  }
  const resolved = await runCommand('git', ['rev-parse', '--verify', `${commit}^{commit}`], workspaceRoot, { shell: false });
  if (resolved.code !== 0) throw new Error(`Invalid materialized commit ${commit}: ${resolved.stderr || resolved.stdout}`);
  const head = await runCommand('git', ['rev-parse', '--verify', 'HEAD'], workspaceRoot, { shell: false });
  const normalized = resolved.stdout.trim();
  if (head.stdout.trim() !== normalized) {
    throw new Error(`Accepted attempt commit ${normalized} is not the current HEAD ${head.stdout.trim()}.`);
  }
  return normalized;
}

async function verifyCandidateMaterialization(
  workspaceRoot: string,
  candidate: CandidateRecord
): Promise<void> {
  const status = await runCommand('git', [
    'status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).auto',
  ], workspaceRoot, { shell: false });
  if (status.code !== 0 || status.stdout.trim()) {
    throw new Error(
      `Accepted attempt ${candidate.attemptId} must be committed with a clean working tree before log_experiment. ${status.stderr || status.stdout}`.trim()
    );
  }
}

async function isCandidateReplayable(workspaceRoot: string, candidate: CandidateRecord): Promise<boolean> {
  const store = new LedgerStore(workspaceRoot);
  for (const objectId of candidateReplayObjectIds(candidate)) {
    if (!(await fs.pathExists(store.objectPath(objectId)))) return false;
  }
  return true;
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
