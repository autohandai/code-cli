/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { GoalManager } from '../goals/GoalManager.js';
import type { SlashCommand, SlashCommandContext } from '../core/slashCommandTypes.js';
import type { GoalMutationResult, GoalSnapshot } from '../goals/types.js';
import { GOAL_FEATURE_DISABLED_MESSAGE, resolveGoalFeatureEnabled } from '../goals/feature.js';

export const metadata: SlashCommand = {
  command: '/goal',
  description: 'Create, inspect, refine, pause, resume, complete, clear, and queue persistent goals',
  implemented: true,
  subcommands: [
    { name: 'writer', description: 'Interview the user and draft a stronger goal before creating it' },
    { name: 'queue', description: 'List queued goals or enqueue a goal' },
    { name: 'pause', description: 'Pause the current goal' },
    { name: 'resume', description: 'Resume a paused or queued goal' },
    { name: 'complete', description: 'Mark the current goal complete' },
    { name: 'clear', description: 'Clear the current goal' },
    { name: 'templates', description: 'List reusable .pi-goals templates' },
  ],
};

export const writeGoalMetadata: SlashCommand = {
  command: '/write-goal',
  description: 'Interview the user and draft a well-specified goal objective',
  implemented: true,
};

export async function goal(ctx: SlashCommandContext, args: string[] = []): Promise<string> {
  if (!resolveGoalFeatureEnabled(ctx.config, ctx.isFeatureEnabled)) {
    return GOAL_FEATURE_DISABLED_MESSAGE;
  }
  await ctx.trackFeatureActivation?.('slash_goal', { surface: 'slash_command' });

  const manager = new GoalManager(ctx.workspaceRoot);
  const input = args.join(' ').trim();
  if (!input) {
    const snapshot = await manager.getSnapshot();
    if (!snapshot.goal && snapshot.queue.length === 0) {
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
    case 'queue':
      return handleQueue(manager, rest);
    case 'pause':
      return formatMutation(await manager.updateGoal({ status: 'paused' }));
    case 'resume': {
      const snapshot = await manager.getSnapshot();
      if (!snapshot.goal && snapshot.queue.length > 0) {
        const started = await manager.startQueuedGoal();
        if (started.ok && started.goal) {
          queueGoalContinuation(ctx, started.goal.objective);
        }
        return formatMutation(started);
      }
      const resumed = await manager.updateGoal({ status: 'active' });
      if (resumed.ok && resumed.goal) {
        queueGoalContinuation(ctx, resumed.goal.objective);
      }
      return formatMutation(resumed);
    }
    case 'complete':
      return formatMutation(await manager.updateGoal({ status: 'complete' }));
    case 'clear':
      return formatMutation(await manager.clearGoal());
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
      const created = await manager.createGoal(resolved.input, { replace: false });
      if (created.ok && created.goal) {
        await emitGoalWrittenCompleted(ctx, created.goal, 'slash');
        queueGoalContinuation(ctx, created.goal.objective);
      }
      return formatMutation(created);
    }
  }
}

export async function writeGoal(ctx: SlashCommandContext, args: string[] = []): Promise<string> {
  if (!resolveGoalFeatureEnabled(ctx.config, ctx.isFeatureEnabled)) {
    return GOAL_FEATURE_DISABLED_MESSAGE;
  }
  await ctx.trackFeatureActivation?.('slash_write_goal', { surface: 'slash_command' });
  return startGoalWriter(ctx, args.join(' ').trim());
}

export async function runGoalCli(workspaceRoot: string, rawInput?: string, config?: SlashCommandContext['config']): Promise<string> {
  if (!resolveGoalFeatureEnabled(config)) {
    return GOAL_FEATURE_DISABLED_MESSAGE;
  }

  const manager = new GoalManager(workspaceRoot);
  const input = rawInput?.trim() ?? '';
  if (!input) return formatSnapshot(await manager.getSnapshot());

  const args = input.match(/"[^"]*"|'[^']*'|\S+/g)?.map(unquote) ?? [];
  return goal({ workspaceRoot } as SlashCommandContext, args);
}

