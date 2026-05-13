/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { PROJECT_DIR_NAME } from '../constants.js';
import { parseQueueBlockItems } from './queueBlockParser.js';
import { listGoalTemplateMetadata, resolveGoalTemplateByName, resolveGoalTemplateInvocation } from './templates.js';
import type {
  GoalCreateInput,
  GoalMutationResult,
  GoalSnapshot,
  GoalState,
  GoalTemplateMetadata,
  GoalUpdateInput,
  QueuedGoal,
} from './types.js';

const GOAL_STATE_FILE = 'goals.local.json';
const MAX_OBJECTIVE_LENGTH = 80_000;

export class GoalManager {
  constructor(private readonly workspaceRoot: string) {}

  async getSnapshot(): Promise<GoalSnapshot> {
    const snapshot = await this.readSnapshot();
    const goal = snapshot.goal ? this.withLiveElapsed(snapshot.goal) : null;
    return { ...snapshot, goal };
  }

  async listTemplates(): Promise<GoalTemplateMetadata[]> {
    return listGoalTemplateMetadata(this.workspaceRoot);
  }

  async resolveObjective(input: string): Promise<{ ok: true; input: GoalCreateInput; template?: string; templateFlags?: Record<string, string>; templateArgs?: string } | { ok: false; message: string }> {
    const resolution = await resolveGoalTemplateInvocation(input, this.workspaceRoot);
    if (resolution.ok) {
      return {
        ok: true,
        input: { objective: resolution.template.objective },
        template: resolution.template.name,
        templateFlags: resolution.template.flags,
        templateArgs: resolution.template.args,
      };
    }
    if ('notTemplate' in resolution) return { ok: true, input: { objective: input } };
    return { ok: false, message: resolution.error };
  }

  async createGoal(input: GoalCreateInput, opts: { replace?: boolean } = {}): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const validation = validateGoalInput(input);
    if (validation) return result(snapshot, false, validation);

    if (snapshot.goal && snapshot.goal.status !== 'complete' && !opts.replace) {
      return result(snapshot, false, 'A goal already exists. Clear it, complete it, or queue the new objective before replacing it.');
    }

    const now = Date.now();
    const goal: GoalState = {
      goalId: crypto.randomUUID(),
      objective: input.objective.trim(),
      status: 'active',
      tokenBudget: input.tokenBudget,
      timeBudgetSeconds: input.timeBudgetSeconds,
      minTokensBeforeWrapUp: input.minTokensBeforeWrapUp,
      minTimeSecondsBeforeWrapUp: input.minTimeSecondsBeforeWrapUp,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
    const next = { ...snapshot, goal, updatedAt: now };
    await this.writeSnapshot(next);
    return result(next, true, snapshot.goal?.status === 'complete' ? 'Goal created; replaced completed goal.' : 'Goal created.');
  }

  async updateGoal(input: GoalUpdateInput): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const current = snapshot.goal ? this.withLiveElapsed(snapshot.goal) : null;
    if (!current) return result(snapshot, false, 'No goal exists to update.');

    let next: GoalState = { ...current };
    const changes: string[] = [];
    if (input.objective !== undefined) {
      const objective = input.objective.trim();
      if (!objective) return result(snapshot, false, 'objective must be non-empty.');
      if (objective.length > MAX_OBJECTIVE_LENGTH) return result(snapshot, false, `objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters).`);
      next = { ...next, objective };
      changes.push('objective');
    }

    const budgetError = applyOptionalPositiveInteger(input.tokenBudget, (value) => {
      next = { ...next, tokenBudget: value };
      changes.push('token budget');
    });
    if (budgetError) return result(snapshot, false, budgetError);
    const timeBudgetError = applyOptionalPositiveInteger(input.timeBudgetSeconds, (value) => {
      next = { ...next, timeBudgetSeconds: value };
      changes.push('time budget');
    });
    if (timeBudgetError) return result(snapshot, false, timeBudgetError);
    const minTokensError = applyOptionalPositiveInteger(input.minTokensBeforeWrapUp, (value) => {
      next = { ...next, minTokensBeforeWrapUp: value };
      changes.push('token floor');
    });
    if (minTokensError) return result(snapshot, false, minTokensError);
    const minTimeError = applyOptionalPositiveInteger(input.minTimeSecondsBeforeWrapUp, (value) => {
      next = { ...next, minTimeSecondsBeforeWrapUp: value };
      changes.push('time floor');
    });
    if (minTimeError) return result(snapshot, false, minTimeError);

