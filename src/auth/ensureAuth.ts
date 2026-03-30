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
import packageJson from '../../package.json' with { type: 'json' };
import type { LoadedConfig } from '../types.js';

// ASCII logo + ANSI Regular FIGlet "Autohand" — side-by-side, cross-platform
const GAP = '     ';
const LOGO_LINES = [
  '(@) (@) (@) (@)' + GAP + ' █████  ██    ██ ████████  ██████  ██   ██  █████  ███    ██ ██████',
  '(@) (@) (@) (@)' + GAP + '██   ██ ██    ██    ██    ██    ██ ██   ██ ██   ██ ████   ██ ██   ██',
  '               ' + GAP + '███████ ██    ██    ██    ██    ██ ███████ ███████ ██ ██  ██ ██   ██',
  '               ' + GAP + '██   ██ ██    ██    ██    ██    ██ ██   ██ ██   ██ ██  ██ ██ ██   ██',
  '               ' + GAP + '██   ██  ██████     ██     ██████  ██   ██ ██   ██ ██   ████ ██████',
];

/** Total number of rendered lines. */
const WELCOME_HEIGHT = LOGO_LINES.length;

/**
 * Typewriter: renders the logo line by line, horizontally centered.
 */
async function typewriteWelcome(startRow: number): Promise<void> {
  const cols = process.stdout.columns || 80;
  const maxWidth = Math.max(...LOGO_LINES.map(l => l.length));
  const leftPad = Math.max(0, Math.floor((cols - maxWidth) / 2));
  const pad = ' '.repeat(leftPad);

  process.stdout.write('\x1b[?25l'); // hide cursor
  for (let i = 0; i < LOGO_LINES.length; i++) {
    process.stdout.write(`\x1b[${startRow + i};1H\x1b[2K`);
    process.stdout.write(chalk.white(pad + LOGO_LINES[i]));
    await new Promise(r => setTimeout(r, 70));
  }
  process.stdout.write('\x1b[?25h'); // show cursor
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
  // Show full-screen welcome before login — like Cursor's splash screen
  if (process.stdout.isTTY) {
    const rows = process.stdout.rows || 24;
    const version = `v${packageJson.version}`;

    // Clear screen and position content vertically centered
    process.stdout.write('\x1b[2J\x1b[H');

    // Layout: logo (8 lines) + blank + version + blank + modal (~12)
    const contentHeight = WELCOME_HEIGHT + 6;
    const topPadding = Math.max(0, Math.floor((rows - contentHeight) / 2));
    const logoRow = topPadding + 1; // 1-based terminal row

    // Typewriter: icon + FIGlet side-by-side
    await typewriteWelcome(logoRow);

    // Position cursor below the art for version + modal
    process.stdout.write(`\x1b[${logoRow + WELCOME_HEIGHT};1H`);
    const cols = process.stdout.columns || 80;
    const maxWidth = Math.max(...LOGO_LINES.map(l => l.length));
    const leftPad = Math.max(0, Math.floor((cols - maxWidth) / 2));
    const versionPad = ' '.repeat(leftPad + Math.floor((maxWidth - version.length) / 2));
    console.log();
    console.log(chalk.gray(`${versionPad}${version}`));
    console.log();

    const selected = await showModal({
      title: chalk.white('Sign in to continue.'),
      options: [
        { label: 'Login', value: 'login' },
        { label: 'Exit', value: 'exit' },
      ],
    });

    // Clear the splash before proceeding
    process.stdout.write('\x1b[2J\x1b[H');

    if (!selected || selected.value === 'exit') {
      process.exit(0);
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
