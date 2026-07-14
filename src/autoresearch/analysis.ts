/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import { candidateReplayObjectIds } from './candidate.js';
import {
  computeParetoAttemptIds,
  decideEvaluation,
  evaluateConstraints,
} from './decision.js';
import { createPersistedDecision } from './decisionRecord.js';
import { objectivesFromConfig, samplingFromConfig } from './evaluator.js';
import {
  LedgerStore,
  createLedgerId,
  type CandidateRecord,
  type DecisionRecord,
  type EvaluationRecord,
  type LedgerEvent,
  type PinRecord,
} from './ledger.js';
import { readConfigJson, readLogEntries } from './session.js';

export type MaterializationState = 'baseline' | 'committed' | 'retained' | 'reverted' | 'none';

export interface AutoresearchHistoryAttempt {
  attemptId: string;
  description: string;
  timestamp: string;
  legacy: boolean;
  replayable: boolean;
  pinned: boolean;
  latestEvaluation?: EvaluationRecord;
  latestDecision?: DecisionRecord;
  materialization: MaterializationState;
}

export interface AutoresearchHistory {
  attempts: AutoresearchHistoryAttempt[];
}

export async function getAutoresearchHistory(workspaceRoot: string): Promise<AutoresearchHistory> {
  const store = new LedgerStore(workspaceRoot);
  const events = await store.load();
  const candidates = events.filter((event): event is CandidateRecord => event.type === 'candidate');
  const attempts: AutoresearchHistoryAttempt[] = [];
  for (const candidate of candidates) {
    const evaluations = events.filter((event): event is EvaluationRecord =>
      event.type === 'evaluation' && event.attemptId === candidate.attemptId
    );
    const decisions = events.filter((event): event is DecisionRecord =>
      event.type === 'decision' && event.attemptId === candidate.attemptId
    );
    const pin = findLatestPin(events, candidate.attemptId);
    const log = (await readLogEntries(workspaceRoot)).find((entry) => entry.attemptId === candidate.attemptId);
    const originalDecision = decisions.find((decision) => decision.source === 'original');
    attempts.push({
      attemptId: candidate.attemptId,
      description: candidate.description,
      timestamp: candidate.timestamp,
      legacy: false,
      replayable: await candidateIsReplayable(store, candidate),
      pinned: pin?.pinned ?? false,
      latestEvaluation: evaluations.at(-1),
      latestDecision: decisions.at(-1),
      materialization: candidate.context.baseline === true
        ? 'baseline'
        : log?.commit
          ? 'committed'
          : originalDecision?.outcome === 'accepted' && originalDecision.materialized
            ? 'retained'
            : originalDecision
              ? 'reverted'
              : 'none',
    });
  }
  const candidateAttemptIds = new Set(candidates.map((candidate) => candidate.attemptId));
  for (const entry of await readLogEntries(workspaceRoot)) {
    if (entry.attemptId && candidateAttemptIds.has(entry.attemptId)) continue;
    attempts.push({
      attemptId: entry.attemptId ?? `legacy-run-${entry.run}`,
      description: entry.description,
      timestamp: entry.timestamp,
      legacy: true,
      replayable: false,
      pinned: false,
      materialization: entry.commit ? 'committed' : entry.status === 'kept' ? 'retained' : 'reverted',
    });
  }
  attempts.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return { attempts };
}

export interface ExperimentComparisonSide {
  attemptId: string;
  samples: EvaluationRecord['samples'];
  aggregates: EvaluationRecord['aggregates'];
  checks: EvaluationRecord['checks'];
  execution: EvaluationRecord['execution'];
  decision?: DecisionRecord;
}

export interface ExperimentComparison {
  left: ExperimentComparisonSide;
  right: ExperimentComparisonSide;
}

export async function compareExperiments(
  workspaceRoot: string,
  leftAttemptId: string,
  rightAttemptId: string
): Promise<ExperimentComparison> {
  const events = await new LedgerStore(workspaceRoot).load();
  return {
    left: comparisonSide(events, leftAttemptId),
    right: comparisonSide(events, rightAttemptId),
  };
}

function comparisonSide(events: LedgerEvent[], attemptId: string): ExperimentComparisonSide {
  const evaluation = [...events].reverse().find((event): event is EvaluationRecord =>
    event.type === 'evaluation' && event.attemptId === attemptId
  );
  if (!evaluation) throw new Error(`Attempt ${attemptId} has no persisted evaluation.`);
  const decision = [...events].reverse().find((event): event is DecisionRecord =>
    event.type === 'decision' && event.attemptId === attemptId
  );
  return {
    attemptId,
    samples: evaluation.samples,
    aggregates: evaluation.aggregates,
    checks: evaluation.checks,
    execution: evaluation.execution,
    decision,
  };
}

