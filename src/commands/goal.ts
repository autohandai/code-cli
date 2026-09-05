/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import path from 'node:path';
import { showModal } from '../ui/ink/components/Modal.js';
import { activateGoalAutoMode } from '../core/agent/GoalActivation.js';
import { buildGoalContinuationInstruction, GoalManager } from '../goals/GoalManager.js';
import { parseCompletionEvidence } from '../goals/GoalCompletion.js';
import { parseGoalCheckpoint, parseGoalProgressCommand } from '../goals/GoalProgress.js';
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import type { GoalMutationResult, GoalSessionSnapshot, GoalState } from '../goals/types.js';
import type { GoalEventData } from '../telemetry/types.js';
import { GOAL_FEATURE_DISABLED_MESSAGE, resolveGoalFeatureEnabled } from '../goals/feature.js';

const GOAL_OBJECTIVE_PREVIEW_LENGTH = 160;

type GoalCommandContext = Pick<SlashCommandContext, 'workspaceRoot'> & Partial<SlashCommandContext>;

export const metadata: SlashCommand = {
  command: '/goal',
  description: 'Create, inspect, refine, pause, resume, complete, clear, and queue persistent goals',
  implemented: true,
  subcommands: [
    { name: 'writer', description: 'Interview the user and draft a stronger goal before creating it' },
    { name: 'view', description: 'Open the live goal queue view' },
    { name: 'edit', description: 'Edit an active or queued goal by ID' },
    { name: 'queue', description: 'List queued goals or enqueue a goal' },
    { name: 'pause', description: 'Pause the current goal' },
    { name: 'blocked', description: 'Stop with a reason, resumption condition, and optional checkpoint JSON' },
    { name: 'waiting', description: 'Wait for an external condition with optional checkpoint JSON' },
    { name: 'checkpoint', description: 'Save progress and the next step as JSON' },
    { name: 'resume', description: 'Resume a paused or queued goal' },
    { name: 'complete', description: 'Mark the current goal complete' },
    { name: 'clear', description: 'Clear the current goal' },
    { name: 'repair', description: 'Restore damaged goal storage from its validated backup' },
    { name: 'recover', description: 'Restore an offline goal’s conversation without starting work' },
    { name: 'templates', description: 'List reusable .pi-goals templates' },
  ],
};

export const goalsMetadata: SlashCommand = {
  ...metadata,
  command: '/goals',
  description: 'Open the live goals queue and manage persistent goals',
};

