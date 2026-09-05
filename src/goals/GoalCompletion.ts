/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GoalCompletionCheck, GoalCompletionEvidence, GoalCompletionReceipt } from './types.js';

export function parseAcceptanceCriteria(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new TypeError('acceptanceCriteria must contain between 1 and 20 criteria.');
  }
  const criteria = value.map((item: unknown) => boundedText(item, 'criterion', 2000));
  if (new Set(criteria).size !== criteria.length) throw new TypeError('acceptanceCriteria must be unique.');
  return criteria;
}

export function parseCompletionEvidence(value: unknown): GoalCompletionEvidence {
  const raw = record(value);
  const summary = boundedText(raw.summary, 'completion summary', 2000);
  if (!Array.isArray(raw.checks) || raw.checks.length === 0 || raw.checks.length > 20) {
    throw new TypeError('completion evidence must contain between 1 and 20 checks.');
  }
  const checks = raw.checks.map((item: unknown): GoalCompletionCheck => {
    const check = record(item);
    if (check.status !== 'passed' && check.status !== 'failed' && check.status !== 'notRun') {
      throw new TypeError('completion check status must be passed, failed, or notRun.');
    }
    return {
      criterion: boundedText(check.criterion, 'criterion', 2000),
      status: check.status,
      evidence: boundedText(check.evidence, 'check evidence', 4000),
    };
  });
  if (new Set(checks.map((check) => check.criterion)).size !== checks.length) {
    throw new TypeError('completion checks must be unique.');
  }
  return { summary, checks };
}

export function buildCompletionReceipt(value: unknown, criteria?: string[]): GoalCompletionReceipt | undefined {
  if (value === undefined) {
    if (criteria) throw new TypeError('Provide completion evidence for every approved acceptance criterion.');
    return undefined;
  }
  const evidence = parseCompletionEvidence(value);
  if (evidence.checks.some((check) => check.status !== 'passed')) {
    throw new TypeError('Every completion check must have passed; failed or unrun checks do not prove completion.');
  }
  if (criteria && (evidence.checks.length !== criteria.length
    || criteria.some((criterion) => !evidence.checks.some((check) => check.criterion === criterion)))) {
    throw new TypeError('Provide one matching completion check for every approved acceptance criterion.');
  }
  return { ...evidence, recordedAt: Date.now(), provenance: 'reported' };
}

export function parseCompletionReceipt(value: unknown, criteria?: string[]): GoalCompletionReceipt | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (raw.provenance !== 'reported' || typeof raw.recordedAt !== 'number'
    || !Number.isFinite(raw.recordedAt) || raw.recordedAt < 0) {
    throw new TypeError('Invalid completion receipt metadata.');
  }
  const receipt = buildCompletionReceipt(raw, criteria);
  return receipt ? { ...receipt, recordedAt: raw.recordedAt } : undefined;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('completion evidence must be an object.');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new TypeError(`${name} must be non-empty text of at most ${max} characters.`);
  }
  return value.trim();
}
