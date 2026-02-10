/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { safePrompt } from '../utils/prompt.js';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { getAuthClient } from '../auth/index.js';
import { saveConfig } from '../config.js';
import { AUTH_CONFIG } from '../constants.js';
import type { LoadedConfig } from '../types.js';
import { createSyncService, DEFAULT_SYNC_CONFIG } from '../sync/index.js';

export const metadata = {
  command: '/login',
  description: t('commands.login.description'),
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
    const result = await safePrompt<{ continueLogin: boolean }>({
      type: 'confirm',
      name: 'continueLogin',
      message: `Already logged in as ${chalk.cyan(config.auth.user.email)}. Log in with a different account?`,
      initial: false,
    });

    if (!result || !result.continueLogin) {
      console.log(chalk.gray(t('commands.login.cancelled')));
      return null;
    }
  }

  const authClient = getAuthClient();

  // Step 1: Initiate device authorization
  console.log(chalk.gray('Initiating authentication...'));
  const initResult = await authClient.initiateDeviceAuth();

  if (!initResult.success || !initResult.deviceCode || !initResult.userCode) {
    console.log(chalk.red(t('commands.login.failed', { error: initResult.error || 'Unknown error' })));
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
      console.log(chalk.green(t('commands.login.success', { email: pollResult.user.name || pollResult.user.email })));
      console.log();

      // Check for cloud sync data and offer to restore
      await checkAndRestoreSyncData(pollResult.token, pollResult.user.id, updatedConfig);

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

/**
 * Check if there's cloud sync data and offer to restore it
 */
async function checkAndRestoreSyncData(
  token: string,
  userId: string,
  config: LoadedConfig
): Promise<void> {
  try {
    // Create sync service to check for cloud data
    const syncService = createSyncService({
      authToken: token,
      userId,
      config: {
        ...DEFAULT_SYNC_CONFIG,
        ...config.sync,
        enabled: true,
      },
    });

    // Check remote status - get remote manifest to see if there's data
    const { getSyncApiClient } = await import('../sync/SyncApiClient.js');
    const apiClient = getSyncApiClient();
    const remoteManifest = await apiClient.getRemoteManifest(token);

    if (!remoteManifest || remoteManifest.files.length === 0) {
      // No cloud data, nothing to restore
      return;
    }

    // Cloud data exists - ask user if they want to restore
    const fileCount = remoteManifest.files.length;
    const totalSize = remoteManifest.files.reduce((sum, f) => sum + f.size, 0);
    const sizeStr = formatSize(totalSize);

    console.log(chalk.cyan(`Found cloud sync data (${fileCount} files, ${sizeStr})`));
    console.log(chalk.gray('This includes your settings, agents, skills, and memory.'));
    console.log();

    const result = await safePrompt<{ restore: boolean }>({
      type: 'confirm',
      name: 'restore',
      message: 'Would you like to restore your settings from the cloud?',
      initial: true,
    });

    if (!result || !result.restore) {
      console.log(chalk.gray('Skipped sync restore. You can sync later with /sync.'));
      return;
    }

    // Restore from cloud with ESC/Ctrl+C cancellation support
    console.log(chalk.gray('Restoring settings from cloud...'));
    console.log(chalk.gray('(Press ESC or Ctrl+C to cancel)'));

    const syncResult = await cancellableOperation(
      () => syncService.forceDownload(),
    );

    if (!syncResult) {
      console.log(chalk.yellow('\nSync restore cancelled.'));
      console.log(chalk.gray('You can sync later with /sync.'));
    } else if (syncResult.success) {
      console.log(chalk.green(`Restored ${syncResult.downloaded} files from cloud.`));
    } else {
      console.log(chalk.yellow(`Sync restore failed: ${syncResult.error}`));
      console.log(chalk.gray('You can try again later with /sync.'));
    }
  } catch {
    // Silently fail - sync is not critical for login
    console.log(chalk.gray('Could not check cloud sync data.'));
  }
}

/**
 * Wrap an async operation so ESC or Ctrl+C cancels it.
 * Returns null if the user cancels.
 */
async function cancellableOperation<T>(fn: () => Promise<T>): Promise<T | null> {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && stdin.setRawMode) {
        try { stdin.setRawMode(wasRaw ?? false); } catch { /* ignore */ }
      }
    };

    const onData = (data: Buffer) => {
      const s = data.toString();
      // ESC (\x1b) or Ctrl+C (\x03)
      if (s === '\x1b' || s === '\x03') {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }
    };

    // Enable raw mode so escape sequences aren't echoed
    if (stdin.isTTY && stdin.setRawMode) {
      try { stdin.setRawMode(true); } catch { /* ignore */ }
    }
    stdin.on('data', onData);

    fn().then((result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }).catch(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Format bytes to human readable size
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
