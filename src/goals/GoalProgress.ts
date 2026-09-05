/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GoalCheckpoint, GoalCheckpointInput, GoalState, GoalStatus, GoalUpdateInput } from './types.js';

export function parseGoalCheckpoint(value: unknown): GoalCheckpointInput {
  const raw = record(value);
  let artifacts: string[] | undefined;
  if (raw.artifacts !== undefined) {
    if (!Array.isArray(raw.artifacts) || raw.artifacts.length > 20) throw new TypeError('checkpoint artifacts must contain at most 20 references.');
    artifacts = raw.artifacts.map((item: unknown) => text(item, 'artifact reference'));
  }
  return {
    summary: text(raw.summary, 'checkpoint summary'),
    nextStep: raw.nextStep === undefined ? undefined : text(raw.nextStep, 'checkpoint next step'),
    artifacts,
  };
}

export function parseStoredCheckpoint(value: unknown): GoalCheckpoint | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (typeof raw.recordedAt !== 'number' || !Number.isFinite(raw.recordedAt) || raw.recordedAt < 0) {
    throw new TypeError('checkpoint recordedAt must be a non-negative timestamp.');
  }
  return { ...parseGoalCheckpoint(raw), recordedAt: raw.recordedAt };
}

export function parseGoalStopState(status: GoalStatus, stopReason: unknown, resumeWhen: unknown): Pick<GoalState, 'stopReason' | 'resumeWhen'> {
  if (status === 'blocked' || status === 'waiting') {
    return { stopReason: text(stopReason, 'stopReason'), resumeWhen: text(resumeWhen, 'resumeWhen') };
  }
  if (stopReason !== undefined || resumeWhen !== undefined) throw new TypeError('stopReason and resumeWhen require a blocked or waiting goal.');
  return { stopReason: undefined, resumeWhen: undefined };
}

export function applyGoalProgress(current: GoalState, input: GoalUpdateInput): GoalState {
  const status = input.status ?? current.status;
  const changingStatus = input.status !== undefined && input.status !== current.status;
  const stopReason = input.stopReason !== undefined ? input.stopReason : changingStatus ? undefined : current.stopReason;
  const resumeWhen = input.resumeWhen !== undefined ? input.resumeWhen : changingStatus ? undefined : current.resumeWhen;
  return {
    ...current,
    ...parseGoalStopState(status, stopReason, resumeWhen),
    checkpoint: input.checkpoint === undefined ? current.checkpoint : { ...parseGoalCheckpoint(input.checkpoint), recordedAt: Date.now() },
  };
}

export function parseGoalProgressCommand(value: unknown): Pick<GoalUpdateInput, 'stopReason' | 'resumeWhen' | 'checkpoint'> {
  const raw = record(value);
  return {
    stopReason: text(raw.stopReason, 'stopReason'),
    resumeWhen: text(raw.resumeWhen, 'resumeWhen'),
    checkpoint: raw.checkpoint === undefined ? undefined : parseGoalCheckpoint(raw.checkpoint),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('goal progress must be an object.');
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 4000) {
    throw new TypeError(`${name} must be non-empty text of at most 4000 characters.`);
  }
  return value.trim();
}
