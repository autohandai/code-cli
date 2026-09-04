/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { PROJECT_DIR_NAME } from '../constants.js';
import { ActiveAgentRegistry } from '../session/ActiveAgentRegistry.js';
import { parseQueueBlockItems } from './queueBlockParser.js';
import { listGoalTemplateMetadata, resolveGoalTemplateByName, resolveGoalTemplateInvocation } from './templates.js';
import type {
  CompletedGoal,
  GoalCreateInput,
  GoalMutationResult,
  GoalPeer,
  GoalSessionSnapshot,
  GoalSnapshot,
  GoalState,
  GoalTemplateMetadata,
  GoalUpdateInput,
  QueuedGoal,
} from './types.js';

const GOAL_STATE_FILE = 'goals.local.json';
const MAX_OBJECTIVE_LENGTH = 80_000;
/** Key used for goals created by managers without a session (RPC/CLI). */
const UNKNOWN_SESSION_KEY = '__unscoped__';

type GoalSnapshotPublisher = () => Promise<void>;

const snapshotPublishers = new Map<string, Set<GoalSnapshotPublisher>>();

export interface GoalManagerOptions {
  sessionId?: string;
  /** Resolve the active session lazily for long-lived UI subscriptions. */
  getSessionId?: () => string | undefined;
  /**
   * Liveness probe for sessions that own active goals. Defaults to the
   * active-agent heartbeat registry, which prunes records for dead PIDs and
   * stale heartbeats. Peer goals are reported, never mutated, by this probe.
   */
  isSessionAlive?: (sessionId: string) => Promise<boolean>;
}

export function buildGoalContinuationInstruction(objective: string): string {
  return [
    `Active goal: ${objective}`,
    'Continue working toward this persistent goal until it is complete, blocked, paused, cleared, or budget-limited.',
    'Use get_goal or update_goal when you need to inspect or modify the goal state.',
  ].join('\n');
}

export class GoalManager {
  private readonly sessionId?: string;
  private readonly getSessionId?: () => string | undefined;
  private readonly isSessionAlive: (sessionId: string) => Promise<boolean>;

  constructor(
    private readonly workspaceRoot: string,
    options: GoalManagerOptions = {},
  ) {
    this.sessionId = options.sessionId?.trim() || undefined;
    this.getSessionId = options.getSessionId;
    this.isSessionAlive = options.isSessionAlive ?? defaultSessionLivenessProbe;
  }

  /** The key under which this manager's goal lives in the snapshot. */
  private goalKey(): string {
    return this.getSessionId?.()?.trim() || this.sessionId || UNKNOWN_SESSION_KEY;
  }

  async getSnapshot(): Promise<GoalSnapshot> {
    const snapshot = await this.readSnapshot();
    const goals = Object.fromEntries(
      Object.entries(snapshot.goals).map(([key, goal]) => [key, this.withLiveElapsed(goal)]),
    );
    return { ...snapshot, goals };
  }

  async getSessionSnapshot(): Promise<GoalSessionSnapshot> {
    const snapshot = await this.getSnapshot();
    const key = this.goalKey();
    const goal = snapshot.goals[key] ?? null;
    const peers = await this.buildPeers(snapshot, key);

    if (!goal) {
      return {
        version: 2,
        goal: null,
        queue: snapshot.queue,
        completed: snapshot.completed,
        updatedAt: snapshot.updatedAt,
        sessionAttachment: key === UNKNOWN_SESSION_KEY ? 'unscoped' : 'none',
        peers,
        message: peers.length > 0
          ? 'No goal is attached to this session. Other sessions are running goals in this workspace; create your own with /goal <objective> to run concurrently.'
          : undefined,
      };
    }
    return {
      version: 2,
      goal,
      queue: snapshot.queue,
      completed: snapshot.completed,
      updatedAt: snapshot.updatedAt,
      sessionAttachment: key === UNKNOWN_SESSION_KEY ? 'unscoped' : 'attached',
      peers,
    };
  }

