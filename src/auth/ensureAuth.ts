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

// Large FIGlet ASCII art — circles on left (lines 1-2), "Autohand Code" fills all lines
const LOGO_LINES = [
  '◎ ◎ ◎ ◎      ___         __        __                    __   ______          __',
  '◎ ◎ ◎ ◎     /   | __  __/ /_____  / /_  ____ _____  ____/ /  / ____/___  ____/ /__',
  '            / /| |/ / / / __/ __ \\/ __ \\/ __ `/ __ \\/ __  /  / /   / __ \\/ __  / _ \\',
  '           / ___ / /_/ / /_/ /_/ / / / / /_/ / / / / /_/ /  / /___/ /_/ / /_/ /  __/',
  '          /_/  |_\\__,_/\\__/\\____/_/ /_/\\__,_/_/ /_/\\__,_/   \\____/\\____/\\__,_/\\___/',
];

/**
 * Typewriter: circles appear column by column on both rows,
 * then the full FIGlet text reveals line by line.
 */
async function typewriteWelcome(startRow: number): Promise<void> {
  const hide = '\x1b[?25l';
  const show = '\x1b[?25h';
  const moveTo = (r: number, c: number) => `\x1b[${r};${c}H`;

  process.stdout.write(hide);

  // Phase 1: Type circles column by column (both rows at once)
  for (let col = 0; col < 4; col++) {
    const x = 1 + col * 2; // column position (◎ + space = 2 chars)
    process.stdout.write(moveTo(startRow, x) + chalk.white('◎'));
    process.stdout.write(moveTo(startRow + 1, x) + chalk.white('◎'));
    await new Promise(r => setTimeout(r, 100));
  }

  await new Promise(r => setTimeout(r, 150));

  // Phase 2: Reveal the text portion of each line
  for (let i = 0; i < LOGO_LINES.length; i++) {
    const line = LOGO_LINES[i];
    // For circle lines (0,1), only write the text part after the circles
    const textStart = i < 2 ? 9 : 0; // circles take 9 chars "◎ ◎ ◎ ◎ "
    const text = i < 2 ? line.slice(textStart) : line;
    const col = i < 2 ? 10 : 1;
    process.stdout.write(moveTo(startRow + i, col) + chalk.white(text));
    await new Promise(r => setTimeout(r, 60));
  }

  process.stdout.write(show);
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

    // Layout: logo (5 lines) + blank + version + blank + modal (~12 lines)
    const logoHeight = LOGO_LINES.length;
    const contentHeight = logoHeight + 6;
    const topPadding = Math.max(0, Math.floor((rows - contentHeight) / 2));
    const logoRow = topPadding + 1; // 1-based terminal row

    // Typewriter the circles, then reveal the FIGlet text
    await typewriteWelcome(logoRow);

    // Position cursor below the logo for version + modal
    process.stdout.write(`\x1b[${logoRow + logoHeight};1H`);
    console.log();
    console.log(chalk.gray(`          ${version}`));
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