export async function goal(ctx: GoalCommandContext, args: string[] = []): Promise<string> {
  if (!resolveGoalFeatureEnabled(ctx.config, ctx.isFeatureEnabled)) {
    return GOAL_FEATURE_DISABLED_MESSAGE;
  }
  await ctx.trackFeatureActivation?.('slash_goal', { surface: 'slash_command' });

  const manager = new GoalManager(ctx.workspaceRoot, {
    sessionId: ctx.sessionManager?.getCurrentSession()?.metadata.sessionId,
  });
  const input = args.join(' ').trim();
  if (!input) {
    const snapshot = await manager.getSessionSnapshot();
    const hasLivePeer = snapshot.peers.some((peer) => peer.ownerAlive);
    if (!snapshot.goal && snapshot.queue.length > 0 && !hasLivePeer) {
      const started = await manager.startQueuedGoal();
      if (started.ok && started.goal) {
        queueGoalContinuation(ctx, started.goal.objective);
      }
      return formatMutation(started);
    }
    if (
      !snapshot.goal
      && snapshot.queue.length === 0
      && snapshot.completed.length === 0
      && snapshot.peers.length === 0
    ) {
      return startGoalWriter(ctx);
    }
    return formatSnapshot(snapshot);
  }

  const [subcommand, ...restArgs] = args;
  const rest = restArgs.join(' ').trim();

  switch (subcommand?.toLowerCase()) {
    case 'writer':
    case 'write':
    case 'refine':
      return startGoalWriter(ctx, rest);
    case 'view': {
      if (!ctx.onToggleGoalView || ctx.isNonInteractive) {
        return formatSnapshot(await manager.getSessionSnapshot());
      }
      ctx.onToggleGoalView(true);
      return 'Opened the live goals view. Press Cmd+G or Ctrl+G to close it.';
    }
    case 'edit': {
      const goalOrQueueId = restArgs[0];
      const objective = restArgs.slice(1).join(' ').trim();
      if (!goalOrQueueId || !objective) {
        return 'Usage: /goal edit <goal-or-queue-id> <objective>';
      }
      return formatMutation(await manager.editGoalObjective(goalOrQueueId, objective));
    }
    case 'queue':
      return handleQueue(manager, rest);
    case 'pause': {
      const paused = await manager.updateGoal({ status: 'paused' });
      reportGoal(ctx, paused, 'paused');
      return formatMutation(paused);
    }
    case 'blocked':
    case 'waiting':
    case 'checkpoint': {
      const operation = subcommand.toLowerCase();
      let update;
      try {
        const value: unknown = JSON.parse(rest);
        update = operation === 'checkpoint'
          ? { checkpoint: parseGoalCheckpoint(value) }
          : { ...parseGoalProgressCommand(value), status: operation === 'blocked' ? 'blocked' as const : 'waiting' as const };
      } catch (error) {
        return `Invalid goal progress: ${error instanceof Error ? error.message : 'expected JSON'}`;
      }
      return formatMutation(await manager.updateGoal(update));
    }
    case 'resume': {
      const snapshot = await manager.getSessionSnapshot();
      const canStartQueued = !snapshot.goal || snapshot.goal.status === 'complete' || snapshot.goal.status === 'budgetLimited';
      if (canStartQueued && snapshot.queue.length > 0) {
        const started = await manager.startQueuedGoal();
        if (started.ok && started.goal) {
          queueGoalContinuation(ctx, started.goal.objective);
        }
        return formatMutation(started);
      }
      const resumed = await manager.updateGoal({ status: 'active' });
      reportGoal(ctx, resumed, 'resumed');
      if (resumed.ok && resumed.goal) {
        queueGoalContinuation(ctx, resumed.goal.objective);
      }
      return formatMutation(resumed);
    }
    case 'complete': {
      let completionEvidence;
      if (rest) {
        try {
          completionEvidence = parseCompletionEvidence(JSON.parse(rest) as unknown);
        } catch (error) {
          return `Invalid completion evidence: ${error instanceof Error ? error.message : 'expected JSON'}`;
        }
      }
      const completed = await manager.updateGoal({ status: 'complete', completionEvidence });
      reportGoal(ctx, completed, 'completed');
      if (completed.ok && completed.started && completed.goal?.status === 'active') {
        queueGoalContinuation(ctx, completed.goal.objective);
      }
      return formatMutation(completed);
    }
    case 'clear': {
      const cleared = await manager.clearGoal();
      reportGoal(ctx, cleared, 'cancelled');
      return formatMutation(cleared);
    }
    case 'repair':
      return formatMutation(await manager.repairSnapshot());
    case 'recover':
      return recoverGoalSession(ctx, manager, rest);
    case 'templates': {
      const templates = await manager.listTemplates();
      if (templates.length === 0) return 'No goal templates found in .pi-goals/ or .ai/.pi-goals/.';
      return [
        `Goal templates (${templates.length}):`,
        ...templates.map((template) => {
          const aliases = template.aliases.length ? ` aliases: ${template.aliases.join(', ')}` : '';
          return `- ${template.name}${aliases}${template.description ? ` - ${template.description}` : ''}`;
        }),
      ].join('\n');
    }
    default: {
      const resolved = await manager.resolveObjective(input);
      if (!resolved.ok) return chalk.yellow(resolved.message);
      // Setting a goal while one is active queues it rather than refusing, so
      // the objectives run back to back. This matches the goal tool and the RPC
      // surface, which have always used createOrQueueGoal.
      const created = await manager.createOrQueueGoal({ ...resolved.input, source: 'command' });
      // When the objective is queued behind a running goal, the result still
      // reports that running goal. Only nudge the agent when a goal actually
      // started, or the active goal gets a duplicate continuation each time.
      if (created.ok && !created.queued?.length && created.goal) {
        await emitGoalWrittenCompleted(ctx, created.goal, 'slash');
        queueGoalContinuation(ctx, created.goal.objective);
      }
      return formatMutation(created);
    }
  }
}

