/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import type { QueuedInstructionPolicy } from '../core/agent/PostTurnActionCoordinator.js';

export type LifecycleCommandContext = Pick<SlashCommandContext,
  'workspaceRoot' | 'queueInstruction' | 'isNonInteractive'>;

export function startLifecycleWorkflow(
  ctx: LifecycleCommandContext,
  prompt: string,
  status: string,
  policy: Pick<QueuedInstructionPolicy, 'intent'> = {},
): string | null {
  if (ctx.isNonInteractive || !ctx.queueInstruction) return prompt;
  ctx.queueInstruction(prompt, undefined, { environmentBootstrap: 'skip', ...policy });
  console.log(chalk.cyan(`\n  ${status}\n`));
  return null;
}

export const lifecycleDelegation = [
  'Use the available agent catalogue and delegate independent, bounded work to the named specialists when their tools and session thread budget allow it.',
  'Give each specialist the exact target, allowed operations, acceptance criteria, and evidence required. Never infer permission to widen the scope.',
  'Respect the shared session concurrency limit; if delegation is unavailable or full, perform the same checks sequentially. Do not create redundant teams or recursively delegate the same work.',
  'Inspect specialist evidence before using it; a specialist completion message is not proof that a check passed.',
].join('\n');
