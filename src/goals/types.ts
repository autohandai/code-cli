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

export interface GoalSnapshot {
  version: 1;
  goal: GoalState | null;
  queue: QueuedGoal[];
  completed: CompletedGoal[];
  updatedAt: number;
  /** Session currently authorized to continue and account usage to the active goal. */
  activeSessionId?: string;
}

export type GoalSessionAttachment = 'none' | 'unscoped' | 'attached' | 'detached';

export interface GoalSessionSnapshot extends Omit<GoalSnapshot, 'activeSessionId'> {
  sessionAttachment: GoalSessionAttachment;
  detachedGoal?: Pick<GoalState, 'goalId' | 'status' | 'createdAt' | 'updatedAt'>;
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