export async function runGoalCli(workspaceRoot: string, rawInput?: string, config?: SlashCommandContext['config']): Promise<string> {
  if (!resolveGoalFeatureEnabled(config)) {
    return GOAL_FEATURE_DISABLED_MESSAGE;
  }

  const manager = new GoalManager(workspaceRoot);
  const input = rawInput?.trim() ?? '';
  if (!input) return formatSnapshot(await manager.getSessionSnapshot());
  const structured = /^(complete|blocked|waiting|checkpoint)\s+([\s\S]+)$/i.exec(input);
  if (structured) return goal({ workspaceRoot, config, isNonInteractive: true }, [structured[1], structured[2]]);

  const args = input.match(/"[^"]*"|'[^']*'|\S+/g)?.map(unquote) ?? [];
  return goal({ workspaceRoot, config, isNonInteractive: true }, args);
}

function startGoalWriter(ctx: GoalCommandContext, roughGoal?: string): string {
  if (ctx.isNonInteractive || !ctx.queueInstruction) {
    return 'Goal writer requires an interactive session. Run autohand, then /goal writer.';
  }
  const activated = ctx.skillsRegistry?.activateSkill('goal-writer') ?? false;
  const roughGoalText = roughGoal?.trim() || 'No rough goal was provided yet.';
  ctx.queueInstruction?.([
    'Activate the built-in goal-writer skill and use it to help the user draft one or more stronger /goal objectives.',
    'Interview the user with follow-up questions when the finish line, proof, boundaries, loop, or stop rule is unclear.',
    'Show every full drafted objective and get explicit user approval before calling create_goal. If more than one goal is approved, call create_goal for each one in order so later goals are queued.',
    `Rough goal request: ${roughGoalText}`,
  ].join('\n'));

  return [
    'Goal writer started.',
    activated
      ? 'The built-in $goal-writer skill is active for the next turn.'
      : 'The next turn will use the built-in $goal-writer skill instructions if available.',
    'Answer the follow-up questions to create a completion contract with proof, boundaries, and a stop rule.',
  ].join('\n');
}

async function recoverGoalSession(ctx: GoalCommandContext, manager: GoalManager, requestedId: string): Promise<string> {
  const snapshot = await manager.getSessionSnapshot();
  const offline = snapshot.peers.filter((peer) => !peer.ownerAlive);
  if (ctx.isNonInteractive || !ctx.restoreSession || !ctx.sessionManager) {
    return [
      'Recover a goal from an interactive session; recovery does not start work.',
      ...offline.map((peer) => `/goal recover ${peer.sessionId} — ${formatObjectivePreview(peer.objective)} (${peer.status})`),
      ...(offline.length ? [] : ['No offline goal sessions are available.']),
    ].join('\n');
  }
  if (snapshot.goal?.status === 'active') return 'Pause or complete this session’s active goal before recovering another session.';
  let sessionId = requestedId;
  if (!sessionId) {
    if (!offline.length) return 'No offline goal sessions are available. Live sessions cannot be recovered.';
    try {
      await ctx.onBeforeModal?.();
      const selection = await showModal({
        title: 'Recover an offline goal',
        hint: '↑↓ choose · enter restore conversation · esc cancel · goals stay stopped',
        options: offline.map((peer) => ({
          value: peer.sessionId, label: formatObjectivePreview(peer.objective),
          description: `${peer.sessionId} · ${peer.status} · offline`,
        })),
      });
      if (!selection) return 'Recovery cancelled. No goals were changed.';
      sessionId = selection.value;
    } catch (error) {
      return `Goal recovery failed: ${error instanceof Error ? error.message : 'picker unavailable'}`;
    } finally {
      await ctx.onAfterModal?.();
    }
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    return 'Recovery requires an exact saved session ID, not a path.';
  }
  try {
    const sessions = await ctx.sessionManager.listSessions({ project: ctx.workspaceRoot });
    if (!sessions.some((session) => session.sessionId === sessionId && path.resolve(session.projectPath) === path.resolve(ctx.workspaceRoot))) {
      return 'The original conversation is unavailable in this workspace. No goals were changed.';
    }
    const prepared = await manager.prepareSessionRecovery(sessionId);
    if (!prepared.ok) return prepared.message ?? 'Recovery was refused.';
    try {
      await ctx.restoreSession(sessionId);
    } catch (error) {
      return `Conversation recovery failed: ${error instanceof Error ? error.message : 'unknown error'}. The original goal remains safely stopped; retry /goal recover ${sessionId}.`;
    }
    return [`Recovered session ${sessionId}. Its goal remains stopped; use /goal resume when ready.`, prepared.storageWarning].filter(Boolean).join('\n');
  } catch (error) {
    return `Goal recovery failed: ${error instanceof Error ? error.message : 'unknown error'}`;
  }
}