function startGoalWriter(ctx: SlashCommandContext, roughGoal?: string): string {
  const activated = ctx.skillsRegistry?.activateSkill('write-goal') ?? false;
  const roughGoalText = roughGoal?.trim() || 'No rough goal was provided yet.';
  ctx.queueInstruction?.([
    'Activate the built-in write-goal skill and use it to help the user draft a stronger /goal objective.',
    'Interview the user with follow-up questions when the finish line, proof, boundaries, loop, or stop rule is unclear.',
    'Show the full drafted objective and get explicit user approval before calling create_goal.',
    `Rough goal request: ${roughGoalText}`,
  ].join('\n'));

  return [
    'Write-goal started.',
    activated
      ? 'The built-in write-goal skill is active for the next turn.'
      : 'The next turn will use the built-in write-goal skill instructions if available.',
    'Answer the follow-up questions to create a completion contract with proof, boundaries, and a stop rule.',
  ].join('\n');
}

async function emitGoalWrittenCompleted(
  ctx: SlashCommandContext,
  goalState: NonNullable<GoalSnapshot['goal']>,
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

function queueGoalContinuation(ctx: SlashCommandContext, objective: string): void {
  ctx.queueInstruction?.([
    `Active goal: ${objective}`,
    'Continue working toward this persistent goal until it is complete, blocked, paused, cleared, or budget-limited.',
    'Use get_goal or update_goal when you need to inspect or modify the goal state.',
  ].join('\n'));
}

function formatMutation(result: GoalMutationResult): string {
  const lines = [result.ok ? chalk.green(result.message ?? 'Goal updated.') : chalk.yellow(result.message ?? 'Goal command failed.')];
  if (result.goal) {
    lines.push('');
    lines.push(formatGoal(result.goal));
  }
  if (result.queued?.length) {
    lines.push('');
    lines.push(`Queued ${result.queued.length} goal${result.queued.length === 1 ? '' : 's'}:`);
    for (const item of result.queued) {
      lines.push(`- [${item.queueId}] ${item.objective}`);
    }
  }
  if (result.started) {
    lines.push(`Started queue item: ${result.started.queueId}`);
  }
  if (result.queue.length > 0 && !result.queued?.length) {
    lines.push('');
    lines.push(formatQueue({ queue: result.queue }));
  }
  return lines.join('\n');
}

function formatSnapshot(snapshot: GoalSnapshot): string {
  if (!snapshot.goal && snapshot.queue.length === 0) {
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
  return parts.join('\n');
}

function formatGoal(goalState: NonNullable<GoalSnapshot['goal']>): string {
  const lines = [
    `Goal: ${goalState.objective}`,
    `Status: ${goalState.status}`,
    `ID: ${goalState.goalId}`,
    `Elapsed: ${formatDuration(goalState.timeUsedSeconds)}`,
    `Tokens: ${goalState.tokensUsed}${goalState.tokenBudget ? ` / ${goalState.tokenBudget}` : ''}`,
  ];
  if (goalState.timeBudgetSeconds) lines.push(`Time budget: ${formatDuration(goalState.timeBudgetSeconds)}`);
  if (goalState.minTokensBeforeWrapUp) lines.push(`Token floor: ${goalState.minTokensBeforeWrapUp}`);
  if (goalState.minTimeSecondsBeforeWrapUp) lines.push(`Time floor: ${formatDuration(goalState.minTimeSecondsBeforeWrapUp)}`);
  return lines.join('\n');
}

function formatQueue(snapshot: Pick<GoalSnapshot, 'queue'>): string {
  if (snapshot.queue.length === 0) return 'No queued goals.';
  return [
    `Queued goals (${snapshot.queue.length}):`,
    ...snapshot.queue.map((item, index) => `${index + 1}. [${item.queueId}] ${item.objective}`),
  ].join('\n');
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
