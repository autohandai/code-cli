#!/usr/bin/env node
process.title = 'autohand';
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import packageJson from '../package.json' with { type: 'json' };
import { getProviderConfig, loadConfig, resolveWorkspaceRoot, saveConfig } from './config.js';
import { runStartupChecks, printStartupCheckResults } from './startup/checks.js';
import { checkWorkspaceSafety, printDangerousWorkspaceWarning } from './startup/workspaceSafety.js';
import { getAuthClient } from './auth/index.js';
import type { AuthUser, LoadedConfig } from './types.js';
import { checkForUpdates, getInstallHint, type VersionCheckResult } from './utils/versionCheck.js';
import { initI18n, detectLocale } from './i18n/index.js';
import { initPingService, startPingService, stopPingService } from './telemetry/index.js';
import { detectStdinType, readPipedStdin } from './utils/stdinDetector.js';
import { buildPipePrompt } from './modes/pipeMode.js';
import { PROJECT_DIR_NAME } from './constants.js';
import { isSessionWorktreeEnabled, prepareSessionWorktree } from './utils/sessionWorktree.js';
import { buildTmuxLaunchCommand, createTmuxSessionName, isTmuxEnabled } from './utils/tmux.js';

/**
 * Get git commit hash (short)
 * Uses build-time embedded commit, falls back to runtime git command for dev
 */
function getCommitFromAlphaVersion(version: string): string | null {
  const match = version.match(/-alpha\.([0-9a-f]{7,40})$/i);
  return match?.[1] ?? null;
}

function getGitCommit(): string {
  // Use build-time embedded commit if available
  if (process.env.BUILD_GIT_COMMIT && process.env.BUILD_GIT_COMMIT !== 'undefined') {
    return process.env.BUILD_GIT_COMMIT;
  }
  // For alpha builds, version suffix encodes the source commit
  const alphaCommit = getCommitFromAlphaVersion(packageJson.version);
  if (alphaCommit) {
    return alphaCommit;
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

type McpConfigScope = 'user' | 'project';

function normalizeMcpScope(scopeInput?: string): McpConfigScope | null {
  const scope = (scopeInput ?? 'user').toLowerCase();
  if (scope === 'user' || scope === 'project') {
    return scope;
  }
  return null;
}

async function resolveProjectConfigPath(workspaceRoot: string): Promise<string> {
  const projectConfigDir = path.join(workspaceRoot, PROJECT_DIR_NAME);
  const yamlPath = path.join(projectConfigDir, 'config.yaml');
  const ymlPath = path.join(projectConfigDir, 'config.yml');
  const jsonPath = path.join(projectConfigDir, 'config.json');

  if (await fs.pathExists(yamlPath)) return yamlPath;
  if (await fs.pathExists(ymlPath)) return ymlPath;
  return jsonPath;
}

async function loadConfigForMcpScope(scopeInput?: string): Promise<{ config: LoadedConfig; scope: McpConfigScope }> {
  const scope = normalizeMcpScope(scopeInput);
  if (!scope) {
    throw new Error(`Invalid scope "${scopeInput}". Use: user or project.`);
  }

  if (scope === 'user') {
    return { config: await loadConfig(), scope };
  }

  const projectConfigPath = await resolveProjectConfigPath(process.cwd());
  return { config: await loadConfig(projectConfigPath), scope };
}
import { FileActionManager } from './actions/filesystem.js';
import { configureSearch } from './actions/web.js';
import { ProviderFactory } from './providers/ProviderFactory.js';
import { AutohandAgent } from './core/agent.js';
import { runAutoSkillGeneration } from './skills/autoSkill.js';
import { runRpcMode } from './modes/rpc/index.js';
import { runAcpMode } from './modes/acp/index.js';
import { normalizeMcpCommandForConfig } from './mcp/commandNormalization.js';
import { SetupWizard } from './onboarding/index.js';
import type { CLIOptions, AgentRuntime } from './types.js';
import { safeSetRawMode } from './ui/rawMode.js';

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


function isIgnorableStdinReadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }

  const maybeError = err as {
    code?: string;
    syscall?: string;
    fd?: number;
  };
  const stdinFd = typeof process.stdin.fd === 'number' ? process.stdin.fd : 0;
  return maybeError.code === 'EIO' && maybeError.syscall === 'read' && maybeError.fd === stdinFd;
}

