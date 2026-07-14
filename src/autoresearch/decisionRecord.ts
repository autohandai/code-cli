/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DecisionRecordSchema,
  LEDGER_POLICY_VERSION,
  createLedgerId,
  type DecisionRecord,
  type EvaluationRecord,
  type JsonValue,
} from './ledger.js';

export interface PersistedDecisionInput {
  attemptId: string;
  evaluation: EvaluationRecord;
  source: DecisionRecord['source'];
  outcome: DecisionRecord['outcome'];
  materialized: boolean;
  primaryImprovement: number;
  confidence: number;
  constraintResults: DecisionRecord['constraintResults'];
  explanation: string;
  context?: Record<string, JsonValue>;
}

export function createPersistedDecision(input: PersistedDecisionInput): DecisionRecord {
  const confidence = Number.isFinite(input.confidence)
    ? input.confidence
    : Math.sign(input.confidence) * Number.MAX_VALUE;
  return DecisionRecordSchema.parse({
    schemaVersion: 1,
    type: 'decision',
    id: createLedgerId('event'),
    attemptId: input.attemptId,
    timestamp: new Date().toISOString(),
    context: input.context ?? {},
    policyVersion: LEDGER_POLICY_VERSION,
    evaluationId: input.evaluation.id,
    source: input.source,
    constraintResults: input.constraintResults,
    primaryImprovement: input.primaryImprovement,
    confidence,
    outcome: input.outcome,
    materialized: input.materialized,
    explanation: input.explanation,
  });
}
