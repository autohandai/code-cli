/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Startup checks - validates required tools and environment
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import chalk from 'chalk';
import fs from 'fs-extra';

export interface ToolCheck {
  name: string;
  command: string;
  versionFlag: string;
  required: boolean;
  description: string;
  installHints: {
    darwin: string;
    linux: string;
    win32: string;
  };
  minVersion?: string;
}

export interface CheckResult {
  name: string;
  installed: boolean;
  version?: string;
  required: boolean;
  description: string;
  installHint?: string;
}

/**
 * Tools that Autohand depends on
 */
const REQUIRED_TOOLS: ToolCheck[] = [
  {
    name: 'git',
    command: 'git',
    versionFlag: '--version',
    required: true,
    description: 'Version control (required for file tracking, undo, and git operations)',
    installHints: {
      darwin: 'brew install git',
      linux: 'sudo apt install git  # or: sudo dnf install git',
      win32: 'winget install Git.Git  # or download from https://git-scm.com'
    }
  },
  {
    name: 'ripgrep',
    command: 'rg',
    versionFlag: '--version',
    required: false,
    description: 'Fast code search (recommended for better search performance)',
    installHints: {
      darwin: 'brew install ripgrep',
      linux: 'sudo apt install ripgrep  # or: cargo install ripgrep',
      win32: 'winget install BurntSushi.ripgrep  # or: scoop install ripgrep'
    }
  }
];

/**
 * Optional tools for enhanced functionality
 */
const OPTIONAL_TOOLS: ToolCheck[] = [
  {
    name: 'node',
    command: 'node',
    versionFlag: '--version',
    required: false,
    description: 'Node.js runtime (for npm/yarn package management)',
    installHints: {
      darwin: 'brew install node  # or: nvm install node',
      linux: 'sudo apt install nodejs  # or: nvm install node',
      win32: 'winget install OpenJS.NodeJS  # or download from https://nodejs.org'
    },
    minVersion: '18.0.0'
  },
  {
    name: 'bun',
    command: 'bun',
    versionFlag: '--version',
    required: false,
    description: 'Bun runtime (fast JavaScript/TypeScript runtime)',
    installHints: {
      darwin: 'curl -fsSL https://bun.sh/install | bash',
      linux: 'curl -fsSL https://bun.sh/install | bash',
      win32: 'powershell -c "irm bun.sh/install.ps1 | iex"'
    }
  }
];

/**
 * Check if a tool is installed and get its version (async to avoid blocking event loop)
 */
function checkTool(tool: ToolCheck): Promise<CheckResult> {
  const platform = os.platform() as 'darwin' | 'linux' | 'win32';
  const installHint = tool.installHints[platform] || tool.installHints.linux;

  return new Promise<CheckResult>((resolve) => {
    try {
      const proc = spawn(tool.command, [tool.versionFlag], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({
          name: tool.name,
          installed: false,
          required: tool.required,
          description: tool.description,
          installHint,
        });
      }, 5000);

      proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const output = (stdout || stderr).trim();
          const versionMatch = output.match(/(\d+\.\d+(\.\d+)?)/);
          const version = versionMatch ? versionMatch[1] : 'unknown';
          resolve({
            name: tool.name,
            installed: true,
            version,
            required: tool.required,
            description: tool.description,
          });
        } else {
          resolve({
            name: tool.name,
            installed: false,
            required: tool.required,
            description: tool.description,
            installHint,
          });
        }
      });

      proc.on('error', () => {
        clearTimeout(timeout);
        resolve({
          name: tool.name,
          installed: false,
          required: tool.required,
          description: tool.description,
          installHint,
        });
      });
    } catch {
      resolve({
        name: tool.name,
        installed: false,
        required: tool.required,
        description: tool.description,
        installHint,
      });
    }
  });
}

/**
 * Check workspace is writable
 */
async function checkWorkspaceWritable(workspaceRoot: string): Promise<{ writable: boolean; error?: string }> {
  try {
    const testFile = `${workspaceRoot}/.autohand-write-test-${Date.now()}`;
    await fs.writeFile(testFile, 'test');
    await fs.remove(testFile);
    return { writable: true };
  } catch (error) {
    return {
      writable: false,
      error: `Cannot write to workspace: ${(error as Error).message}`
    };
  }
}

/**
 * Check if a directory is empty (no significant files)
 * Hidden files like .DS_Store are ignored, but .git counts as significant
 */
function isEmptyDirectory(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    const significantEntries = entries.filter(e => !e.startsWith('.') || e === '.git');
    return significantEntries.length === 0;
  } catch {
    return false;
  }
}

/**
 * Run a git command and return trimmed stdout, or undefined on failure
 */
function runGitCommand(args: string[], cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const proc = spawn('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      const timeout = setTimeout(() => { proc.kill(); resolve(undefined); }, 5000);

      proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0 && stdout.trim() ? stdout.trim() : undefined);
      });
      proc.on('error', () => { clearTimeout(timeout); resolve(undefined); });
    } catch {
      resolve(undefined);
    }
  });
}

/**
 * Get the current git branch name
 * Handles repos with no commits (uses symbolic-ref as fallback)
 */
async function getGitBranch(workspaceRoot: string): Promise<string | undefined> {
  // Try rev-parse first (works when there are commits)
  const branch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], workspaceRoot);
  if (branch) return branch;

  // Fall back to symbolic-ref (works for repos with no commits)
  return runGitCommand(['symbolic-ref', '--short', 'HEAD'], workspaceRoot);
}

/**
 * Check if inside a git repository
 * If directory is empty and not a git repo, auto-initialize git
 */
