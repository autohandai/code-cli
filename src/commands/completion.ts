/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import {
  generateCompletion,
  detectShell,
  getInstallInstructions,
  installCompletion,
  type ShellType,
} from '../completions/index.js';
import type { SlashCommand } from '../core/slashCommands.js';

export const metadata: SlashCommand = {
  command: '/completion',
  description: 'Generate shell completion scripts',
  implemented: true,
};

export async function execute(args?: string): Promise<void> {
  // Check if a shell was provided as argument
  let shell: ShellType | null = null;

  if (args) {
    const arg = args.trim().toLowerCase();
    if (arg === 'bash' || arg === 'zsh' || arg === 'fish') {
      shell = arg;
    }
  }

  // If no shell provided, detect or prompt
  if (!shell) {
    const detected = detectShell();

    if (detected) {
      console.log(chalk.gray(`Detected shell: ${detected}`));
    }

    const shellOptions: ModalOption[] = [
      { label: 'Bash', value: 'bash' },
      { label: 'Zsh', value: 'zsh' },
      { label: 'Fish', value: 'fish' },
    ];

    const shellResult = await showModal({
      title: 'Select your shell:',
      options: shellOptions,
      initialIndex: shellOptions.findIndex(o => o.value === (detected || 'bash'))
    });

    if (!shellResult) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }

    shell = shellResult.value as ShellType;
  }

  // Ask what to do
  const actionOptions: ModalOption[] = [
    { label: 'Print completion script to terminal', value: 'print' },
    { label: 'Install completion to default location', value: 'install' },
    { label: 'Show installation instructions', value: 'instructions' },
  ];

  const actionResult = await showModal({
    title: 'What would you like to do?',
    options: actionOptions
  });

  if (!actionResult) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  const action = actionResult.value;

  switch (action) {
      case 'print':
        console.log();
        console.log(chalk.cyan(`# ${shell} completion script for autohand`));
        console.log(chalk.cyan('# Copy and save to appropriate location'));
        console.log();
        console.log(generateCompletion(shell));
        break;

      case 'install':
        const installPath = await installCompletion(shell);
        console.log();
        console.log(chalk.green('Completion script installed to:'));
        console.log(chalk.cyan(`  ${installPath}`));
        console.log();
        console.log(getInstallInstructions(shell));
        break;

      case 'instructions':
        console.log(getInstallInstructions(shell));
        break;
  }
}

/**
 * CLI subcommand for completion (autohand completion <shell>)
 */
export async function runCompletionCommand(shell?: string): Promise<void> {
  if (!shell) {
    console.error('Usage: autohand completion <bash|zsh|fish>');
    process.exit(1);
  }

  const validShells = ['bash', 'zsh', 'fish'];
  if (!validShells.includes(shell)) {
    console.error(`Invalid shell: ${shell}`);
    console.error(`Valid options: ${validShells.join(', ')}`);
    process.exit(1);
  }

  // Print completion script to stdout
  console.log(generateCompletion(shell as ShellType));
}
