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
export async function plan(_ctx: SlashCommandContext, args?: string): Promise<string | null> {
  const manager = getPlanModeManager();
  const subcommand = args?.trim().toLowerCase();

  switch (subcommand) {
    case 'on':
    case 'enable':
      if (manager.isEnabled()) {
        console.log(chalk.yellow('Plan mode is already enabled.'));
        return null;
      }
      manager.enable();
      console.log(chalk.green('Plan mode enabled.'));
      console.log(chalk.gray('Tools are now read-only. Use /plan off to disable.'));
      console.log(chalk.gray('Tip: Press Shift+Tab twice to quickly toggle plan mode.'));
      return null;

    case 'off':
    case 'disable':
      if (!manager.isEnabled()) {
        console.log(chalk.yellow('Plan mode is not enabled.'));
        return null;
      }
      manager.disable();
      console.log(chalk.green('Plan mode disabled.'));
      console.log(chalk.gray('Full tool access restored.'));
      return null;

    case 'status':
      return showPlanStatus(manager);

    case '':
    case undefined:
      // Toggle
      if (manager.isEnabled()) {
        manager.disable();
        console.log(chalk.green('Plan mode disabled.'));
        console.log(chalk.gray('Full tool access restored.'));
      } else {
        manager.enable();
        console.log(chalk.green('Plan mode enabled.'));
        console.log(chalk.gray('Tools are now read-only.'));
      }
      return null;

    default:
      console.log(chalk.yellow(`Unknown subcommand: ${subcommand}`));
      console.log(chalk.gray(`
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
function showPlanStatus(manager: PlanModeManager): string | null {
  const enabled = manager.isEnabled();
  const phase = manager.getPhase();
  const plan = manager.getPlan();
  const indicator = manager.getPromptIndicator();

  console.log('');
  console.log(chalk.bold.cyan('Plan Mode Status'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`Status:    ${enabled ? chalk.green('ENABLED') : chalk.gray('DISABLED')}`);
  console.log(`Phase:     ${chalk.cyan(phase)}`);
  console.log(`Indicator: ${indicator || chalk.gray('(none)')}`);

  if (plan) {
    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const inProgress = plan.steps.find(s => s.status === 'in_progress');

    console.log('');
    console.log(chalk.bold(`Plan: ${plan.id}`));
    console.log(`Progress: ${completed}/${plan.steps.length} steps`);
    console.log('');

    for (const step of plan.steps) {
      const icon = getStepIcon(step.status);
      const color = getStepColor(step.status);
      console.log(color(`  ${icon} ${step.number}. ${step.description}`));
    }

    if (inProgress) {
      console.log('');
      console.log(chalk.yellow(`Currently working on: Step ${inProgress.number}`));
    }
  } else {
    console.log('');
    console.log(chalk.gray('No plan created yet.'));
    console.log(chalk.gray('Ask the agent to create a plan for your task.'));
  }

  console.log('');
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
