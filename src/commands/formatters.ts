/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { listFormatters } from '../actions/formatters.js';
import type { SlashCommand } from '../core/slashCommands.js';

export const metadata: SlashCommand = {
  command: '/formatters',
  description: 'List available code formatters',
  implemented: true,
};

export async function execute(): Promise<void> {
  console.log();
  console.log(chalk.cyan.bold('Available Code Formatters'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  const formatters = await listFormatters();

  // Group by category
  const builtIn = formatters.filter(f => f.command === 'built-in');
  const external = formatters.filter(f => f.command !== 'built-in');

  console.log(chalk.yellow.bold('Built-in Formatters (always available):'));
  console.log();

  for (const f of builtIn) {
    console.log(`  ${chalk.green('✓')} ${chalk.white.bold(f.name)}`);
    console.log(`    ${chalk.gray(f.description)}`);
    console.log(`    ${chalk.gray('Extensions:')} ${f.extensions.join(', ')}`);
    console.log();
  }

  console.log(chalk.yellow.bold('External Formatters:'));
  console.log();

  for (const f of external) {
    const status = f.installed
      ? chalk.green('✓ installed')
      : chalk.red('✗ not found');

    console.log(`  ${f.installed ? chalk.green('✓') : chalk.red('✗')} ${chalk.white.bold(f.name)} ${chalk.gray(`(${f.command})`)} - ${status}`);
    console.log(`    ${chalk.gray(f.description)}`);
    console.log(`    ${chalk.gray('Extensions:')} ${f.extensions.join(', ')}`);
    console.log();
  }

  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('Usage: The agent can use format_file action with any installed formatter.'));
  console.log(chalk.gray('Install missing formatters via your package manager (npm, pip, cargo, etc.)'));
  console.log();
}
