#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from 'commander';
import chalk from 'chalk';
import packageJson from '../package.json' with { type: 'json' };
import { loadConfig, resolveWorkspaceRoot } from './config.js';
import { FileActionManager } from './actions/filesystem.js';
import { OpenRouterClient } from './openrouter.js';
import { AutohandAgent } from './core/agent.js';
import { startStatusPanel } from './ui/statusPanel.js';
import type { CLIOptions, AgentRuntime } from './types.js';


const ASCII_FRIEND = [
  '⢀⡴⠛⠛⠻⣷⡄⠀⣠⡶⠟⠛⠻⣶⡄⢀⣴⡾⠛⠛⢿⣦⠀⢀⣴⠞⠛⠛⠶⡀',
  '⡎⠀⢰⣶⡆⠈⣿⣴⣿⠁⣴⣶⡄⠘⣿⣾⡏⢀⣶⣦⠀⢻⡇⣿⠃⢠⣶⡆⠀⢹',
  '⢧⠀⠘⠛⠃⢠⡿⠙⣿⡀⠙⠛⠃⣰⡿⢻⣧⠈⠛⠛⢀⣾⠇⢻⣆⠈⠛⠋⠀⡼',
  '⠈⠻⢶⣶⡾⠟⠁⠀⠘⠿⢶⣶⡾⠟⠁⠀⠙⠷⣶⣶⠿⠋⠀⠈⠻⠷⣶⡶⠚⠁',
  '⢀⣴⠿⠿⠷⣦⡀⠀⣠⣶⠿⠻⢷⣦⡀⠀⣠⡾⠟⠿⣶⣄⠀⢀⣴⡾⠿⠿⣶⣄',
  '⡾⠃⢠⣤⡄⠘⣿⣠⣿⠁⣠⣤⡄⠹⣷⣼⡏⢀⣤⣤⠈⢿⡆⣾⠏⢀⣤⣄⠈⢿',
  '⢧⡀⠸⠿⠇⢀⣿⠺⣿⡀⠻⠿⠃⢰⣿⢿⣇⠈⠿⠿⠀⣼⡇⢿⣇⠘⠿⠇⠀⣸',
  '⠈⢿⣦⣤⣴⡿⠃⠀⠙⢷⣦⣤⣶⡿⠁⠈⠻⣷⣤⣤⡾⠛⠀⠈⢿⣦⣤⣤⠴⠁'
].join('\n');

const program = new Command();

program
  .name('autohand')
  .description('Autonomous LLM-powered coding agent CLI')
  .option('-p, --prompt <text>', 'Run a single instruction in command mode')
  .option('--path <path>', 'Workspace path to operate in')
  .option('--yes', 'Auto-confirm risky actions', false)
  .option('--dry-run', 'Preview actions without applying mutations', false)
  .option('--model <model>', 'Override the configured LLM model')
  .option('--config <path>', 'Path to config file (default ~/.autohand-cli/config.json)')
  .option('--temperature <value>', 'Sampling temperature', parseFloat)
  .action(async (opts: CLIOptions) => {
    await runCLI(opts);
  });

async function runCLI(options: CLIOptions): Promise<void> {
  let statusPanel: { update: (snap: any) => void; stop: () => void } | null = null;
  try {
    const config = await loadConfig(options.config);
    const workspaceRoot = resolveWorkspaceRoot(config, options.path);
    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options
    };

    printBanner();
    printWelcome(runtime);

    const openRouter = new OpenRouterClient({
      ...config.openrouter,
      model: options.model ?? config.openrouter.model
    });
    const files = new FileActionManager(workspaceRoot);
    const agent = new AutohandAgent(openRouter, files, runtime);

    if (options.prompt) {
      await agent.runInstruction(options.prompt);
    } else {
      await agent.runInteractive();
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
    // Cleanup if needed
  }
}

function printBanner(): void {
  if (process.env.AUTOHAND_NO_BANNER === '1') {
    return;
  }
  if (process.stdout.isTTY) {
    console.log(chalk.gray(ASCII_FRIEND));
  } else {
    console.log('autohand');
  }
}

function printWelcome(runtime: AgentRuntime): void {
  if (!process.stdout.isTTY) {
    return;
  }
  const model = runtime.options.model ?? runtime.config.openrouter.model;
  const dir = runtime.workspaceRoot;
  console.log(`${chalk.bold('> Autohand')} v${packageJson.version}`);
  console.log(`${chalk.gray('model:')} ${chalk.cyan(model)}  ${chalk.gray('| directory:')} ${chalk.cyan(dir)}`);
  console.log();
  console.log(chalk.gray('To get started, describe a task or try one of these commands:'));
  console.log(chalk.cyan('/init ') + chalk.gray('create an AGENTS.md file with instructions for Autohand'));
  console.log(chalk.cyan('/help ') + chalk.gray('review my current changes and find issues'));
  console.log();
}

program.parseAsync();
