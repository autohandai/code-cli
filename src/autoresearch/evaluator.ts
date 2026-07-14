/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'fs-extra';
import { runCommand } from '../actions/command.js';
import {
  aggregateMetricSamples,
  decideEvaluation,
  type DecisionObjective,
  type EngineDecision,
} from './decision.js';
import {
  EvaluationRecordSchema,
  createLedgerId,
  type EvaluationRecord,
  type LedgerStore,
  type MetricAggregate,
} from './ledger.js';
import type { SessionConfig } from './session.js';

export const DEFAULT_MIN_SAMPLES = 3;
export const DEFAULT_MAX_SAMPLES = 9;
export const DEFAULT_CONFIDENCE_THRESHOLD = 2;

export interface EvaluatorPaths {
  measurePath: string;
  checksPath?: string;
  beforeHookPath?: string;
  afterHookPath?: string;
}

export interface EvaluateWorkspaceInput {
  workspaceRoot: string;
  attemptId: string;
  config: SessionConfig;
  paths: EvaluatorPaths;
  store: LedgerStore;
  evaluatorMode: 'original' | 'current';
  referenceAggregates?: Record<string, MetricAggregate>;
  driftWarnings?: string[];
  signal?: AbortSignal;
  context?: Record<string, string | number | boolean | null>;
}

export interface EvaluateWorkspaceResult {
  evaluation: EvaluationRecord;
  provisionalDecision?: EngineDecision;
  output: string;
}

export function objectivesFromConfig(config: SessionConfig): DecisionObjective[] {
  return [
    {
      name: config.metricName,
      unit: config.metricUnit,
      direction: config.direction,
      primary: true,
    },
    ...(config.secondaryObjectives ?? []).map((objective) => ({
      ...objective,
      primary: false,
    })),
  ];
}

export function samplingFromConfig(config: SessionConfig): Required<NonNullable<SessionConfig['sampling']>> {
  const minSamples = normalizePositiveInteger(config.sampling?.minSamples, DEFAULT_MIN_SAMPLES);
  const maxSamples = Math.max(
    minSamples,
    normalizePositiveInteger(config.sampling?.maxSamples, DEFAULT_MAX_SAMPLES)
  );
  const confidenceThreshold = Number.isFinite(config.sampling?.confidenceThreshold)
    && (config.sampling?.confidenceThreshold ?? 0) > 0
    ? config.sampling!.confidenceThreshold
    : DEFAULT_CONFIDENCE_THRESHOLD;
  return { minSamples, maxSamples, confidenceThreshold };
}

