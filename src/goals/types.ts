/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type GoalStatus = 'active' | 'paused' | 'budgetLimited' | 'complete';

export interface GoalState {
  goalId: string;
  objective: string;
  status: GoalStatus;
  tokenBudget?: number;
  timeBudgetSeconds?: number;
  minTokensBeforeWrapUp?: number;
  minTimeSecondsBeforeWrapUp?: number;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueuedGoal {
  queueId: string;
  objective: string;
  tokenBudget?: number;
  timeBudgetSeconds?: number;
  minTokensBeforeWrapUp?: number;
  minTimeSecondsBeforeWrapUp?: number;
  source: 'command' | 'tool' | 'rpc' | 'cli';
  template?: string;
  templateFlags?: Record<string, string>;
  templateArgs?: string;
  createdAt: number;
}

export interface CompletedGoal {
  goalId: string;
  objective: string;
  status: Extract<GoalStatus, 'complete' | 'budgetLimited'>;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  completedAt: number;
}

/**
 * Persistent goal state for a workspace.
 *
 * v2 stores one active goal per session (`goals` keyed by sessionId, with
 * `__unscoped__` for managers without a session) so multiple terminals can run
 * goals concurrently. The workspace-wide `queue` remains a shared backlog.
 */
export interface GoalSnapshot {
  version: 2;
  /** sessionId (or `__unscoped__`) -> that session's active goal. */
  goals: Record<string, GoalState>;
  queue: QueuedGoal[];
  completed: CompletedGoal[];
  updatedAt: number;
}

export type GoalSessionAttachment = 'none' | 'unscoped' | 'attached';

/** Another session's active goal, surfaced so concurrent sessions stay aware. */
export interface GoalPeer {
  sessionId: string;
  objective: string;
  status: GoalStatus;
  ownerAlive: boolean;
}

/** Per-session view of the workspace goal state (what `get_goal` returns). */
export interface GoalSessionSnapshot {
  version: 2;
  /** This session's active goal, if any. */
  goal: GoalState | null;
  queue: QueuedGoal[];
  completed: CompletedGoal[];
  updatedAt: number;
  sessionAttachment: GoalSessionAttachment;
  /** Active goals owned by other sessions in this workspace. */
  peers: GoalPeer[];
  message?: string;
}

export interface GoalTemplateMetadata {
  name: string;
  path: string;
  description?: string;
  aliases: string[];
  allowCommands: boolean;
  requiredPlaceholders: string[];
  requiredFlags: string[];
  requiresArgs: boolean;
}

export interface GoalMutationResult {
  ok: boolean;
  goal: GoalState | null;
  queue: QueuedGoal[];
  telemetry?: {
    timeRemainingSeconds?: number;
    tokensRemaining?: number;
    completionFloorMet?: boolean;
  };
  message?: string;
  queued?: QueuedGoal[];
  started?: QueuedGoal;
  completed?: CompletedGoal;
  completedRun?: CompletedGoal[];
  dequeued?: QueuedGoal;
  removed?: QueuedGoal;
}

export interface GoalCreateInput {
  objective: string;
  tokenBudget?: number;
  timeBudgetSeconds?: number;
  minTokensBeforeWrapUp?: number;
  minTimeSecondsBeforeWrapUp?: number;
}

export interface GoalUpdateInput {
  objective?: string;
  status?: GoalStatus;
  tokenBudget?: number | null;
  timeBudgetSeconds?: number | null;
  minTokensBeforeWrapUp?: number | null;
  minTimeSecondsBeforeWrapUp?: number | null;
}