/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { PROJECT_DIR_NAME } from '../constants.js';
import { withFileLock } from '../utils/atomicFile.js';
import { GoalSnapshotStore, GoalStorageError } from './GoalSnapshotStore.js';
import { buildCompletionReceipt, parseAcceptanceCriteria } from './GoalCompletion.js';
import { applyGoalProgress } from './GoalProgress.js';
import { parseGoalStatus, UNSCOPED_GOAL_SESSION_KEY as UNKNOWN_SESSION_KEY } from './types.js';
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
  GoalTurnUsageInput,
  GoalUpdateInput,
  QueuedGoal,
} from './types.js';

const GOAL_STATE_FILE = 'goals.local.json';
const MAX_OBJECTIVE_LENGTH = 80_000;

type GoalSnapshotPublisher = () => Promise<void>;

interface GoalSubscriptionGroup {
  publishers: Set<GoalSnapshotPublisher>;
  timer: ReturnType<typeof setInterval>;
}

const subscriptionGroups = new Map<string, GoalSubscriptionGroup>();

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
    'Continue working toward this persistent goal until it is complete, blocked, waiting, paused, cleared, or budget-limited.',
    'Use get_goal or update_goal when you need to inspect or modify the goal state.',
  ].join('\n');
}

export class GoalManager {
  private readonly store: GoalSnapshotStore;
  private storageWarning?: string;
  private readonly sessionId?: string;
  private readonly getSessionId?: () => string | undefined;
  private readonly isSessionAlive: (sessionId: string) => Promise<boolean>;

