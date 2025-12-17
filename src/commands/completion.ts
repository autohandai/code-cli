/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import enquirer from 'enquirer';
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

    const { Select } = enquirer as any;
    const prompt = new Select({
      name: 'shell',
      message: 'Select your shell:',
      choices: [
        { name: 'bash', message: 'Bash' },
        { name: 'zsh', message: 'Zsh' },
        { name: 'fish', message: 'Fish' },
      ],
      initial: detected || 'bash',
    });

    try {
      shell = await prompt.run() as ShellType;
    } catch {
      // User cancelled
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  // Ask what to do
  const { Select } = enquirer as any;
  const actionPrompt = new Select({
    name: 'action',
    message: 'What would you like to do?',
    choices: [
      { name: 'print', message: 'Print completion script to terminal' },
      { name: 'install', message: 'Install completion to default location' },
      { name: 'instructions', message: 'Show installation instructions' },
    ],
  });

  try {
    const action = await actionPrompt.run();

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
  } catch {
    console.log(chalk.gray('Cancelled.'));
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