async function emitGoalWrittenCompleted(
  ctx: GoalCommandContext,
  goalState: GoalState,
  source: string
): Promise<void> {
  await ctx.hookManager?.executeHooks('goal-written:completed', {
    goalId: goalState.goalId,
    goalObjective: goalState.objective,
    goalSource: source,
  });
}

async function handleQueue(manager: GoalManager, rest: string): Promise<string> {
  if (!rest) {
    const snapshot = await manager.getSnapshot();
    if (snapshot.queue.length === 0) return 'No queued goals.';
    return formatQueue(snapshot);
  }
  return formatMutation(await manager.enqueueGoalBlock(rest, 'command'));
}

function queueGoalContinuation(ctx: GoalCommandContext, objective: string): void {
  activateGoalAutoMode(ctx);
  ctx.queueInstruction?.(buildGoalContinuationInstruction(objective));
}

function formatMutation(result: GoalMutationResult): string {
  const lines = [result.ok ? chalk.green(result.message ?? 'Goal updated.') : chalk.yellow(result.message ?? 'Goal command failed.')];
  if (result.storageWarning) lines.push(chalk.yellow(result.storageWarning));
  if (result.goal) {
    lines.push('');
    lines.push(formatGoal(result.goal));
  }
  if (result.queued?.length) {
    lines.push('');
    lines.push(`Queued ${result.queued.length} goal${result.queued.length === 1 ? '' : 's'}:`);
    for (const item of result.queued) {
      lines.push(`- [${item.queueId}] ${formatObjectivePreview(item.objective)}`);
    }
  }
  if (result.started) {
    lines.push(`Started queue item: ${result.started.queueId}`);
  }
  if (result.completedRun?.length && result.queue.length === 0) {
    lines.push('');
    lines.push(formatCompletedRun(result.completedRun));
  }
  if (result.queue.length > 0 && !result.queued?.length) {
    lines.push('');
    lines.push(formatQueue({ queue: result.queue }));
  }
  return lines.join('\n');
}

function formatSnapshot(snapshot: GoalSessionSnapshot): string {
  if (
    !snapshot.goal
    && snapshot.queue.length === 0
    && snapshot.completed.length === 0
    && snapshot.peers.length === 0
  ) {
    return [
      'No goal is currently set.',
      'Use /goal <objective> to create one, or /goal queue <objective> to queue later work.',
    ].join('\n');
  }
  const parts: string[] = [];
  if (snapshot.goal) parts.push(formatGoal(snapshot.goal));
  else parts.push('No active goal.');
  if (snapshot.queue.length > 0) {
    parts.push('');
    parts.push(formatQueue(snapshot));
  }
  if (snapshot.completed.length > 0) {
    parts.push('');
    parts.push(formatCompletedRun(snapshot.completed));
  }
  if (snapshot.peers.length > 0) {
    parts.push('');
    parts.push([
      `Other active sessions (${snapshot.peers.length}):`,
      ...snapshot.peers.map((peer) => (
        `- ${formatObjectivePreview(peer.objective)} (${peer.status}${peer.ownerAlive ? '' : ', session offline'}) · ${peer.sessionId}${peer.ownerAlive ? '' : ` · /goal recover ${peer.sessionId}`}`
      )),
    ].join('\n'));
  }
  return parts.join('\n');
}

