/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import crypto from 'node:crypto';
import { open } from 'node:fs/promises';
import { atomicWriteJson } from '../utils/atomicFile.js';
import { parseAcceptanceCriteria, parseCompletionReceipt } from './GoalCompletion.js';
import { UNSCOPED_GOAL_SESSION_KEY } from './types.js';
import type { CompletedGoal, GoalSnapshot, GoalState, QueuedGoal } from './types.js';

export class GoalStorageError extends Error {
  constructor(message: string, readonly kind: 'corrupt' | 'unreadable' | 'unsupported', cause?: unknown) {
    super(`Goal storage: ${message}${kind === 'corrupt' ? ' Use /goal repair to restore a backup explicitly.' : ''}`, { cause });
    this.name = 'GoalStorageError';
  }
}

export class GoalSnapshotStore {
  constructor(readonly statePath: string) {}

  get backupPath(): string {
    return `${this.statePath}.backup`;
  }

  async read(): Promise<GoalSnapshot> {
    const snapshot = await this.readFile(this.statePath);
    if (snapshot) return snapshot;
    if (await this.readFile(this.backupPath)) {
      throw new GoalStorageError('the primary snapshot is missing but a backup exists. No goals were changed.', 'corrupt');
    }
    return emptySnapshot();
  }

  async readBackup(): Promise<GoalSnapshot> {
    const snapshot = await this.readFile(this.backupPath);
    if (!snapshot) throw new GoalStorageError('no saved backup is available. The damaged snapshot was preserved.', 'unreadable');
    return snapshot;
  }

  private async readFile(filePath: string): Promise<GoalSnapshot | null> {
    let contents: string;
    try {
      contents = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw new GoalStorageError(`cannot read ${filePath} (${errorCode(error) ?? 'I/O error'}). No goals were changed.`, 'unreadable', error);
    }
    try {
      return normalizeSnapshot(JSON.parse(contents) as unknown);
    } catch (error) {
      if (error instanceof GoalStorageError) throw error;
      throw new GoalStorageError(`invalid snapshot at ${filePath}. No goals were changed.`, 'corrupt', error);
    }
  }

  async write(snapshot: GoalSnapshot): Promise<string | undefined> {
    await atomicWriteJson(this.statePath, snapshot);
    try {
      await atomicWriteJson(this.backupPath, snapshot);
    } catch (error) {
      return `Goal saved, but its backup could not be refreshed (${errorCode(error) ?? 'I/O error'}). The backup may be older or unavailable.`;
    }
  }