    const floorError = validateFloors(next);
    if (floorError) return result(snapshot, false, floorError);

    if (input.status !== undefined) {
      if (!['active', 'paused', 'complete', 'budgetLimited'].includes(input.status)) {
        return result(snapshot, false, 'status must be active, paused, complete, or budgetLimited.');
      }
      if (input.status === 'complete' && !floorMet(next)) {
        return result(snapshot, false, 'Completion floor is not met yet. Keep working, raise the floor, or clear the goal if the user explicitly wants to stop.');
      }
      next = transitionStatus(next, input.status);
      changes.push(`status ${input.status}`);
    }

    if (next.status === 'active' && budgetLimitReason(next)) {
      return result(snapshot, false, 'Cannot resume: budget is exhausted. Raise the budget or clear the goal before resuming.');
    }
    if (changes.length === 0) return result(snapshot, false, 'No goal updates were provided.');

    next = { ...next, updatedAt: Date.now() };
    const updated = { ...snapshot, goal: next, updatedAt: next.updatedAt };
    await this.writeSnapshot(updated);
    return result(updated, true, `Goal updated: ${changes.join(', ')}.`);
  }

  async clearGoal(): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const next = { ...snapshot, goal: null, updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return result(next, true, snapshot.goal ? 'Goal cleared.' : 'No goal was set.');
  }

  async enqueueGoal(input: GoalCreateInput & { source: QueuedGoal['source']; template?: string; templateFlags?: Record<string, string>; templateArgs?: string }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const validation = validateGoalInput(input);
    if (validation) return result(snapshot, false, validation);
    const queued = buildQueuedGoal(input);
    const next = { ...snapshot, queue: [...snapshot.queue, queued], updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...result(next, true, 'Queued goal.'), queued: [queued] };
  }

  async enqueueGoalBlock(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const items = parseQueueBlockItems(input);
    if (!items) return this.enqueueResolvedGoalInput(input, source);

    const queued: QueuedGoal[] = [];
    for (const item of items) {
      const resolved = await this.resolveObjective(item.objectiveInput);
      if (!resolved.ok) return result(snapshot, false, `Queue item ${item.marker} could not be resolved: ${resolved.message}`);
      const validation = validateGoalInput(resolved.input);
      if (validation) return result(snapshot, false, `Queue item ${item.marker}: ${validation}`);
      queued.push(buildQueuedGoal({
        ...resolved.input,
        source,
        template: resolved.template,
        templateFlags: resolved.templateFlags,
        templateArgs: resolved.templateArgs,
      }));
    }
    const next = { ...snapshot, queue: [...snapshot.queue, ...queued], updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...result(next, true, `Queued ${queued.length} goals.`), queued };
  }

  async enqueueResolvedGoalInput(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const resolved = await this.resolveObjective(input);
    if (!resolved.ok) {
      const snapshot = await this.readSnapshot();
      return result(snapshot, false, resolved.message);
    }
    return this.enqueueGoal({
      ...resolved.input,
      source,
      template: resolved.template,
      templateFlags: resolved.templateFlags,
      templateArgs: resolved.templateArgs,
    });
  }

  async startQueuedGoal(): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const current = snapshot.goal ? this.withLiveElapsed(snapshot.goal) : null;
    if (current && current.status !== 'complete' && current.status !== 'budgetLimited') {
      return result({ ...snapshot, goal: current }, false, 'A non-terminal goal is already active. The queued goal was left in the queue.');
    }
    const nextQueued = snapshot.queue[0];
    if (!nextQueued) return result({ ...snapshot, goal: current }, false, 'No queued goals.');

    let objective = nextQueued.objective;
    if (nextQueued.template) {
      const resolved = await resolveGoalTemplateByName(this.workspaceRoot, nextQueued.template, nextQueued.templateFlags ?? {}, nextQueued.templateArgs ?? '');
      if (!resolved.ok) return result(snapshot, false, 'notTemplate' in resolved ? `Unknown goal template '${nextQueued.template}'.` : resolved.error);
      objective = resolved.template.objective;
    }

    const now = Date.now();
    const goal: GoalState = {
      goalId: crypto.randomUUID(),
      objective,
      status: 'active',
      tokenBudget: nextQueued.tokenBudget,
      timeBudgetSeconds: nextQueued.timeBudgetSeconds,
      minTokensBeforeWrapUp: nextQueued.minTokensBeforeWrapUp,
      minTimeSecondsBeforeWrapUp: nextQueued.minTimeSecondsBeforeWrapUp,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
    const updated = { ...snapshot, goal, queue: snapshot.queue.slice(1), updatedAt: now };
    await this.writeSnapshot(updated);
    return { ...result(updated, true, 'Started queued goal.'), started: nextQueued, dequeued: nextQueued };
  }

  async dequeueGoal(audit?: { rationale?: string; authority?: string }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    if (!audit?.rationale?.trim() || !audit.authority?.trim()) {
      return result(snapshot, false, 'rationale and authority are required to dequeue a queued goal.');
    }
    const dequeued = snapshot.queue[0];
    if (!dequeued) return result(snapshot, false, 'No queued goals.');
    const next = { ...snapshot, queue: snapshot.queue.slice(1), updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...result(next, true, 'Dequeued goal.'), dequeued };
  }

  async removeQueuedGoal(queueId: string): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const removed = snapshot.queue.find((item) => item.queueId === queueId);
    if (!removed) return result(snapshot, false, `No queued goal found with id ${queueId}.`);
    const next = { ...snapshot, queue: snapshot.queue.filter((item) => item.queueId !== queueId), updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...result(next, true, 'Removed queued goal.'), removed };
  }

  async recordTurnUsage(input: { tokensUsed?: number }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    if (!snapshot.goal) return result(snapshot, true, 'No active goal.');
    let goal = this.withLiveElapsed(snapshot.goal);
    goal = {
      ...goal,
      tokensUsed: goal.tokensUsed + Math.max(0, Math.floor(input.tokensUsed ?? 0)),
      updatedAt: Date.now(),
    };
    const limitReason = budgetLimitReason(goal);
    if (limitReason) {
      goal = transitionStatus(goal, 'budgetLimited');
    }
    const next = { ...snapshot, goal, updatedAt: goal.updatedAt };
    await this.writeSnapshot(next);
    return result(next, true, limitReason ? `Goal budget limited: ${limitReason}.` : 'Goal usage recorded.');
  }

  formatSnapshot(snapshot: GoalSnapshot): string {
    const lines: string[] = [];
    if (!snapshot.goal) {
      lines.push('No goal is currently set.');
    } else {
      const goal = snapshot.goal;
      lines.push(`Goal ${goal.goalId}`);
      lines.push(`Status: ${goal.status}`);
      lines.push(`Objective: ${goal.objective}`);
      lines.push(`Elapsed: ${formatDuration(goal.timeUsedSeconds)}`);
      lines.push(`Tokens: ${goal.tokensUsed}${goal.tokenBudget ? ` / ${goal.tokenBudget}` : ''}`);
      if (goal.timeBudgetSeconds) lines.push(`Time budget: ${formatDuration(goal.timeBudgetSeconds)}`);
      if (goal.minTokensBeforeWrapUp) lines.push(`Token floor: ${goal.minTokensBeforeWrapUp}`);
      if (goal.minTimeSecondsBeforeWrapUp) lines.push(`Time floor: ${formatDuration(goal.minTimeSecondsBeforeWrapUp)}`);
    }
    if (snapshot.queue.length > 0) {
      lines.push('');
      lines.push(`Queued goals (${snapshot.queue.length}):`);
      snapshot.queue.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.queueId}] ${truncate(item.objective, 120)}`);
      });
    }
    return lines.join('\n');
  }

  private async readSnapshot(): Promise<GoalSnapshot> {
    const filePath = this.statePath();
    if (!(await fs.pathExists(filePath))) {
      return emptySnapshot();
    }
    try {
      const raw = await fs.readJson(filePath) as Partial<GoalSnapshot>;
      return normalizeSnapshot(raw);
    } catch {
      return emptySnapshot();
    }
  }

  private async writeSnapshot(snapshot: GoalSnapshot): Promise<void> {
    await fs.ensureDir(path.dirname(this.statePath()));
    await fs.writeJson(this.statePath(), snapshot, { spaces: 2 });
  }

  private statePath(): string {
    return path.join(this.workspaceRoot, PROJECT_DIR_NAME, GOAL_STATE_FILE);
  }

  private withLiveElapsed(goal: GoalState): GoalState {
    if (goal.status !== 'active') return goal;
    const elapsedDelta = Math.max(0, Math.floor((Date.now() - goal.updatedAt) / 1000));
    return { ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsedDelta };
  }
}

function emptySnapshot(): GoalSnapshot {
  return { version: 1, goal: null, queue: [], updatedAt: Date.now() };
}

function normalizeSnapshot(raw: Partial<GoalSnapshot>): GoalSnapshot {
  return {
    version: 1,
    goal: normalizeGoal(raw.goal),
    queue: Array.isArray(raw.queue) ? raw.queue.map(normalizeQueuedGoal).filter((item): item is QueuedGoal => Boolean(item)) : [],
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function normalizeGoal(value: unknown): GoalState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.goalId !== 'string' || typeof raw.objective !== 'string' || !isGoalStatus(raw.status)) return null;
  return {
    goalId: raw.goalId,
    objective: raw.objective,
    status: raw.status,
    tokenBudget: positiveInteger(raw.tokenBudget),
    timeBudgetSeconds: positiveInteger(raw.timeBudgetSeconds),
    minTokensBeforeWrapUp: positiveInteger(raw.minTokensBeforeWrapUp),
    minTimeSecondsBeforeWrapUp: positiveInteger(raw.minTimeSecondsBeforeWrapUp),
    tokensUsed: positiveInteger(raw.tokensUsed) ?? 0,
    timeUsedSeconds: positiveInteger(raw.timeUsedSeconds) ?? 0,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  };
}

function normalizeQueuedGoal(value: unknown): QueuedGoal | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.queueId !== 'string' || typeof raw.objective !== 'string') return null;
  return {
    queueId: raw.queueId,
    objective: raw.objective,
    tokenBudget: positiveInteger(raw.tokenBudget),
    timeBudgetSeconds: positiveInteger(raw.timeBudgetSeconds),
    minTokensBeforeWrapUp: positiveInteger(raw.minTokensBeforeWrapUp),
    minTimeSecondsBeforeWrapUp: positiveInteger(raw.minTimeSecondsBeforeWrapUp),
    source: raw.source === 'command' || raw.source === 'tool' || raw.source === 'rpc' || raw.source === 'cli' ? raw.source : 'tool',
    template: typeof raw.template === 'string' ? raw.template : undefined,
    templateFlags: isStringRecord(raw.templateFlags) ? raw.templateFlags : undefined,
    templateArgs: typeof raw.templateArgs === 'string' ? raw.templateArgs : undefined,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

function buildQueuedGoal(input: GoalCreateInput & { source: QueuedGoal['source']; template?: string; templateFlags?: Record<string, string>; templateArgs?: string }): QueuedGoal {
  return {
    queueId: `q-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    objective: input.objective.trim(),
    tokenBudget: input.tokenBudget,
    timeBudgetSeconds: input.timeBudgetSeconds,
    minTokensBeforeWrapUp: input.minTokensBeforeWrapUp,
    minTimeSecondsBeforeWrapUp: input.minTimeSecondsBeforeWrapUp,
    source: input.source,
    template: input.template,
    templateFlags: input.templateFlags,
    templateArgs: input.templateArgs,
    createdAt: Date.now(),
  };
}

