/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auto-Mode command - Start and control autonomous development loops
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { AutomodeManager } from '../core/AutomodeManager.js';
import type { SlashCommand } from '../core/slashCommandTypes.js';

export interface AutomodeCommandContext {
  automodeManager?: AutomodeManager;
  workspaceRoot?: string;
}

/**
 * Command metadata
 */
export const metadata: SlashCommand = {
  command: '/automode',
  description: t('commands.automode.description'),
  implemented: true,
};

/**
 * Parse auto-mode arguments
 */
function parseArgs(args: string[]): {
  subcommand?: string;
  prompt?: string;
  maxIterations?: number;
  completionPromise?: string;
} {
  const result: ReturnType<typeof parseArgs> = {};

  // Check for subcommand
  const firstArg = args[0]?.toLowerCase();
  if (['status', 'pause', 'resume', 'cancel', 'help'].includes(firstArg)) {
    result.subcommand = firstArg;
    args = args.slice(1);
  }

  // Parse remaining args
  const promptParts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--max-iterations' && args[i + 1]) {
      result.maxIterations = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--completion-promise' && args[i + 1]) {
      result.completionPromise = args[i + 1];
      i++;
    } else if (!arg.startsWith('--')) {
      promptParts.push(arg);
    }
  }

  if (promptParts.length > 0) {
    result.prompt = promptParts.join(' ');
  }

  return result;
}

/**
 * Auto-mode command handler
 */
export async function automode(
  ctx: AutomodeCommandContext,
  args: string[] = []
): Promise<string | null> {
  const { automodeManager } = ctx;

  if (!automodeManager) {
    return 'Auto-mode manager not available. Please restart autohand.';
  }

  const parsed = parseArgs(args);

  switch (parsed.subcommand) {
    case 'status':
      return handleStatus(automodeManager);

    case 'pause':
      return handlePause(automodeManager);

    case 'resume':
      return handleResume(automodeManager);

    case 'cancel':
      return handleCancel(automodeManager);

    case 'help':
      return showHelp();

    default:
      // Start auto-mode with prompt
      if (!parsed.prompt) {
        return showHelp();
      }
      return handleStart(automodeManager, parsed);
  }
}

/**
 * Handle auto-mode start
 */
async function handleStart(
  manager: AutomodeManager,
  options: {
    prompt?: string;
    maxIterations?: number;
    completionPromise?: string;
  }
): Promise<string | null> {
  if (!options.prompt) {
    return 'Please provide a task prompt. Example: /automode Build a REST API for todos';
  }

  if (manager.isActive()) {
    return 'Auto-mode is already running. Use /automode pause or /automode cancel first.';
  }

  // Return instructions - actual start happens in the agent
  return `Starting auto-mode with task:\n${chalk.cyan(options.prompt)}\n\n` +
    `Settings:\n` +
    `  Max iterations: ${options.maxIterations ?? 50}\n` +
    `  Completion promise: "${options.completionPromise ?? 'DONE'}"\n\n` +
    chalk.gray('Press ESC to cancel at any time.');
}

/**
 * Handle status command
 */
function handleStatus(manager: AutomodeManager): string {
  const state = manager.getState();

  if (!state) {
    return 'No auto-mode session is currently active.';
  }

  const statusEmoji: Record<string, string> = {
    running: '🔄',
    paused: '⏸️',
    completed: '✅',
    cancelled: '⚠️',
    failed: '❌',
  };

  const lines = [
    '',
    `${statusEmoji[state.status] ?? '❓'} Auto-Mode Status`,
    '',
    `  Session: ${state.sessionId}`,
    `  Status: ${state.status}`,
    `  ${t('commands.automode.iteration', { current: String(state.currentIteration), max: String(state.maxIterations) })}`,
    `  Files created: ${state.filesCreated}`,
    `  Files modified: ${state.filesModified}`,
  ];

  if (state.branch) {
    lines.push(`  Branch: ${state.branch}`);
  }

  if (state.lastCheckpoint) {
    lines.push(`  Last checkpoint: ${state.lastCheckpoint.commit}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Handle pause command
 */
async function handlePause(manager: AutomodeManager): Promise<string> {
  if (!manager.isActive()) {
    return 'No auto-mode session is currently running.';
  }

  if (manager.isPausedState()) {
    return 'Auto-mode is already paused. Use /automode resume to continue.';
  }

  await manager.pause();
  return 'Auto-mode paused. Use /automode resume to continue.';
}

/**
 * Handle resume command
 */
async function handleResume(manager: AutomodeManager): Promise<string> {
  if (!manager.isActive()) {
    return 'No auto-mode session to resume.';
  }

  if (!manager.isPausedState()) {
    return 'Auto-mode is not paused.';
  }

  await manager.resume();
  return 'Auto-mode resumed.';
}

/**
 * Handle cancel command
 */
async function handleCancel(manager: AutomodeManager): Promise<string> {
  if (!manager.isActive()) {
    return 'No auto-mode session to cancel.';
  }

  await manager.cancel('user_cancel');
  return 'Auto-mode cancelled.';
}

/**
 * Show help
 */
function showHelp(): string {
  return `
${chalk.cyan('Auto-Mode: Autonomous Development Loops')}

Auto-mode lets autohand work autonomously on tasks through
iterative improvement cycles—inspired by the Ralph technique.

${chalk.yellow('Usage:')}
  /automode <prompt>              Start auto-mode with a task
  /automode status                Show current loop state
  /automode pause                 Pause the loop
  /automode resume                Resume paused loop
  /automode cancel                Cancel the loop

${chalk.yellow('Options:')}
  --max-iterations <n>            Maximum iterations (default: 50)
  --completion-promise <text>     Completion marker (default: "DONE")

${chalk.yellow('Examples:')}
  /automode Build a REST API for todos
  /automode Fix all TypeScript errors --max-iterations 20
  /automode Implement dark mode --completion-promise "DARK_MODE_DONE"

${chalk.yellow('Tips:')}
  • Include clear completion criteria in your prompt
  • Use <promise>DONE</promise> in your instructions to signal completion
  • Press ESC at any time to cancel
  • Use /automode status to check progress
`;
}