  constructor(
    private readonly workspaceRoot: string,
    options: GoalManagerOptions = {},
  ) {
    this.store = new GoalSnapshotStore(this.statePath());
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
    const hasDetachedUnscopedGoal = key !== UNKNOWN_SESSION_KEY
      && snapshot.goals[UNKNOWN_SESSION_KEY] !== undefined;
    let message: string | undefined;
    if (peers.length > 0) {
      message = 'No goal is attached to this session. Other sessions are running goals in this workspace; create your own with /goal <objective> to run concurrently.';
    } else if (hasDetachedUnscopedGoal) {
      message = 'A persisted goal exists but is not attached to the current session.';
    }

    if (!goal) {
      return {
        version: 2,
        sessionId: key === UNKNOWN_SESSION_KEY ? undefined : key,
        goal: null,
        queue: snapshot.queue,
        completed: snapshot.completed,
        updatedAt: snapshot.updatedAt,
        sessionAttachment: key === UNKNOWN_SESSION_KEY ? 'unscoped' : 'none',
        peers,
        message,
      };
    }
    return {
      version: 2,
      sessionId: key === UNKNOWN_SESSION_KEY ? undefined : key,
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
    let disposed = false;
    let refreshAgain = false;
    let pending: Promise<void> | undefined;
    let lastValid: GoalSessionSnapshot | undefined;
    let lastFingerprint: string | undefined;
    const publishLatest = async (): Promise<void> => {
      let snapshot: GoalSessionSnapshot;
      try {
        snapshot = await this.getSessionSnapshot();
      } catch (error) {
        const key = this.goalKey();
        const sessionId = key === UNKNOWN_SESSION_KEY ? undefined : key;
        snapshot = {
          ...((lastValid?.sessionId === sessionId ? lastValid : undefined) ?? {
            version: 2, sessionId, goal: null, queue: [], completed: [], peers: [], updatedAt: 0,
            sessionAttachment: key === UNKNOWN_SESSION_KEY ? 'unscoped' : 'none',
          }),
          storageError: error instanceof Error ? error.message : 'Goal storage could not be read.',
        };
      }
      if (disposed) return;
      if ((snapshot.sessionId ?? UNKNOWN_SESSION_KEY) !== this.goalKey()) {
        refreshAgain = true;
        return;
      }
      if (!snapshot.storageError) lastValid = snapshot;
      const fingerprint = JSON.stringify({
        ...snapshot,
        updatedAt: undefined,
        goal: snapshot.goal ? { ...snapshot.goal, timeUsedSeconds: Math.floor(snapshot.goal.timeUsedSeconds) } : null,
      });
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;
      listener(snapshot);
    };
    const publish = (): Promise<void> => {
      refreshAgain = true;
      pending ??= (async () => {
        while (refreshAgain && !disposed) {
          refreshAgain = false;
          await publishLatest();
        }
      })().finally(() => { pending = undefined; });
      return pending;
    };
    let group = subscriptionGroups.get(statePath);
    if (!group) {
      const publishers = new Set<GoalSnapshotPublisher>();
      const timer = setInterval(() => {
        for (const refresh of publishers) void refresh().catch(() => {});
      }, 1000);
      timer.unref();
      group = { publishers, timer };
      subscriptionGroups.set(statePath, group);
    }
    group.publishers.add(publish);
    void publish().catch(() => {});

    return () => {
      if (disposed) return;
      disposed = true;
      group.publishers.delete(publish);
      if (group.publishers.size === 0) {
        clearInterval(group.timer);
        subscriptionGroups.delete(statePath);
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

  async prepareSessionRecovery(sessionId: string): Promise<GoalMutationResult> {
    return this.withMutation(async () => {
      const snapshot = await this.readSnapshot();
      const key = this.goalKey();
      if (!/^[a-zA-Z0-9_.-]+$/.test(sessionId) || sessionId === '.' || sessionId === '..' || sessionId === UNKNOWN_SESSION_KEY) {
        return this.result(snapshot, false, 'Recovery requires an exact saved session ID, not a path or an unscoped goal.');
      }
      if (sessionId === key) return this.result(snapshot, false, 'This goal is already attached. Use /goal resume when ready.');
      const target = snapshot.goals[sessionId];
      if (!target || target.status === 'complete' || target.status === 'budgetLimited') {
        return this.result(snapshot, false, 'No unfinished goal exists for that session.');
      }
      if (snapshot.goals[key]?.status === 'active') {
        return this.result(snapshot, false, 'Pause or complete this session’s active goal before recovering another session.');
      }
      try {
        if (await this.isSessionAlive(sessionId)) return this.result(snapshot, false, 'Cannot recover a goal owned by a live session.');
      } catch {
        return this.result(snapshot, false, 'Could not verify session liveness. No goals were changed.');
      }
      if (target.status !== 'active') return this.result(snapshot, true, 'Goal is stopped and ready for conversation recovery.');
      const now = Date.now();
      const next: GoalSnapshot = {
        ...snapshot,
        goals: { ...snapshot.goals, [sessionId]: { ...target, status: 'paused', updatedAt: now } },
        updatedAt: now,
      };
      await this.writeSnapshot(next);
      return this.result(next, true, 'Offline goal paused for conversation recovery; saved usage was preserved.');
    });
  }

  async repairSnapshot(): Promise<GoalMutationResult> {
    return this.withMutation(async () => {
      try {
        const current = await this.readSnapshot();
        return this.result(current, false, 'Goal storage is valid. No recovery was needed.');
      } catch (error) {
        if (!(error instanceof GoalStorageError) || error.kind !== 'corrupt') throw error;
      }
      const backup = await this.store.readBackup();
      for (const sessionId of Object.keys(backup.goals)) {
        if (sessionId !== this.goalKey() && sessionId !== UNKNOWN_SESSION_KEY && await this.isSessionAlive(sessionId)) {
          throw new GoalStorageError('stop other workspace sessions before restoring a backup. No goals were changed.', 'unreadable');
        }
      }
      const now = Date.now();
      const restored: GoalSnapshot = {
        ...backup,
        goals: Object.fromEntries(Object.entries(backup.goals).map(([key, goal]) => [key,
          goal.status === 'active' ? { ...goal, status: 'paused' as const, updatedAt: now } : goal,
        ])),
        updatedAt: now,
      };
      const preservedPath = await this.store.restore(restored);
      await this.publishSnapshot();
      return this.result(restored, true,
        `Goal storage restored from ${this.store.backupPath}. Active goals were paused; use /goal resume when ready.${preservedPath ? ` Damaged data preserved at ${preservedPath}.` : ''}`,
        { recovery: { backupPath: this.store.backupPath, preservedPath } },
      );
    });
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
    return this.withMutation(() => this.createGoalUnlocked(input, opts));
  }

  private async createGoalUnlocked(input: GoalCreateInput, opts: { replace?: boolean } = {}): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const validation = validateGoalInput(input);
    if (validation) return this.result(snapshot, false, validation);

    const key = this.goalKey();
    const existing = snapshot.goals[key];
    const existingIsTerminal = existing?.status === 'complete' || existing?.status === 'budgetLimited';
    if (existing && !existingIsTerminal && !opts.replace) {
      return this.result(snapshot, false, 'A goal already exists for this session. Clear it, complete it, or queue the new objective before replacing it.');
    }

    const now = Date.now();
    const goal: GoalState = {
      goalId: crypto.randomUUID(),
      objective: input.objective.trim(),
      acceptanceCriteria: parseAcceptanceCriteria(input.acceptanceCriteria),
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
      completed: existing && existingIsTerminal
        ? appendCompletedGoal(snapshot.completed, buildCompletedGoal(existing, now, key))
        : snapshot.completed,
      updatedAt: now,
    };
    await this.writeSnapshot(next);
    const message = existingIsTerminal
      ? `Goal created; replaced ${existing.status === 'complete' ? 'completed' : 'budget-limited'} goal.`
      : 'Goal created.';
    return this.result(next, true, message);
  }

  async createOrQueueGoal(input: GoalCreateInput & { source: QueuedGoal['source'] }): Promise<GoalMutationResult> {
    return this.withMutation(() => this.createOrQueueGoalUnlocked(input));
  }

  private async createOrQueueGoalUnlocked(input: GoalCreateInput & { source: QueuedGoal['source'] }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key] ? this.withLiveElapsed(snapshot.goals[key]) : null;
    if (current && current.status !== 'complete' && current.status !== 'budgetLimited') {
      return this.enqueueGoalUnlocked(input);
    }
    return this.createGoalUnlocked(input);
  }

  async updateGoal(input: GoalUpdateInput): Promise<GoalMutationResult> {
    return this.withMutation(() => this.updateGoalUnlocked(input));
  }

  private async updateGoalUnlocked(input: GoalUpdateInput): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key] ? this.withLiveElapsed(snapshot.goals[key]) : null;
    if (!current) return this.result(snapshot, false, 'No goal exists for this session to update.');
    if (input.completionEvidence !== undefined && input.status !== 'complete') {
      return this.result(snapshot, false, 'completion evidence can only be submitted when completing a goal.');
    }

    let next: GoalState = { ...current };
    const changes: string[] = [];
    try {
      parseGoalStatus(input.status);
      next = applyGoalProgress(next, input);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return this.result(snapshot, false, error.message);
    }
    if (input.checkpoint !== undefined) changes.push('checkpoint');
    if (input.stopReason !== undefined || input.resumeWhen !== undefined) changes.push('stop details');
    if (input.objective !== undefined) {
      const objective = input.objective.trim();
      if (!objective) return this.result(snapshot, false, 'objective must be non-empty.');
      if (objective.length > MAX_OBJECTIVE_LENGTH) return this.result(snapshot, false, `objective is too long (max ${MAX_OBJECTIVE_LENGTH} characters).`);
      next = { ...next, objective, completionReceipt: undefined };
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
      if (input.status === 'complete' && !floorMet(next)) {
        return this.result(snapshot, false, 'Completion floor is not met yet. Keep working, raise the floor, or clear the goal if the user explicitly wants to stop.');
      }
      if (input.status === 'complete') {
        try {
          next.completionReceipt = buildCompletionReceipt(input.completionEvidence, next.acceptanceCriteria);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          return this.result(snapshot, false, error.message);
        }
      } else {
        next.completionReceipt = undefined;
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
      const completedGoal = buildCompletedGoal(next, Date.now(), key);
      const completedRun = [...snapshot.completed.filter((item) => item.goalId !== completedGoal.goalId), completedGoal];
      next = { ...next, updatedAt: Date.now() };
      const updated: GoalSnapshot = {
        ...snapshot,
        goals: { ...snapshot.goals, [key]: next },
        completed: completedRun,
        updatedAt: next.updatedAt,
      };
      await this.writeSnapshot(updated);
      const nextQueued = snapshot.queue[0];
      if (nextQueued) {
        const started = await this.startQueuedGoalFromSnapshot(updated, nextQueued);
        if (!started.ok) {
          return this.result(updated, true,
            `Goal completed. The next queued goal was not started: ${started.message} The queue is unchanged; repair the template and use /goal resume or start_queued_goal.`,
            { completed: completedGoal, completedRun, queueError: started.message },
          );
        }
        return {
          ...started,
          message: 'Goal completed. Started next queued goal.',
          completed: completedGoal,
          completedRun,
        };
      }
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
    return this.withMutation(() => this.clearGoalUnlocked());
  }

  private async clearGoalUnlocked(): Promise<GoalMutationResult> {
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
    return this.withMutation(() => this.enqueueGoalUnlocked(input));
  }

  private async enqueueGoalUnlocked(input: GoalCreateInput & { source: QueuedGoal['source']; template?: string; templateFlags?: Record<string, string>; templateArgs?: string }): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const validation = validateGoalInput(input);
    if (validation) return this.result(snapshot, false, validation);
    const queued = buildQueuedGoal(input);
    const next = { ...snapshot, queue: [...snapshot.queue, queued], updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...this.result(next, true, 'Queued goal.'), queued: [queued] };
  }

  async enqueueGoalBlock(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    return this.withMutation(() => this.enqueueGoalBlockUnlocked(input, source));
  }

  private async enqueueGoalBlockUnlocked(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const items = parseQueueBlockItems(input);
    if (!items) return this.enqueueResolvedGoalInputUnlocked(input, source);

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
    return this.withMutation(() => this.enqueueResolvedGoalInputUnlocked(input, source));
  }

  private async enqueueResolvedGoalInputUnlocked(input: string, source: QueuedGoal['source']): Promise<GoalMutationResult> {
    const resolved = await this.resolveObjective(input);
    if (!resolved.ok) {
      const snapshot = await this.readSnapshot();
      return this.result(snapshot, false, resolved.message);
    }
    return this.enqueueGoalUnlocked({
      ...resolved.input,
      source,
      template: resolved.template,
      templateFlags: resolved.templateFlags,
      templateArgs: resolved.templateArgs,
    });
  }

  async startQueuedGoal(): Promise<GoalMutationResult> {
    return this.withMutation(() => this.startQueuedGoalUnlocked());
  }

  private async startQueuedGoalUnlocked(): Promise<GoalMutationResult> {
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
        completed: appendCompletedGoal(snapshot.completed, buildCompletedGoal(current, Date.now(), key)),
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
      acceptanceCriteria: nextQueued.acceptanceCriteria,
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
    return this.withMutation(() => this.dequeueGoalUnlocked(audit));
  }

  private async dequeueGoalUnlocked(audit?: { rationale?: string; authority?: string }): Promise<GoalMutationResult> {
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
    return this.withMutation(() => this.removeQueuedGoalUnlocked(queueId));
  }

  private async removeQueuedGoalUnlocked(queueId: string): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const removed = snapshot.queue.find((item) => item.queueId === queueId);
    if (!removed) return this.result(snapshot, false, `No queued goal found with id ${queueId}.`);
    const next = { ...snapshot, queue: snapshot.queue.filter((item) => item.queueId !== queueId), updatedAt: Date.now() };
    await this.writeSnapshot(next);
    return { ...this.result(next, true, 'Removed queued goal.'), removed };
  }

