#!/usr/bin/env node
process.title = 'Autohand Code';
// Set terminal window/icon title (OSC 0 - works in Ghostty, iTerm2, and most terminals)
if (process.stdout.isTTY) {
  process.stdout.write('\x1b]0;Autohand Code\x07');
}
// Set environment variable for detection by Expect and other tools
process.env.AUTOHAND_CODE = '1';
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { getProviderConfig, loadConfig, resolveWorkspaceRoot, saveConfig } from './config.js';
import { runStartupChecks, printStartupCheckResults, validateWorkspacePath } from './startup/checks.js';
import { checkWorkspaceSafety, printDangerousWorkspaceWarning } from './startup/workspaceSafety.js';
import { ensureAuthenticated } from './auth/index.js';
import type { AuthUser, BuiltInProviderName, LoadedConfig, SkillInstallScope } from './types.js';
import { validateAuthOnStartup } from './auth/startupAuth.js';
import { installProcessErrorHandlers } from './reporting/processErrorReporting.js';
import { checkForUpdates, getInstallHint, type VersionCheckResult } from './utils/versionCheck.js';
import { initI18n, detectLocale } from './i18n/index.js';
import { initPingService, shutdownPingService, startPingService } from './telemetry/index.js';
import { detectStdinType, readPipedStdin } from './utils/stdinDetector.js';
import { buildPipePrompt } from './modes/pipeMode.js';
import { shouldUseInteractivePipeHandoff } from './modes/pipeRouting.js';
import { AUTOHAND_PATHS, PROJECT_DIR_NAME } from './constants.js';
import { isSessionWorktreeEnabled, prepareSessionWorktree } from './utils/sessionWorktree.js';
import { buildTmuxLaunchCommand, createTmuxSessionName, isTmuxEnabled } from './utils/tmux.js';
import { registerBrowserCommand, registerBrowserOptions } from './browser/cliCommand.js';
import { formatDeprecatedBrowserOptionWarning } from './browser/compatibility.js';
import {
  normalizeContextCompactOption,
  normalizeInitialCliOptions,
  normalizePromptAndProtocolOptions,
  normalizeSearchEngineOption,
  normalizeTmuxWorktreeOption,
  type RootCliOptions,
} from './startup/cliOptions.js';
import {
  resolveAgentLaunchMode,
  resolvePostAuthLaunchMode,
  resolveProtocolLaunchMode,
} from './startup/modeRouter.js';
import { prepareBareModeConfig } from './runtime/bareMode.js';
import {
  awaitCliLifecycleStep,
  CliRuntimeResourceOwner,
} from './runtime/CliRuntimeResourceOwner.js';
import { setSyncService as setRuntimeSyncService } from './sync/runtimeSyncService.js';
import type { SyncService } from './sync/SyncService.js';
import { getFeatureState } from './features/featureRegistry.js';
import { getTerminalColumns, renderAutohandLogo } from './utils/asciiArt.js';
import {
  formatInstallHint,
  formatStartupBanner,
  formatUpdateAvailable,
  formatUpdateReady,
  formatWelcomeGreeting,
  formatWelcomeStatusLine,
  formatWelcomeSuggestion,
  formatWelcomeTitle,
  formatWelcomeVersionPrefix,
} from './ui/theme/startup.js';
import { AgentsGenerator } from './onboarding/agentsGenerator.js';
import { looksLikeInlineAgents, parseInlineAgents } from './core/agents/AgentRegistry.js';
import { getCustomProviderConfig, isCustomProviderName } from './providers/customProviders.js';
import { runtimeVersion } from './utils/runtimeVersion.js';

async function refreshModelCatalogBeforeAgentStart(options: {
  bare?: boolean;
  offline?: boolean;
}): Promise<void> {
  const { refreshModelCatalogOnStartup } = await import('./providers/modelCatalogUpdater.js');
  await refreshModelCatalogOnStartup({
    offline: options.offline === true || options.bare === true ? true : undefined,
    userAgent: `autohand/${runtimeVersion}`,
  });
}

function applyCliModelOverride(config: LoadedConfig, model: string): void {
  const providerName = config.provider ?? 'openrouter';
  if (isCustomProviderName(providerName)) {
    const customProvider = getCustomProviderConfig(config, providerName);
    if (customProvider) {
      config.customProviders = {
        ...config.customProviders,
        [customProvider.id]: {
          ...customProvider,
          model,
        },
      };
    }
    return;
  }

  const providerConfig = config[providerName as BuiltInProviderName];
  if (providerConfig) {
    providerConfig.model = model;
  }
}

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
  const alphaCommit = getCommitFromAlphaVersion(runtimeVersion);
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
  return `${runtimeVersion} (${commit})`;
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
  const tomlPath = path.join(projectConfigDir, 'config.toml');
  const yamlPath = path.join(projectConfigDir, 'config.yaml');
  const ymlPath = path.join(projectConfigDir, 'config.yml');
  const jsonPath = path.join(projectConfigDir, 'config.json');

  if (await fs.pathExists(tomlPath)) return tomlPath;
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
  return { config: await loadConfig(projectConfigPath, process.cwd()), scope };
}

import { normalizeMcpCommandForConfig } from './mcp/commandNormalization.js';
import type { CLIOptions, AgentRuntime } from './types.js';
import type { AutohandAgent } from './core/agent.js';
import { registerExtensionsCommand } from './extensions/cli.js';

installProcessErrorHandlers();

const program = new Command();
registerBrowserCommand(program);
registerBrowserOptions(program);
registerExtensionsCommand(program);