export async function evaluateWorkspace(input: EvaluateWorkspaceInput): Promise<EvaluateWorkspaceResult> {
  const objectives = objectivesFromConfig(input.config);
  validateObjectives(objectives);
  const sampling = samplingFromConfig(input.config);
  const samples: EvaluationRecord['samples'] = [];
  const sampleMetrics: Array<Record<string, number>> = [];
  const outputs: string[] = [];
  let provisionalDecision: EngineDecision | undefined;

  for (let sequence = 1; sequence <= sampling.maxSamples; sequence += 1) {
    try {
      await runOptionalHook(input, input.paths.beforeHookPath, 'before');
      const startedAt = Date.now();
      const result = await runCommand('bash', [input.paths.measurePath], input.workspaceRoot, {
        directory: input.config.workingDir,
        timeout: normalizeTimeout(input.config.timeoutMs),
        signal: input.signal,
        shell: false,
      });
      const durationMs = Date.now() - startedAt;
      const output = result.stdout + result.stderr;
      outputs.push(output);
      if (isTimeoutResult(result)) {
        return persistFailedEvaluation(input, samples, sampleMetrics, outputs,
          `Benchmark timed out after ${normalizeTimeout(input.config.timeoutMs)}ms.`);
      }
      if (result.code !== 0) {
        return persistFailedEvaluation(input, samples, sampleMetrics, outputs,
          `Benchmark failed with exit code ${result.code}: ${result.stderr || result.stdout}`);
      }
      const metrics = parseObjectiveMetrics(output, objectives);
      sampleMetrics.push(metrics);
      samples.push({
        sequence,
        metrics,
        outputObject: await input.store.putObject(output),
        durationMs,
        timestamp: new Date().toISOString(),
      });
      await runOptionalHook(input, input.paths.afterHookPath, 'after');
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        const evaluation = await persistExecutionEvaluation(input, samples, sampleMetrics, {
          outcome: 'cancelled',
          error: 'Benchmark execution was cancelled.',
        });
        return { evaluation, output: outputs.join('\n\n') };
      }
      const message = error instanceof Error ? error.message : String(error);
      return persistFailedEvaluation(input, samples, sampleMetrics, outputs, message);
    }

    if (sequence < sampling.minSamples) continue;
    if (!input.referenceAggregates) break;
    const aggregates = aggregateMetricSamples(sampleMetrics, objectives.map((objective) => objective.name));
    provisionalDecision = decideEvaluation({
      objectives,
      constraints: input.config.constraints ?? [],
      referenceAggregates: input.referenceAggregates,
      candidateAggregates: aggregates,
      checksPassed: true,
      sampleCount: sequence,
      maxSamples: sampling.maxSamples,
      confidenceThreshold: sampling.confidenceThreshold,
    });
    if (provisionalDecision.outcome !== 'sampling') break;
  }

  let checks: EvaluationRecord['checks'];
  try {
    checks = await runChecks(input);
  } catch (error) {
    const cancelled = input.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
    const evaluation = await persistExecutionEvaluation(input, samples, sampleMetrics, {
      outcome: cancelled ? 'cancelled' : 'checks_failed',
      error: cancelled
        ? 'Correctness checks were cancelled.'
        : `Correctness checks could not execute: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { evaluation, provisionalDecision, output: outputs.join('\n\n') };
  }
  const aggregates = aggregateMetricSamples(sampleMetrics, objectives.map((objective) => objective.name));
  if (input.referenceAggregates) {
    provisionalDecision = decideEvaluation({
      objectives,
      constraints: input.config.constraints ?? [],
      referenceAggregates: input.referenceAggregates,
      candidateAggregates: aggregates,
      checksPassed: checks.passed,
      sampleCount: samples.length,
      maxSamples: sampling.maxSamples,
      confidenceThreshold: sampling.confidenceThreshold,
    });
  }
  const evaluation = EvaluationRecordSchema.parse({
    schemaVersion: 1,
    type: 'evaluation',
    id: createLedgerId('event'),
    attemptId: input.attemptId,
    timestamp: new Date().toISOString(),
    context: input.context ?? {},
    evaluatorMode: input.evaluatorMode,
    samples,
    aggregates,
    checks,
    execution: { outcome: checks.passed ? 'passed' : 'checks_failed' },
    driftWarnings: input.driftWarnings ?? [],
  });
  await input.store.append(evaluation);
  return { evaluation, provisionalDecision, output: outputs.join('\n\n') };
}

function validateObjectives(objectives: DecisionObjective[]): void {
  const names = new Set<string>();
  for (const objective of objectives) {
    if (!objective.name.trim()) throw new Error('Autoresearch objective names cannot be empty.');
    if (names.has(objective.name)) throw new Error(`Duplicate autoresearch objective: ${objective.name}.`);
    names.add(objective.name);
  }
}

export function parseObjectiveMetrics(
  output: string,
  objectives: DecisionObjective[]
): Record<string, number> {
  const metrics: Record<string, number> = {};
  const numberPattern = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  for (const objective of objectives) {
    const regex = new RegExp(`METRIC\\s+${escapeRegex(objective.name)}\\s*=\\s*(\\S+)`, 'g');
    const matches = [...output.matchAll(regex)];
    const values = matches
      .map((match) => match[1])
      .filter((value) => new RegExp(`^${numberPattern}$`).test(value))
      .map(Number)
      .filter(Number.isFinite);
    if (matches.length !== 1 || values.length !== 1) {
      throw new Error(
        `Benchmark invocation must emit exactly one finite METRIC ${objective.name}=<number> value; found ${matches.length}.`
      );
    }
    metrics[objective.name] = values[0];
  }
  return metrics;
}

async function runOptionalHook(
  input: EvaluateWorkspaceInput,
  hookPath: string | undefined,
  phase: 'before' | 'after'
): Promise<void> {
  if (!hookPath || !(await fs.pathExists(hookPath))) return;
  const result = await runCommand('bash', [hookPath], input.workspaceRoot, {
    directory: input.config.workingDir,
    timeout: normalizeTimeout(input.config.timeoutMs),
    signal: input.signal,
    shell: false,
    env: {
      AUTO_RESEARCH_WORKSPACE: input.workspaceRoot,
      AUTO_RESEARCH_HOOK: phase,
    },
  });
  if (result.code !== 0) {
    throw new Error(`Auto-research ${phase} hook failed with exit code ${result.code}: ${result.stderr || result.stdout}`);
  }
}

async function runChecks(input: EvaluateWorkspaceInput): Promise<EvaluationRecord['checks']> {
  if (!input.paths.checksPath || !(await fs.pathExists(input.paths.checksPath))) {
    return { passed: true };
  }
  const result = await runCommand('bash', [input.paths.checksPath], input.workspaceRoot, {
    directory: input.config.workingDir,
    timeout: normalizeTimeout(input.config.timeoutMs),
    signal: input.signal,
    shell: false,
  });
  const output = result.stdout + result.stderr;
  return {
    passed: result.code === 0,
    outputObject: await input.store.putObject(output),
  };
}

async function persistFailedEvaluation(
  input: EvaluateWorkspaceInput,
  samples: EvaluationRecord['samples'],
  sampleMetrics: Array<Record<string, number>>,
  outputs: string[],
  error: string
): Promise<EvaluateWorkspaceResult> {
  const output = outputs.join('\n\n');
  const evaluation = await persistExecutionEvaluation(input, samples, sampleMetrics, {
    outcome: 'benchmark_failed',
    error,
    ...(output ? { outputObject: await input.store.putObject(output) } : {}),
  });
  return { evaluation, output };
}

async function persistExecutionEvaluation(
  input: EvaluateWorkspaceInput,
  samples: EvaluationRecord['samples'],
  sampleMetrics: Array<Record<string, number>>,
  execution: EvaluationRecord['execution']
): Promise<EvaluationRecord> {
  const evaluation = EvaluationRecordSchema.parse({
    schemaVersion: 1,
    type: 'evaluation',
    id: createLedgerId('event'),
    attemptId: input.attemptId,
    timestamp: new Date().toISOString(),
    context: input.context ?? {},
    evaluatorMode: input.evaluatorMode,
    samples,
    aggregates: sampleMetrics.length === 0
      ? {}
      : aggregateMetricSamples(sampleMetrics, objectivesFromConfig(input.config).map((objective) => objective.name)),
    checks: { passed: false },
    execution,
    driftWarnings: input.driftWarnings ?? [],
  });
  await input.store.append(evaluation);
  return evaluation;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function normalizeTimeout(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value!) : 10 * 60 * 1000;
}

function isTimeoutResult(result: { code: number | null; signal?: NodeJS.Signals | null }): boolean {
  return result.code === null && result.signal === 'SIGTERM';
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function evaluatorPathsForWorkspace(workspaceRoot: string): EvaluatorPaths {
  const autoDir = path.join(workspaceRoot, '.auto');
  return {
    measurePath: path.join(autoDir, 'measure.sh'),
    checksPath: path.join(autoDir, 'checks.sh'),
    beforeHookPath: path.join(autoDir, 'hooks', 'before.sh'),
    afterHookPath: path.join(autoDir, 'hooks', 'after.sh'),
  };
}