export interface RescoreExperimentsOptions {
  attemptId?: string;
  all?: boolean;
}

export async function rescoreExperiments(
  workspaceRoot: string,
  options: RescoreExperimentsOptions
): Promise<{ decisions: DecisionRecord[] }> {
  const config = await readConfigJson(workspaceRoot);
  if (!config?.ledgerVersion) throw new Error('Rescoring requires a replayable autoresearch session.');
  if (!options.all && !options.attemptId) throw new Error('rescore requires an attempt id or --all.');
  const store = new LedgerStore(workspaceRoot);
  const events = await store.load();
  const candidates = events.filter((event): event is CandidateRecord =>
    event.type === 'candidate' && (options.all || event.attemptId === options.attemptId)
  );
  if (candidates.length === 0) throw new Error(`Unknown ledger attempt: ${options.attemptId ?? '(all)'}`);
  const objectives = objectivesFromConfig(config);
  const sampling = samplingFromConfig(config);
  const decisions: DecisionRecord[] = [];

  for (const candidate of candidates) {
    const evaluation = [...events].reverse().find((event): event is EvaluationRecord =>
      event.type === 'evaluation' && event.attemptId === candidate.attemptId
    );
    if (!evaluation) continue;
    const reference = findReferenceEvaluation(events, candidate);
    const originalDecision = events.find((event): event is DecisionRecord =>
      event.type === 'decision' && event.attemptId === candidate.attemptId && event.source === 'original'
    );
    let outcome: DecisionRecord['outcome'];
    let primaryImprovement = 0;
    let confidence = 0;
    let constraintResults: DecisionRecord['constraintResults'] = [];
    let explanation: string;
    if (candidate.context.baseline === true) {
      outcome = evaluation.execution.outcome === 'passed' ? 'accepted' : executionDecision(evaluation);
      explanation = 'Baseline rescored as the materialized reference evaluation.';
    } else if (evaluation.execution.outcome !== 'passed') {
      outcome = executionDecision(evaluation);
      explanation = evaluation.execution.error ?? `Evaluation outcome is ${evaluation.execution.outcome}.`;
    } else if (evaluation.samples.length < sampling.minSamples) {
      outcome = 'inconclusive';
      explanation = `Current policy requires a minimum of ${sampling.minSamples} samples; only ${evaluation.samples.length} samples are stored.`;
    } else if (!reference) {
      outcome = 'inconclusive';
      explanation = 'No compatible materialized reference evaluation is available.';
    } else {
      const engine = decideEvaluation({
        objectives,
        constraints: config.constraints ?? [],
        referenceAggregates: reference.aggregates,
        candidateAggregates: evaluation.aggregates,
        checksPassed: evaluation.checks.passed,
        sampleCount: evaluation.samples.length,
        maxSamples: Math.min(sampling.maxSamples, evaluation.samples.length),
        confidenceThreshold: sampling.confidenceThreshold,
      });
      outcome = engine.outcome === 'sampling' ? 'inconclusive' : engine.outcome;
      primaryImprovement = engine.primaryImprovement;
      confidence = engine.confidence;
      constraintResults = engine.constraintResults;
      explanation = engine.explanation;
    }
    const decision = createPersistedDecision({
      attemptId: candidate.attemptId,
      evaluation,
      source: 'rescore',
      outcome,
      materialized: originalDecision?.materialized ?? false,
      primaryImprovement,
      confidence,
      constraintResults,
      explanation,
      context: { rescoredWithCurrentPolicy: true },
    });
    await store.append(decision);
    decisions.push(decision);
  }
  return { decisions };
}

export async function getParetoExperiments(
  workspaceRoot: string
): Promise<{ attemptIds: string[] }> {
  const config = await readConfigJson(workspaceRoot);
  if (!config?.ledgerVersion) return { attemptIds: [] };
  const events = await new LedgerStore(workspaceRoot).load();
  const objectives = objectivesFromConfig(config);
  const sampling = samplingFromConfig(config);
  const candidates = events.filter((event): event is CandidateRecord => event.type === 'candidate');
  const paretoCandidates = candidates.flatMap((candidate) => {
    const evaluation = [...events].reverse().find((event): event is EvaluationRecord =>
      event.type === 'evaluation' && event.attemptId === candidate.attemptId
    );
    const decision = [...events].reverse().find((event): event is DecisionRecord =>
      event.type === 'decision' && event.attemptId === candidate.attemptId
    );
    if (!evaluation || !decision || evaluation.execution.outcome !== 'passed') return [];
    const constraintPassing = evaluateConstraints(
      config.constraints ?? [],
      evaluation.aggregates,
      sampling.confidenceThreshold
    ).every((result) => result.passed && result.conclusive);
    return [{
      attemptId: candidate.attemptId,
      constraintPassing,
      metrics: Object.fromEntries(Object.entries(evaluation.aggregates)
        .map(([name, aggregate]) => [name, aggregate.median])),
    }];
  });
  return { attemptIds: computeParetoAttemptIds(paretoCandidates, objectives) };
}

