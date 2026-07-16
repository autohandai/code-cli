/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  computeParetoAttemptIds,
  decideEvaluation,
  type DecisionObjective,
} from '../../src/autoresearch/decision.js';
import { parseObjectiveMetrics } from '../../src/autoresearch/evaluator.js';

const objectives: DecisionObjective[] = [
  { name: 'total_ms', unit: 'ms', direction: 'lower', primary: true },
  { name: 'memory_mb', unit: 'MB', direction: 'lower', primary: false },
];

describe('autoresearch deterministic decision engine', () => {
  it('accepts a stable primary improvement at the minimum sample count', () => {
    const decision = decideEvaluation({
      objectives,
      constraints: [],
      referenceAggregates: {
        total_ms: { median: 100, mad: 0, sampleCount: 3 },
        memory_mb: { median: 50, mad: 0, sampleCount: 3 },
      },
      candidateAggregates: {
        total_ms: { median: 90, mad: 0, sampleCount: 3 },
        memory_mb: { median: 52, mad: 0, sampleCount: 3 },
      },
      checksPassed: true,
      sampleCount: 3,
      maxSamples: 9,
      confidenceThreshold: 2,
    });

    expect(decision.outcome).toBe('accepted');
    expect(decision.primaryImprovement).toBe(10);
    expect(decision.confidence).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects a stable regression and fails hard constraints closed', () => {
    const regression = decideEvaluation({
      objectives,
      constraints: [],
      referenceAggregates: {
        total_ms: { median: 100, mad: 0, sampleCount: 3 },
        memory_mb: { median: 50, mad: 0, sampleCount: 3 },
      },
      candidateAggregates: {
        total_ms: { median: 110, mad: 0, sampleCount: 3 },
        memory_mb: { median: 50, mad: 0, sampleCount: 3 },
      },
      checksPassed: true,
      sampleCount: 3,
      maxSamples: 9,
      confidenceThreshold: 2,
    });
    expect(regression.outcome).toBe('rejected');

    const constrained = decideEvaluation({
      objectives,
      constraints: [{ metricName: 'memory_mb', operator: '<=', threshold: 50 }],
      referenceAggregates: {
        total_ms: { median: 100, mad: 1, sampleCount: 3 },
        memory_mb: { median: 48, mad: 1, sampleCount: 3 },
      },
      candidateAggregates: {
        total_ms: { median: 80, mad: 1, sampleCount: 3 },
        memory_mb: { median: 60, mad: 1, sampleCount: 3 },
      },
      checksPassed: true,
      sampleCount: 3,
      maxSamples: 9,
      confidenceThreshold: 2,
    });
    expect(constrained.outcome).toBe('rejected');
    expect(constrained.constraintResults[0]).toMatchObject({ passed: false, conclusive: true });
  });

  it('requests more samples for noisy overlap and becomes inconclusive at the limit', () => {
    const input = {
      objectives,
      constraints: [],
      referenceAggregates: {
        total_ms: { median: 100, mad: 2, sampleCount: 3 },
        memory_mb: { median: 50, mad: 1, sampleCount: 3 },
      },
      candidateAggregates: {
        total_ms: { median: 99, mad: 2, sampleCount: 3 },
        memory_mb: { median: 50, mad: 1, sampleCount: 3 },
      },
      checksPassed: true,
      maxSamples: 9,
      confidenceThreshold: 2,
    } as const;

    expect(decideEvaluation({ ...input, sampleCount: 3 }).outcome).toBe('sampling');
    expect(decideEvaluation({ ...input, sampleCount: 9 }).outcome).toBe('inconclusive');
  });

  it('computes mixed-direction Pareto candidates from constraint-passing evaluations', () => {
    const pareto = computeParetoAttemptIds([
      { attemptId: 'fast', constraintPassing: true, metrics: { total_ms: 80, memory_mb: 60 } },
      { attemptId: 'small', constraintPassing: true, metrics: { total_ms: 100, memory_mb: 40 } },
      { attemptId: 'dominated', constraintPassing: true, metrics: { total_ms: 110, memory_mb: 70 } },
      { attemptId: 'failed', constraintPassing: false, metrics: { total_ms: 1, memory_mb: 1 } },
    ], objectives);

    expect(pareto).toEqual(['fast', 'small']);
  });

  it('rejects duplicate objective emissions even when one value is non-finite', () => {
    expect(() => parseObjectiveMetrics(
      'METRIC total_ms=90\nMETRIC total_ms=NaN',
      [objectives[0]]
    )).toThrow(/exactly one finite METRIC total_ms.*found 2/i);
  });
});
