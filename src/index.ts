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
  // Ignore readline close errors (happens during exit with enquirer prompts)
  if (reason && typeof reason === 'object' && (reason as any).code === 'ERR_USE_AFTER_CLOSE') {
    return;
  }
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
  .option('-c, --auto-commit', 'Auto-commit with LLM-generated message (runs lint & test first)', false)
  .option('--unrestricted', 'Run without any approval prompts (use with caution)', false)
  .option('--restricted', 'Deny all dangerous operations automatically', false)
  .option('--auto-skill', 'Auto-generate skills based on project analysis', false)
  .option('--skill-install [skill-name]', 'Install a community skill (opens browser if no name)')
  .option('--project', 'Install skill to project level (with --skill-install)', false)
  .option('--permissions', 'Display current permission settings and exit', false)
  .option('--patch', 'Generate git patch without applying changes (requires --prompt)', false)
  .option('--output <file>', 'Output file for patch (default: stdout, used with --patch)')
  .option('--mode <mode>', 'Run mode: interactive (default) or rpc', 'interactive')
  .action(async (opts: CLIOptions & { mode?: string; skillInstall?: string | boolean; project?: boolean; permissions?: boolean }) => {
    // Handle --skill-install flag
    if (opts.skillInstall !== undefined) {
      await runSkillInstall(opts);
      return;
    }

    // Handle --permissions flag
    if (opts.permissions) {
      await displayPermissions(opts);
      return;
    }

    // Handle --patch flag
    if (opts.patch) {
      await runPatchMode(opts);
      return;
    }

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

      let apiKey: string;
      try {
        const result = await enquirer.prompt<{ apiKey: string }>({
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
        apiKey = result.apiKey;
      } catch (error: any) {
        // Handle user cancellation (Ctrl+C or ESC)
        if (error?.code === 'ERR_USE_AFTER_CLOSE' || error?.message?.includes('cancelled')) {
          console.log(chalk.gray('\nSetup cancelled.'));
          process.exit(0);
        }
        throw error;
      }

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

/**
 * Handle --skill-install flag for installing community skills
 */
async function runSkillInstall(opts: CLIOptions & { skillInstall?: string | boolean; project?: boolean }): Promise<void> {
  const config = await loadConfig(opts.config);
  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Import skill install dependencies
  const { SkillsRegistry } = await import('./skills/SkillsRegistry.js');
  const { AUTOHAND_PATHS } = await import('./constants.js');
  const { skillsInstall } = await import('./commands/skills-install.js');

  // Initialize skills registry
  const skillsRegistry = new SkillsRegistry(AUTOHAND_PATHS.skills);
  await skillsRegistry.initialize();
  await skillsRegistry.setWorkspace(workspaceRoot);

  // Determine skill name (if provided)
  const skillName = typeof opts.skillInstall === 'string' ? opts.skillInstall : undefined;

  // Run the install command
  await skillsInstall({
    skillsRegistry,
    workspaceRoot,
  }, skillName);
}

/**
 * Handle --permissions flag to display current permission settings
 */
async function displayPermissions(opts: CLIOptions): Promise<void> {
  const config = await loadConfig(opts.config);
  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Import permission manager
  const { PermissionManager } = await import('./permissions/PermissionManager.js');
  const { loadLocalProjectSettings } = await import('./permissions/localProjectPermissions.js');

  // Load local project permissions
  const localSettings = await loadLocalProjectSettings(workspaceRoot);

  // Merge global and local settings
  const mergedSettings = {
    mode: localSettings?.permissions?.mode ?? config.permissions?.mode ?? 'interactive',
    whitelist: [
      ...(config.permissions?.whitelist ?? []),
      ...(localSettings?.permissions?.whitelist ?? [])
    ],
    blacklist: [
      ...(config.permissions?.blacklist ?? []),
      ...(localSettings?.permissions?.blacklist ?? [])
    ],
    rules: [
      ...(config.permissions?.rules ?? []),
      ...(localSettings?.permissions?.rules ?? [])
    ]
  };

  const manager = new PermissionManager({ settings: mergedSettings });
  const whitelist = manager.getWhitelist();
  const blacklist = manager.getBlacklist();
  const settings = manager.getSettings();

  console.log();
  console.log(chalk.bold.cyan('Autohand Permissions'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Mode
  console.log(chalk.bold('Mode:'), chalk.cyan(settings.mode || 'interactive'));
  console.log();

  // Workspace
  console.log(chalk.bold('Workspace:'), chalk.gray(workspaceRoot));
  console.log(chalk.bold('Config:'), chalk.gray(config.configPath));
  console.log();

  // Whitelist (Approved)
  console.log(chalk.bold.green('Approved (Whitelist)'));
  if (whitelist.length === 0) {
    console.log(chalk.gray('  No approved patterns'));
  } else {
    whitelist.forEach((pattern, index) => {
      console.log(chalk.green(`  ${index + 1}. ${pattern}`));
    });
  }
  console.log();

  // Blacklist (Denied)
  console.log(chalk.bold.red('Denied (Blacklist)'));
  if (blacklist.length === 0) {
    console.log(chalk.gray('  No denied patterns'));
  } else {
    blacklist.forEach((pattern, index) => {
      console.log(chalk.red(`  ${index + 1}. ${pattern}`));
    });
  }
  console.log();

  // Summary
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.bold('Summary:'), `${whitelist.length} approved, ${blacklist.length} denied`);
  console.log();

  // Help text
  console.log(chalk.gray('Use /permissions in interactive mode to manage permissions.'));
  console.log(chalk.gray('Use --unrestricted to skip all approval prompts.'));
  console.log(chalk.gray('Use --restricted to deny all dangerous operations.'));
  console.log();
}

/**
 * Handle --patch flag to generate a git-compatible patch without applying changes
 */
async function runPatchMode(opts: CLIOptions): Promise<void> {
  // Validate that --prompt is provided
  if (!opts.prompt) {
    console.error(chalk.red('Error: --patch requires --prompt to specify the instruction'));
    console.error(chalk.gray('Usage: autohand --prompt "your instruction" --patch'));
    process.exit(1);
  }

  // Import dependencies
  const fs = await import('fs-extra');
  const { generateUnifiedPatch, formatChangeSummary } = await import('./utils/patch.js');

  const config = await loadConfig(opts.config);
  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Override model from CLI if provided
  if (opts.model) {
    const providerName = config.provider ?? 'openrouter';
    if (config[providerName]) {
      (config as any)[providerName].model = opts.model;
    }
  }

  const llmProvider = ProviderFactory.create(config);
  const files = new FileActionManager(workspaceRoot);

  // Enable preview mode - changes will be batched instead of written
  const batchId = crypto.randomUUID();
  files.enterPreviewMode(batchId);

  // Set up runtime with auto-confirm and unrestricted mode
  const patchOptions: CLIOptions = {
    ...opts,
    yes: true,           // Auto-confirm all actions
    unrestricted: true   // Skip approval prompts
  };

  const runtime: AgentRuntime = {
    config,
    workspaceRoot,
    options: patchOptions
  };

  // Show status
  console.error(chalk.cyan('Patch Mode: Changes will be captured without modifying files\n'));

  try {
    const agent = new AutohandAgent(llmProvider, files, runtime);

    // Run the instruction (changes will be batched in preview mode)
    await agent.runCommandMode(opts.prompt);

    // Get all pending changes
    const changes = files.getPendingChanges();

    if (changes.length === 0) {
      console.error(chalk.yellow('\nNo changes were made.'));
      process.exit(0);
    }

    // Generate unified patch
    const patch = generateUnifiedPatch(changes);

    // Show summary to stderr (so it doesn't pollute stdout when piping)
    console.error(chalk.green(`\n✓ ${formatChangeSummary(changes)}`));

    // Output patch
    if (opts.output) {
      await fs.default.ensureDir((await import('path')).dirname(opts.output));
      await fs.default.writeFile(opts.output, patch);
      console.error(chalk.green(`✓ Patch written to ${opts.output}`));
      console.error(chalk.gray('\nTo apply: git apply ' + opts.output));
    } else {
      // Output to stdout
      process.stdout.write(patch);
    }

    files.exitPreviewMode();
    process.exit(0);
  } catch (error) {
    files.exitPreviewMode();
    console.error(chalk.red(`\nError: ${(error as Error).message}`));
    process.exit(1);
  }
}

program.parseAsync();
