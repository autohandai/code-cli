/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Plan Mode Command
 * Toggle plan mode for safe code exploration before execution
 */

import chalk from 'chalk';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { PlanModeManager } from '../modes/planMode/PlanModeManager.js';

export const metadata = {
  command: '/plan',
  description: 'toggle plan mode for safe code exploration',
  implemented: true,
};

// Singleton PlanModeManager instance
let planModeManager: PlanModeManager | null = null;

/**
 * Get or create the PlanModeManager singleton
 */
export function getPlanModeManager(): PlanModeManager {
  if (!planModeManager) {
    planModeManager = new PlanModeManager();
  }
  return planModeManager;
}

/**
 * Plan command handler
 *
 * Usage:
 *   /plan        - Toggle plan mode
 *   /plan on     - Enable plan mode
 *   /plan off    - Disable plan mode
 *   /plan status - Show current plan status
 */
export interface PlanOptions {
  /** Optional output handler; defaults to console.log */
  output?: (message: string) => void;
}

export async function plan(_ctx: SlashCommandContext, args?: string, opts?: PlanOptions): Promise<string | null> {
  const manager = getPlanModeManager();
  const subcommand = args?.trim().toLowerCase();
  const out = opts?.output ?? console.log;

  switch (subcommand) {
    case 'on':
    case 'enable':
      if (manager.isEnabled()) {
        out(chalk.yellow('Plan mode is already enabled.'));
        return null;
      }
      manager.enable();
      out(chalk.green('Plan mode enabled.'));
      out(chalk.gray('Tools are now read-only. Use /plan off to disable.'));
      out(chalk.gray('Tip: Press Shift+Tab twice to quickly toggle plan mode.'));
      return null;

    case 'off':
    case 'disable':
      if (!manager.isEnabled()) {
        out(chalk.yellow('Plan mode is not enabled.'));
        return null;
      }
      manager.disable();
      out(chalk.green('Plan mode disabled.'));
      out(chalk.gray('Full tool access restored.'));
      return null;

    case 'status':
      return showPlanStatus(manager, out);

    case '':
    case undefined:
      // Toggle
      if (manager.isEnabled()) {
        manager.disable();
        out(chalk.green('Plan mode disabled.'));
        out(chalk.gray('Full tool access restored.'));
      } else {
        manager.enable();
        out(chalk.green('Plan mode enabled.'));
        out(chalk.gray('Tools are now read-only.'));
      }
      return null;

    default:
      out(chalk.yellow(`Unknown subcommand: ${subcommand}`));
      out(chalk.gray(`
Usage:
  /plan        - Toggle plan mode
  /plan on     - Enable plan mode
  /plan off    - Disable plan mode
  /plan status - Show current plan state

Keyboard shortcut:
  Shift+Tab (twice) - Enter plan mode
  Shift+Tab (once)  - Exit plan mode (when in plan mode)
`));
      return null;
  }
}

/**
 * Show current plan mode status
 */
function showPlanStatus(manager: PlanModeManager, out: (message: string) => void = console.log): string | null {
  const enabled = manager.isEnabled();
  const phase = manager.getPhase();
  const plan = manager.getPlan();
  const indicator = manager.getPromptIndicator();

  out('');
  out(chalk.bold.cyan('Plan Mode Status'));
  out(chalk.gray('─'.repeat(40)));
  out(`Status:    ${enabled ? chalk.green('ENABLED') : chalk.gray('DISABLED')}`);
  out(`Phase:     ${chalk.cyan(phase)}`);
  out(`Indicator: ${indicator || chalk.gray('(none)')}`);

  if (plan) {
    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const inProgress = plan.steps.find(s => s.status === 'in_progress');

    out('');
    out(chalk.bold(`Plan: ${plan.id}`));
    out(`Progress: ${completed}/${plan.steps.length} steps`);
    out('');

    for (const step of plan.steps) {
      const icon = getStepIcon(step.status);
      const color = getStepColor(step.status);
      out(color(`  ${icon} ${step.number}. ${step.description}`));
    }

    if (inProgress) {
      out('');
      out(chalk.yellow(`Currently working on: Step ${inProgress.number}`));
    }
  } else {
    out('');
    out(chalk.gray('No plan created yet.'));
    out(chalk.gray('Ask the agent to create a plan for your task.'));
  }

  out('');
  return null;
}

/**
 * Get icon for step status
 */
function getStepIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '→';
    case 'skipped':
      return '⊘';
    default:
      return '○';
  }
}

/**
 * Get color function for step status
 */
function getStepColor(status: string): (s: string) => string {
  switch (status) {
    case 'completed':
      return chalk.green;
    case 'in_progress':
      return chalk.yellow;
    case 'skipped':
      return chalk.gray;
    default:
      return chalk.white;
  }
}