  async editGoalObjective(goalOrQueueId: string, objectiveInput: string): Promise<GoalMutationResult> {
    return this.withMutation(() => this.editGoalObjectiveUnlocked(goalOrQueueId, objectiveInput));
  }

  private async editGoalObjectiveUnlocked(goalOrQueueId: string, objectiveInput: string): Promise<GoalMutationResult> {
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
      if (current.status === 'complete' && current.acceptanceCriteria) {
        return this.result(snapshot, false, 'Resume the completed goal before editing its objective and recording new evidence.');
      }
      const goal = { ...this.withLiveElapsed(current), objective, completionReceipt: undefined, updatedAt: Date.now() };
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

  async recordTurnUsage(input: GoalTurnUsageInput): Promise<GoalMutationResult> {
    if (input.goalId === null) {
      return this.result(await this.readSnapshot(), true, 'No goal owned this turn.');
    }
    return this.withMutation(() => this.recordTurnUsageUnlocked(input));
  }

  private async recordTurnUsageUnlocked(input: GoalTurnUsageInput): Promise<GoalMutationResult> {
    const snapshot = await this.readSnapshot();
    const key = this.goalKey();
    const current = snapshot.goals[key];
    const tokens = Number.isFinite(input.tokensUsed) ? Math.max(0, Math.floor(input.tokensUsed ?? 0)) : 0;
    if (input.goalId && current?.goalId !== input.goalId) {
      const completedIndex = snapshot.completed.findIndex((goal) => (
        goal.goalId === input.goalId && (goal.sessionId ?? UNKNOWN_SESSION_KEY) === key
      ));
      if (completedIndex < 0) return this.result(snapshot, true, 'The turn goal is no longer available for this session.');
      const completed = snapshot.completed.slice();
      completed[completedIndex] = {
        ...completed[completedIndex],
        tokensUsed: completed[completedIndex].tokensUsed + tokens,
      };
      const next = { ...snapshot, completed, updatedAt: Date.now() };
      await this.writeSnapshot(next);
      return this.result(next, true, 'Completed goal usage recorded.');
    }
    if (!current) return this.result(snapshot, true, 'No active goal for this session.');
    if (current.status !== 'active' && input.goalId === undefined) {
      return this.result(snapshot, true, 'Goal usage not recorded because the goal is not active.');
    }
    let goal = this.withLiveElapsed(current);
    goal = {
      ...goal,
      tokensUsed: goal.tokensUsed + tokens,
      updatedAt: Date.now(),
    };
    const limitReason = goal.status === 'active' ? budgetLimitReason(goal) : null;
    if (limitReason) {
      goal = transitionStatus(goal, 'budgetLimited');
    }
    const completed = snapshot.completed.map((entry) => entry.goalId === goal.goalId
      ? { ...entry, tokensUsed: goal.tokensUsed }
      : entry);
    const next = { ...snapshot, goals: { ...snapshot.goals, [key]: goal }, completed, updatedAt: goal.updatedAt };
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
      if (goal.status === 'complete' || goal.status === 'budgetLimited') continue;
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

  private result(snapshot: GoalSnapshot, ok: boolean, message: string, extras: Partial<GoalMutationResult> = {}): GoalMutationResult {
    const goal = snapshot.goals[this.goalKey()] ?? null;
    return {
      ok,
      goal,
      queue: snapshot.queue,
      message,
      storageWarning: this.storageWarning,
      telemetry: goal ? {
        timeRemainingSeconds: goal.timeBudgetSeconds !== undefined ? Math.max(0, goal.timeBudgetSeconds - goal.timeUsedSeconds) : undefined,
        tokensRemaining: goal.tokenBudget !== undefined ? Math.max(0, goal.tokenBudget - goal.tokensUsed) : undefined,
        completionFloorMet: floorMet(goal),
      } : undefined,
      ...extras,
    };
  }

  private async readSnapshot(): Promise<GoalSnapshot> {
    return this.store.read();
  }

  private async writeSnapshot(snapshot: GoalSnapshot): Promise<void> {
    this.storageWarning = await this.store.write(snapshot);
    await this.publishSnapshot();
  }

  private async publishSnapshot(): Promise<void> {
    const statePath = this.statePath();
    const group = subscriptionGroups.get(statePath);
    if (group) {
      await Promise.allSettled([...group.publishers].map((publish) => publish()));
    }
  }

  private withMutation<T>(operation: () => Promise<T>): Promise<T> {
    return withFileLock(
      `${this.statePath()}.lock`,
      () => {
        this.storageWarning = undefined;
        return operation();
      },
      { waitTimeoutMs: 10_000 },
    );
  }

  private statePath(): string {
    return path.join(this.workspaceRoot, PROJECT_DIR_NAME, GOAL_STATE_FILE);
  }

  private withLiveElapsed(goal: GoalState): GoalState {
    if (goal.status !== 'active') return goal;
    const elapsedDelta = Math.max(0, (Date.now() - goal.updatedAt) / 1000);
    return { ...goal, timeUsedSeconds: goal.timeUsedSeconds + elapsedDelta };
  }
}

async function defaultSessionLivenessProbe(sessionId: string): Promise<boolean> {
  const registry = new ActiveAgentRegistry();
  const active = await registry.listActive();
  return active.some((record) => record.sessionId === sessionId);
}


function buildQueuedGoal(input: GoalCreateInput & { source: QueuedGoal['source']; template?: string; templateFlags?: Record<string, string>; templateArgs?: string }): QueuedGoal {
  return {
    queueId: `q-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    objective: input.objective.trim(),
    acceptanceCriteria: parseAcceptanceCriteria(input.acceptanceCriteria),
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

function buildCompletedGoal(goal: GoalState, completedAt: number, sessionId: string): CompletedGoal {
  return {
    goalId: goal.goalId,
    sessionId,
    objective: goal.objective,
    acceptanceCriteria: goal.acceptanceCriteria,
    completionReceipt: goal.completionReceipt,
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
  try {
    parseAcceptanceCriteria(input.acceptanceCriteria);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return error.message;
  }
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
  return { ...goal, status, updatedAt: Date.now() };
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

function floorMet(goal: GoalState): boolean {
  const tokenMet = goal.minTokensBeforeWrapUp === undefined || goal.tokensUsed >= goal.minTokensBeforeWrapUp;
  const timeMet = goal.minTimeSecondsBeforeWrapUp === undefined || goal.timeUsedSeconds >= goal.minTimeSecondsBeforeWrapUp;
  return tokenMet && timeMet;
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
