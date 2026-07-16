/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import fs from 'fs-extra';
import {
  applyCandidateToWorktree,
  candidateReplayObjectIds,
  createEnvironmentFingerprint,
} from './candidate.js';
import { evaluateWorkspace, objectivesFromConfig } from './evaluator.js';
import {
  LedgerStore,
  type ArtifactPrunedRecord,
  type CandidateRecord,
  type DecisionRecord,
  type EnvironmentFingerprint,
  type EvaluationRecord,
  type LedgerEvent,
} from './ledger.js';
import { readConfigJson, readMeasureSh, type SessionConfig } from './session.js';
import { createPersistedDecision } from './decisionRecord.js';

const execFileAsync = promisify(execFile);

export interface ReplayExperimentOptions {
  evaluator?: 'original' | 'current';
  signal?: AbortSignal;
}

export interface ReplayExperimentResult {
  success: boolean;
  attemptId?: string;
  evaluatorMode?: 'original' | 'current';
  metrics?: Record<string, number>;
  samples?: EvaluationRecord['samples'];
  decision?: DecisionRecord;
  driftWarnings?: string[];
  error?: string;
}

interface ReplayEvaluator {
  config: SessionConfig;
  measureScript: string;
  checksScript?: string;
  beforeHookScript?: string;
  afterHookScript?: string;
}