export async function pinExperiment(
  workspaceRoot: string,
  attemptId: string,
  pinned: boolean
): Promise<PinRecord> {
  const store = new LedgerStore(workspaceRoot);
  const events = await store.load();
  if (!events.some((event) => event.type === 'candidate' && event.attemptId === attemptId)) {
    throw new Error(`Unknown ledger attempt: ${attemptId}`);
  }
  const event: PinRecord = {
    schemaVersion: 1,
    type: 'pin',
    id: createLedgerId('event'),
    attemptId,
    timestamp: new Date().toISOString(),
    context: {},
    pinned,
  };
  await store.append(event);
  return event;
}

export interface PruneArtifactCandidate {
  attemptId: string;
  objects: string[];
  bytes: number;
  protected: boolean;
  reason: string;
}

export interface PruneArtifactsOptions {
  dryRun?: boolean;
  includeProtected?: boolean;
}

export interface PruneArtifactsResult {
  applied: boolean;
  candidates: PruneArtifactCandidate[];
  bytesFreed: number;
  remainingBytes: number;
}

export async function pruneArtifacts(
  workspaceRoot: string,
  options: PruneArtifactsOptions = {}
): Promise<PruneArtifactsResult> {
  const config = await readConfigJson(workspaceRoot);
  const store = new LedgerStore(workspaceRoot);
  const events = await store.load();
  const candidates = events.filter((event): event is CandidateRecord => event.type === 'candidate');
  const objectsByAttempt = new Map(candidates.map((candidate) => [
    candidate.attemptId,
    referencedObjects(events, candidate),
  ]));
  const attemptsByObject = new Map<string, Set<string>>();
  for (const [attemptId, objects] of objectsByAttempt) {
    for (const objectId of objects) {
      const attempts = attemptsByObject.get(objectId) ?? new Set<string>();
      attempts.add(attemptId);
      attemptsByObject.set(objectId, attempts);
    }
  }
  const sizes = new Map<string, number>();
  for (const objectId of attemptsByObject.keys()) {
    const stats = await fs.stat(store.objectPath(objectId)).catch(() => null);
    if (stats?.isFile()) sizes.set(objectId, stats.size);
  }
  const totalBytes = [...sizes.values()].reduce((total, size) => total + size, 0);
  const maxBytes = config?.retention?.maxArtifactBytes;
  const maxAgeDays = config?.retention?.maxArtifactAgeDays;
  if (maxBytes === undefined && maxAgeDays === undefined) {
    return { applied: false, candidates: [], bytesFreed: 0, remainingBytes: totalBytes };
  }
  const ageCutoff = maxAgeDays === undefined
    ? undefined
    : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const selectable = candidates
    .map((candidate) => {
      const pinned = findLatestPin(events, candidate.attemptId)?.pinned ?? false;
      const originalDecision = events.find((event): event is DecisionRecord =>
        event.type === 'decision' && event.attemptId === candidate.attemptId && event.source === 'original'
      );
      const protectedArtifact = pinned || originalDecision?.outcome === 'accepted';
      return { candidate, protectedArtifact };
    })
    .filter(({ protectedArtifact, candidate }) =>
      (options.includeProtected === true || !protectedArtifact)
      && (options.includeProtected === true || isAutomaticallyPrunable(events, candidate.attemptId))
    )
    .sort((left, right) => left.candidate.timestamp.localeCompare(right.candidate.timestamp));

  const selected = new Set<string>();
  const plannedObjects = new Set<string>();
  const plans: PruneArtifactCandidate[] = [];
  let projectedBytes = totalBytes;
  for (const { candidate, protectedArtifact } of selectable) {
    const expired = ageCutoff !== undefined && new Date(candidate.timestamp).getTime() <= ageCutoff;
    const overBudget = maxBytes !== undefined && projectedBytes > maxBytes;
    if (!expired && !overBudget) continue;
    selected.add(candidate.attemptId);
    const deletable = [...(objectsByAttempt.get(candidate.attemptId) ?? [])].filter((objectId) => {
      const references = attemptsByObject.get(objectId) ?? new Set<string>();
      return sizes.has(objectId)
        && [...references].every((attemptId) => selected.has(attemptId))
        && !plannedObjects.has(objectId);
    });
    for (const objectId of deletable) plannedObjects.add(objectId);
    const bytes = deletable.reduce((total, objectId) => total + (sizes.get(objectId) ?? 0), 0);
    projectedBytes = Math.max(0, projectedBytes - bytes);
    plans.push({
      attemptId: candidate.attemptId,
      objects: deletable,
      bytes,
      protected: protectedArtifact,
      reason: expired ? 'artifact age limit exceeded' : 'artifact byte limit exceeded',
    });
  }

  const accountedObjects = new Set<string>();
  const actionablePlans = plans.map((plan) => {
    const impactedObjects = [...(objectsByAttempt.get(plan.attemptId) ?? [])]
      .filter((objectId) => plannedObjects.has(objectId));
    const newlyAccounted = impactedObjects.filter((objectId) => !accountedObjects.has(objectId));
    for (const objectId of newlyAccounted) accountedObjects.add(objectId);
    return {
      ...plan,
      objects: impactedObjects,
      bytes: newlyAccounted.reduce((total, objectId) => total + (sizes.get(objectId) ?? 0), 0),
    };
  }).filter((plan) => plan.objects.length > 0);
  const dryRun = options.dryRun !== false;
  if (!dryRun) {
    const deletedObjects = new Set<string>();
    for (const plan of actionablePlans) {
      for (const objectId of plan.objects) {
        if (deletedObjects.has(objectId)) continue;
        await fs.remove(store.objectPath(objectId));
        deletedObjects.add(objectId);
      }
      await store.append({
        schemaVersion: 1,
        type: 'artifact_pruned',
        id: createLedgerId('event'),
        attemptId: plan.attemptId,
        timestamp: new Date().toISOString(),
        context: { protected: plan.protected },
        objects: plan.objects,
        bytesFreed: plan.bytes,
        reason: plan.reason,
      });
    }
  }
  return {
    applied: !dryRun,
    candidates: actionablePlans,
    bytesFreed: actionablePlans.reduce((total, plan) => total + plan.bytes, 0),
    remainingBytes: projectedBytes,
  };
}

