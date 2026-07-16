/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConstraintResult, MetricAggregate } from './ledger.js';
import type { OptimizationDirection } from './session.js';

export interface DecisionObjective {
  name: string;
  unit: string;
  direction: OptimizationDirection;
  primary: boolean;
}

export interface HardConstraint {
  metricName: string;
  operator: '<' | '<=' | '>' | '>=';
  threshold: number;
}

export interface DecisionEngineInput {
  objectives: DecisionObjective[];
  constraints: HardConstraint[];
  referenceAggregates: Record<string, MetricAggregate>;
  candidateAggregates: Record<string, MetricAggregate>;
  checksPassed: boolean;
  sampleCount: number;
  maxSamples: number;
  confidenceThreshold: number;
}

export type EngineDecisionOutcome =
  | 'sampling'
  | 'accepted'
  | 'rejected'
  | 'inconclusive'
  | 'checks_failed';

export interface EngineDecision {
  outcome: EngineDecisionOutcome;
  primaryImprovement: number;
  confidence: number;
  constraintResults: ConstraintResult[];
  explanation: string;
}

const ROBUST_EPSILON = 1e-12;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function medianAbsoluteDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function aggregateMetricSamples(
  samples: Array<Record<string, number>>,
  objectiveNames: string[]
): Record<string, MetricAggregate> {
  return Object.fromEntries(objectiveNames.map((name) => {
    const values = samples.map((sample) => sample[name]);
    return [name, {
      median: median(values),
      mad: medianAbsoluteDeviation(values),
      sampleCount: values.length,
    }];
  }));
}

export function decideEvaluation(input: DecisionEngineInput): EngineDecision {
  const primary = input.objectives.find((objective) => objective.primary);
  if (!primary) throw new Error('Autoresearch policy requires exactly one primary objective.');
  const reference = input.referenceAggregates[primary.name];
  const candidate = input.candidateAggregates[primary.name];
  if (!reference || !candidate) {
    throw new Error(`Missing aggregate for primary objective ${primary.name}.`);
  }

  const signedImprovement = primary.direction === 'lower'
    ? reference.median - candidate.median
    : candidate.median - reference.median;
  const noiseBand = Math.max(reference.mad, candidate.mad);
  const confidence = noiseBand <= ROBUST_EPSILON
    ? signedImprovement === 0 ? 0 : Math.sign(signedImprovement) * Number.POSITIVE_INFINITY
    : signedImprovement / noiseBand;
  const constraintResults = evaluateConstraints(
    input.constraints,
    input.candidateAggregates,
    input.confidenceThreshold
  );

  if (!input.checksPassed) {
    return {
      outcome: 'checks_failed',
      primaryImprovement: signedImprovement,
      confidence,
      constraintResults,
      explanation: 'Correctness checks failed; hard constraints fail closed.',
    };
  }
  const failedConstraint = constraintResults.find((result) => result.conclusive && !result.passed);
  if (failedConstraint) {
    return {
      outcome: 'rejected',
      primaryImprovement: signedImprovement,
      confidence,
      constraintResults,
      explanation: `Constraint ${failedConstraint.metricName} ${failedConstraint.operator} ${failedConstraint.threshold} conclusively failed.`,
    };
  }
  if (confidence <= -input.confidenceThreshold) {
    return {
      outcome: 'rejected',
      primaryImprovement: signedImprovement,
      confidence,
      constraintResults,
      explanation: `Primary objective conclusively regressed with confidence ${formatConfidence(confidence)}.`,
    };
  }
  const constraintsPass = constraintResults.every((result) => result.conclusive && result.passed);
  if (constraintsPass && confidence >= input.confidenceThreshold) {
    return {
      outcome: 'accepted',
      primaryImprovement: signedImprovement,
      confidence,
      constraintResults,
      explanation: `Primary objective improved with confidence ${formatConfidence(confidence)} and all hard constraints passed.`,
    };
  }
  if (input.sampleCount < input.maxSamples) {
    return {
      outcome: 'sampling',
      primaryImprovement: signedImprovement,
      confidence,
      constraintResults,
      explanation: 'Measurements overlap the robust noise band; collect another sample.',
    };
  }
  return {
    outcome: 'inconclusive',
    primaryImprovement: signedImprovement,
    confidence,
    constraintResults,
    explanation: `Measurements remained inconclusive after ${input.maxSamples} samples.`,
  };
}

export function evaluateConstraints(
  constraints: HardConstraint[],
  aggregates: Record<string, MetricAggregate>,
  confidenceThreshold: number
): ConstraintResult[] {
  return constraints.map((constraint) =>
    evaluateConstraint(constraint, aggregates, confidenceThreshold)
  );
}

function evaluateConstraint(
  constraint: HardConstraint,
  aggregates: Record<string, MetricAggregate>,
  confidenceThreshold: number
): ConstraintResult {
  const aggregate = aggregates[constraint.metricName];
  if (!aggregate) {
    return {
      ...constraint,
      conservativeValue: constraint.operator.startsWith('<')
        ? Number.MAX_VALUE
        : -Number.MAX_VALUE,
      passed: false,
      conclusive: true,
    };
  }
  const margin = aggregate.mad * confidenceThreshold;
  const upper = aggregate.median + margin;
  const lower = aggregate.median - margin;
  const less = constraint.operator === '<' || constraint.operator === '<=';
  const conservativeValue = less ? upper : lower;
  const passes = compare(conservativeValue, constraint.operator, constraint.threshold);
  const conclusivelyFails = less
    ? !compare(lower, constraint.operator, constraint.threshold)
    : !compare(upper, constraint.operator, constraint.threshold);
  return {
    ...constraint,
    conservativeValue,
    passed: passes,
    conclusive: passes || conclusivelyFails,
  };
}

function compare(value: number, operator: HardConstraint['operator'], threshold: number): boolean {
  switch (operator) {
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    case '>=': return value >= threshold;
  }
}

function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return confidence > 0 ? 'infinite' : '-infinite';
  return confidence.toFixed(2);
}

export interface ParetoCandidate {
  attemptId: string;
  constraintPassing: boolean;
  metrics: Record<string, number>;
}

export function computeParetoAttemptIds(
  candidates: ParetoCandidate[],
  objectives: DecisionObjective[]
): string[] {
  const eligible = candidates.filter((candidate) =>
    candidate.constraintPassing
    && objectives.every((objective) => Number.isFinite(candidate.metrics[objective.name]))
  );
  return eligible
    .filter((candidate) => !eligible.some((other) =>
      other.attemptId !== candidate.attemptId && dominates(other, candidate, objectives)
    ))
    .map((candidate) => candidate.attemptId)
    .sort();
}

function dominates(
  left: ParetoCandidate,
  right: ParetoCandidate,
  objectives: DecisionObjective[]
): boolean {
  let strictlyBetter = false;
  for (const objective of objectives) {
    const leftValue = left.metrics[objective.name];
    const rightValue = right.metrics[objective.name];
    const noWorse = objective.direction === 'lower'
      ? leftValue <= rightValue
      : leftValue >= rightValue;
    if (!noWorse) return false;
    if (leftValue !== rightValue) strictlyBetter = true;
  }
  return strictlyBetter;
}
