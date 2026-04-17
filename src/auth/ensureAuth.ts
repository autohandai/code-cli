/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mandatory authentication gate for CLI startup
 */
import chalk from 'chalk';
import { AuthClient } from './AuthClient.js';
import { loadConfig } from '../config.js';
import { showModal } from '../ui/ink/components/Modal.js';
import { LOGO_LINES } from '../utils/asciiArt.js';
import { checkForUpdates } from '../utils/versionCheck.js';
import packageJson from '../../package.json' with { type: 'json' };
import type { LoadedConfig } from '../types.js';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Get git commit hash (short)
 * Uses build-time embedded commit, falls back to runtime git command for dev
 */
async function getGitCommit(): Promise<string> {
  // Use build-time embedded commit if available
  if (process.env.BUILD_GIT_COMMIT && process.env.BUILD_GIT_COMMIT !== 'undefined') {
    return process.env.BUILD_GIT_COMMIT;
  }
  // For alpha builds, version suffix encodes the source commit
  const match = packageJson.version.match(/-alpha\.([0-9a-f]{7,40})$/i);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback for development (running from source)
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Run the appropriate upgrade command based on platform
 */
async function runUpgrade(): Promise<void> {
  const os = platform();
  let command: string;
  let args: string[];
  const shell: string | boolean = false;

  if (os === 'win32') {
    // Windows
    command = 'powershell.exe';
    args = ['-Command', 'iwr -useb https://autohand.ai/install.ps1 | iex'];
  } else if (os === 'darwin') {
    // macOS - try brew first, fallback to curl
    command = 'sh';
    args = ['-c', 'brew tap autohandai/code && brew install autohand-code || curl -fsSL https://autohand.ai/install.sh | sh'];
  } else {
    // Linux - use curl
    command = 'sh';
    args = ['-c', 'curl -fsSL https://autohand.ai/install.sh | sh'];
  }

  console.log(chalk.gray('Upgrading Autohand...'));
  console.log(chalk.gray(`Running: ${command} ${args.join(' ')}`));
  console.log();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: shell || undefined,
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log();
        console.log(chalk.green('Upgrade completed successfully!'));
        console.log(chalk.gray('Please restart Autohand to use the new version.'));
        resolve();
      } else {
        console.log();
        console.log(chalk.red('Upgrade failed.'));
        console.log(chalk.gray('You can try manually:'));
        if (os === 'win32') {
          console.log(chalk.gray('  iwr -useb https://autohand.ai/install.ps1 | iex'));
        } else {
          console.log(chalk.gray('  curl -fsSL https://autohand.ai/install.sh | sh'));
          console.log(chalk.gray('  or: brew tap autohandai/code && brew install autohand-code'));
        }
        console.log(chalk.gray('  or: npm i -g autohand-cli'));
        console.log(chalk.gray('  or: bun i -g autohand-cli'));
        reject(new Error(`Upgrade failed with exit code ${code}`));
      }
    });

    child.on('error', (error) => {
      console.log();
      console.log(chalk.red('Upgrade failed.'));
      console.log(chalk.gray(`Error: ${error.message}`));
      reject(error);
    });
  });
}

/**
 * Ensure the user is authenticated before proceeding.
 * Interactive — prompts the user to log in when no valid token exists.
 *
 * Flow:
 *  1. Token exists + not expired → validate via API (3 s timeout)
 *  2. Network error during validation → trust local token
 *  3. Invalid / missing / expired → launch interactive login
 *  4. After login, reload config. If still no token → exit(1)
 *
 * Returns the (possibly refreshed) config.
 */
export async function ensureAuthenticated(config: LoadedConfig): Promise<LoadedConfig> {
  // Fast path: token exists and hasn't expired locally
  if (config.auth?.token) {
    if (isTokenExpiredLocally(config)) {
      // Expired locally — skip server check, go straight to login
      return await promptLogin(config);
    }

    // Validate with server using a short timeout
    const client = new AuthClient({ timeout: 3000 });
    try {
      const result = await client.validateSession(config.auth.token);
      if (result.authenticated) {
        // Token is valid
        if (result.user && config.auth) {
          config.auth.user = result.user;
        }
        return config;
      }
      // Server says invalid — need to re-login
      return await promptLogin(config);
    } catch {
      // Network error — trust local token
      return config;
    }
  }

  // No token at all — need to login
  return await promptLogin(config);
}

/**
 * Non-interactive authentication check.
 * Returns true if the user has a valid (or assumed-valid) token.
 * Does not print anything or prompt for login.
 */
export async function checkAuthenticated(config: LoadedConfig): Promise<boolean> {
  if (!config.auth?.token) {
    return false;
  }

  if (isTokenExpiredLocally(config)) {
    return false;
  }

  // Validate with server using a short timeout
  const client = new AuthClient({ timeout: 3000 });
  try {
    const result = await client.validateSession(config.auth.token);
    return result.authenticated;
  } catch {
    // Network error — trust local token
    return true;
  }
}

/**
 * Check if the token is expired based on local expiry date.
 */
function isTokenExpiredLocally(config: LoadedConfig): boolean {
  if (!config.auth?.expiresAt) {
    return false;
  }
  const expiresAt = new Date(config.auth.expiresAt);
  return expiresAt < new Date();
}

/**
 * Print a message and launch the interactive login flow.
 * Reloads config after login. Exits if login fails.
 */
async function promptLogin(config: LoadedConfig): Promise<LoadedConfig> {
  // Show modal with logo and login/exit options
  if (process.stdout.isTTY) {
    const commit = await getGitCommit();
    const versionStr = commit !== 'unknown' 
      ? `v${packageJson.version} (${commit})` 
      : `v${packageJson.version}`;
    
    // Check for updates
    let updateAvailable = false;
    let latestVersion: string | null = null;
    try {
      const updateResult = await checkForUpdates(packageJson.version, { forceCheck: true });
      if (!updateResult.error && !updateResult.isUpToDate && updateResult.latestVersion) {
        updateAvailable = true;
        latestVersion = updateResult.latestVersion;
      }
    } catch {
      // Silently fail version check
    }

    const logoWithVersion = [...LOGO_LINES, '', chalk.gray(versionStr)].join('\n');
    
    // Build options based on update availability
    const options = [
      { label: 'Login', value: 'login' },
    ];
    
    if (updateAvailable && latestVersion) {
      options.push({ 
        label: `Upgrade (v${latestVersion} available)`, 
        value: 'upgrade' 
      });
    }
    
    options.push({ label: 'Exit', value: 'exit' });

    const selected = await showModal({
      logo: logoWithVersion,
      skipAltScreen: true,
      title: updateAvailable 
        ? chalk.yellow('New version available!') 
        : chalk.white('Sign in to continue.'),
      options,
    });

    if (!selected || selected.value === 'exit') {
      process.exit(0);
    }

    if (selected.value === 'upgrade') {
      try {
        await runUpgrade();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    }
  }

  const { login } = await import('../commands/login.js');
  await login({ config });

  // Reload config to pick up the token saved by login()
  const refreshed = await loadConfig(config.configPath);

  if (!refreshed.auth?.token) {
    console.log(chalk.red('Login failed. Autohand requires authentication to run.'));
    process.exit(1);
  }

  return refreshed;
}