program
  .name('autohand')
  .description('Autonomous coding agent')
  .version(getVersionString(), '-v, --version', 'output the current version')
  .argument('[prompt]', 'Run a single instruction in command mode (same as -p)')
  .option('-p, --prompt [text]', 'Run a single instruction in command mode')
  .option('--bare', 'Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and AGENTS.md auto-discovery', false)
  .option('--offline', 'Disable startup network operations, including model catalog refreshes', false)
  .option('--path <path>', 'Workspace path to operate in')
  .option('-y, --yes', 'Auto-confirm risky actions', false)
  .option('--y', 'Alias for --yes', false)
  .option('--dry-run', 'Preview actions without applying mutations', false)
  .option('-d, --debug', 'Enable debug output (verbose logging)', false)
  .option('--model <model>', 'Override the configured LLM model')
  .option('--config <path>', 'Path to config file (default ~/.autohand/config.json)')
  .option('--temperature <value>', 'Sampling temperature', parseFloat)
  .option('--thinking [level]', 'Set thinking/reasoning depth (none, normal, extended)')
  .option('-c, --auto-commit', 'Auto-commit with LLM-generated message (runs lint & test first)', false)
  .option('--unrestricted', 'Run without any approval prompts (use with caution)', false)
  .option('--restricted', 'Deny all dangerous operations automatically', false)
  .option('--no-idle-logout', 'Disable authenticated idle logout for long-running agent sessions')
  .option('--goal [input]', 'Run /goal non-interactively (status when omitted, otherwise same arguments as /goal)')
  .option('--auto-skill', 'Auto-generate skills based on project analysis', false)
  .option('--learn', 'Run /learn skill advisor non-interactively (analyze and install recommended skills)', false)
  .option('--learn-update', 'Re-analyze project and regenerate outdated LLM-generated skills', false)
  .option('--skill-install [skill-name]', 'Install a community skill (opens browser if no name)')
  .option('--project', 'Install skill to project level (with --skill-install)', false)
  .option('--permissions', 'Display current permission settings and exit', false)
  .option('--settings', 'Configure Autohand settings (same as /settings in interactive mode)', false)
  .option('--login', 'Sign in to your Autohand account', false)
  .option('--logout', 'Sign out of your Autohand account', false)
  .option('--sync-settings [bool]', 'Enable/disable settings sync (default: true for logged users)')
  .option('--patch', 'Generate git patch without applying changes (requires --prompt)', false)
  .option('--output <file>', 'Output file for patch (default: stdout, used with --patch)')
  .option('--mode <mode>', 'Run mode: interactive (default), rpc, or acp', 'interactive')
  .option('--acp', 'Shorthand for --mode acp (Agent Client Protocol over stdio)', false)
  .option('--teammate-mode <mode>', 'Team display mode: auto, in-process, or tmux')
  .option('--worktree [name]', 'Run session in isolated git worktree (optional name)')
  .option('--tmux', 'Launch in a dedicated tmux session (implies --worktree)')
  // Auto-mode options
  .option('--auto-mode [prompt]', 'Enable interactive auto-mode, or start a standalone loop with an inline task')
  .option('--max-iterations <n>', 'Max auto-mode iterations (default: 50)', parseInt)
  .option('--completion-promise <text>', 'Completion marker text (default: "DONE")')
  .option('--no-worktree', 'Disable git worktree isolation in auto-mode')
  .option('--checkpoint-interval <n>', 'Git commit every N iterations (default: 5)', parseInt)
  .option('--max-runtime <m>', 'Max runtime in minutes (default: 120)', parseInt)
  .option('--max-cost <d>', 'Max API cost in dollars (default: 10)', parseFloat)
  .option('--interactive-on-complete', 'After auto-mode ends, hand off directly to interactive mode (TTY only)', false)
  .option('--setup', 'Run the setup wizard to configure or reconfigure Autohand', false)
  .option('--about', 'Show information about Autohand', false)
  .option('--feedback', 'Submit feedback', false)
  .option('--add-dir <path...>', 'Add additional directories to workspace scope (can be used multiple times)')
  .option('--display-language <locale>', 'Set display language (e.g., en, id, zh-cn, fr, de, ja)')
  .option('--cc, --context-compact', 'Enable context compaction (default: on)')
  .option('--no-cc, --no-context-compact', 'Disable context compaction')
  .option('--search-engine <provider>', 'Set web search provider (browser-profile, exa, google, brave, duckduckgo, parallel)')
  .option('--sys-prompt <value>', 'Replace entire system prompt (inline string or file path)')
  .option('--system-prompt <value>', 'Replace entire system prompt (inline string or file path)')
  .option('--system-prompt-file <path>', 'Replace entire system prompt with file contents')
  .option('--append-sys-prompt <value>', 'Append to system prompt (inline string or file path)')
  .option('--append-system-prompt <value>', 'Append to system prompt (inline string or file path)')
  .option('--append-system-prompt-file <path>', 'Append file contents to system prompt')
  .option('--mcp-config <path>', 'Explicit MCP config file')
  .option('--agents <json|path>', 'Custom agents as inline JSON ({"reviewer":{"description":"...","prompt":"..."}}) or an external agents directory')
  .option('--plugin-dir <path>', 'Explicit plugin/meta-tool directory')
  .option('--yolo [pattern]', 'Auto-approve tool calls matching pattern (e.g., allow:read,write or deny:delete)')
  .option('--timeout <seconds>', 'Timeout in seconds for auto-approve mode', parseInt)
  .option('--fork <pathOrId>', 'Create and resume a new session branch from an existing session reference')
  .action(async (positionalPrompt: string | undefined, opts: RootCliOptions) => {
    // Clear screen immediately for Cursor-like behavior (before any output)
    if (process.stdout.isTTY && process.env.AUTOHAND_NO_BANNER !== '1') {
      process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
    }

    const normalization = normalizeInitialCliOptions(opts);
    if (normalization.deprecatedBrowserOption) {
      console.warn(chalk.yellow(formatDeprecatedBrowserOptionWarning(normalization.deprecatedBrowserOption)));
    }

    const { extensionRuntimeHost } = await import('./extensions/ExtensionRuntimeHost.js');
    extensionRuntimeHost.setCliOptions(opts as unknown as Record<string, unknown>);

    await refreshModelCatalogBeforeAgentStart(opts);

    // `--agents` accepts inline JSON (Claude Code format) or a directory path.
    // Parse and validate inline JSON up front so users get a clear error before
    // the session starts; a path value is left untouched for the registry.
    if (typeof opts.agents === 'string' && looksLikeInlineAgents(opts.agents)) {
      try {
        opts.inlineAgents = parseInlineAgents(opts.agents);
      } catch (error) {
        console.error(chalk.red(`Invalid --agents JSON: ${(error as Error).message}`));
        process.exit(1);
      }
    }

    normalizePromptAndProtocolOptions(positionalPrompt, opts);

    // tmux sessions are intended to run with isolated worktrees by default.
    // Respect explicit --no-worktree (opts.worktree === false) as invalid with --tmux.
    const tmuxOptionError = normalizeTmuxWorktreeOption(opts);
    if (tmuxOptionError) {
      console.error(chalk.red(tmuxOptionError));
      process.exit(1);
    }

    // Launch in tmux first (single-hop; child continues with AUTOHAND_TMUX_LAUNCHED=1)
    if (isTmuxEnabled(opts.tmux) && launchInTmuxIfRequested(opts)) {
      return;
    }

    // Handle --skill-install flag
    if (opts.skillInstall !== undefined) {
      const continueInteractive = await runSkillInstall(opts);
      if (!continueInteractive) {
        return;
      }
    }

    // Handle --learn flag (non-interactive /learn)
    if (opts.learn) {
      await runLearnNonInteractive(opts, 'recommend');
      return;
    }

    // Handle --learn-update flag (non-interactive /learn update)
    if (opts.learnUpdate) {
      await runLearnNonInteractive(opts, 'update');
      return;
    }

    // Handle --permissions flag
    if (opts.permissions) {
      await displayPermissions(opts);
      return;
    }

    // Handle --settings flag
    if ((opts as any).settings) {
      const config = await loadConfig(opts.config, process.cwd());
      const { settings } = await import('./commands/settings.js');
      await settings({ config });
      process.exit(0);
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
      const config = await loadConfig(opts.config);
      await about({ config });
      process.exit(0);
    }

    // Handle --feedback flag
    if (opts.feedback) {
      const { initI18n, detectLocale } = await import('./i18n/index.js');
      const { feedback } = await import('./commands/feedback.js');
      const { locale } = detectLocale();
      await initI18n(locale);
      const config = await loadConfig(opts.config);
      await feedback({ config });
      process.exit(0);
    }

    // Handle --setup flag
    if (opts.setup) {
      const config = await loadConfig(opts.config, process.cwd());
      const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

      const workspacePathValidation = await validateWorkspacePath(workspaceRoot);
      if (!workspacePathValidation.valid) {
        console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
        process.exit(1);
      }
      const safetyCheck = checkWorkspaceSafety(workspaceRoot);
      if (!safetyCheck.safe) {
        printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
        process.exit(1);
      }

      const { SetupWizard } = await import('./onboarding/index.js');
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

    // Protocol modes reserve stdout for their SDK transports and cannot show
    // interactive auth/login UI. They perform their own non-interactive config,
    // workspace, and auth checks after stdout/stderr are prepared for the mode.
    const protocolLaunchMode = resolveProtocolLaunchMode(opts);
    if (protocolLaunchMode === 'rpc') {
      const { runRpcMode } = await import('./modes/rpc/index.js');
      process.exitCode = await runRpcMode(opts);
      return;
    }

    if (protocolLaunchMode === 'acp') {
      const { runAcpMode } = await import('./modes/acp/index.js');
      await runAcpMode(opts);
      return;
    }

    // ── Workspace safety gate ──
    // Check workspace is safe BEFORE requiring authentication so users
    // running from home/system directories get the warning first.
    {
      const preAuthConfig = await loadConfig(opts.config, process.cwd());
      const workspaceRoot = resolveWorkspaceRoot(preAuthConfig, opts.path);
      const workspacePathValidation = await validateWorkspacePath(workspaceRoot);
      if (!workspacePathValidation.valid) {
        console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
        process.exit(1);
      }
      const safetyCheck = checkWorkspaceSafety(workspaceRoot);
      if (!safetyCheck.safe) {
        printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
        process.exit(1);
      }
    }

    // ── Mandatory authentication gate ──
    // Everything below requires a valid login. --login, --logout, --setup,
    // --about, --permissions, --skill-install, and --learn* are exempt above.
    {
      let authConfig = await loadConfig(opts.config, process.cwd());
      authConfig = await ensureAuthenticated(authConfig, { bare: opts.bare === true });
      // Propagate refreshed auth into the options so downstream code sees
      // the updated token (e.g. runCLI, runRpcMode, runAutoMode).
      (opts as any)._authConfig = authConfig;
    }

    // Handle --patch flag
    if (opts.patch) {
      await runPatchMode(opts);
      return;
    }

    // Map --cc flag to contextCompact option
    // Commander uses 'cc' for the flag name, we map it to 'contextCompact' for consistency
    normalizeContextCompactOption(opts);

    if (opts.goal !== undefined) {
      await runGoalFlag(opts);
      if (!opts.prompt) {
        return;
      }
    }


    // Disable the browser bridge when --no-browser (or its compatibility alias) is used.
    if (opts.browser === false) {
      const config = await loadConfig(opts.config, process.cwd());
      if (config.chrome) {
        config.chrome.enabledByDefault = false;
        await saveConfig(config);
        console.log(chalk.green("\u2713 Browser integration disabled."));
      }
      // Continue to the normal CLI flow without opening a browser handoff.
    }

    // Map --search-engine flag to searchEngine option
    const searchEngineError = normalizeSearchEngineOption(opts);
    if (searchEngineError) {
      console.error(chalk.red(searchEngineError));
      process.exit(1);
    }

    const postAuthLaunchMode = resolvePostAuthLaunchMode({
      mode: opts.mode,
      autoMode: opts.autoMode,
      prompt: opts.prompt,
      argv: process.argv,
      stdinIsTTY: Boolean(process.stdin.isTTY),
    });

    // Teammate mode — headless process receiving tasks from lead
    if (postAuthLaunchMode === 'teammate') {
      const { parseTeammateOptions, runTeammateMode } = await import('./modes/teammate.js');
      const teammateOpts = parseTeammateOptions(process.argv);
      if (!teammateOpts) {
        console.error('Error: --mode teammate requires --team, --name, --agent, and --lead-session');
        process.exit(1);
      }
      await runTeammateMode(teammateOpts);
      return;
    }

    if (postAuthLaunchMode === 'auto-unavailable') {
      console.error(chalk.red('Interactive auto-mode requires a terminal (TTY). Use `autohand --auto-mode "<task>"` for standalone loops.'));
      process.exit(1);
    }

    // Handle standalone --auto-mode loops
    if (postAuthLaunchMode === 'auto-standalone') {
      // Commander's --no-worktree sets opts.worktree to false
      opts.noWorktree = opts.worktree === false;
      await runAutoMode(opts);
      return;
    }

    if (postAuthLaunchMode === 'auto-interactive') {
      opts.interactiveAutoMode = true;
    }

    await runCLI(opts);
  });

program
  .command('resume <sessionId>')
  .description('Resume a previous session')
  .option('--path <path>', 'Workspace path to operate in')
  .option('--model <model>', 'Override the configured LLM model')
  .option('--offline', 'Disable the model catalog refresh for this resumed session', false)
  .action(async (sessionId: string, opts: CLIOptions & { offline?: boolean }) => {
    await refreshModelCatalogBeforeAgentStart(opts);

    // Mandatory auth gate for resume
    let authConfig = await loadConfig(opts.config, process.cwd());
    authConfig = await ensureAuthenticated(authConfig);
    (opts as any)._authConfig = authConfig;

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

program
  .command('squad [args...]')
  .description('Start and manage the standalone Autohand Squad runtime')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (args: string[] = []) => {
    const rootOptions = program.opts<CLIOptions>();
    const config = await loadConfig(rootOptions.config, process.cwd());
    const workspaceRoot = resolveWorkspaceRoot(config, rootOptions.path);
    const { runSquadCommand } = await import('./commands/squad.js');
    const result = await runSquadCommand({ workspaceRoot, config }, args);
    if (result.output) {
      if (result.code === 0) {
        console.log(result.output);
      } else {
        console.error(result.output);
      }
    }
    process.exit(result.code);
  });

program
  .command('queue [args...]')
  .description('Show the local Autohand Squad queue')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (args: string[] = []) => {
    const rootOptions = program.opts<CLIOptions>();
    const config = await loadConfig(rootOptions.config, process.cwd());
    const workspaceRoot = resolveWorkspaceRoot(config, rootOptions.path);
    const { runSquadCommand } = await import('./commands/squad.js');
    const result = await runSquadCommand({ workspaceRoot, config }, ['queue', ...args]);
    if (result.output) {
      if (result.code === 0) {
        console.log(result.output);
      } else {
        console.error(result.output);
      }
    }
    process.exit(result.code);
  });

// ── Config subcommand ───────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Configure Autohand settings')
  .action(async () => {
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const { settings } = await import('./commands/settings.js');
    await settings({ config });
    process.exit(0);
  });

configCmd
  .command('set <parts...>')
  .description('Set a config value, e.g. autohand config set verbs activity false')
  .action(async (parts: string[]) => {
    try {
      const config = await loadConfig(program.opts<{ config?: string }>().config);
      const { parseConfigSetArgs, setConfigSetting, formatConfigSetResult } = await import('./commands/settings.js');
      const { key, value } = parseConfigSetArgs(parts);
      const result = setConfigSetting(config, key, value);
      await saveConfig(config);
      console.log(chalk.green(formatConfigSetResult(result)));
      process.exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(message));
      process.exit(1);
    }
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

// ── Experiments subcommands ─────────────────────────────────────────────
const experimentsCmd = program
  .command('experiments')
  .description('List and toggle Autohand experiments')
  .action(async () => {
    const { features } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await features({ config }, ['list']);
    if (result) console.log(result);
    process.exit(0);
  });

experimentsCmd
  .command('list')
  .alias('ls')
  .description('List experiments and current state')
  .action(async () => {
    const { features } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await features({ config }, ['list']);
    if (result) console.log(result);
    process.exit(0);
  });

experimentsCmd
  .command('status <feature>')
  .alias('show')
  .description('Show one experiment')
  .action(async (featureId: string) => {
    const { features } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await features({ config }, ['status', featureId]);
    if (result?.startsWith('Unknown feature')) {
      console.log(chalk.red(result));
      process.exit(1);
    }
    if (result) console.log(result);
    process.exit(0);
  });

experimentsCmd
  .command('refresh')
  .description('Download remote feature flags from the Autohand API')
  .action(async () => {
    const { features } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await features({ config }, ['refresh']);
    if (result) console.log(result);
    process.exit(0);
  });

experimentsCmd
  .command('enable <feature>')
  .description('Enable an experiment')
  .action(async (featureId: string) => {
    const { setFeatureEnabled } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await setFeatureEnabled(config, featureId, true);
    if (result.startsWith('Unknown feature')) {
      console.log(chalk.red(result));
      process.exit(1);
    }
    console.log(result);
    process.exit(0);
  });

experimentsCmd
  .command('disable <feature>')
  .description('Disable an experiment')
  .action(async (featureId: string) => {
    const { setFeatureEnabled } = await import('./commands/features.js');
    const config = await loadConfig(program.opts<{ config?: string }>().config);
    const result = await setFeatureEnabled(config, featureId, false);
    if (result.startsWith('Unknown feature')) {
      console.log(chalk.red(result));
      process.exit(1);
    }
    console.log(result);
    process.exit(0);
  });

// ── Sessions subcommand ─────────────────────────────────────────────────
program
  .command('agents [args...]')
  .description('Show active Autohand CLI agents')
  .option('--once', 'Print one snapshot and exit')
  .action(async (args: string[] = [], opts: { once?: boolean }) => {
    const { handler } = await import('./commands/agents.js');
    const commandArgs = opts.once ? [...args, '--once'] : args;
    const output = await handler(commandArgs);
    if (output) {
      console.log(output);
    }
    process.exit(0);
  });

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
    const config = await loadConfig(undefined, process.cwd());
    const workspaceRoot = resolveWorkspaceRoot(config, opts.path);
    const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
    const exists = await fs.pathExists(agentsPath);
    if (exists) {
      console.log(chalk.yellow('AGENTS.md already exists in this workspace.'));
      process.exit(0);
    }
    const generator = new AgentsGenerator();
    await fs.writeFile(agentsPath, generator.generateContent({}));
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

// ── Update/Upgrade subcommand ───────────────────────────────────────────
program
  .command('update')
  .description('Check for updates and install if available')
  .option('--check', 'Only check for updates without installing')
  .option('--models', 'Refresh the remote model catalog without updating the CLI')
  .action(async (opts: { check?: boolean; models?: boolean }) => {
    const { runModelCatalogUpdate, runUpdate } = await import('./commands/update.js');
    if (opts.models) {
      if (opts.check) {
        throw new Error('--check cannot be combined with --models');
      }
      await runModelCatalogUpdate({ currentVersion: runtimeVersion });
      return;
    }
    await runUpdate({
      currentVersion: runtimeVersion,
      check: opts.check ?? false,
    });
  });

program
  .command('upgrade')
  .description('Check for updates and install if available')
  .option('--check', 'Only check for updates without installing')
  .option('--models', 'Refresh the remote model catalog without updating the CLI')
  .action(async (opts: { check?: boolean; models?: boolean }) => {
    const { runModelCatalogUpdate, runUpdate } = await import('./commands/update.js');
    if (opts.models) {
      if (opts.check) {
        throw new Error('--check cannot be combined with --models');
      }
      await runModelCatalogUpdate({ currentVersion: runtimeVersion });
      return;
    }
    await runUpdate({
      currentVersion: runtimeVersion,
      check: opts.check ?? false,
    });
  });

// ── Auto-research subcommand ─────────────────────────────────────────────
program
  .command('auto-research [args...]')
  .alias('autoresearch')
  .description('Start, inspect, or finalize an auto-research session under .auto/')
  .allowUnknownOption(true)
  .action(async (args: string[] = []) => {
    const { runAutoResearchCli } = await import('./commands/autoresearch.js');
    const result = await runAutoResearchCli(process.cwd(), withAutoResearchParentOptions(args, program.opts()));
    if (result) {
      console.log(result);
    }
    process.exit(0);
  });

function withAutoResearchParentOptions(args: string[], parentOptions: { maxIterations?: number | string; yes?: boolean; y?: boolean }): string[] {
  const forwardedArgs = [...args];

  if (parentOptions.maxIterations !== undefined && !hasFlag(forwardedArgs, '--max-iterations')) {
    forwardedArgs.push('--max-iterations', String(parentOptions.maxIterations));
  }

  if ((parentOptions.yes === true || parentOptions.y === true) && !hasFlag(forwardedArgs, '--yes')) {
    forwardedArgs.push('--yes');
  }

  return forwardedArgs;
}

function hasFlag(args: string[], flagName: string): boolean {
  return args.some((arg) => arg === flagName || arg.startsWith(`${flagName}=`));
}

// ── Import subcommand ─────────────────────────────────────────────────
program
  .command('import [source]')
  .description('Import data from other coding agents (claude, codex, gemini, cursor, cline, continue, augment, opencode, kimi)')
  .option('--all', 'Import all available categories without prompting')
  .option('--categories <list>', 'Comma-separated list of categories to import (sessions,settings,skills,memory,mcp,hooks)', (val: string) => val.split(','))
  .option('--dry-run', 'Preview what would be imported without making changes')
  .option('--retry-failed', 'Retry previously failed import items')
  .action(async (source: string | undefined, opts: { all?: boolean; categories?: string[]; dryRun?: boolean; retryFailed?: boolean }) => {
    const { runImport } = await import('./import/index.js');
    await runImport({
      source: source as any,
      categories: opts.categories as any,
      all: opts.all,
      dryRun: opts.dryRun,
      retryFailed: opts.retryFailed,
    });
    process.exit(0);
  });

async function runCLI(options: CLIOptions): Promise<void> {
  const agentHolder: { current: AutohandAgent | null } = { current: null };
  const commandLifecycleController = new AbortController();
  let agent: AutohandAgent | null = null;
  const runtimeResourceOwner = new CliRuntimeResourceOwner<
    AuthUser,
    VersionCheckResult,
    SyncService
  >({
    process,
    stopPing: () => shutdownPingService(),
    setSyncService: setRuntimeSyncService,
    onSignal: (signal) => {
      const existingExitCode = Number(process.exitCode ?? 0);
      if (!Number.isFinite(existingExitCode) || existingExitCode === 0) {
        process.exitCode = signal === 'SIGINT' ? 130 : 143;
      }
      commandLifecycleController.abort(
        new DOMException(`Received ${signal}`, 'AbortError'),
      );
      agentHolder.current?.requestExit();
    },
  });
  try {
    let config = (options as any)._authConfig ?? await awaitCliLifecycleStep(
      loadConfig(options.config, process.cwd()),
      commandLifecycleController.signal,
    );
    if (options.bare) {
      config = await awaitCliLifecycleStep(
        prepareBareModeConfig(config, options),
        commandLifecycleController.signal,
      );
    }
    if (commandLifecycleController.signal.aborted) {
      return;
    }
    const originalWorkspaceRoot = resolveWorkspaceRoot(config, options.path);
    let workspaceRoot = originalWorkspaceRoot;
    let sessionWorktree: ReturnType<typeof import('./utils/sessionWorktree.js')['prepareSessionWorktree']> | null = null;

    // Initialize i18n with locale detection
    const { locale: detectedLocale } = detectLocale({
      cliOverride: options.displayLanguage,
      configLocale: config.ui?.locale,
    });
    await awaitCliLifecycleStep(
      initI18n(detectedLocale),
      commandLifecycleController.signal,
    );
    if (commandLifecycleController.signal.aborted) {
      return;
    }

    const {
      buildPermissionSettingsFromYolo,
      normalizeYoloInput,
      parseYoloPattern,
    } = await awaitCliLifecycleStep(
      import('./permissions/yoloMode.js'),
      commandLifecycleController.signal,
    );
    const normalizedYolo = normalizeYoloInput(options.yolo as string | boolean | undefined);
    if (normalizedYolo) {
      try {
        const yoloPattern = parseYoloPattern(normalizedYolo);
        options.yolo = normalizedYolo;
        config.permissions = {
          ...config.permissions,
          ...buildPermissionSettingsFromYolo(yoloPattern),
        };
      } catch (error) {
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
        return;
      }
    }

    // Check if API key is missing and run setup wizard
    const providerName = config.provider ?? 'openrouter';
    const providerConfig = getProviderConfig(config, providerName);

    if (!providerConfig) {
      // No valid provider config - run the setup wizard
      const { SetupWizard } = await awaitCliLifecycleStep(
        import('./onboarding/index.js'),
        commandLifecycleController.signal,
      );
      const wizard = new SetupWizard(originalWorkspaceRoot, config);
      const result = await awaitCliLifecycleStep(
        wizard.run({ skipWelcome: !config.isNewConfig }),
        commandLifecycleController.signal,
      );

      if (result.cancelled) {
        console.log(chalk.gray('\nSetup cancelled.'));
        process.exitCode = 0;
        return;
      }

      if (result.success) {
        // Merge wizard config into existing config
        config = { ...config, ...result.config };
        await awaitCliLifecycleStep(
          saveConfig(config),
          commandLifecycleController.signal,
        );
        console.log(); // Add spacing after wizard
      }
    }
    if (commandLifecycleController.signal.aborted) {
      return;
    }

    // Check for dangerous workspace directories (home, root, system dirs)
    const workspacePathValidation = await awaitCliLifecycleStep(
      validateWorkspacePath(originalWorkspaceRoot),
      commandLifecycleController.signal,
    );
    if (commandLifecycleController.signal.aborted) {
      return;
    }
    if (!workspacePathValidation.valid) {
      console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
      process.exitCode = 1;
      return;
    }

    const safetyCheck = checkWorkspaceSafety(originalWorkspaceRoot);
    if (!safetyCheck.safe) {
      printDangerousWorkspaceWarning(originalWorkspaceRoot, safetyCheck);
      process.exitCode = 1;
      return;
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
        process.exitCode = 1;
        return;
      }
    }

    // Validate and resolve additional directories from --add-dir flag
    const additionalDirs: string[] = [];
    if (options.addDir && options.addDir.length > 0) {
      for (const dir of options.addDir) {
        const resolvedDir = path.resolve(dir);

        // Check if directory exists
        const additionalPathExists = await awaitCliLifecycleStep(
          fs.pathExists(resolvedDir),
          commandLifecycleController.signal,
        );
        if (commandLifecycleController.signal.aborted) {
          return;
        }
        if (!additionalPathExists) {
          console.error(chalk.red(`Error: Additional directory does not exist: ${dir}`));
          process.exitCode = 1;
          return;
        }

        // Check if it's a directory
        const stats = await awaitCliLifecycleStep(
          fs.stat(resolvedDir),
          commandLifecycleController.signal,
        );
        if (commandLifecycleController.signal.aborted) {
          return;
        }
        if (!stats.isDirectory()) {
          console.error(chalk.red(`Error: Additional path is not a directory: ${dir}`));
          process.exitCode = 1;
          return;
        }

        // Safety check for the additional directory
        const addDirSafetyCheck = checkWorkspaceSafety(resolvedDir);
        if (!addDirSafetyCheck.safe) {
          console.error(chalk.red(`Error: Unsafe additional directory: ${dir}`));
          console.error(chalk.yellow(`  ${addDirSafetyCheck.reason}`));
          process.exitCode = 1;
          return;
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
    // Store whether Ink will be enabled so we can synchronize startup.
    // Ink is code-defaulted, not controlled by stale config.ui.useInkRenderer.
    const { shouldUseInkRenderer } = await awaitCliLifecycleStep(
      import('./ui/inkMode.js'),
      commandLifecycleController.signal,
    );
    const inkEnabled = shouldUseInkRenderer();
    if (commandLifecycleController.signal.aborted) {
      return;
    }

    // Initialize and start ping service (45-minute intervals for usage tracking)
    // This runs independently of telemetry opt-in for basic usage counting
    if (!options.bare) {
      runtimeResourceOwner.startPing(() => {
        initPingService({
          cliVersion: runtimeVersion,
          clientType: 'cli',
        });
        startPingService();
      });
    }

    // Print welcome immediately with no version/auth info - don't block on network
    printWelcome(runtime, undefined, null);

    // Ensure all stdout is flushed before Ink takes over the alternate screen buffer
    // This prevents banner/welcome output from appearing mid-render in Ink's UI
    if (inkEnabled && process.stdout.isTTY) {
      process.stdout.write('\x1b[s'); // Save cursor position
      process.stdout.write('\x1b[u'); // Restore cursor position (forces flush)
    }

    // Run startup checks synchronously before prompt to prevent output racing.
    // git init, tool checks etc. must finish printing BEFORE the prompt renders.
    if (!options.bare) {
      try {
        const checkResults = await awaitCliLifecycleStep(
          runStartupChecks(workspaceRoot),
          commandLifecycleController.signal,
        );
        printStartupCheckResults(checkResults);
        if (!checkResults.allRequiredMet) {
          console.log(chalk.yellow('Continuing anyway, but some features may not work correctly.\n'));
        }
      } catch {
        // Non-critical - continue without startup check output
      }
    }
    if (commandLifecycleController.signal.aborted) {
      return;
    }

    // Run auth, version check, sync in background (fire-and-forget).
    // These are network-bound and should not block the prompt.
    if (!options.bare && runtimeResourceOwner) {
      runtimeResourceOwner.startBackgroundStartup({
        resolveAuthAndVersion: async () => {
          const versionCheckPromise = config.ui?.checkForUpdates !== false
            ? checkForUpdates(runtimeVersion, {
                checkIntervalHours: config.ui?.updateCheckInterval ?? 24,
              })
            : Promise.resolve(null);

          const [authUser, versionResult] = await Promise.all([
            validateAuthOnStartup(config),
            versionCheckPromise,
          ]);
          return { authUser: authUser ?? null, versionResult };
        },
        onVersionResult: (versionResult) => {
          agentHolder.current?.setVersionCheckResult(versionResult);
        },
        shouldStartSync: () => Boolean(
          config.auth?.token
          && options.syncSettings !== false
          && config.sync?.enabled !== false
        ),
        createSyncService: async (authUser) => {
          const { createSyncService, DEFAULT_SYNC_CONFIG } = await import('./sync/index.js');
          return createSyncService({
            authToken: config.auth?.token ?? '',
            userId: authUser.id,
            config: {
              ...DEFAULT_SYNC_CONFIG,
              ...config.sync,
              enabled: true,
            },
            onAuthFailure: async () => {
              const message = 'Session sync failed. Run /logout and /login if you continue to see this message.';
              if (agentHolder.current) {
                agentHolder.current.notifyUser(message);
              } else {
                const { promptNotify } = await import('./ui/inputPrompt.js');
                promptNotify(chalk.yellow(message));
              }
            },
          });
        },
      });
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

    // Override debug mode from CLI if provided
    if (options.debug) {
      config.agent = config.agent ?? {};
      config.agent.debug = true;
    }

    if (commandLifecycleController.signal.aborted) {
      return;
    }
    const { ProviderFactory } = await awaitCliLifecycleStep(
      import('./providers/ProviderFactory.js'),
      commandLifecycleController.signal,
    );
    const { FileActionManager } = await awaitCliLifecycleStep(
      import('./actions/filesystem.js'),
      commandLifecycleController.signal,
    );
    if (commandLifecycleController.signal.aborted) {
      return;
    }
    const llmProvider = ProviderFactory.create(config);
    const files = new FileActionManager(workspaceRoot, runtime.additionalDirs);

    // Handle --auto-skill flag
    if (options.autoSkill) {
      console.log(chalk.cyan('\nAuto-generating skills for this project...\n'));
      const { runAutoSkillGeneration } = await awaitCliLifecycleStep(
        import('./skills/autoSkill.js'),
        commandLifecycleController.signal,
      );
      const result = await awaitCliLifecycleStep(
        runAutoSkillGeneration(workspaceRoot, llmProvider),
        commandLifecycleController.signal,
      );
      if (!result.success) {
        console.log(chalk.yellow(result.error || 'Failed to generate skills'));
      }
      return;
    }

    // Configure web search provider from CLI flag, config file, or environment
    const searchConfig = config.search ?? {};
    const { configureSearchFromSettings } = await awaitCliLifecycleStep(
      import('./actions/web.js'),
      commandLifecycleController.signal,
    );
    configureSearchFromSettings(searchConfig, options.searchEngine);

    // Pipe mode: read stdin once if piped, then compose with prompt text (if any).
    // This must happen before AutohandAgent construction because dependency
    // composition chooses Ink vs plain UI from the current stdin and prompt mode.
    //
    // Supports: echo "data" | autohand -p "explain"  (stdin + prompt -> command mode)
    //           echo "data" | autohand -p             (stdin only -> command mode)
    //           echo "data" | autohand                (stdin -> first instruction, then interactive)
    const stdinType = detectStdinType();
    let pipeInitialInstruction: string | undefined;
    if (stdinType === 'pipe') {
      const pipedInput = await awaitCliLifecycleStep(
        readPipedStdin(),
        commandLifecycleController.signal,
      );
      const hasExplicitPromptFlag = process.argv.some(a => a === '-p' || a === '--prompt');
      if (options.prompt) {
        // Both -p "text" and stdin: combine them -> command mode
        options.prompt = buildPipePrompt(options.prompt, pipedInput);
      } else if (pipedInput && hasExplicitPromptFlag) {
        // -p without text, pipe provides content -> command mode
        options.prompt = pipedInput;
      } else if (pipedInput) {
        const shouldHandoffInteractive = shouldUseInteractivePipeHandoff({
          pipedInput,
          hasExplicitPromptFlag,
          hasPromptText: Boolean(options.prompt),
          stdoutIsTTY: Boolean(process.stdout.isTTY),
        });

        if (shouldHandoffInteractive) {
          // No -p flag, just piped input -> interactive with initial instruction.
          // Reopen /dev/tty so Ink/readline can accept interactive input after pipe.
          try {
            const { openSync } = await import('node:fs');
            const tty = await import('node:tty');
            const fd = openSync('/dev/tty', 'r');
            const ttyIn = new tty.ReadStream(fd);
            Object.defineProperty(process, 'stdin', {
              value: ttyIn,
              writable: true,
              configurable: true,
            });
            pipeInitialInstruction = pipedInput;
          } catch {
            // Can't reopen TTY (e.g., no terminal, Windows) -> fall back to command mode
            options.prompt = pipedInput;
          }
        } else {
          // Non-interactive output (pipe/file) must stay in command mode.
          options.prompt = pipedInput;
        }
      }
    }

    const { AutohandAgent } = await awaitCliLifecycleStep(
      import('./core/agent.js'),
      commandLifecycleController.signal,
    );
    if (commandLifecycleController.signal.aborted) {
      return;
    }
    agent = new AutohandAgent(llmProvider, files, runtime);
    agentHolder.current = agent;
    if (commandLifecycleController.signal.aborted) {
      agent.requestExit();
      return;
    }

    // Handle --browser: trigger a browser handoff before entering interactive mode.
    if (options.browser === true) {
      // Ensure native host is installed and paired to the configured extension id.
      const { ensureNativeHostInstalled, createBrowserHandoff, buildChromeOpenUrl, openChromeContinuation } = await import('./browser/chrome.js');
      const extensionId = config.chrome?.extensionId;
      await ensureNativeHostInstalled({ extensionId }).catch(() => {});

      // Create a session eagerly so we have a valid sessionId for the handoff
      const sessionManager = agent.getSessionManager();
      await sessionManager.initialize();
      let currentSession = sessionManager.getCurrentSession();
      if (!currentSession) {
        const providerName = config.provider ?? 'openrouter';
        const modelName = options.model ?? (config as any)[providerName]?.model ?? 'unknown';
        currentSession = await sessionManager.createSession(workspaceRoot, modelName);
      }
      const sessionId = currentSession.metadata.sessionId;

      // Create browser handoff
      await createBrowserHandoff({
        sessionId,
        workspaceRoot,
        extensionId,
        installUrl: config.chrome?.installUrl,
      });

      // Open Chrome with the handoff URL
      await openChromeContinuation(
        buildChromeOpenUrl({ extensionId, installUrl: config.chrome?.installUrl }),
        config.chrome?.browser ?? 'auto',
        { userDataDir: config.chrome?.userDataDir, profileDirectory: config.chrome?.profileDirectory },
      );

      console.log(chalk.green('\n✓ Opened browser. Open the Autohand side panel (Cmd+E) to continue.'));
      console.log(chalk.gray(`  Session: ${sessionId}\n`));
    }

    const agentLaunchMode = resolveAgentLaunchMode(options);
    if (agentLaunchMode === 'fork' && options.fork) {
        const forkEnabled = getFeatureState(config, 'experimental_fork')?.enabled === true;
        if (!forkEnabled) {
          console.error(chalk.red('The --fork flag is behind experimental_fork. Run /features enable experimental_fork, then try again.'));
          process.exitCode = 1;
          return;
        }
        const sessionManager = agent.getSessionManager();
        await sessionManager.initialize();
        const forked = await sessionManager.branchSession(options.fork, { type: 'fork' });
        console.log(chalk.green(`\nForked session ${forked.metadata.sessionId}.`));
        await agent.resumeSession(forked.metadata.sessionId);
        if (!commandLifecycleController.signal.aborted) {
          process.exitCode = 0;
        }
    } else if (agentLaunchMode === 'command' && options.prompt) {
      const succeeded = await agent.runCommandMode(
        options.prompt,
        commandLifecycleController.signal,
      );
      if (!commandLifecycleController.signal.aborted) {
        process.exitCode = succeeded ? 0 : 1;
      }
    } else if (agentLaunchMode === 'resume' && options.resumeSessionId) {
      await agent.resumeSession(options.resumeSessionId);
      if (!commandLifecycleController.signal.aborted) {
        process.exitCode = 0;
      }
    } else {
      await agent.runInteractive(pipeInitialInstruction);
      if (!commandLifecycleController.signal.aborted) {
        process.exitCode = 0;
      }
    }
  } catch (error) {
    if (!commandLifecycleController.signal.aborted) {
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      } else {
        console.error(error);
      }
      process.exitCode = 1;
    }
  } finally {
    await Promise.allSettled([
      agent?.shutdownRuntimeResources(),
      runtimeResourceOwner?.shutdown(),
    ]);
    agentHolder.current = null;
  }
}

function printBanner(): void {
  if (process.env.AUTOHAND_NO_BANNER === '1') {
    return;
  }
  if (process.stdout.isTTY) {
    // Clear screen and scrollback buffer for Cursor-like behavior
    // \x1b[3J = clear entire screen including scrollback (not universally supported, but works on most modern terminals)
    // \x1b[2J = clear entire screen (visible only)
    // \x1b[H = move cursor to home position (top-left)
    process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
    console.log(formatStartupBanner(renderAutohandLogo({ columns: getTerminalColumns(process.stdout) })));
  } else {
    console.log('autohand');
  }
}

interface WelcomeSuggestion {
  command: string;
  description: string;
}

/**
 * Build contextual welcome suggestions based on auth state and workspace features.
 * Shows different commands depending on whether the user is logged in and what
 * features are available, rather than always showing the same fixed list.
 */
function buildWelcomeSuggestions(isLoggedIn: boolean, workspaceRoot: string): WelcomeSuggestion[] {
  const suggestions: WelcomeSuggestion[] = [];

  // Always suggest /help — it's the universal discovery command
  suggestions.push({ command: '/help', description: 'see all available commands and tips' });

  if (!isLoggedIn) {
    // Not logged in — prioritize getting them signed in
    suggestions.push({ command: '/login', description: 'sign in to your Autohand account' });
  }

  // Check if AGENTS.md exists — suggest /init only when it doesn't
  const agentsPath = path.join(workspaceRoot, 'AGENTS.md');
  const hasAgentsMd = fs.pathExistsSync(agentsPath);
  if (!hasAgentsMd) {
    suggestions.push({ command: '/init', description: 'create an AGENTS.md file with instructions for Autohand' });
  }

  // Logged-in features
  if (isLoggedIn) {
    suggestions.push({ command: '/review', description: 'review your current changes and find issues' });
    suggestions.push({ command: '/plan', description: 'plan and break down a complex task' });
    suggestions.push({ command: '/skills', description: 'discover and install skills for your project' });
  }

  return suggestions;
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
  let versionLine = formatWelcomeVersionPrefix(getVersionString());
  if (versionCheck) {
    if (versionCheck.isUpToDate) {
      versionLine += formatUpdateReady();
    } else if (versionCheck.updateAvailable && versionCheck.latestVersion) {
      versionLine += formatUpdateAvailable(versionCheck.latestVersion);
    }
  }
  console.log(versionLine);

  // Show upgrade hint if update available
  if (versionCheck?.updateAvailable) {
    console.log(formatInstallHint(getInstallHint(versionCheck.channel)));
  }

  // Personalized greeting if logged in
  const isLoggedIn = !!(authUser || runtime.config.auth?.token);
  if (authUser) {
    console.log(formatWelcomeGreeting(authUser.name || authUser.email));
  }

  // Show CC status (default: ON unless --no-cc was passed)
  const ccEnabled = runtime.options.contextCompact !== false;

  console.log(formatWelcomeStatusLine(model, ccEnabled, dir));
  console.log();

  // Build contextual suggestions based on auth state and available features
  const suggestions = buildWelcomeSuggestions(isLoggedIn, dir);
  console.log(formatWelcomeTitle());
  for (const s of suggestions) {
    console.log(formatWelcomeSuggestion(s.command, s.description));
  }

  console.log();
}

/**
 * Handle --skill-install flag for installing community skills
 */
async function runSkillInstall(opts: CLIOptions & { skillInstall?: string | boolean; project?: boolean }): Promise<boolean> {
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
  const installScope = resolveSkillInstallScope(opts, skillName);
  let installedSkillName: string | null = null;

  // Run the install command
  const installResult = await skillsInstall({
    skillsRegistry,
    workspaceRoot,
    installScope,
    showActivationHint: false,
    onSkillInstalled: (name) => {
      installedSkillName = name;
    },
  }, skillName);

  if (!installResult || !installedSkillName) {
    return false;
  }

  const useSkill = opts.yes && skillName
    ? true
    : await promptUseInstalledSkill(installedSkillName);
  if (!useSkill) {
    return false;
  }

  if (!skillsRegistry.activateSkill(installedSkillName)) {
    console.log(chalk.yellow(`Installed ${installedSkillName}, but it could not be activated automatically.`));
    return false;
  }

  opts.activateSkillOnStartup = installedSkillName;
  return true;
}

function resolveSkillInstallScope(
  opts: CLIOptions & { project?: boolean },
  skillName?: string
): SkillInstallScope | undefined {
  if (opts.project) {
    return 'project';
  }

  if (opts.yes && skillName) {
    return 'user';
  }

  return undefined;
}

async function promptUseInstalledSkill(skillName: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  process.stdout.write(`Would you like to use the skill "${skillName}" now? (yes/no) `);

  return new Promise<boolean>((resolve) => {
    let answer = '';
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    const keepAlive = setInterval(() => {}, 1000);

    const cleanup = (): void => {
      clearInterval(keepAlive);
      stdin.off('data', onData);
      if (typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(wasRaw);
      }
    };

    const finish = (accepted: boolean): void => {
      cleanup();
      resolve(accepted);
    };

    const onData = (chunk: Buffer | string): void => {
      answer += chunk.toString('utf8');
      if (answer.includes('\u0003')) {
        process.stdout.write('\n');
        finish(false);
        return;
      }
      if (!answer.includes('\n') && !answer.includes('\r')) {
        return;
      }

      finish(/^(?:y|yes)$/i.test(answer.trim()));
    };

    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
    stdin.resume();
    stdin.on('data', onData);
  });
}

/**
 * Handle --learn and --learn-update flags for non-interactive /learn
 */
async function runLearnNonInteractive(opts: CLIOptions, subcommand: 'recommend' | 'update'): Promise<void> {
  const config = await loadConfig(opts.config);
  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(workspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
    process.exit(1);
  }

  // Import learn command and dependencies
  const { learn } = await import('./commands/learn.js');
  const { SkillsRegistry } = await import('./skills/SkillsRegistry.js');
  const { AUTOHAND_PATHS } = await import('./constants.js');
  const { HookManager } = await import('./core/HookManager.js');

  // Initialize skills registry
  const skillsRegistry = new SkillsRegistry(AUTOHAND_PATHS.skills);
  await skillsRegistry.initialize();
  await skillsRegistry.setWorkspace(workspaceRoot);

  // Initialize LLM provider
  const { ProviderFactory } = await import('./providers/ProviderFactory.js');
  const llmProvider = ProviderFactory.create(config);

  // Initialize hook manager
  const hookManager = new HookManager({ workspaceRoot });

  const args = subcommand === 'update' ? ['update'] : [];
  const result = await learn({
    skillsRegistry,
    workspaceRoot,
    hookManager,
    isNonInteractive: true,
    llm: llmProvider,
  }, args);

  if (result) {
    console.log(result);
  }
}

async function runGoalFlag(opts: CLIOptions): Promise<void> {
  const config = (opts as any)._authConfig ?? await loadConfig(opts.config, process.cwd());
  const { GOAL_FEATURE_DISABLED_MESSAGE, isGoalFeatureEnabled } = await import('./goals/feature.js');
  if (!isGoalFeatureEnabled(config)) {
    console.error(chalk.yellow(GOAL_FEATURE_DISABLED_MESSAGE));
    process.exit(1);
  }

  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);
  const workspacePathValidation = await validateWorkspacePath(workspaceRoot);
  if (!workspacePathValidation.valid) {
    console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
    process.exit(1);
  }
  const safetyCheck = checkWorkspaceSafety(workspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
    process.exit(1);
  }

  const { runGoalCli } = await import('./commands/goal.js');
  const result = await runGoalCli(workspaceRoot, opts.goal ?? '', config);
  console.log(result);
}

/**
 * Handle --permissions flag to display current permission settings
 */
function renderPermissionScope(title: string, pathLabel: string, allowList: string[], denyList: string[]): void {
  console.log(chalk.bold(title));
  console.log(chalk.gray(pathLabel));

  if (allowList.length === 0) {
    console.log(chalk.gray('  No AllowList entries'));
  } else {
    console.log(chalk.green('  AllowList'));
    allowList.forEach((pattern, index) => {
      console.log(chalk.green(`    ${index + 1}. ${pattern}`));
    });
  }

  if (denyList.length === 0) {
    console.log(chalk.gray('  No DenyList entries'));
  } else {
    console.log(chalk.red('  DenyList'));
    denyList.forEach((pattern, index) => {
      console.log(chalk.red(`    ${index + 1}. ${pattern}`));
    });
  }

  console.log();
}

export async function displayPermissions(opts: CLIOptions): Promise<void> {
  const config = await loadConfig(opts.config);
  const workspaceRoot = resolveWorkspaceRoot(config, opts.path);

  // Check for dangerous workspace directories
  const safetyCheck = checkWorkspaceSafety(workspaceRoot);
  if (!safetyCheck.safe) {
    printDangerousWorkspaceWarning(workspaceRoot, safetyCheck);
    process.exit(1);
  }

  const { PermissionManager } = await import('./permissions/PermissionManager.js');
  const manager = new PermissionManager({
    settings: config.permissions,
    workspaceRoot,
  });
  await manager.initLocalSettings();
  const snapshot = manager.getPermissionSnapshot(config.configPath);

  console.log();
  console.log(chalk.bold.cyan('Autohand Permissions'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log();

  // Mode
  console.log(chalk.bold('Mode:'), chalk.cyan(snapshot.mode || 'interactive'));
  console.log();

  // Workspace
  console.log(chalk.bold('Workspace:'), chalk.gray(workspaceRoot));
  console.log(chalk.bold('Config:'), chalk.gray(config.configPath));
  console.log();

  renderPermissionScope('Session', snapshot.session.path, snapshot.session.allowList, snapshot.session.denyList);
  renderPermissionScope('Project', snapshot.project.path, snapshot.project.allowList, snapshot.project.denyList);
  renderPermissionScope('User', snapshot.user.path, snapshot.user.allowList, snapshot.user.denyList);
  renderPermissionScope('Effective', snapshot.effective.path, snapshot.effective.allowList, snapshot.effective.denyList);

  // Summary
  console.log(chalk.gray('─'.repeat(60)));
  console.log(
    chalk.bold('Summary:'),
    `${snapshot.effective.allowList.length} allowed, ${snapshot.effective.denyList.length} denied`
  );
  console.log();

  // Help text
  console.log(chalk.gray('Use /permissions in interactive mode to inspect permissions.'));
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
  const workspacePathValidation = await validateWorkspacePath(originalWorkspaceRoot);
  if (!workspacePathValidation.valid) {
    console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
    process.exit(1);
  }

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
    applyCliModelOverride(config, opts.model);
  }

  const { ProviderFactory } = await import('./providers/ProviderFactory.js');
  const { FileActionManager } = await import('./actions/filesystem.js');
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
  const { configureSearchFromSettings } = await import('./actions/web.js');
  configureSearchFromSettings(searchConfig);

  let agent: AutohandAgent | null = null;
  let exitCode = 0;
  try {
    const { AutohandAgent } = await import('./core/agent.js');
    agent = new AutohandAgent(llmProvider, files, runtime);

    // Run the instruction (changes will be batched in preview mode)
    const succeeded = await agent.runCommandMode(opts.prompt);
    if (!succeeded) {
      exitCode = 1;
    } else {
      // Get all pending changes
      const changes = files.getPendingChanges();

      if (changes.length === 0) {
        console.error(chalk.yellow('\nNo changes were made.'));
      } else {
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
      }
    }
  } catch (error) {
    console.error(chalk.red(`\nError: ${(error as Error).message}`));
    exitCode = 1;
  } finally {
    files.exitPreviewMode();
    await agent?.shutdownRuntimeResources();
  }
  process.exitCode = exitCode;
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
  const workspacePathValidation = await validateWorkspacePath(originalWorkspaceRoot);
  if (!workspacePathValidation.valid) {
    console.error(chalk.red(`Error: ${workspacePathValidation.error}`));
    process.exit(1);
  }

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
    applyCliModelOverride(config, opts.model);
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
  const { ProviderFactory } = await import('./providers/ProviderFactory.js');
  const llmProvider = ProviderFactory.create(config);

  // Create file manager with effective workspace (worktree if available)
  const { FileActionManager } = await import('./actions/filesystem.js');
  const files = new FileActionManager(effectiveWorkspace, additionalDirs);
  const { safeSetRawMode } = await import('./ui/rawMode.js');
  let agent: AutohandAgent | null = null;
  let automodeKeypressHandler: ((_str: string, key: { name?: string; ctrl?: boolean }) => void) | null = null;
  let signalExitStarted = false;

  // Set up ESC key handling for cancellation
  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    safeSetRawMode(process.stdin, true);

    automodeKeypressHandler = (_str, key) => {
      if (key && key.name === 'escape') {
        console.log(chalk.yellow('\n⚠️  Cancelling auto-mode...'));
        void automodeManager.cancel('user_escape').catch(() => {});
      }
      // Ctrl+C also cancels
      if (key && key.ctrl && key.name === 'c' && !signalExitStarted) {
        signalExitStarted = true;
        console.log(chalk.yellow('\n⚠️  Cancelling auto-mode...'));
        void (async () => {
          await automodeManager.cancel('user_escape').catch(() => {});
          if (process.stdin.isTTY) safeSetRawMode(process.stdin, false);
          process.exitCode = 0;
        })();
      }
    };
    process.stdin.on('keypress', automodeKeypressHandler);
  }

  let exitCode = 1;
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
    const { configureSearchFromSettings } = await import('./actions/web.js');
    configureSearchFromSettings(searchConfig);

    const { AutohandAgent } = await import('./core/agent.js');
    agent = new AutohandAgent(llmProvider, files, runtime);
    const activeAgent = agent;

    // Define the iteration callback
    const runIteration = async (
      iteration: number,
      prompt: string,
      abortSignal: AbortSignal
    ) => {
      // Build iteration prompt
      const iterationPrompt = buildIterationPrompt(prompt, iteration);

      // Reset per-iteration counters before running
      activeAgent.getAndResetFileModCount();
      activeAgent.getAndResetExecutedActions();

      let error: string | undefined;

      const success = await activeAgent.runCommandMode(
        iterationPrompt,
        { signal: abortSignal, keepAlive: true },
      ).catch((err: unknown) => {
        error = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Iteration error: ${error}`));
        return false;
      });

      if (!success && !error) {
        error = abortSignal.aborted
          ? 'Iteration aborted'
          : 'Agent command did not complete successfully';
      }

      // Collect actual file change data and action names from this iteration
      const fileChanges = activeAgent.getAndResetFileModCount();
      const actions = activeAgent.getAndResetExecutedActions();
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

    const statusText = finalState?.status === 'completed' ? 'completed' : `ended (${finalState?.status})`;
    exitCode = signalExitStarted ? 0 : finalState?.status === 'completed' ? 0 : 1;
    const shouldHandoffToInteractive = opts.interactiveOnComplete === true && process.stdin.isTTY;

    if (opts.interactiveOnComplete && !process.stdin.isTTY) {
      console.log(chalk.yellow('\n⚠ --interactive-on-complete requested, but no TTY is available. Exiting after auto-mode.\n'));
    }

    if (!shouldHandoffToInteractive) {
      await Promise.all([
        activeAgent.shutdown({
          sessionEndReason: finalState?.status === 'completed' ? 'exit' : 'error',
          telemetryReason: finalState?.status === 'completed' ? 'completed' : 'crashed',
          showSessionSummary: false,
        }),
        sessionManager.closeSession(
          `Auto-mode ${statusText} after ${finalState?.currentIteration ?? 0} iterations: ${opts.autoMode?.slice(0, 50)}...`,
        ),
      ]);
      console.log(chalk.gray(`\n📁 Session saved: ${session.metadata.sessionId}`));
    } else {
      console.log(chalk.cyan('\n▶️ Auto-mode finished. Handing off to interactive mode (--interactive-on-complete).\n'));
      await activeAgent.runInteractive();
      exitCode = 0;
    }

  } catch (error) {
    // Restore terminal
    if (process.stdin.isTTY) {
      safeSetRawMode(process.stdin, false);
    }

    await Promise.allSettled([
      agent?.shutdown({
        sessionEndReason: 'error',
        telemetryReason: 'crashed',
        showSessionSummary: false,
      }),
      sessionManager.closeSession(`Auto-mode failed: ${(error as Error).message}`),
    ]);

    console.error(chalk.red(`\nAuto-mode error: ${(error as Error).message}`));
    exitCode = 1;
  } finally {
    if (automodeKeypressHandler) {
      process.stdin.off('keypress', automodeKeypressHandler);
    }
    if (process.stdin.isTTY) {
      safeSetRawMode(process.stdin, false);
    }
    await agent?.shutdownRuntimeResources();
  }
  process.exitCode = exitCode;
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

function isCliEntrypoint(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isCliEntrypoint()) {
  void prepareRuntimeExtensionsForCli(program, process.argv)
    .then(() => program.parseAsync())
    .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
    process.exit(1);
  });
}

function argvOptionValue(argv: string[], option: string): string | undefined {
  const index = argv.indexOf(option);
  if (index >= 0) {
    return argv[index + 1];
  }
  const prefix = `${option}=`;
  return argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function prepareRuntimeExtensionsForCli(command: Command, argv: string[]): Promise<void> {
  if (argv.includes('--bare')) {
    return;
  }
  const workspaceRoot = path.resolve(argvOptionValue(argv, '--path') ?? process.cwd());
  const [{ ExtensionRegistry }, runtimeModule, slashModule, { ProviderFactory }] = await Promise.all([
    import('./extensions/ExtensionRegistry.js'),
    import('./extensions/ExtensionRuntimeHost.js'),
    import('./core/slashCommands.js'),
    import('./providers/ProviderFactory.js'),
  ]);
  runtimeModule.extensionRuntimeHost.setReservedCapabilities({
    reservedCommands: [
      ...slashModule.SLASH_COMMANDS.map((item) => item.command),
      '/chrome',
    ],
    reservedProviders: ProviderFactory.getProviderNames(),
    reservedCliFlags: command.options
      .flatMap((option) => [option.short, option.long])
      .filter((flag): flag is string => typeof flag === 'string'),
  });
  const snapshot = await new ExtensionRegistry({
    userRoot: AUTOHAND_PATHS.extensions,
    projectRoot: path.join(workspaceRoot, PROJECT_DIR_NAME, 'extensions'),
  }).load();
  await runtimeModule.extensionRuntimeHost.sync(snapshot);
  runtimeModule.registerExtensionCliFlags(command, runtimeModule.extensionRuntimeHost);
}

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

export type {
  ExtensionCommandContext,
  ExtensionCommandResult,
  ExtensionRuntimeAPI,
  ExtensionViewProps,
  ExtensionViewRequest,
} from './extensions/ExtensionRuntimeHost.js';