export async function replayExperiment(
  workspaceRoot: string,
  attemptId: string,
  options: ReplayExperimentOptions = {}
): Promise<ReplayExperimentResult> {
  const requestedEvaluator: unknown = options.evaluator;
  if (requestedEvaluator !== undefined
    && requestedEvaluator !== 'original'
    && requestedEvaluator !== 'current') {
    return {
      success: false,
      attemptId,
      error: 'Replay evaluator must be original or current.',
    };
  }
  const evaluatorMode = requestedEvaluator ?? 'original';
  const store = new LedgerStore(workspaceRoot);
  let temporaryWorktree: string | undefined;
  try {
    const events = await store.load();
    const candidate = events.find((event): event is CandidateRecord =>
      event.type === 'candidate' && event.attemptId === attemptId
    );
    if (!candidate) return { success: false, attemptId, evaluatorMode, error: `Unknown ledger attempt: ${attemptId}` };
    const replayObjects = new Set(candidateReplayObjectIds(candidate));
    const prunedObjects = new Set(events
      .filter((event): event is ArtifactPrunedRecord =>
        event.type === 'artifact_pruned'
      )
      .flatMap((event) => event.objects)
      .filter((objectId) => replayObjects.has(objectId)));
    if (prunedObjects.size > 0) {
      return {
        success: false,
        attemptId,
        evaluatorMode,
        error: `Attempt ${attemptId} is no longer replayable because ${prunedObjects.size} artifact object(s) were pruned.`,
      };
    }
    const evaluator = evaluatorMode === 'original'
      ? await readOriginalEvaluator(store, candidate)
      : await readCurrentEvaluator(workspaceRoot);
    validateReplayWorkingDirectory(evaluator.config.workingDir);

    temporaryWorktree = await allocateWorktreePath();
    await runGit(workspaceRoot, ['worktree', 'add', '--detach', temporaryWorktree, candidate.baseCommit]);
    await applyCandidateToWorktree(temporaryWorktree, candidate, store);
    const paths = await writeReplayEvaluator(temporaryWorktree, evaluator);
    const currentEnvironment = await createEnvironmentFingerprint(temporaryWorktree, {
      measure: evaluator.measureScript,
      ...(evaluator.checksScript === undefined ? {} : { checks: evaluator.checksScript }),
      ...(evaluator.beforeHookScript === undefined ? {} : { beforeHook: evaluator.beforeHookScript }),
      ...(evaluator.afterHookScript === undefined ? {} : { afterHook: evaluator.afterHookScript }),
    }, evaluator.config.environmentAllowlist ?? []);
    const driftWarnings = compareEnvironment(candidate.environment, currentEnvironment);
    const reference = findReferenceEvaluation(events, candidate.parentAttemptId);
    const objectiveNames = objectivesFromConfig(evaluator.config).map((objective) => objective.name);
    const compatibleReference = reference
      && objectiveNames.every((name) => reference.aggregates[name] !== undefined)
      ? reference.aggregates
      : undefined;
    if (!compatibleReference) {
      driftWarnings.push('Current objective set has no compatible materialized reference evaluation.');
    }
    const evaluated = await evaluateWorkspace({
      workspaceRoot: temporaryWorktree,
      attemptId,
      config: evaluator.config,
      paths,
      store,
      evaluatorMode,
      referenceAggregates: compatibleReference,
      driftWarnings,
      signal: options.signal,
      context: { replay: true },
    });
    const execution = evaluated.evaluation.execution;
    const engine = evaluated.provisionalDecision;
    const outcome: DecisionRecord['outcome'] = execution.outcome !== 'passed'
      ? execution.outcome === 'checks_failed' ? 'checks_failed' : 'crashed'
      : engine && engine.outcome !== 'sampling'
        ? engine.outcome
        : 'inconclusive';
    const decision = createPersistedDecision({
      attemptId,
      evaluation: evaluated.evaluation,
      source: 'replay',
      outcome,
      materialized: false,
      primaryImprovement: engine?.primaryImprovement ?? 0,
      confidence: engine?.confidence ?? 0,
      constraintResults: engine?.constraintResults ?? [],
      explanation: engine?.explanation ?? execution.error ?? 'Replay has no compatible reference and is advisory.',
      context: { evaluatorMode },
    });
    await store.append(decision);
    if (options.signal?.aborted) {
      const error = new Error('Autoresearch replay aborted.');
      error.name = 'AbortError';
      throw error;
    }
    const metrics = Object.fromEntries(Object.entries(evaluated.evaluation.aggregates)
      .map(([name, aggregate]) => [name, aggregate.median]));
    return {
      success: execution.outcome === 'passed' || execution.outcome === 'checks_failed',
      attemptId,
      evaluatorMode,
      metrics,
      samples: evaluated.evaluation.samples,
      decision,
      driftWarnings,
      error: execution.outcome === 'passed' ? undefined : execution.error,
    };
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    return {
      success: false,
      attemptId,
      evaluatorMode,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (temporaryWorktree) {
      await removeReplayWorktree(workspaceRoot, temporaryWorktree);
    }
  }
}

async function readOriginalEvaluator(store: LedgerStore, candidate: CandidateRecord): Promise<ReplayEvaluator> {
  const configJson = (await store.readObject(candidate.evaluator.configObject)).toString('utf8');
  const parsed = JSON.parse(configJson) as SessionConfig;
  if (!parsed || typeof parsed.metricName !== 'string' || typeof parsed.direction !== 'string') {
    throw new Error(`Candidate ${candidate.attemptId} contains an invalid frozen evaluator config.`);
  }
  return {
    config: parsed,
    measureScript: (await store.readObject(candidate.evaluator.measureObject)).toString('utf8'),
    checksScript: candidate.evaluator.checksObject
      ? (await store.readObject(candidate.evaluator.checksObject)).toString('utf8')
      : undefined,
    beforeHookScript: candidate.evaluator.beforeHookObject
      ? (await store.readObject(candidate.evaluator.beforeHookObject)).toString('utf8')
      : undefined,
    afterHookScript: candidate.evaluator.afterHookObject
      ? (await store.readObject(candidate.evaluator.afterHookObject)).toString('utf8')
      : undefined,
  };
}

async function readCurrentEvaluator(workspaceRoot: string): Promise<ReplayEvaluator> {
  const config = await readConfigJson(workspaceRoot);
  const measureScript = await readMeasureSh(workspaceRoot);
  if (!config || !measureScript) throw new Error('Current autoresearch evaluator is not configured.');
  return {
    config,
    measureScript,
    checksScript: await readOptional(path.join(workspaceRoot, '.auto', 'checks.sh')),
    beforeHookScript: await readOptional(path.join(workspaceRoot, '.auto', 'hooks', 'before.sh')),
    afterHookScript: await readOptional(path.join(workspaceRoot, '.auto', 'hooks', 'after.sh')),
  };
}

async function writeReplayEvaluator(worktreeRoot: string, evaluator: ReplayEvaluator): Promise<{
  measurePath: string;
  checksPath?: string;
  beforeHookPath?: string;
  afterHookPath?: string;
}> {
  const autoDir = path.join(worktreeRoot, '.auto');
  await fs.ensureDir(path.join(autoDir, 'hooks'));
  const measurePath = path.join(autoDir, 'measure.sh');
  await fs.writeFile(measurePath, evaluator.measureScript, { mode: 0o700 });
  const result: {
    measurePath: string;
    checksPath?: string;
    beforeHookPath?: string;
    afterHookPath?: string;
  } = { measurePath };
  if (evaluator.checksScript !== undefined) {
    result.checksPath = path.join(autoDir, 'checks.sh');
    await fs.writeFile(result.checksPath, evaluator.checksScript, { mode: 0o700 });
  }
  if (evaluator.beforeHookScript !== undefined) {
    result.beforeHookPath = path.join(autoDir, 'hooks', 'before.sh');
    await fs.writeFile(result.beforeHookPath, evaluator.beforeHookScript, { mode: 0o700 });
  }
  if (evaluator.afterHookScript !== undefined) {
    result.afterHookPath = path.join(autoDir, 'hooks', 'after.sh');
    await fs.writeFile(result.afterHookPath, evaluator.afterHookScript, { mode: 0o700 });
  }
  return result;
}

function findReferenceEvaluation(
  events: LedgerEvent[],
  parentAttemptId: string | null
): EvaluationRecord | undefined {
  if (parentAttemptId) {
    const parentDecision = [...events].reverse().find((event): event is DecisionRecord =>
      event.type === 'decision'
      && event.attemptId === parentAttemptId
      && event.source === 'original'
      && event.outcome === 'accepted'
      && event.materialized
    );
    if (parentDecision) {
      return events.find((event): event is EvaluationRecord =>
        event.type === 'evaluation' && event.id === parentDecision.evaluationId
      );
    }
  }
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

function compareEnvironment(
  original: EnvironmentFingerprint,
  current: EnvironmentFingerprint
): string[] {
  const warnings: string[] = [];
  for (const key of ['platform', 'architecture', 'cliVersion', 'nodeVersion', 'bunVersion', 'gitVersion'] as const) {
    if (original[key] !== current[key]) {
      warnings.push(`Environment ${key} changed: original ${original[key] || '(empty)'}, current ${current[key] || '(empty)'}.`);
    }
  }
  if (JSON.stringify(original.lockfiles) !== JSON.stringify(current.lockfiles)) {
    warnings.push('Environment lockfile hashes changed.');
  }
  if (JSON.stringify(original.evaluators) !== JSON.stringify(current.evaluators)) {
    warnings.push('Evaluator scripts changed from the frozen candidate snapshot.');
  }
  if (JSON.stringify(original.allowedEnvironment) !== JSON.stringify(current.allowedEnvironment)) {
    warnings.push('Allowlisted environment values changed; original values were not restored.');
  }
  return warnings;
}

function validateReplayWorkingDirectory(workingDir: string | undefined): void {
  if (!workingDir) return;
  if (path.isAbsolute(workingDir) || workingDir.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe replay evaluator workingDir: ${workingDir}`);
  }
}

async function allocateWorktreePath(): Promise<string> {
  const placeholder = await fs.mkdtemp(path.join(os.tmpdir(), 'autoresearch-replay-worktree-'));
  await fs.remove(placeholder);
  return placeholder;
}

async function removeReplayWorktree(repositoryRoot: string, worktreePath: string): Promise<void> {
  try {
    await runGit(repositoryRoot, ['worktree', 'remove', '--force', worktreePath]);
  } catch {
    await fs.remove(worktreePath);
    await runGit(repositoryRoot, ['worktree', 'prune']).catch(() => '');
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    return (await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 })).stdout;
  } catch (error) {
    const details = error as Error & { stderr?: string; stdout?: string };
    throw new Error((details.stderr || details.stdout || details.message).trim());
  }
}

function readOptional(filePath: string): Promise<string | undefined> {
  return fs.readFile(filePath, 'utf8').catch(() => undefined);
}