async function checkGitRepo(workspaceRoot: string): Promise<{ isGitRepo: boolean; branch?: string; initialized?: boolean }> {
  // First check if .git directory exists (works even with no commits)
  const gitDirExists = fs.existsSync(`${workspaceRoot}/.git`);

  if (gitDirExists) {
    // It's a git repo - get the branch name
    const branch = await getGitBranch(workspaceRoot);
    return {
      isGitRepo: true,
      branch
    };
  }

  // Not a git repo - check if empty and auto-init
  if (isEmptyDirectory(workspaceRoot)) {
    const initResult = await runGitCommand(['init'], workspaceRoot);

    if (initResult !== undefined) {
      // On macOS, create .gitignore with .DS_Store
      if (os.platform() === 'darwin') {
        try {
          const gitignorePath = `${workspaceRoot}/.gitignore`;
          if (!fs.existsSync(gitignorePath)) {
            fs.writeFileSync(gitignorePath, '.DS_Store\n');
          }
        } catch {
          // Ignore errors creating .gitignore
        }
      }

      // Get the default branch name
      const branch = await getGitBranch(workspaceRoot) || 'main';

      return {
        isGitRepo: true,
        branch,
        initialized: true
      };
    }
  }

  return { isGitRepo: false };
}

/**
 * Get platform-specific package manager suggestion
 */
function getPackageManagerHint(): string {
  const platform = os.platform();

  switch (platform) {
    case 'darwin':
      return 'Homebrew (brew)';
    case 'linux':
      return 'apt, dnf, or your distro package manager';
    case 'win32':
      return 'winget, scoop, or chocolatey';
    default:
      return 'your system package manager';
  }
}

export interface StartupCheckResults {
  tools: CheckResult[];
  workspace: {
    path: string;
    writable: boolean;
    isGitRepo: boolean;
    branch?: string;
    /** True if git was auto-initialized for an empty directory */
    initialized?: boolean;
    error?: string;
  };
  allRequiredMet: boolean;
  warnings: string[];
}

/**
 * Run all startup checks
 * All tool checks run in parallel (async spawn) to avoid blocking the event loop
 */
export async function runStartupChecks(workspaceRoot: string): Promise<StartupCheckResults> {
  const warnings: string[] = [];

  // Run ALL tool checks + workspace checks in parallel
  const allTools = [...REQUIRED_TOOLS, ...OPTIONAL_TOOLS];
  const [toolResults, workspaceCheck, gitCheck] = await Promise.all([
    Promise.all(allTools.map(tool => checkTool(tool))),
    checkWorkspaceWritable(workspaceRoot),
    checkGitRepo(workspaceRoot),
  ]);

  // Collect warnings
  for (const result of toolResults) {
    if (!result.installed && result.required) {
      warnings.push(`Required tool '${result.name}' is not installed`);
    }
  }

  if (!workspaceCheck.writable) {
    warnings.push(workspaceCheck.error || 'Workspace is not writable');
  }

  const allRequiredMet = toolResults
    .filter(r => r.required)
    .every(r => r.installed);

  return {
    tools: toolResults,
    workspace: {
      path: workspaceRoot,
      writable: workspaceCheck.writable,
      isGitRepo: gitCheck.isGitRepo,
      branch: gitCheck.branch,
      initialized: gitCheck.initialized,
      error: workspaceCheck.error
    },
    allRequiredMet,
    warnings
  };
}

/**
 * Print startup check results to console
 */
export function printStartupCheckResults(results: StartupCheckResults, verbose = false): void {
  const missingRequired = results.tools.filter(t => t.required && !t.installed);
  const missingOptional = results.tools.filter(t => !t.required && !t.installed);

  // Show git initialization message if it happened
  if (results.workspace.initialized) {
    console.log(chalk.green('✓ Initialized git repository'));
    console.log();
  }

  // Only print tool issues if there are problems or verbose mode
  if (missingRequired.length === 0 && !verbose) {
    return;
  }

  console.log();

  // Print missing required tools
  if (missingRequired.length > 0) {
    console.log(chalk.red.bold('⚠ Missing required tools:'));
    console.log();

    for (const tool of missingRequired) {
      console.log(chalk.red(`  ✗ ${tool.name}`));
      console.log(chalk.gray(`    ${tool.description}`));
      console.log(chalk.cyan(`    Install: ${tool.installHint}`));
      console.log();
    }
  }

  // Print missing optional tools (less prominent)
  if (missingOptional.length > 0 && verbose) {
    console.log(chalk.yellow('Optional tools not installed:'));
    for (const tool of missingOptional) {
      console.log(chalk.yellow(`  ○ ${tool.name}`) + chalk.gray(` - ${tool.description}`));
      console.log(chalk.gray(`    Install: ${tool.installHint}`));
    }
    console.log();
  }

  // Print workspace warnings
  if (!results.workspace.writable) {
    console.log(chalk.red(`⚠ Workspace issue: ${results.workspace.error}`));
    console.log();
  }

  // Print installed tools in verbose mode
  if (verbose) {
    const installed = results.tools.filter(t => t.installed);
    if (installed.length > 0) {
      console.log(chalk.green('Installed tools:'));
      for (const tool of installed) {
        const version = tool.version ? chalk.gray(` (${tool.version})`) : '';
        console.log(chalk.green(`  ✓ ${tool.name}${version}`));
      }
      console.log();
    }
  }

  // Summary
  if (!results.allRequiredMet) {
    console.log(chalk.red.bold('Some required tools are missing. Autohand may not work correctly.'));
    console.log(chalk.gray(`Use ${getPackageManagerHint()} to install them.`));
    console.log();
  }
}

/**
 * Quick check - returns true if all required tools are available
 */
export async function quickCheck(): Promise<boolean> {
  const requiredTools = REQUIRED_TOOLS.filter(t => t.required);
  const results = await Promise.all(requiredTools.map(t => checkTool(t)));
  return results.every(r => r.installed);
}