  subscribe(listener: (snapshot: GoalSessionSnapshot) => void): () => void {
    const statePath = this.statePath();
    const publish = async (): Promise<void> => {
      listener(await this.getSessionSnapshot());
    };
    const publishers = snapshotPublishers.get(statePath) ?? new Set<GoalSnapshotPublisher>();
    publishers.add(publish);
    snapshotPublishers.set(statePath, publishers);
    void publish().catch(() => {});

    return () => {
      publishers.delete(publish);
      if (publishers.size === 0) {
        snapshotPublishers.delete(statePath);
      }
    };
  }

  async getActiveGoalForSession(): Promise<GoalState | null> {
    const snapshot = await this.getSnapshot();
    const goal = snapshot.goals[this.goalKey()];
    if (!goal || goal.status !== 'active') {
      return null;
    }
    return goal;
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
    if (validation) return this.result(snapshot, false, validation);

    const key = this.goalKey();
    const existing = snapshot.goals[key];
    if (existing && existing.status !== 'complete' && !opts.replace) {
      return this.result(snapshot, false, 'A goal already exists for this session. Clear it, complete it, or queue the new objective before replacing it.');
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
    const next: GoalSnapshot = {
      ...snapshot,
      goals: { ...snapshot.goals, [key]: goal },
      updatedAt: now,
    };
    await this.writeSnapshot(next);
    const message = existing && existing.status === 'complete'
      ? 'Goal created; replaced completed goal.'
      : 'Goal created.';
    return this.result(next, true, message);
  }

  async createOrQueueGoal(input: GoalCreateInput & { source: QueuedGoal['source'] }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key] ? this.withLiveElapsed(snapshot.goals[key]) : null;
    if (current && current.status !== 'complete' && current.status !== 'budgetLimited') {
      return this.enqueueGoal(input);
    }
    return this.createGoal(input);
  }