process.on('uncaughtException', (err) => {
  if (isIgnorableStdinReadError(err)) {
    return;
  }
  (globalThis as any).__autohandLastError = err;
  console.error('[DEBUG] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  // Ignore readline close errors (happens during exit with Modal prompts)
  if (reason && typeof reason === 'object' && (reason as any).code === 'ERR_USE_AFTER_CLOSE') {
    return;
  }
  if (isIgnorableStdinReadError(reason)) {
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
  .description('Autonomous coding agent')
  .version(getVersionString(), '-v, --version', 'output the current version')
  .argument('[prompt]', 'Run a single instruction in command mode (same as -p)')
  .option('-p, --prompt <text>', 'Run a single instruction in command mode')
  .option('--path <path>', 'Workspace path to operate in')
  .option('-y, --yes', 'Auto-confirm risky actions', false)
  .option('--dry-run', 'Preview actions without applying mutations', false)
  .option('-d, --debug', 'Enable debug output (verbose logging)', false)
  .option('--model <model>', 'Override the configured LLM model')
  .option('--config <path>', 'Path to config file (default ~/.autohand/config.json)')
  .option('--temperature <value>', 'Sampling temperature', parseFloat)
  .option('--thinking [level]', 'Set thinking/reasoning depth (none, normal, extended)')
  .option('-c, --auto-commit', 'Auto-commit with LLM-generated message (runs lint & test first)', false)
  .option('--unrestricted', 'Run without any approval prompts (use with caution)', false)
  .option('--restricted', 'Deny all dangerous operations automatically', false)
  .option('--auto-skill', 'Auto-generate skills based on project analysis', false)
  .option('--skill-install [skill-name]', 'Install a community skill (opens browser if no name)')
  .option('--project', 'Install skill to project level (with --skill-install)', false)
  .option('--permissions', 'Display current permission settings and exit', false)
  .option('--login', 'Sign in to your Autohand account', false)
  .option('--logout', 'Sign out of your Autohand account', false)
  .option('--sync-settings [bool]', 'Enable/disable settings sync (default: true for logged users)')
  .option('--patch', 'Generate git patch without applying changes (requires --prompt)', false)
  .option('--output <file>', 'Output file for patch (default: stdout, used with --patch)')
  .option('--mode <mode>', 'Run mode: interactive (default), rpc, or acp', 'interactive')
  .option('--teammate-mode <mode>', 'Team display mode: auto, in-process, or tmux')
  .option('--worktree [name]', 'Run session in isolated git worktree (optional name)')
  .option('--tmux', 'Launch in a dedicated tmux session (implies --worktree)')
  // Auto-mode options
  .option('--auto-mode <prompt>', 'Start autonomous development loop with the given task')
  .option('--max-iterations <n>', 'Max auto-mode iterations (default: 50)', parseInt)
  .option('--completion-promise <text>', 'Completion marker text (default: "DONE")')
  .option('--no-worktree', 'Disable git worktree isolation in auto-mode')
  .option('--checkpoint-interval <n>', 'Git commit every N iterations (default: 5)', parseInt)
  .option('--max-runtime <m>', 'Max runtime in minutes (default: 120)', parseInt)
  .option('--max-cost <d>', 'Max API cost in dollars (default: 10)', parseFloat)
  .option('--setup', 'Run the setup wizard to configure or reconfigure Autohand', false)
  .option('--about', 'Show information about Autohand', false)
  .option('--add-dir <path...>', 'Add additional directories to workspace scope (can be used multiple times)')
  .option('--display-language <locale>', 'Set display language (e.g., en, zh-cn, fr, de, ja)')
  .option('--cc, --context-compact', 'Enable context compaction (default: on)')
  .option('--no-cc, --no-context-compact', 'Disable context compaction')
  .option('--search-engine <provider>', 'Set web search provider (google, brave, duckduckgo, parallel)')
  .option('--sys-prompt <value>', 'Replace entire system prompt (inline string or file path)')
  .option('--append-sys-prompt <value>', 'Append to system prompt (inline string or file path)')
  .option('--yolo [pattern]', 'Auto-approve tool calls matching pattern (e.g., allow:read,write or deny:delete)')
  .option('--timeout <seconds>', 'Timeout in seconds for auto-approve mode', parseInt)
  .action(async (positionalPrompt: string | undefined, opts: CLIOptions & { mode?: string; skillInstall?: string | boolean; project?: boolean; permissions?: boolean; worktree?: boolean | string; tmux?: boolean; setup?: boolean; about?: boolean; syncSettings?: string | boolean; cc?: boolean; searchEngine?: string }) => {
    // Positional argument acts as prompt (e.g. autohand 'explain this')
    // -p/--prompt flag takes precedence if both are provided
    if (positionalPrompt && !opts.prompt) {
      opts.prompt = positionalPrompt;
    }

    // tmux sessions are intended to run with isolated worktrees by default.
    // Respect explicit --no-worktree (opts.worktree === false) as invalid with --tmux.
    if (isTmuxEnabled(opts.tmux)) {
      if (opts.worktree === false) {
        console.error(chalk.red('--tmux cannot be used with --no-worktree'));
        process.exit(1);
      }
      if (opts.worktree === undefined) {
        opts.worktree = true;
      }
    }

    // Launch in tmux first (single-hop; child continues with AUTOHAND_TMUX_LAUNCHED=1)
    if (isTmuxEnabled(opts.tmux) && launchInTmuxIfRequested(opts)) {
      return;
    }

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

    // Handle --login flag
    if (opts.login) {
      const { login } = await import('./commands/login.js');
      const config = await loadConfig(opts.config);
      await login({ config });
      process.exit(0);
    }

    // Handle --logout flag
    if (opts.logout) {
      const { logout } = await import('./commands/logout.js');
      const config = await loadConfig(opts.config);
      await logout({ config });
      process.exit(0);
    }

    // Handle --about flag
    if (opts.about) {
      const { initI18n, detectLocale } = await import('./i18n/index.js');
      const { about } = await import('./commands/about.js');
      const { locale } = detectLocale();
      await initI18n(locale);
      await about();
      process.exit(0);
    }

    // Handle --setup flag
    if (opts.setup) {
      const config = await loadConfig(opts.config);
      const workspaceRoot = resolveWorkspaceRoot(config, opts.path);
      const wizard = new SetupWizard(workspaceRoot, config);
      const result = await wizard.run({ skipWelcome: false });

      if (result.cancelled) {
        console.log(chalk.gray('\nSetup cancelled.'));
        process.exit(0);
      }

      if (result.success) {
        const newConfig = { ...config, ...result.config };
        await saveConfig(newConfig);
        console.log(chalk.green('\nSetup complete! Run `autohand` to start.'));
      }
      process.exit(0);
    }

    // Handle --patch flag
    if (opts.patch) {
      await runPatchMode(opts);
      return;
    }

    // Map --cc flag to contextCompact option
    // Commander uses 'cc' for the flag name, we map it to 'contextCompact' for consistency
    if (opts.cc !== undefined) {
      opts.contextCompact = opts.cc;
    }

    // Map --search-engine flag to searchEngine option
    if ((opts as any).searchEngine) {
      const provider = (opts as any).searchEngine.toLowerCase();
      if (['google', 'brave', 'duckduckgo', 'parallel'].includes(provider)) {
        opts.searchEngine = provider as 'google' | 'brave' | 'duckduckgo' | 'parallel';
      } else {
        console.error(chalk.red(`Invalid search engine: ${provider}. Valid options: google, brave, duckduckgo, parallel`));
        process.exit(1);
      }
    }

    // RPC mode takes priority - auto-mode is handled via RPC methods when in RPC mode
    if (opts.mode === 'rpc') {
      await runRpcMode(opts);
      return;
    }

    // Native ACP mode - in-process Agent Client Protocol over stdio
    if (opts.mode === 'acp') {
      await runAcpMode(opts);
      return;
    }

    // Teammate mode — headless process receiving tasks from lead
    if (opts.mode === 'teammate') {
      const { parseTeammateOptions, runTeammateMode } = await import('./modes/teammate.js');
      const teammateOpts = parseTeammateOptions(process.argv);
      if (!teammateOpts) {
        console.error('Error: --mode teammate requires --team, --name, --agent, and --lead-session');
        process.exit(1);
      }
      await runTeammateMode(teammateOpts);
      return;
    }

    // Handle --auto-mode flag (standalone CLI mode only, not RPC)
    if (opts.autoMode) {
      // Commander's --no-worktree sets opts.worktree to false
      opts.noWorktree = opts.worktree === false;
      await runAutoMode(opts);
      return;
    }

    await runCLI(opts);
  });

program
  .command('resume <sessionId>')
  .description('Resume a previous session')
  .option('--path <path>', 'Workspace path to operate in')
  .option('--model <model>', 'Override the configured LLM model')
  .action(async (sessionId: string, opts: CLIOptions) => {
    await runCLI({ ...opts, resumeSessionId: sessionId });
  });

program
  .command('login')
  .description('Sign in to your Autohand account')
  .action(async () => {
    const { login } = await import('./commands/login.js');
    const config = await loadConfig();
    await login({ config });
    process.exit(0);
  });

program
  .command('logout')
  .description('Sign out of your Autohand account')
  .action(async () => {
    const { logout } = await import('./commands/logout.js');
    const config = await loadConfig();
    await logout({ config });
    process.exit(0);
  });

// ── MCP subcommand ──────────────────────────────────────────────────────
const mcpCmd = program
  .command('mcp')
  .description('Manage MCP (Model Context Protocol) servers');

mcpCmd
  .command('add <name> <target> [args...]')
  .description('Add an MCP server to config and auto-connect on next session')
  .option('-t, --transport <transport>', 'Transport type: stdio | http | sse', 'stdio')
  .option('-s, --scope <scope>', 'Config scope: user | project', 'user')
  .action(async (
    name: string,
    target: string,
    serverArgs: string[],
    options: { transport?: string; scope?: string }
  ) => {
    let config: LoadedConfig;
    let scope: McpConfigScope;
    try {
      const scoped = await loadConfigForMcpScope(options.scope);
      config = scoped.config;
      scope = scoped.scope;
    } catch (error) {
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
      return;
    }

    if (!config.mcp) config.mcp = {};
    if (!config.mcp.servers) config.mcp.servers = [];
    const wasMcpDisabled = config.mcp.enabled === false;
    if (wasMcpDisabled) {
      config.mcp.enabled = true;
    }

    const transport = (options.transport ?? 'stdio').toLowerCase();
    if (transport !== 'stdio' && transport !== 'http' && transport !== 'sse') {
      console.log(chalk.red(`Invalid transport "${options.transport}". Use: stdio or http.`));
      process.exit(1);
    }

    if (transport === 'sse') {
      console.log(chalk.yellow('SSE transport is not implemented yet.'));
      console.log(chalk.gray('Use --transport http (streamable HTTP) or stdio for now.'));
      process.exit(1);
    }

    if (transport === 'http' && serverArgs.length > 0) {
      console.log(chalk.red(`Transport "${transport}" does not accept extra args.`));
      console.log(chalk.gray(`Usage: autohand mcp add --transport ${transport} <name> <url>`));
      process.exit(1);
    }

    const normalized = normalizeMcpCommandForConfig(
      target,
      serverArgs.length > 0 ? serverArgs : undefined
    );
    const normalizedCommand = normalized.command ?? target;
    const normalizedArgs = normalized.args;

    const newServer = transport === 'stdio'
      ? {
          name,
          transport: 'stdio' as const,
          command: normalizedCommand,
          args: normalizedArgs,
          autoConnect: true,
        }
      : {
          name,
          transport: 'http' as const,
          url: target,
          autoConnect: true,
        };

    const displayTarget = transport === 'stdio'
      ? `${normalizedCommand} ${(normalizedArgs ?? []).join(' ')}`.trim()
      : target;

    const existing = config.mcp.servers.find(s => s.name === name);

    if (existing) {
      const sameConfig = transport === 'stdio'
        ? existing.transport === 'stdio'
          && existing.command === normalizedCommand
          && JSON.stringify(existing.args) === JSON.stringify(normalizedArgs)
        : existing.transport === transport
          && existing.url === target;

      if (sameConfig) {
        const wasAutoConnectDisabled = existing.autoConnect === false;
        if (wasAutoConnectDisabled || wasMcpDisabled) {
          existing.autoConnect = true;
          await saveConfig(config);

          const reenabledParts: string[] = [];
          if (wasMcpDisabled) reenabledParts.push('MCP support');
          if (wasAutoConnectDisabled) reenabledParts.push('auto-connect');
          const reenabled = reenabledParts.join(' and ');

          console.log(chalk.green(`Server "${name}" is already configured. Re-enabled ${reenabled}.`));
          console.log(chalk.gray('Server will auto-connect when you start autohand.'));
          process.exit(0);
        }

        console.log(chalk.green(`Server "${name}" is already configured with the same settings.`));
        process.exit(0);
      }

      // Update in-place
      existing.transport = newServer.transport;
      if (newServer.transport === 'stdio') {
        existing.command = newServer.command;
        existing.args = newServer.args;
        existing.url = undefined;
      } else {
        existing.url = newServer.url;
        existing.command = undefined;
        existing.args = undefined;
      }
      existing.autoConnect = true;
      await saveConfig(config);
      console.log(chalk.green(`Updated "${name}" in ${scope} config (${newServer.transport}: ${displayTarget})`));
      console.log(chalk.gray('Server will use the new settings on next start.'));
      process.exit(0);
    }

    config.mcp.servers.push(newServer);

    await saveConfig(config);
    console.log(chalk.green(`Added "${name}" to ${scope} config (${newServer.transport}: ${displayTarget})`));
    console.log(chalk.gray('Server will auto-connect when you start autohand.'));
    process.exit(0);
  });

mcpCmd
  .command('remove <name>')
  .description('Remove an MCP server from config')
  .option('-s, --scope <scope>', 'Config scope: user | project', 'user')
  .action(async (name: string, options: { scope?: string }) => {
    let config: LoadedConfig;
    let scope: McpConfigScope;
    try {
      const scoped = await loadConfigForMcpScope(options.scope);
      config = scoped.config;
      scope = scoped.scope;
    } catch (error) {
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
      return;
    }
    const serverIndex = config.mcp?.servers?.findIndex(s => s.name === name);

    if (serverIndex === undefined || serverIndex < 0) {
      console.log(chalk.yellow(`Server "${name}" not found in ${scope} config.`));
      process.exit(1);
    }

    config.mcp!.servers!.splice(serverIndex, 1);
    await saveConfig(config);
    console.log(chalk.green(`Removed "${name}" from ${scope} config.`));
    process.exit(0);
  });

mcpCmd
  .command('list')
  .description('List configured MCP servers')
  .option('-s, --scope <scope>', 'Config scope: user | project', 'user')
  .action(async (options: { scope?: string }) => {
    let config: LoadedConfig;
    let scope: McpConfigScope;
    try {
      const scoped = await loadConfigForMcpScope(options.scope);
      config = scoped.config;
      scope = scoped.scope;
    } catch (error) {
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
      return;
    }
    const servers = config.mcp?.servers ?? [];

    if (servers.length === 0) {
      console.log(chalk.gray(`No MCP servers configured in ${scope} config.`));
      console.log(chalk.gray('Add one with: autohand mcp add <name> <command> [args...]'));
      console.log(chalk.gray('Or HTTP: autohand mcp add --transport http <name> <url>'));
      process.exit(0);
    }

    console.log(chalk.cyan(`\nConfigured MCP Servers (${servers.length}, ${scope} config):\n`));
    for (const server of servers) {
      const target = server.transport === 'stdio'
        ? `${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}`.trim()
        : (server.url ?? '<missing-url>');
      const auto = server.autoConnect !== false ? chalk.green('auto-connect') : chalk.gray('manual');
      console.log(`  ${chalk.white(server.name)} ${chalk.gray('→')} ${server.transport}:${target} ${chalk.gray(`[${auto}]`)}`);
    }
    console.log();
    process.exit(0);
  });

mcpCmd
  .command('install [server-name]')
  .description('Browse and install community MCP servers')
  .option('-s, --scope <scope>', 'Config scope: user | project', 'user')
  .action(async (serverName: string | undefined, options: { scope?: string }) => {
    let config: LoadedConfig;
    try {
      const scoped = await loadConfigForMcpScope(options.scope);
      config = scoped.config;
    } catch (error) {
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
      return;
    }
    const { McpClientManager } = await import('./mcp/McpClientManager.js');
    const manager = new McpClientManager();
    const { mcpInstall } = await import('./commands/mcp-install.js');
    const result = await mcpInstall({ mcpManager: manager, config }, serverName);
    if (result) console.log(result);
    await manager.disconnectAll().catch(() => {});
    process.exit(0);
  });

// ── Sessions subcommand ─────────────────────────────────────────────────
program
  .command('sessions')
  .description('List saved sessions')
  .option('--project <name>', 'Filter sessions by project name')
  .action(async (opts: { project?: string }) => {
    const { SessionManager } = await import('./session/SessionManager.js');
    const sessionManager = new SessionManager();
    await sessionManager.initialize();
    const { sessions } = await import('./commands/sessions.js');
    const args = opts.project ? ['--project', opts.project] : [];
    await sessions({ sessionManager, args });
    process.exit(0);
  });

// ── Init subcommand ─────────────────────────────────────────────────────
program
  .command('init')
  .description('Create an AGENTS.md file in the workspace')
  .option('--path <path>', 'Workspace path')
  .action(async (opts: { path?: string }) => {
    const config = await loadConfig();
    const workspaceRoot = resolveWorkspaceRoot(config, opts.path);
    const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
    const exists = await fs.pathExists(agentsPath);
    if (exists) {
      console.log(chalk.yellow('AGENTS.md already exists in this workspace.'));
      process.exit(0);
    }
    const template = [
      '# AGENTS.md',
      '',
      '## Project Context',
      'Describe your project here so the agent understands the codebase.',
      '',
      '## Coding Standards',
      '- List your coding conventions',
      '- Preferred patterns and practices',
      '',
      '## Important Files',
      '- `src/index.ts` - Entry point',
      '',
    ].join('\n');
    await fs.writeFile(agentsPath, template);
    console.log(chalk.green(`Created ${agentsPath}`));
    process.exit(0);
  });

// ── Completion subcommand ───────────────────────────────────────────────
program
  .command('completion <shell>')
  .description('Generate shell completion scripts (bash, zsh, fish)')
  .action(async (shell: string) => {
    const { runCompletionCommand } = await import('./commands/completion.js');
    await runCompletionCommand(shell);
    process.exit(0);
  });

async function runCLI(options: CLIOptions): Promise<void> {
  try {
    let config = await loadConfig(options.config);
    const originalWorkspaceRoot = resolveWorkspaceRoot(config, options.path);
    let workspaceRoot = originalWorkspaceRoot;
    let sessionWorktree: ReturnType<typeof prepareSessionWorktree> | null = null;

    // Initialize i18n with locale detection
    const { locale: detectedLocale } = detectLocale({
      cliOverride: options.displayLanguage,
      configLocale: config.ui?.locale,
    });
    await initI18n(detectedLocale);

    // Check if API key is missing and run setup wizard
    const providerName = config.provider ?? 'openrouter';
    const providerConfig = getProviderConfig(config, providerName);

    if (!providerConfig) {
      // No valid provider config - run the setup wizard
      const wizard = new SetupWizard(originalWorkspaceRoot, config);
      const result = await wizard.run({ skipWelcome: !config.isNewConfig });

      if (result.cancelled) {
        console.log(chalk.gray('\nSetup cancelled.'));
        process.exit(0);
      }

      if (result.success) {
        // Merge wizard config into existing config
        config = { ...config, ...result.config };
        await saveConfig(config);
        console.log(); // Add spacing after wizard
      }
    }

    // Check for dangerous workspace directories (home, root, system dirs)
    const safetyCheck = checkWorkspaceSafety(originalWorkspaceRoot);
    if (!safetyCheck.safe) {
      printDangerousWorkspaceWarning(originalWorkspaceRoot, safetyCheck);
      process.exit(1);
    }

    // Optional isolated git worktree for interactive/prompt sessions
    if (isSessionWorktreeEnabled(options.worktree)) {
      sessionWorktree = prepareSessionWorktree({
        cwd: originalWorkspaceRoot,
        worktree: options.worktree,
        mode: 'cli',
      });
      workspaceRoot = sessionWorktree.worktreePath;

      const worktreeSafetyCheck = checkWorkspaceSafety(workspaceRoot);
      if (!worktreeSafetyCheck.safe) {
        printDangerousWorkspaceWarning(workspaceRoot, worktreeSafetyCheck);
        process.exit(1);
      }
    }

    // Validate and resolve additional directories from --add-dir flag
    const additionalDirs: string[] = [];
    if (options.addDir && options.addDir.length > 0) {
      for (const dir of options.addDir) {
        const resolvedDir = path.resolve(dir);

        // Check if directory exists
        if (!await fs.pathExists(resolvedDir)) {
          console.error(chalk.red(`Error: Additional directory does not exist: ${dir}`));
          process.exit(1);
        }

        // Check if it's a directory
        const stats = await fs.stat(resolvedDir);
        if (!stats.isDirectory()) {
          console.error(chalk.red(`Error: Additional path is not a directory: ${dir}`));
          process.exit(1);
        }

        // Safety check for the additional directory
        const addDirSafetyCheck = checkWorkspaceSafety(resolvedDir);
        if (!addDirSafetyCheck.safe) {
          console.error(chalk.red(`Error: Unsafe additional directory: ${dir}`));
          console.error(chalk.yellow(`  ${addDirSafetyCheck.reason}`));
          process.exit(1);
        }

        additionalDirs.push(resolvedDir);
      }
    }

    const runtime: AgentRuntime = {
      config,
      workspaceRoot,
      options,
      additionalDirs: additionalDirs.length > 0 ? additionalDirs : undefined
    };

    // Print banner FIRST for immediate visual feedback
    printBanner();
    if (sessionWorktree && process.stdout.isTTY) {
      console.log(chalk.gray(`Using git worktree: ${sessionWorktree.worktreePath}`));
      console.log(chalk.gray(`Branch: ${sessionWorktree.branchName}${sessionWorktree.createdBranch ? ' (new)' : ''}\n`));
    }

    // Initialize and start ping service (45-minute intervals for usage tracking)
    // This runs independently of telemetry opt-in for basic usage counting
    initPingService({
      cliVersion: packageJson.version,
      clientType: 'cli',
    });
    startPingService();

    // Stop ping service on process exit
    const stopPing = () => stopPingService();
    process.on('exit', stopPing);
    process.on('SIGINT', stopPing);
    process.on('SIGTERM', stopPing);

    // Print welcome immediately with no version/auth info - don't block on network
    printWelcome(runtime, undefined, null);

    // Mutable reference so the background startup IIFE can reach the agent
    // once it's constructed (after synchronous setup below).
    const agentHolder: { current: AutohandAgent | null } = { current: null };

    // Run startup checks synchronously before prompt to prevent output racing.
    // git init, tool checks etc. must finish printing BEFORE the prompt renders.
    try {
      const checkResults = await runStartupChecks(workspaceRoot);
      printStartupCheckResults(checkResults);
      if (!checkResults.allRequiredMet) {
        console.log(chalk.yellow('Continuing anyway, but some features may not work correctly.\n'));
      }
    } catch {
      // Non-critical - continue without startup check output
    }

    // Run auth, version check, sync in background (fire-and-forget).
    // These are network-bound and should not block the prompt.
    (async () => {
      try {
        const versionCheckPromise = config.ui?.checkForUpdates !== false
          ? checkForUpdates(packageJson.version, {
              checkIntervalHours: config.ui?.updateCheckInterval ?? 24,
            })
          : Promise.resolve(null);

        const [authUser, versionResult] = await Promise.all([
          validateAuthOnStartup(config),
          versionCheckPromise,
        ]);

        // Pass version check result to agent for status bar display
        if (versionResult && agentHolder.current) {
          agentHolder.current.setVersionCheckResult(versionResult);
        }

        // Start settings sync service for logged-in users
        if (authUser && config.auth?.token) {
          const syncEnabled = options.syncSettings !== false &&
            config.sync?.enabled !== false;

          if (syncEnabled) {
            try {
              const { createSyncService, DEFAULT_SYNC_CONFIG } = await import('./sync/index.js');
              const { setSyncService } = await import('./commands/sync.js');
              const syncService = createSyncService({
                authToken: config.auth.token,
                userId: authUser.id,
                config: {
                  ...DEFAULT_SYNC_CONFIG,
                  ...config.sync,
                  enabled: true,
                },
                onAuthFailure: async () => {
                  config.auth = undefined;
                  try { await saveConfig(config); } catch { /* ignore */ }
                  console.log(chalk.yellow('Session expired. Run /login to sign in again.'));
                },
              });
              syncService.start();
              setSyncService(syncService);

              const stopSync = () => {
                syncService?.stop();
                setSyncService(null);
              };
              process.on('exit', stopSync);
              process.on('SIGINT', stopSync);
              process.on('SIGTERM', stopSync);
            } catch {
              // Sync service failed to start, continue without it
            }
          }
        }
      } catch {
        // Non-critical startup tasks - don't crash on failure
      }
    })();

    // Note: Git repo check is passed to the agent via runtime.
    // The agent/LLM can suggest initializing git if needed for complex tasks.

    // Override model from CLI if provided
    if (options.model) {
      const providerName = config.provider ?? 'openrouter';
      if (config[providerName]) {
        (config as any)[providerName].model = options.model;
      }
    }

    // Override debug mode from CLI if provided
    if (options.debug) {
      config.agent = config.agent ?? {};
      config.agent.debug = true;
    }

    const llmProvider = ProviderFactory.create(config);
    const files = new FileActionManager(workspaceRoot, runtime.additionalDirs);

    // Handle --auto-skill flag
    if (options.autoSkill) {
      console.log(chalk.cyan('\nAuto-generating skills for this project...\n'));
      const result = await runAutoSkillGeneration(workspaceRoot, llmProvider);
      if (!result.success) {
        console.log(chalk.yellow(result.error || 'Failed to generate skills'));
      }
      return;
    }

    // Configure web search provider from CLI flag, config file, or environment
    const searchConfig = config.search ?? {};
    configureSearch({
      provider: options.searchEngine ?? searchConfig.provider ?? 'google',
      braveApiKey: searchConfig.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY,
      parallelApiKey: searchConfig.parallelApiKey ?? process.env.PARALLEL_API_KEY,
    });

    const agent = new AutohandAgent(llmProvider, files, runtime);
    agentHolder.current = agent;

    if (options.prompt) {
      // Read piped stdin if available (e.g. git diff | autohand -p "explain")
      let instruction = options.prompt;
      const stdinType = detectStdinType();
      if (stdinType === 'pipe') {
        const pipedInput = await readPipedStdin();
        instruction = buildPipePrompt(instruction, pipedInput);
      }

      await agent.runCommandMode(instruction);
      // Explicitly exit after prompt mode to prevent hanging
      // Some managers may keep event loop alive
      process.exit(0);
    } else if (options.resumeSessionId) {
      await agent.resumeSession(options.resumeSessionId);
      // Explicitly exit to prevent hanging from open handles
      process.exit(0);
    } else {
      await agent.runInteractive();
      // Explicitly exit after interactive mode to prevent hanging.
      // Background managers (telemetry, MCP, hooks) may keep the event loop alive.
      process.exit(0);
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

function printWelcome(runtime: AgentRuntime, authUser?: AuthUser, versionCheck?: VersionCheckResult | null): void {
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

  // Build version line with update status
  let versionLine = `${chalk.bold('> Autohand')} v${getVersionString()}`;
  if (versionCheck) {
    if (versionCheck.isUpToDate) {
      versionLine += chalk.green(' ✓ Up to date');
    } else if (versionCheck.updateAvailable && versionCheck.latestVersion) {
      versionLine += chalk.yellow(` ⬆ Update available: v${versionCheck.latestVersion}`);
    }
  }
  console.log(versionLine);

  // Show upgrade hint if update available
  if (versionCheck?.updateAvailable) {
    console.log(chalk.gray('  ↳ Run: ') + chalk.cyan(getInstallHint(versionCheck.channel)));
  }

  // Personalized greeting if logged in
  if (authUser) {
    console.log(chalk.green(`Welcome back, ${authUser.name || authUser.email}!`));
  }

  // Show CC status (default: ON unless --no-cc was passed)
  const ccEnabled = runtime.options.contextCompact !== false;
  const ccStatus = ccEnabled ? chalk.green('[CC: ON]') : chalk.yellow('[CC: OFF]');

  console.log(`${chalk.gray('model:')} ${chalk.cyan(model)}  ${ccStatus}  ${chalk.gray('| directory:')} ${chalk.cyan(dir)}`);
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

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(workspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
    process.exit(1);
  }

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

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(workspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
    process.exit(1);
  }

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
  const originalWorkspaceRoot = resolveWorkspaceRoot(config, opts.path);
  let workspaceRoot = originalWorkspaceRoot;

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(originalWorkspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(originalWorkspaceRoot, safetyCheck);
    process.exit(1);
  }

  if (isSessionWorktreeEnabled(opts.worktree)) {
    const sessionWorktree = prepareSessionWorktree({
      cwd: originalWorkspaceRoot,
      worktree: opts.worktree,
      mode: 'patch',
    });
    workspaceRoot = sessionWorktree.worktreePath;
    const worktreeSafetyCheck = checkWorkspaceSafety(workspaceRoot);
    if (!worktreeSafetyCheck.safe) {
      printDangerousWorkspaceWarning(workspaceRoot, worktreeSafetyCheck);
      process.exit(1);
    }
    console.error(chalk.gray(`Using git worktree: ${sessionWorktree.worktreePath}`));
    console.error(chalk.gray(`Branch: ${sessionWorktree.branchName}${sessionWorktree.createdBranch ? ' (new)' : ''}\n`));
  }

  // Validate and resolve additional directories from --add-dir flag
  const additionalDirs: string[] = [];
  if (opts.addDir && opts.addDir.length > 0) {
    for (const dir of opts.addDir) {
      const resolvedDir = path.resolve(dir);
      if (!await fs.pathExists(resolvedDir)) {
        console.error(chalk.red(`Error: Additional directory does not exist: ${dir}`));
        process.exit(1);
      }
      const stats = await fs.stat(resolvedDir);
      if (!stats.isDirectory()) {
        console.error(chalk.red(`Error: Additional path is not a directory: ${dir}`));
        process.exit(1);
      }
      const addDirSafetyCheck = checkWorkspaceSafety(resolvedDir);
      if (!addDirSafetyCheck.safe) {
        console.error(chalk.red(`Error: Unsafe additional directory: ${dir}`));
        console.error(chalk.yellow(`  ${addDirSafetyCheck.reason}`));
        process.exit(1);
      }
      additionalDirs.push(resolvedDir);
    }
  }

  // Override model from CLI if provided
  if (opts.model) {
    const providerName = config.provider ?? 'openrouter';
    if (config[providerName]) {
      (config as any)[providerName].model = opts.model;
    }
  }

  const llmProvider = ProviderFactory.create(config);
  const files = new FileActionManager(workspaceRoot, additionalDirs);

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
    options: patchOptions,
    additionalDirs: additionalDirs.length > 0 ? additionalDirs : undefined
  };

  // Show status
  console.error(chalk.cyan('Patch Mode: Changes will be captured without modifying files\n'));

  // Configure web search provider
  const searchConfig = config.search ?? {};
  configureSearch({
    provider: searchConfig.provider ?? 'google',
    braveApiKey: searchConfig.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY,
    parallelApiKey: searchConfig.parallelApiKey ?? process.env.PARALLEL_API_KEY,
  });

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

/**
 * Handle --auto-mode flag to run autonomous development loop
 */
async function runAutoMode(opts: CLIOptions): Promise<void> {
  if (!opts.autoMode) {
    console.error(chalk.red('Error: --auto-mode requires a task prompt'));
    process.exit(1);
  }

  const config = await loadConfig(opts.config);
  const originalWorkspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(originalWorkspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(originalWorkspaceRoot, safetyCheck);
    process.exit(1);
  }

  // Validate and resolve additional directories from --add-dir flag
  const additionalDirs: string[] = [];
  if (opts.addDir && opts.addDir.length > 0) {
    for (const dir of opts.addDir) {
      const resolvedDir = path.resolve(dir);
      if (!await fs.pathExists(resolvedDir)) {
        console.error(chalk.red(`Error: Additional directory does not exist: ${dir}`));
        process.exit(1);
      }
      const stats = await fs.stat(resolvedDir);
      if (!stats.isDirectory()) {
        console.error(chalk.red(`Error: Additional path is not a directory: ${dir}`));
        process.exit(1);
      }
      const addDirSafetyCheck = checkWorkspaceSafety(resolvedDir);
      if (!addDirSafetyCheck.safe) {
        console.error(chalk.red(`Error: Unsafe additional directory: ${dir}`));
        console.error(chalk.yellow(`  ${addDirSafetyCheck.reason}`));
        process.exit(1);
      }
      additionalDirs.push(resolvedDir);
    }
  }

  // Override model from CLI if provided
  if (opts.model) {
    const providerName = config.provider ?? 'openrouter';
    if (config[providerName]) {
      (config as any)[providerName].model = opts.model;
    }
  }

  // Override debug mode from CLI if provided
  if (opts.debug) {
    config.agent = config.agent ?? {};
    config.agent.debug = true;
  }

  // Import auto-mode dependencies
  const { AutomodeManager, getAutomodeOptions } = await import('./core/AutomodeManager.js');
  const { HookManager } = await import('./core/HookManager.js');
  const { SessionManager } = await import('./session/SessionManager.js');
  const { MemoryManager } = await import('./memory/MemoryManager.js');
  const readline = await import('readline');

  // Get auto-mode options first to determine worktree preference
  const automodeOptions = getAutomodeOptions(opts, config);
  if (!automodeOptions) {
    console.error(chalk.red('Error: Failed to parse auto-mode options'));
    process.exit(1);
  }

  // Banner
  printBanner();
  console.log(chalk.bold.cyan('\n🔄 Auto-Mode: Autonomous Development Loop\n'));
  console.log(chalk.gray('Task:'), chalk.white(opts.autoMode));
  console.log(chalk.gray('Max Iterations:'), chalk.cyan(automodeOptions.maxIterations ?? 50));
  console.log(chalk.gray('Completion Marker:'), chalk.cyan(automodeOptions.completionPromise ?? 'DONE'));
  console.log(chalk.gray('Worktree Isolation:'), chalk.cyan(automodeOptions.useWorktree !== false ? 'enabled' : 'disabled'));

  // Get model name for session
  const providerName = config.provider ?? 'openrouter';
  const modelName = opts.model ?? (config as any)[providerName]?.model ?? 'unknown';

  // Create session manager and session for auto-mode
  const sessionManager = new SessionManager();
  await sessionManager.initialize();
  const session = await sessionManager.createSession(originalWorkspaceRoot, modelName);
  session.metadata.type = 'automode';
  session.metadata.automodePrompt = opts.autoMode;

  // Create memory manager (uses original workspace for memory storage)
  const memoryManager = new MemoryManager(originalWorkspaceRoot);

  // Create hook manager (uses original workspace for hooks)
  const hookManager = new HookManager({
    settings: config.hooks ?? { enabled: true, hooks: [] },
    workspaceRoot: originalWorkspaceRoot,
  });

  // Create auto-mode manager with session
  const automodeManager = new AutomodeManager(config, originalWorkspaceRoot, hookManager, session, memoryManager);

  // Prepare worktree BEFORE creating agent (if enabled)
  // This ensures the agent operates in the isolated worktree
  const useWorktree = automodeOptions.useWorktree !== false;
  let effectiveWorkspace = originalWorkspaceRoot;

  if (useWorktree) {
    console.log(chalk.gray('\nPreparing git worktree for isolation...'));
    const worktreePath = await automodeManager.prepareWorktree(true);
    if (worktreePath) {
      effectiveWorkspace = worktreePath;
      console.log(chalk.green(`✓ Worktree created: ${worktreePath}`));
      console.log(chalk.gray(`  Branch: ${automodeManager.getBranchName()}`));
      console.log(chalk.gray(`  All changes will be isolated to this worktree`));
    } else {
      console.log(chalk.yellow('⚠ Continuing without worktree isolation'));
    }
  }
  console.log();

  // Create LLM provider
  const llmProvider = ProviderFactory.create(config);

  // Create file manager with effective workspace (worktree if available)
  const files = new FileActionManager(effectiveWorkspace, additionalDirs);

  // Set up ESC key handling for cancellation
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    safeSetRawMode(process.stdin, true);

    process.stdin.on('keypress', (_str, key) => {
      if (key && key.name === 'escape') {
        console.log(chalk.yellow('\n⚠️  Cancelling auto-mode...'));
        automodeManager.cancel('user_escape');
      }
      // Ctrl+C also cancels
      if (key && key.ctrl && key.name === 'c') {
        console.log(chalk.yellow('\n⚠️  Cancelling auto-mode...'));
        automodeManager.cancel('user_escape');
        // Restore terminal and exit
        if (process.stdin.isTTY) {
          safeSetRawMode(process.stdin, false);
        }
        process.exit(0);
      }
    });
  }

  try {
    // Create agent runtime with effective workspace (worktree if available)
    const runtime: AgentRuntime = {
      config,
      workspaceRoot: effectiveWorkspace,
      options: {
        ...opts,
        yes: true,  // Auto-confirm in auto-mode
      },
      additionalDirs: additionalDirs.length > 0 ? additionalDirs : undefined
    };

    // Configure web search provider
    const searchConfig = config.search ?? {};
    configureSearch({
      provider: searchConfig.provider ?? 'google',
      braveApiKey: searchConfig.braveApiKey ?? process.env.BRAVE_SEARCH_API_KEY,
      parallelApiKey: searchConfig.parallelApiKey ?? process.env.PARALLEL_API_KEY,
    });

    const agent = new AutohandAgent(llmProvider, files, runtime);

    // Define the iteration callback
    const runIteration = async (
      iteration: number,
      prompt: string,
      _abortSignal: AbortSignal
    ) => {
      // Build iteration prompt
      const iterationPrompt = buildIterationPrompt(prompt, iteration);

      // Reset per-iteration counters before running
      agent.getAndResetFileModCount();
      agent.getAndResetExecutedActions();

      let success = true;
      let error: string | undefined;

      try {
        await agent.runCommandMode(iterationPrompt);
      } catch (err) {
        success = false;
        error = (err as Error).message;
        console.error(chalk.red(`Iteration error: ${error}`));
      }

      // Collect actual file change data and action names from this iteration
      const fileChanges = agent.getAndResetFileModCount();
      const actions = agent.getAndResetExecutedActions();
      if (actions.length === 0) {
        actions.push('Executed agent iteration');
      }

      return {
        success,
        actions,
        error,
        filesModified: fileChanges.count,
        modifiedFiles: fileChanges.paths,
      };
    };

    // Start the auto-mode loop (this runs the main loop internally)
    await automodeManager.start(automodeOptions, runIteration);

    // Restore terminal
    if (process.stdin.isTTY) {
      safeSetRawMode(process.stdin, false);
    }

    // Get final state
    const finalState = automodeManager.getState();
    if (finalState) {
      session.metadata.automodeIterations = finalState.currentIteration;
      const statusText = finalState.status === 'completed' ? 'completed' : `ended (${finalState.status})`;
      console.log(chalk.gray(`\n📊 Auto-mode ${statusText} after ${finalState.currentIteration} iterations`));
    }

    // Ask user if they want to continue in interactive mode
    console.log(chalk.cyan('\n🔄 Auto-mode finished. You can continue working interactively.\n'));
    console.log(chalk.gray('Press Enter to continue in interactive mode, or Ctrl+C to exit.\n'));

    // Wait for user input
    const continuePromise = new Promise<boolean>((resolve) => {
      if (!process.stdin.isTTY) {
        resolve(false);
        return;
      }

      readline.emitKeypressEvents(process.stdin);
      safeSetRawMode(process.stdin, true);
      process.stdin.resume();

      const handleKey = (_str: string, key: readline.Key) => {
        process.stdin.off('keypress', handleKey);
        if (process.stdin.isTTY) {
          safeSetRawMode(process.stdin, false);
        }

        if (key && key.ctrl && key.name === 'c') {
          resolve(false);
        } else if (key && key.name === 'return') {
          resolve(true);
        } else {
          // Any other key - continue
          resolve(true);
        }
      };

      process.stdin.on('keypress', handleKey);
    });

    const shouldContinue = await continuePromise;

    if (!shouldContinue) {
      // Close session and exit
      const statusText = finalState?.status === 'completed' ? 'completed' : `ended (${finalState?.status})`;
      await sessionManager.closeSession(`Auto-mode ${statusText} after ${finalState?.currentIteration ?? 0} iterations: ${opts.autoMode?.slice(0, 50)}...`);
      console.log(chalk.gray(`\n📁 Session saved: ${session.metadata.sessionId}`));
      process.exit(finalState?.status === 'completed' ? 0 : 1);
    }

    // Continue in interactive mode with the same session
    console.log(chalk.cyan('\n▶️ Continuing in interactive mode...\n'));

    // Transition to interactive mode with the existing agent
    await agent.runInteractive();

  } catch (error) {
    // Restore terminal
    if (process.stdin.isTTY) {
      safeSetRawMode(process.stdin, false);
    }

    // Close session on error
    await sessionManager.closeSession(`Auto-mode failed: ${(error as Error).message}`);

    console.error(chalk.red(`\nAuto-mode error: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Build prompt for each auto-mode iteration
 */
function buildIterationPrompt(taskPrompt: string, iteration: number): string {
  return `# Auto-Mode Task (Iteration ${iteration})

## Original Task
${taskPrompt}

## Instructions
You are running in auto-mode, an autonomous development loop. Continue working on the task above.

1. Review your previous work (check git log, file changes, test results)
2. Identify what remains to be done
3. Make progress on the task
4. If the task is complete, output: <promise>DONE</promise>

IMPORTANT: Only output <promise>DONE</promise> when ALL requirements are fully met.
Do not stop early - keep improving until the task is truly complete.`;
}

program.parseAsync();

function launchInTmuxIfRequested(opts: CLIOptions & { mode?: string }): boolean {
  if (!opts.tmux) {
    return false;
  }

  if (process.env.AUTOHAND_TMUX_LAUNCHED === '1') {
    return false;
  }

  if (opts.mode === 'rpc' || opts.mode === 'acp') {
    console.error(chalk.red('--tmux is not supported with --mode rpc or --mode acp'));
    process.exit(1);
  }

  const check = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  if (check.status !== 0) {
    console.error(chalk.red('tmux is not available. Install tmux or run without --tmux.'));
    process.exit(1);
  }

  const sessionName = createTmuxSessionName();
  const command = buildTmuxLaunchCommand(process.argv);

  const create = spawnSync('tmux', ['new-session', '-d', '-s', sessionName, command], {
    encoding: 'utf8',
  });

  if (create.status !== 0) {
    const details = create.stderr?.trim() || create.stdout?.trim() || 'unknown error';
    console.error(chalk.red(`Failed to start tmux session: ${details}`));
    process.exit(1);
  }

  if (process.env.TMUX) {
    const switched = spawnSync('tmux', ['switch-client', '-t', sessionName], { stdio: 'inherit' });
    if (switched.status !== 0) {
      console.log(chalk.green(`Started tmux session: ${sessionName}`));
      console.log(chalk.gray(`Attach with: tmux attach-session -t ${sessionName}`));
    }
    process.exit(0);
  }

  if (process.stdin.isTTY) {
    const attached = spawnSync('tmux', ['attach-session', '-t', sessionName], { stdio: 'inherit' });
    process.exit(attached.status ?? 0);
  }

  console.log(chalk.green(`Started tmux session: ${sessionName}`));
  console.log(chalk.gray(`Attach with: tmux attach-session -t ${sessionName}`));
  process.exit(0);
}
