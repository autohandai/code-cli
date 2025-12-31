#!/usr/bin/env node
process.title = 'autohand';
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { execSync } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };
import { getProviderConfig, loadConfig, resolveWorkspaceRoot, saveConfig } from './config.js';
import { runStartupChecks, printStartupCheckResults } from './startup/checks.js';
import { getAuthClient } from './auth/index.js';
import type { AuthUser, LoadedConfig } from './types.js';

/**
 * Get git commit hash (short)
 * Uses build-time embedded commit, falls back to runtime git command for dev
 */
function getGitCommit(): string {
  // Use build-time embedded commit if available
  if (process.env.BUILD_GIT_COMMIT && process.env.BUILD_GIT_COMMIT !== 'undefined') {
    return process.env.BUILD_GIT_COMMIT;
  }
  // Fallback for development (running from source)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get full version string with git commit
 */
function getVersionString(): string {
  const commit = getGitCommit();
  return `${packageJson.version} (${commit})`;
}
import { FileActionManager } from './actions/filesystem.js';
import { ProviderFactory } from './providers/ProviderFactory.js';
import { AutohandAgent } from './core/agent.js';
import { runAutoSkillGeneration } from './skills/autoSkill.js';
import { runRpcMode } from './modes/rpc/index.js';
import type { CLIOptions, AgentRuntime } from './types.js';

/**
 * Validate auth token on startup
 * Returns the authenticated user if valid, undefined otherwise
 */
async function validateAuthOnStartup(config: LoadedConfig): Promise<AuthUser | undefined> {
  if (!config.auth?.token) {
    return undefined;
  }

  // Check if token is expired locally first
  if (config.auth.expiresAt) {
    const expiresAt = new Date(config.auth.expiresAt);
    if (expiresAt < new Date()) {
      // Token expired, clear it silently
      config.auth = undefined;
      try {
        await saveConfig(config);
      } catch {
        // Ignore save errors during startup
      }
      return undefined;
    }
  }

  // Validate with server (non-blocking, silent failure)
  try {
    const authClient = getAuthClient();
    const result = await authClient.validateSession(config.auth.token);

    if (!result.authenticated) {
      // Token invalid, clear it silently
      config.auth = undefined;
      try {
        await saveConfig(config);
      } catch {
        // Ignore save errors during startup
      }
      return undefined;
    }

    // Update user info if returned from server
    if (result.user && config.auth) {
      config.auth.user = result.user;
    }

    return config.auth?.user;
  } catch {
    // Network error, assume token is still valid locally
    return config.auth?.user;
  }
}


process.on('uncaughtException', (err) => {
  (globalThis as any).__autohandLastError = err;
  console.error('[DEBUG] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  (globalThis as any).__autohandLastError = reason;
  console.error('[DEBUG] Unhandled Rejection at:', promise, 'reason:', reason);
});

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
  .version(getVersionString(), '-v, --version', 'output the current version')
  .option('-p, --prompt <text>', 'Run a single instruction in command mode')
  .option('--path <path>', 'Workspace path to operate in')
  .option('-y, --yes', 'Auto-confirm risky actions', false)
  .option('--dry-run', 'Preview actions without applying mutations', false)
  .option('--model <model>', 'Override the configured LLM model')
  .option('--config <path>', 'Path to config file (default ~/.autohand/config.json)')
  .option('--temperature <value>', 'Sampling temperature', parseFloat)
  .option('-c, --auto-commit', 'Auto-commit changes after completing tasks', false)
  .option('--unrestricted', 'Run without any approval prompts (use with caution)', false)
  .option('--restricted', 'Deny all dangerous operations automatically', false)
  .option('--auto-skill', 'Auto-generate skills based on project analysis', false)
  .option('--mode <mode>', 'Run mode: interactive (default) or rpc', 'interactive')
  .action(async (opts: CLIOptions & { mode?: string }) => {
    if (opts.mode === 'rpc') {
      await runRpcMode(opts);
    } else {
      await runCLI(opts);
    }
  });

program
  .command('resume <sessionId>')
  .description('Resume a previous session')
  .option('--path <path>', 'Workspace path to operate in')
  .option('--model <model>', 'Override the configured LLM model')
  .action(async (sessionId: string, opts: CLIOptions) => {
    await runCLI({ ...opts, resumeSessionId: sessionId });
  });

async function runCLI(options: CLIOptions): Promise<void> {
  const statusPanel: { update: (snap: any) => void; stop: () => void } | null = null;
  try {
    let config = await loadConfig(options.config);

    // Check if API key is missing and prompt for it
    const providerName = config.provider ?? 'openrouter';
    const providerConfig = getProviderConfig(config, providerName);

    if (!providerConfig) {
      // No valid provider config - need to set up API key
      if (config.isNewConfig) {
        console.log(chalk.cyan('\n✨ Welcome to Autohand!\n'));
        console.log(chalk.gray(`Config created at: ${config.configPath}\n`));
      }

      console.log(chalk.yellow(`No ${providerName} API key configured.\n`));

      const { apiKey } = await enquirer.prompt<{ apiKey: string }>({
        type: 'password',
        name: 'apiKey',
        message: `Enter your ${providerName === 'openrouter' ? 'OpenRouter' : providerName} API key`,
        validate: (val: unknown) => {
          if (typeof val !== 'string' || !val.trim()) {
            return 'API key is required';
          }
          return true;
        }
      });

      // Update config with API key
      if (providerName === 'openrouter') {
        config.openrouter = {
          ...config.openrouter,
          apiKey: apiKey.trim(),
          baseUrl: config.openrouter?.baseUrl || 'https://openrouter.ai/api/v1',
          model: config.openrouter?.model || 'anthropic/claude-sonnet-4-20250514'
        };
      } else if (providerName === 'openai') {
        config.openai = {
          ...config.openai,
          apiKey: apiKey.trim(),
          model: config.openai?.model || 'gpt-4o'
        };
      }

      await saveConfig(config);
      console.log(chalk.green('✓ API key saved to config\n'));
    }

    const workspaceRoot = resolveWorkspaceRoot(config, options.path);
    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options
    };

    // Validate auth on startup (non-blocking)
    const authUser = await validateAuthOnStartup(config);

    printBanner();
    printWelcome(runtime, authUser);

    // Run startup checks
    const checkResults = await runStartupChecks(workspaceRoot);
    printStartupCheckResults(checkResults);

    // Warn but continue if required tools are missing
    if (!checkResults.allRequiredMet) {
      console.log(chalk.yellow('Continuing anyway, but some features may not work correctly.\n'));
    }

    // Note: Git repo check is passed to the agent via runtime.
    // The agent/LLM can suggest initializing git if needed for complex tasks.

    // Override model from CLI if provided
    if (options.model) {
      const providerName = config.provider ?? 'openrouter';
      if (config[providerName]) {
        (config as any)[providerName].model = options.model;
      }
    }

    const llmProvider = ProviderFactory.create(config);
    const files = new FileActionManager(workspaceRoot);

    // Handle --auto-skill flag
    if (options.autoSkill) {
      console.log(chalk.cyan('\nAuto-generating skills for this project...\n'));
      const result = await runAutoSkillGeneration(workspaceRoot, llmProvider);
      if (!result.success) {
        console.log(chalk.yellow(result.error || 'Failed to generate skills'));
      }
      return;
    }

    const agent = new AutohandAgent(llmProvider, files, runtime);

    if (options.prompt) {
      await agent.runCommandMode(options.prompt);
    } else if (options.resumeSessionId) {
      await agent.resumeSession(options.resumeSessionId);
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

function printWelcome(runtime: AgentRuntime, authUser?: AuthUser): void {
  if (!process.stdout.isTTY) {
    return;
  }
  const model = (() => {
    try {
      const settings = getProviderConfig(runtime.config);
      return runtime.options.model ?? settings?.model ?? 'unknown';
    } catch {
      return runtime.options.model ?? 'unknown';
    }
  })();
  const dir = runtime.workspaceRoot;
  console.log(`${chalk.bold('> Autohand')} v${getVersionString()}`);

  // Personalized greeting if logged in
  if (authUser) {
    console.log(chalk.green(`Welcome back, ${authUser.name || authUser.email}!`));
  }

  console.log(`${chalk.gray('model:')} ${chalk.cyan(model)}  ${chalk.gray('| directory:')} ${chalk.cyan(dir)}`);
  console.log();
  console.log(chalk.gray('To get started, describe a task or try one of these commands:'));
  console.log(chalk.cyan('/init ') + chalk.gray('create an AGENTS.md file with instructions for Autohand'));
  console.log(chalk.cyan('/help ') + chalk.gray('review my current changes and find issues'));

  // Show login hint if not authenticated
  if (!authUser) {
    console.log(chalk.cyan('/login ') + chalk.gray('sign in to your Autohand account'));
  }

  console.log();
}

program.parseAsync();