  async updateGoal(input: GoalUpdateInput): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key] ? this.withLiveElapsed(snapshot.goals[key]) : null;
    if (!current) return this.result(snapshot, false, 'No goal exists for this session to update.');

    let next: GoalState = { ...current };
    const changes: string[] = [];
    if (input.objective !== undefined) {
      const objective = input.objective.trim();
      if (!objective) return this.result(snapshot, false, 'objective must be non-empty.');
      if (objective.length > MAX_OBJECTIVE_LENGTH) return this.result(snapshot, false, `objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters).`);
      next = { ...next, objective };
      changes.push('objective');
    }

    const budgetError = applyOptionalPositiveInteger(input.tokenBudget, (value) => {
      next = { ...next, tokenBudget: value };
      changes.push('token budget');
    });
    if (budgetError) return this.result(snapshot, false, budgetError);
    const timeBudgetError = applyOptionalPositiveInteger(input.timeBudgetSeconds, (value) => {
      next = { ...next, timeBudgetSeconds: value };
      changes.push('time budget');
    });
    if (timeBudgetError) return this.result(snapshot, false, timeBudgetError);
    const minTokensError = applyOptionalPositiveInteger(input.minTokensBeforeWrapUp, (value) => {
      next = { ...next, minTokensBeforeWrapUp: value };
      changes.push('token floor');
    });
    if (minTokensError) return this.result(snapshot, false, minTokensError);
    const minTimeError = applyOptionalPositiveInteger(input.minTimeSecondsBeforeWrapUp, (value) => {
      next = { ...next, minTimeSecondsBeforeWrapUp: value };
      changes.push('time floor');
    });
    if (minTimeError) return this.result(snapshot, false, minTimeError);

    const floorError = validateFloors(next);
    if (floorError) return this.result(snapshot, false, floorError);

    if (input.status !== undefined) {
      if (!['active', 'paused', 'complete', 'budgetLimited'].includes(input.status)) {
        return this.result(snapshot, false, 'status must be active, paused, complete, or budgetLimited.');
      }
      if (input.status === 'complete' && !floorMet(next)) {
        return this.result(snapshot, false, 'Completion floor is not met yet. Keep working, raise the floor, or clear the goal if the user explicitly wants to stop.');
      }
      next = transitionStatus(next, input.status);
      changes.push(`status ${input.status}`);
    }

    if (next.status === 'active' && budgetLimitReason(next)) {
      return this.result(snapshot, false, 'Cannot resume: budget is exhausted. Raise the budget or clear the goal before resuming.');
    }
    if (changes.length === 0) return this.result(snapshot, false, 'No goal updates were provided.');

    if (next.status === 'complete') {
      if (current.status === 'complete') return this.result({ ...snapshot, goals: { ...snapshot.goals, [key]: current } }, false, 'Goal is already complete.');
      const completedGoal = buildCompletedGoal(next, Date.now());
      const completedRun = appendCompletedGoal(snapshot.completed, completedGoal);
      const nextQueued = snapshot.queue[0];
      if (nextQueued) {
        const started = await this.startQueuedGoalFromSnapshot({
          ...snapshot,
          goals: { ...snapshot.goals, [key]: next },
          completed: completedRun,
        }, nextQueued);
        if (!started.ok) return started;
        return {
          ...started,
          message: 'Goal completed. Started next queued goal.',
          completed: completedGoal,
          completedRun,
        };
      }
      next = { ...next, updatedAt: Date.now() };
      const updated = {
        ...snapshot,
        goals: { ...snapshot.goals, [key]: next },
        completed: completedRun,
        updatedAt: next.updatedAt,
      };
      await this.writeSnapshot(updated);
      return this.result(updated, true, formatAllCompleteMessage(completedRun), {
        completed: completedGoal,
        completedRun,
      });
    }

    next = { ...next, updatedAt: Date.now() };
    const updated: GoalSnapshot = {
      ...snapshot,
      goals: { ...snapshot.goals, [key]: next },
      updatedAt: next.updatedAt,
    };
    await this.writeSnapshot(updated);
    return this.result(updated, true, `Goal updated: ${changes.join(', ')}.`);
  }

  async clearGoal(): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const hadGoal = Boolean(snapshot.goals[key]);
    const goals = { ...snapshot.goals };
    delete goals[key];
    const next: GoalSnapshot = {
      ...snapshot,
      goals,
      updatedAt: Date.now(),
    };
    await this.writeSnapshot(next);
    return this.result(next, true, hadGoal ? 'Goal cleared.' : 'No goal was set.');
  }

  async enqueueGoal(input: GoalCreateInput & { source: QueuedGoal['source']; template?: string; templateFlags?: Record<string, string>; templateArgs?: string }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const validation = validateGoalInput(input);
    if (validation) return this.result(snapshot, false, validation);
    const queued = buildQueuedGoal(input);
    const next = { ...snapshot, queue: [...snapshot.queue, queued], updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...this.result(next, true, 'Queued goal.'), queued: [queued] };
  }

  async enqueueGoalBlock(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const items = parseQueueBlockItems(input);
    if (!items) return this.enqueueResolvedGoalInput(input, source);

    const queued: QueuedGoal[] = [];
    for (const item of items) {
      const resolved = await this.resolveObjective(item.objectiveInput);
      if (!resolved.ok) return this.result(snapshot, false, `Queue item ${item.marker} could not be resolved: ${resolved.message}`);
      const validation = validateGoalInput(resolved.input);
      if (validation) return this.result(snapshot, false, `Queue item ${item.marker}: ${validation}`);
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
    return { ...this.result(next, true, `Queued ${queued.length} goals.`), queued };
  }

  async enqueueResolvedGoalInput(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const resolved = await this.resolveObjective(input);
    if (!resolved.ok) {
      const snapshot = await this.readSnapshot();
      return this.result(snapshot, false, resolved.message);
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
    const key = this.goalKey();
    const current = snapshot.goals[key] ? this.withLiveElapsed(snapshot.goals[key]) : null;
    if (current && current.status !== 'complete' && current.status !== 'budgetLimited') {
      return this.result({ ...snapshot, goals: { ...snapshot.goals, [key]: current } }, false, 'A non-terminal goal is already active for this session. The queued goal was left in the queue.');
    }
    const nextQueued = snapshot.queue[0];
    if (!nextQueued) return this.result(snapshot, false, 'No queued goals.');

    const snapshotWithTerminalHistory = current && (current.status === 'complete' || current.status === 'budgetLimited')
      ? {
        ...snapshot,
        goals: { ...snapshot.goals, [key]: current },
        completed: appendCompletedGoal(snapshot.completed, buildCompletedGoal(current, Date.now())),
      }
      : snapshot;
    return this.startQueuedGoalFromSnapshot(snapshotWithTerminalHistory, nextQueued);
  }

  private async startQueuedGoalFromSnapshot(snapshot: GoalSnapshot, nextQueued: QueuedGoal): Promise<GoalMutationResult> {
    let objective = nextQueued.objective;
    if (nextQueued.template) {
      const resolved = await resolveGoalTemplateByName(this.workspaceRoot, nextQueued.template, nextQueued.templateFlags ?? {}, nextQueued.templateArgs ?? '');
      if (!resolved.ok) return this.result(snapshot, false, 'notTemplate' in resolved ? `Unknown goal template '${nextQueued.template}'.` : resolved.error);
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
    const updated: GoalSnapshot = {
      ...snapshot,
      goals: { ...snapshot.goals, [this.goalKey()]: goal },
      queue: snapshot.queue.slice(1),
      updatedAt: now,
    };
    await this.writeSnapshot(updated);
    return { ...this.result(updated, true, 'Started queued goal.'), started: nextQueued, dequeued: nextQueued };
  }

  async dequeueGoal(audit?: { rationale?: string; authority?: string }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    if (!audit?.rationale?.trim() || !audit.authority?.trim()) {
      return this.result(snapshot, false, 'rationale and authority are required to dequeue a queued goal.');
    }
    const dequeued = snapshot.queue[0];
    if (!dequeued) return this.result(snapshot, false, 'No queued goals.');
    const next = { ...snapshot, queue: snapshot.queue.slice(1), updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...this.result(next, true, 'Dequeued goal.'), dequeued };
  }

  async removeQueuedGoal(queueId: string): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const removed = snapshot.queue.find((item) => item.queueId === queueId);
    if (!removed) return this.result(snapshot, false, `No queued goal found with id ${queueId}.`);
    const next = { ...snapshot, queue: snapshot.queue.filter((item) => item.queueId !== queueId), updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...this.result(next, true, 'Removed queued goal.'), removed };
  }

  async editGoalObjective(goalOrQueueId: string, objectiveInput: string): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const objective = objectiveInput.trim();
    if (!objective) {
      return this.result(snapshot, false, 'objective must be non-empty.');
    }
    if (objective.length > MAX_OBJECTIVE_LENGTH) {
      return this.result(snapshot, false, `objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters).`);
    }

    const key = this.goalKey();
    const current = snapshot.goals[key];
    if (current?.goalId === goalOrQueueId) {
      const goal = { ...current, objective, updatedAt: Date.now() };
      const next = {
        ...snapshot,
        goals: { ...snapshot.goals, [key]: goal },
        updatedAt: goal.updatedAt,
      };
      await this.writeSnapshot(next);
      return this.result(next, true, 'Active goal updated.');
    }

    const queueIndex = snapshot.queue.findIndex((item) => item.queueId === goalOrQueueId);
    if (queueIndex === -1) {
      return this.result(
        snapshot,
        false,
        `No goal found with id ${goalOrQueueId} for the current session or queue.`,
      );
    }

    const queued = snapshot.queue[queueIndex];
    const queue = snapshot.queue.slice();
    queue[queueIndex] = {
      ...queued,
      objective,
      template: undefined,
      templateFlags: undefined,
      templateArgs: undefined,
    };
    const next = { ...snapshot, queue, updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return this.result(next, true, 'Queued goal updated.');
  }

  async recordTurnUsage(input: { tokensUsed?: number }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key];
    if (!current) return this.result(snapshot, true, 'No active goal for this session.');
    if (current.status !== 'active') {
      return this.result(snapshot, true, 'Goal usage not recorded because the goal is not active.');
    }
    let goal = this.withLiveElapsed(current);
    goal = {
      ...goal,
      tokensUsed: goal.tokensUsed + Math.max(0, Math.floor(input.tokensUsed ?? 0)),
      updatedAt: Date.now(),
    };
    const limitReason = budgetLimitReason(goal);
    if (limitReason) {
      goal = transitionStatus(goal, 'budgetLimited');
    }
    const next = { ...snapshot, goals: { ...snapshot.goals, [key]: goal }, updatedAt: goal.updatedAt };
    await this.writeSnapshot(next);
    return this.result(next, true, limitReason ? `Goal budget limited: ${limitReason}.` : 'Goal usage recorded.');
  }

  formatSnapshot(snapshot: GoalSnapshot): string {
    const lines: string[] = [];
    const entries = Object.entries(snapshot.goals);
    if (entries.length === 0) {
      lines.push('No goal is currently set.');
    } else {
      entries.forEach(([key, goal], index) => {
        if (index > 0) lines.push('');
        lines.push(`Goal ${goal.goalId}${key !== UNKNOWN_SESSION_KEY ? ` (session ${key})` : ''}`);
        lines.push(`Status: ${goal.status}`);
        lines.push(`Objective: ${goal.objective}`);
        lines.push(`Elapsed: ${formatDuration(goal.timeUsedSeconds)}`);
        lines.push(`Tokens: ${goal.tokensUsed}${goal.tokenBudget ? ` / ${goal.tokenBudget}` : ''}`);
        if (goal.timeBudgetSeconds) lines.push(`Time budget: ${formatDuration(goal.timeBudgetSeconds)}`);
        if (goal.minTokensBeforeWrapUp) lines.push(`Token floor: ${goal.minTokensBeforeWrapUp}`);
        if (goal.minTimeSecondsBeforeWrapUp) lines.push(`Time floor: ${formatDuration(goal.minTimeSecondsBeforeWrapUp)}`);
      });
    }
    if (snapshot.queue.length > 0) {
      lines.push('');
      lines.push(`Queued goals (${snapshot.queue.length}):`);
      snapshot.queue.forEach((item, index) => {
        lines.push(`${index + 1}. [${item.queueId}] ${truncate(item.objective, 120)}`);
      });
    }
    if (snapshot.completed.length > 0) {
      lines.push('');
      lines.push(formatCompletedSummary(snapshot.completed));
    }
    return lines.join('\n');
  }

  private async buildPeers(snapshot: GoalSnapshot, ownKey: string): Promise<GoalPeer[]> {
    const peers: GoalPeer[] = [];
    for (const [key, goal] of Object.entries(snapshot.goals)) {
      if (key === ownKey || key === UNKNOWN_SESSION_KEY) continue;
      if (goal.status !== 'active' && goal.status !== 'paused') continue;
      let ownerAlive = true;
      try {
        ownerAlive = await this.isSessionAlive(key);
      } catch {
        // A failed liveness probe must never block goal inspection.
      }
      peers.push({ sessionId: key, objective: goal.objective, status: goal.status, ownerAlive });
    }
    return peers;
  }

  private async readSnapshot(): Promise<GoalSnapshot> {
    const filePath = this.statePath();
    if (!(await fs.pathExists(filePath))) {
      return emptySnapshot();
    }
    try {
      const raw = await fs.readJson(filePath) as unknown;
      return normalizeSnapshot(raw);
    } catch {
      return emptySnapshot();
    }
  }

  private async writeSnapshot(snapshot: GoalSnapshot): Promise<void> {
    const statePath = this.statePath();
    await fs.ensureDir(path.dirname(statePath));
    await fs.writeJson(statePath, snapshot, { spaces: 2 });
    const publishers = snapshotPublishers.get(statePath);
    if (publishers) {
      await Promise.allSettled([...publishers].map((publish) => publish()));
    }
  }

  private statePath(): string {
    return path.join(this.workspaceRoot, PROJECT_DIR_NAME, GOAL_STATE_FILE);
  }

  private result(
    snapshot: GoalSnapshot,
    ok: boolean,
    message: string,
    extras: Partial<GoalMutationResult> = {},
  ): GoalMutationResult {
    return result(snapshot, ok, message, extras, this.goalKey());
  }

  private withLiveElapsed(goal: GoalState): GoalState {
    if (goal.status !== 'active') return goal;
    const elapsedDelta = Math.max(0, Math.floor((Date.now() - goal.updatedAt) / 1000));
    return { ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsedDelta };
  }
}