function validateGoalInput(input: GoalCreateInput): string | null {
  const objective = input.objective.trim();
  if (!objective) return 'objective must be non-empty.';
  if (objective.length > MAX_OBJECTIVE_LENGTH) return `objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters).`;
  for (const [name, value] of [
    ['tokenBudget', input.tokenBudget],
    ['timeBudgetSeconds', input.timeBudgetSeconds],
    ['minTokensBeforeWrapUp', input.minTokensBeforeWrapUp],
    ['minTimeSecondsBeforeWrapUp', input.minTimeSecondsBeforeWrapUp],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) return `${name} must be a positive integer.`;
  }
  return validateFloors(input);
}

function validateFloors(input: Pick<GoalCreateInput, 'tokenBudget' | 'timeBudgetSeconds' | 'minTokensBeforeWrapUp' | 'minTimeSecondsBeforeWrapUp'>): string | null {
  if (input.tokenBudget !== undefined && input.minTokensBeforeWrapUp !== undefined && input.minTokensBeforeWrapUp > input.tokenBudget) {
    return 'minTokensBeforeWrapUp cannot be greater than tokenBudget.';
  }
  if (input.timeBudgetSeconds !== undefined && input.minTimeSecondsBeforeWrapUp !== undefined && input.minTimeSecondsBeforeWrapUp > input.timeBudgetSeconds) {
    return 'minTimeSecondsBeforeWrapUp cannot be greater than timeBudgetSeconds.';
  }
  return null;
}

