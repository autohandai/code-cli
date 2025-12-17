/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import enquirer from 'enquirer';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { getAuthClient } from '../auth/index.js';
import { saveConfig } from '../config.js';
import { AUTH_CONFIG } from '../constants.js';
import type { LoadedConfig } from '../types.js';

export const metadata = {
  command: '/login',
  description: 'sign in to your Autohand account',
  implemented: true,
};

type LoginContext = Pick<SlashCommandContext, 'config'>;

/**
 * Open URL in the default browser
 * Uses dynamic import for 'open' package, falls back to platform-specific commands
 */
async function openBrowser(url: string): Promise<boolean> {
  try {
    // Try to use the 'open' package if available
    const open = await import('open').then(m => m.default).catch(() => null);
    if (open) {
      await open(url);
      return true;
    }

    // Fallback to platform-specific commands
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      command = `xdg-open "${url}"`;
    }

    await execAsync(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function login(ctx: LoginContext): Promise<string | null> {
  const config = ctx.config as LoadedConfig;

  // Check if already logged in
  if (config?.auth?.token && config?.auth?.user) {
    const { continueLogin } = await enquirer.prompt<{ continueLogin: boolean }>({
      type: 'confirm',
      name: 'continueLogin',
      message: `Already logged in as ${chalk.cyan(config.auth.user.email)}. Log in with a different account?`,
      initial: false,
    });

    if (!continueLogin) {
      console.log(chalk.gray('Login cancelled.'));
      return null;
    }
  }

  const authClient = getAuthClient();

  // Step 1: Initiate device authorization
  console.log(chalk.gray('Initiating authentication...'));
  const initResult = await authClient.initiateDeviceAuth();

  if (!initResult.success || !initResult.deviceCode || !initResult.userCode) {
    console.log(chalk.red(`Failed to start login: ${initResult.error || 'Unknown error'}`));
    return null;
  }

  // Step 2: Display user code and open browser
  console.log();
  console.log(chalk.bold('To sign in, visit:'));
  console.log(chalk.cyan.underline(initResult.verificationUriComplete || `${AUTH_CONFIG.authorizationUrl}?code=${initResult.userCode}`));
  console.log();
  console.log(chalk.gray('Or enter this code manually:'));
  console.log(chalk.bold.yellow(`  ${initResult.userCode}`));
  console.log();

  // Try to open browser
  const browserOpened = await openBrowser(
    initResult.verificationUriComplete || `${AUTH_CONFIG.authorizationUrl}?code=${initResult.userCode}`
  );

  if (browserOpened) {
    console.log(chalk.gray('Browser opened. Complete the login in your browser.'));
  } else {
    console.log(chalk.yellow('Could not open browser automatically. Please visit the URL above.'));
  }

  console.log();
  console.log(chalk.gray('Waiting for authorization...'));
  console.log(chalk.gray('(Press Ctrl+C to cancel)'));

  // Step 3: Poll for authorization
  const startTime = Date.now();
  const timeout = AUTH_CONFIG.authTimeout;
  const pollInterval = initResult.interval ? initResult.interval * 1000 : AUTH_CONFIG.pollInterval;

  let dots = 0;
  const maxDots = 3;

  while (Date.now() - startTime < timeout) {
    // Show progress
    process.stdout.write(`\r${chalk.gray('Waiting' + '.'.repeat(dots + 1) + ' '.repeat(maxDots - dots))}`);
    dots = (dots + 1) % (maxDots + 1);

    await sleep(pollInterval);

    const pollResult = await authClient.pollDeviceAuth(initResult.deviceCode);

    if (pollResult.status === 'authorized' && pollResult.token && pollResult.user) {
      // Clear the waiting line
      process.stdout.write('\r' + ' '.repeat(20) + '\r');

      // Calculate expiry date
      const expiresAt = new Date(Date.now() + AUTH_CONFIG.sessionExpiryDays * 24 * 60 * 60 * 1000).toISOString();

      // Save to config
      const updatedConfig: LoadedConfig = {
        ...config,
        auth: {
          token: pollResult.token,
          user: pollResult.user,
          expiresAt,
        },
      };

      await saveConfig(updatedConfig);

      console.log();
      console.log(chalk.green('Login successful!'));
      console.log(chalk.cyan(`Welcome, ${pollResult.user.name || pollResult.user.email}!`));
      console.log();

      return null;
    }

    if (pollResult.status === 'expired') {
      process.stdout.write('\r' + ' '.repeat(20) + '\r');
      console.log(chalk.red('Authorization code expired. Please try again.'));
      return null;
    }

    // Continue polling if still pending
  }

  // Timeout
  process.stdout.write('\r' + ' '.repeat(20) + '\r');
  console.log(chalk.red('Authorization timed out. Please try again.'));
  return null;
}
