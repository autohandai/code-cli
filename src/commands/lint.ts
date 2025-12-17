/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { listLinters } from '../actions/linters.js';
import type { SlashCommand } from '../core/slashCommands.js';

export const metadata: SlashCommand = {
  command: '/lint',
  description: 'List available code linters',
  implemented: true,
};

export async function execute(): Promise<void> {
  console.log();
  console.log(chalk.cyan.bold('Available Code Linters'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  const linters = await listLinters();

  for (const linter of linters) {
    const status = linter.installed
      ? chalk.green('✓ installed')
      : chalk.red('✗ not found');

    console.log(`  ${linter.installed ? chalk.green('✓') : chalk.red('✗')} ${chalk.white.bold(linter.name)} ${chalk.gray(`(${linter.command})`)} - ${status}`);
    console.log(`    ${chalk.gray(linter.description)}`);
    console.log(`    ${chalk.gray('Extensions:')} ${linter.extensions.join(', ')}`);
    console.log();
  }

  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('Usage: The agent can use lint_file action to check code quality.'));
  console.log(chalk.gray('Install missing linters via your package manager:'));
  console.log(chalk.gray('  npm: npm install -g eslint stylelint'));
  console.log(chalk.gray('  pip: pip install pylint ruff'));
  console.log(chalk.gray('  cargo: rustup component add clippy'));
  console.log(chalk.gray('  go: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest'));
  console.log();
}