async function defaultSessionLivenessProbe(sessionId: string): Promise<boolean> {
  const registry = new ActiveAgentRegistry();
  const active = await registry.listActive();
  return active.some((record) => record.sessionId === sessionId);
}

function emptySnapshot(): GoalSnapshot {
  return { version: 2, goals: {}, queue: [], completed: [], updatedAt: Date.now() };
}

function normalizeSnapshot(value: unknown): GoalSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptySnapshot();
  }
  const raw = value as Record<string, unknown>;
  const goals: Record<string, GoalState> = {};
  if (raw.goals && typeof raw.goals === 'object' && !Array.isArray(raw.goals)) {
    for (const [key, value] of Object.entries(raw.goals)) {
      const goal = normalizeGoal(value);
      if (goal) goals[key] = goal;
    }
  }
  // v1 -> v2 migration: a single `goal` + `activeSessionId` becomes a
  // per-session goal under the owning session (or __unscoped__).
  const legacyGoal = normalizeGoal(raw.goal);
  if (legacyGoal) {
    const legacyKey = typeof raw.activeSessionId === 'string' && raw.activeSessionId.trim()
      ? raw.activeSessionId
      : UNKNOWN_SESSION_KEY;
    goals[legacyKey] = legacyGoal;
  }
  return {
    version: 2,
    goals,
    queue: Array.isArray(raw.queue) ? raw.queue.map(normalizeQueuedGoal).filter((item): item is QueuedGoal => Boolean(item)) : [],
    completed: Array.isArray(raw.completed) ? raw.completed.map(normalizeCompletedGoal).filter((item): item is CompletedGoal => Boolean(item)) : [],
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

function normalizeCompletedGoal(value: unknown): CompletedGoal | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.goalId !== 'string' || typeof raw.objective !== 'string') return null;
  if (raw.status !== 'complete' && raw.status !== 'budgetLimited') return null;
  return {
    goalId: raw.goalId,
    objective: raw.objective,
    status: raw.status,
    tokensUsed: positiveInteger(raw.tokensUsed) ?? 0,
    timeUsedSeconds: positiveInteger(raw.timeUsedSeconds) ?? 0,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : Date.now(),
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

function buildCompletedGoal(goal: GoalState, completedAt: number): CompletedGoal {
  return {
    goalId: goal.goalId,
    objective: goal.objective,
    status: goal.status === 'budgetLimited' ? 'budgetLimited' : 'complete',
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    completedAt,
  };
}

function appendCompletedGoal(completed: CompletedGoal[], goal: CompletedGoal): CompletedGoal[] {
  if (completed.some((item) => item.goalId === goal.goalId)) return completed;
  return [...completed, goal];
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

function result(
  snapshot: GoalSnapshot,
  ok: boolean,
  message: string,
  extras: Partial<GoalMutationResult>,
  key: string,
): GoalMutationResult {
  const goal = snapshot.goals[key] ?? null;
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
    ...extras,
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

function formatAllCompleteMessage(completedRun: CompletedGoal[]): string {
  return [
    'All queued goals are complete.',
    '',
    formatCompletedSummary(completedRun),
  ].join('\n');
}

function formatCompletedSummary(completedRun: CompletedGoal[]): string {
  return [
    `Completed goals this session (${completedRun.length}):`,
    ...completedRun.map((item, index) => `${index + 1}. ${truncate(item.objective, 120)}`),
  ].join('\n');
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}