function formatGoal(goalState: GoalState): string {
  const lines = [
    `Goal: ${formatObjectivePreview(goalState.objective)}`,
    `Status: ${goalState.status}`,
    `ID: ${goalState.goalId}`,
    `Elapsed: ${formatDuration(goalState.timeUsedSeconds)}`,
    `Tokens: ${goalState.tokensUsed}${goalState.tokenBudget ? ` / ${goalState.tokenBudget}` : ''}`,
  ];
  if (goalState.timeBudgetSeconds) lines.push(`Time budget: ${formatDuration(goalState.timeBudgetSeconds)}`);
  if (goalState.minTokensBeforeWrapUp) lines.push(`Token floor: ${goalState.minTokensBeforeWrapUp}`);
  if (goalState.minTimeSecondsBeforeWrapUp) lines.push(`Time floor: ${formatDuration(goalState.minTimeSecondsBeforeWrapUp)}`);
  if (goalState.stopReason) lines.push(`Stopped because: ${goalState.stopReason}`);
  if (goalState.resumeWhen) lines.push(`Resume when: ${goalState.resumeWhen}`);
  if (goalState.checkpoint) {
    lines.push(`Checkpoint: ${goalState.checkpoint.summary}`);
    if (goalState.checkpoint.nextStep) lines.push(`Next step: ${goalState.checkpoint.nextStep}`);
    if (goalState.checkpoint.artifacts?.length) lines.push(`Artifacts: ${goalState.checkpoint.artifacts.join(', ')}`);
  }
  if (goalState.acceptanceCriteria) lines.push('Acceptance criteria:', ...goalState.acceptanceCriteria.map((criterion) => `- ${criterion}`));
  if (goalState.completionReceipt) {
    lines.push(`Reported completion evidence: ${goalState.completionReceipt.summary}`);
    lines.push(...goalState.completionReceipt.checks.map((check) => `- ${check.criterion}: ${check.status} — ${check.evidence}`));
  }
  return lines.join('\n');
}

function formatQueue(snapshot: Pick<GoalSessionSnapshot, 'queue'>): string {
  if (snapshot.queue.length === 0) return 'No queued goals.';
  return [
    `Queued goals (${snapshot.queue.length}):`,
    ...snapshot.queue.map((item, index) => (
      `${index + 1}. [${item.queueId}] ${formatObjectivePreview(item.objective)}`
    )),
  ].join('\n');
}

function formatCompletedRun(completed: NonNullable<GoalMutationResult['completedRun']>): string {
  return [
    `Completed goals this session (${completed.length}):`,
    ...completed.map((item, index) => `${index + 1}. ${formatObjectivePreview(item.objective)}${item.completionReceipt ? ` — Reported completion evidence: ${item.completionReceipt.summary}` : ''}`),
  ].join('\n');
}

function formatObjectivePreview(objective: string): string {
  const normalized = objective.replace(/\s+/gu, ' ').trim();
  if (normalized.length <= GOAL_OBJECTIVE_PREVIEW_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, GOAL_OBJECTIVE_PREVIEW_LENGTH - 1).trimEnd()}…`;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '');
}

/**
 * Reports a goal transition, once, only when the mutation actually succeeded.
 *
 * A refused mutation still returns a result, and reporting it would inflate
 * every count on the console's goals page with work that never happened.
 *
 * `budgetLimited` is reported as `blocked` with its reason: the goal stopped
 * without finishing, which is what the surface aggregates, and the reason is
 * what makes the stall actionable.
 */
function reportGoal(
  ctx: GoalCommandContext,
  result: GoalMutationResult,
  action: GoalEventData['action'],
): void {
  if (!result.ok) return;
  const blocked = result.goal?.status === 'budgetLimited';
  void ctx.trackGoalEvent?.({
    goalId: result.goal?.goalId,
    action: blocked ? 'blocked' : action,
    status: blocked ? 'budget limited' : undefined,
    source: 'slash_command',
  });
}
