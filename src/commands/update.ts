/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import {
  DEFAULT_MODEL_CATALOG_URL,
  refreshModelCatalog,
} from '../providers/modelCatalogUpdater.js';
import { checkForUpdates, getInstallHint } from '../utils/versionCheck.js';

export interface UpdateOptions {
  currentVersion: string;
  check: boolean;
}

export interface ModelCatalogUpdateOptions {
  currentVersion: string;
}

export async function runModelCatalogUpdate(options: ModelCatalogUpdateOptions): Promise<void> {
  console.log(chalk.gray(`Refreshing model catalog from ${process.env.AUTOHAND_MODELS_URL ?? DEFAULT_MODEL_CATALOG_URL}...`));
  const result = await refreshModelCatalog({
    force: true,
    offline: false,
    userAgent: `autohand/${options.currentVersion}`,
  });

  if (result.status === 'not-modified') {
    console.log(chalk.green('Model catalog is already current.'));
    return;
  }

  const counts = result.modelCount !== undefined && result.providerCount !== undefined
    ? `${result.modelCount} models across ${result.providerCount} providers`
    : 'the latest model definitions';
  const revision = result.revision ? ` (${result.revision})` : '';
  console.log(chalk.green(`Updated ${counts}${revision}.`));
}

/**
 * Run the update/upgrade command.
 *
 * - With --check: prints version status and exits (0 = up-to-date, 1 = update available or error)
 * - Without --check: checks for update and runs the install script if one is available
 */
export async function runUpdate(opts: UpdateOptions): Promise<void> {
  const { currentVersion, check } = opts;

  console.log(chalk.gray('Checking for updates...'));

  // The user explicitly asked to update; bypass the skip-check env var
  const prevSkip = process.env.AUTOHAND_SKIP_UPDATE_CHECK;
  delete process.env.AUTOHAND_SKIP_UPDATE_CHECK;
  const result = await checkForUpdates(currentVersion, { forceCheck: true });
  if (prevSkip !== undefined) {
    process.env.AUTOHAND_SKIP_UPDATE_CHECK = prevSkip;
  }

  // Handle version check errors
  if (result.error) {
    console.error(chalk.red(`Failed to check for updates: ${result.error}`));
    process.exit(1);
    return;
  }

  if (result.latestVersion === null) {
    console.error(chalk.red('Could not determine latest version.'));
    process.exit(1);
    return;
  }

  const channel = result.channel;

  // Print version info
  console.log(`  Current version: ${chalk.cyan(currentVersion)}`);
  console.log(`  Latest version:  ${chalk.cyan(result.latestVersion)}`);
  console.log(`  Channel:         ${chalk.gray(channel)}`);
  console.log();

  if (result.isUpToDate) {
    console.log(chalk.green('Already up to date.'));
    process.exit(0);
    return;
  }

  // Update available
  console.log(chalk.yellow(`Update available: ${currentVersion} → ${result.latestVersion}`));

  if (check) {
    // --check mode: just report, exit 1 to signal "update available"
    const hint = getInstallHint(channel);
    console.log(chalk.gray(`Run to update: ${hint}`));
    process.exit(1);
    return;
  }

  // Install mode: run the install script
  const installCmd = getInstallHint(channel);
  console.log();
  console.log(chalk.gray(`Running: ${installCmd}`));
  console.log();

  const exitCode = await runInstallScript(installCmd);

  if (exitCode === 0) {
    console.log();
    console.log(chalk.green(`Successfully updated to ${result.latestVersion}!`));
    process.exit(0);
  } else {
    console.log();
    console.error(chalk.red(`Update failed (exit code ${exitCode}).`));
    console.error(chalk.gray(`You can try manually: ${installCmd}`));
    process.exit(exitCode);
  }
}

/**
 * Spawn the install script and stream its output.
 * Returns the exit code.
 */
function runInstallScript(command: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });

    child.on('error', () => {
      resolve(1);
    });
  });
}