async function candidateIsReplayable(store: LedgerStore, candidate: CandidateRecord): Promise<boolean> {
  for (const objectId of requiredReplayObjects(candidate)) {
    try {
      await store.readObject(objectId);
    } catch {
      return false;
    }
  }
  return true;
}

function requiredReplayObjects(candidate: CandidateRecord): string[] {
  return candidateReplayObjectIds(candidate);
}

function referencedObjects(events: LedgerEvent[], candidate: CandidateRecord): Set<string> {
  const objects = new Set(requiredReplayObjects(candidate));
  for (const evaluation of events.filter((event): event is EvaluationRecord =>
    event.type === 'evaluation' && event.attemptId === candidate.attemptId
  )) {
    for (const sample of evaluation.samples) objects.add(sample.outputObject);
    if (evaluation.checks.outputObject) objects.add(evaluation.checks.outputObject);
    if (evaluation.execution.outputObject) objects.add(evaluation.execution.outputObject);
  }
  return objects;
}

function findLatestPin(events: LedgerEvent[], attemptId: string): PinRecord | undefined {
  return [...events].reverse().find((event): event is PinRecord =>
    event.type === 'pin' && event.attemptId === attemptId
  );
}

function findReferenceEvaluation(
  events: LedgerEvent[],
  candidate: CandidateRecord
): EvaluationRecord | undefined {
  const referenceAttemptId = candidate.parentAttemptId;
  if (!referenceAttemptId) return undefined;
  const decision = [...events].reverse().find((event): event is DecisionRecord =>
    event.type === 'decision'
    && event.attemptId === referenceAttemptId
    && event.source === 'original'
    && event.outcome === 'accepted'
    && event.materialized
  );
  if (!decision) return undefined;
  return events.find((event): event is EvaluationRecord =>
    event.type === 'evaluation' && event.id === decision.evaluationId
  );
}

function executionDecision(evaluation: EvaluationRecord): DecisionRecord['outcome'] {
  return evaluation.execution.outcome === 'checks_failed' ? 'checks_failed' : 'crashed';
}

function isAutomaticallyPrunable(events: LedgerEvent[], attemptId: string): boolean {
  const originalDecision = events.find((event): event is DecisionRecord =>
    event.type === 'decision' && event.attemptId === attemptId && event.source === 'original'
  );
  return originalDecision?.outcome === 'rejected' || originalDecision?.outcome === 'inconclusive';
}