  async restore(snapshot: GoalSnapshot): Promise<string | undefined> {
    let contents: Buffer | undefined;
    try {
      contents = await fs.readFile(this.statePath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    let preservedPath: string | undefined;
    if (contents !== undefined) {
      assertStillCorrupt(contents);
      preservedPath = `${this.statePath}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
      const preserved = await open(preservedPath, 'wx', 0o600);
      try {
        await preserved.writeFile(contents);
        await preserved.sync();
      } finally {
        await preserved.close();
      }
    }
    await atomicWriteJson(this.statePath, snapshot);
    return preservedPath;
  }
}

function emptySnapshot(): GoalSnapshot {
  return { version: 2, goals: {}, queue: [], completed: [], updatedAt: Date.now() };
}

function assertStillCorrupt(contents: Buffer): void {
  try {
    normalizeSnapshot(JSON.parse(contents.toString('utf8')) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof GoalStorageError && error.kind === 'corrupt') return;
    throw error;
  }
  throw new GoalStorageError('snapshot changed during recovery. Inspect it before retrying; no goals were changed.', 'unreadable');
}

function normalizeSnapshot(value: unknown): GoalSnapshot {
  const raw = record(value);
  if (raw.version !== 1 && raw.version !== 2) {
    if (typeof raw.version !== 'number' || raw.version < 3) throw malformed();
    throw new GoalStorageError(`unsupported version ${String(raw.version)}. Use a compatible CLI; no goals were changed.`, 'unsupported');
  }
  if (raw.version === 2 && (!Array.isArray(raw.queue) || !Array.isArray(raw.completed))) throw malformed();
  const goals: Record<string, GoalState> = Object.create(null) as Record<string, GoalState>;
  if (raw.version === 2 || raw.goals !== undefined) {
    for (const [key, value] of Object.entries(record(raw.goals))) goals[key] = normalizeGoal(value);
  }
  if (raw.version === 1 && raw.goal !== undefined && raw.goal !== null) {
    const key = typeof raw.activeSessionId === 'string' && raw.activeSessionId.trim()
      ? raw.activeSessionId : UNSCOPED_GOAL_SESSION_KEY;
    goals[key] = normalizeGoal(raw.goal);
  }
  return {
    version: 2,
    goals,
    queue: collection(raw.queue).map(normalizeQueuedGoal),
    completed: collection(raw.completed).map(normalizeCompletedGoal),
    updatedAt: nonNegativeNumber(raw.updatedAt) ?? Date.now(),
  };
}

function normalizeGoal(value: unknown): GoalState {
  const raw = record(value);
  if (!isGoalStatus(raw.status)) throw malformed();
  return {
    goalId: requiredString(raw.goalId),
    objective: requiredString(raw.objective),
    status: raw.status,
    ...completion(raw),
    ...budgets(raw),
    tokensUsed: nonNegativeInteger(raw.tokensUsed) ?? 0,
    timeUsedSeconds: nonNegativeNumber(raw.timeUsedSeconds) ?? 0,
    createdAt: nonNegativeNumber(raw.createdAt) ?? Date.now(),
    updatedAt: nonNegativeNumber(raw.updatedAt) ?? Date.now(),
  };
}

function normalizeQueuedGoal(value: unknown): QueuedGoal {
  const raw = record(value);
  const source = raw.source ?? 'tool';
  if (source !== 'command' && source !== 'tool' && source !== 'rpc' && source !== 'cli') throw malformed();
  let templateFlags: Record<string, string> | undefined;
  if (raw.templateFlags !== undefined) {
    templateFlags = Object.fromEntries(Object.entries(record(raw.templateFlags)).map(([key, value]) => {
      if (typeof value !== 'string') throw malformed();
      return [key, value];
    }));
  }
  return {
    queueId: requiredString(raw.queueId),
    objective: requiredString(raw.objective),
    acceptanceCriteria: parseAcceptanceCriteria(raw.acceptanceCriteria),
    ...budgets(raw),
    source,
    template: optionalString(raw.template),
    templateFlags,
    templateArgs: optionalString(raw.templateArgs),
    createdAt: nonNegativeNumber(raw.createdAt) ?? Date.now(),
  };
}

function normalizeCompletedGoal(value: unknown): CompletedGoal {
  const raw = record(value);
  if (raw.status !== 'complete' && raw.status !== 'budgetLimited') throw malformed();
  return {
    goalId: requiredString(raw.goalId),
    sessionId: optionalString(raw.sessionId),
    objective: requiredString(raw.objective),
    status: raw.status,
    ...completion(raw),
    tokensUsed: nonNegativeInteger(raw.tokensUsed) ?? 0,
    timeUsedSeconds: nonNegativeNumber(raw.timeUsedSeconds) ?? 0,
    createdAt: nonNegativeNumber(raw.createdAt) ?? Date.now(),
    completedAt: nonNegativeNumber(raw.completedAt) ?? Date.now(),
  };
}

function completion(raw: Record<string, unknown>): Pick<GoalState, 'acceptanceCriteria' | 'completionReceipt'> {
  const acceptanceCriteria = parseAcceptanceCriteria(raw.acceptanceCriteria);
  return { acceptanceCriteria, completionReceipt: parseCompletionReceipt(raw.completionReceipt, acceptanceCriteria) };
}

function budgets(raw: Record<string, unknown>): Pick<GoalState, 'tokenBudget' | 'timeBudgetSeconds' | 'minTokensBeforeWrapUp' | 'minTimeSecondsBeforeWrapUp'> {
  return {
    tokenBudget: nonNegativeInteger(raw.tokenBudget),
    timeBudgetSeconds: nonNegativeInteger(raw.timeBudgetSeconds),
    minTokensBeforeWrapUp: nonNegativeInteger(raw.minTokensBeforeWrapUp),
    minTimeSecondsBeforeWrapUp: nonNegativeInteger(raw.minTimeSecondsBeforeWrapUp),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed();
  return value as Record<string, unknown>;
}

function collection(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformed();
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw malformed();
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw malformed();
  return value;
}

function nonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw malformed();
  return value;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = nonNegativeNumber(value);
  if (number !== undefined && !Number.isInteger(number)) throw malformed();
  return number;
}

function isGoalStatus(value: unknown): value is GoalState['status'] {
  return value === 'active' || value === 'paused' || value === 'budgetLimited' || value === 'complete';
}

function malformed(): GoalStorageError {
  return new GoalStorageError('malformed snapshot. No goals were changed.', 'corrupt');
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : undefined;
}