function transitionStatus(goal: GoalState, status: GoalState['status']): GoalState {
  const now = Date.now();
  if (goal.status === 'active' && status !== 'active') {
    const elapsedDelta = Math.max(0, Math.floor((now - goal.updatedAt) / 1000));
    return { ...goal, status, timeUsedSeconds: goal.timeUsedSeconds + elapsedDelta, updatedAt: now };
  }
  if (goal.status !== 'active' && status === 'active') {
    return { ...goal, status, updatedAt: now };
  }
  return { ...goal, status, updatedAt: now };
}

function budgetLimitReason(goal: GoalState): string | null {
  if (goal.tokenBudget !== undefined && goal.tokensUsed >= goal.tokenBudget) return 'tokenBudget';
  if (goal.timeBudgetSeconds !== undefined && goal.timeUsedSeconds >= goal.timeBudgetSeconds) return 'timeBudget';
  return null;
}

function applyOptionalPositiveInteger(value: number | null | undefined, apply: (value: number | undefined) => void): string | null {
  if (value === undefined) return null;
  if (value === null) {
    apply(undefined);
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) return 'budget and floor values must be positive integers or null.';
  apply(value);
  return null;
}

function result(snapshot: GoalSnapshot, ok: boolean, message: string): GoalMutationResult {
  const goal = snapshot.goal;
  return {
    ok,
    goal,
    queue: snapshot.queue,
    message,
    telemetry: goal ? {
      timeRemainingSeconds: goal.timeBudgetSeconds !== undefined ? Math.max(0, goal.timeBudgetSeconds - goal.timeUsedSeconds) : undefined,
      tokensRemaining: goal.tokenBudget !== undefined ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : undefined,
      completionFloorMet: floorMet(goal),
    } : undefined,
  };
}

function floorMet(goal: GoalState): boolean {
  const tokenMet = goal.minTokensBeforeWrapUp === undefined || goal.tokensUsed >= goal.minTokensBeforeWrapUp;
  const timeMet = goal.minTimeSecondsBeforeWrapUp === undefined || goal.timeUsedSeconds >= goal.minTimeSecondsBeforeWrapUp;
  return tokenMet && timeMet;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function isGoalStatus(value: unknown): value is GoalState['status'] {
  return value === 'active' || value === 'paused' || value === 'budgetLimited' || value === 'complete';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}
