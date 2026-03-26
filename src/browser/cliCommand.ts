/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import {
  applyChromeSettings,
  buildChromeOpenUrl,
  DEFAULT_CHROME_INSTALL_URL,
  detectExtensionProfile,
  installNativeHost,
  normalizeBrowsers,
  openChromeContinuation,
  resolveCliLaunchSpec,
} from './chrome.js';

export function registerChromeCommand(program: Command): void {
  program
    .command('chrome')
    .description('install and configure the Autohand Chrome extension bridge')
    .command('install')
    .description('install the native messaging bridge for Chrome-compatible browsers')
    .option('--browser <browser>', 'target browser: chrome, chromium, brave, edge, or all', 'all')
    .option('--extension-id <id>', 'installed Chrome extension id to use for direct handoff')
    .option('--install-url <url>', 'fallback install/continue URL', DEFAULT_CHROME_INSTALL_URL)
    .option('--cli-path <path>', 'CLI binary path to register in the native host')
    .option('--open', 'open the install/continue page after installation', false)
    .action(async (options: {
      browser: string;
      extensionId?: string;
      installUrl?: string;
      cliPath?: string;
      open?: boolean;
    }) => {
      const config = await loadConfig();
      const launchSpec = resolveCliLaunchSpec(options.cliPath);
      const browsers = normalizeBrowsers(options.browser);
      const extensionId = options.extensionId ?? config.chrome?.extensionId;
      const preferredBrowser = options.browser === 'all'
        ? (config.chrome?.browser ?? 'auto')
        : options.browser as any;
      const installUrl = options.installUrl ?? config.chrome?.installUrl ?? DEFAULT_CHROME_INSTALL_URL;
      const detectedProfile = extensionId ? await detectExtensionProfile(extensionId, browsers) : null;

      const result = await installNativeHost({
        cliCommand: launchSpec.command,
        cliArgPrefix: launchSpec.args,
        extensionIds: extensionId ? [extensionId] : [],
        browsers,
      });

      applyChromeSettings(config, {
        extensionId,
        browser: detectedProfile?.browser ?? preferredBrowser,
        userDataDir: detectedProfile?.userDataDir ?? config.chrome?.userDataDir,
        profileDirectory: detectedProfile?.profileDirectory ?? config.chrome?.profileDirectory,
        installUrl,
      });
      await saveConfig(config);

      console.log(chalk.green('\nInstalled Autohand Chrome bridge.'));
      for (const target of result.targets) {
        console.log(chalk.gray(`  ${target.browser}: ${target.manifestPath}`));
      }
      if (options.open) {
        await openChromeContinuation(
          buildChromeOpenUrl({ extensionId, installUrl }),
          detectedProfile?.browser ?? preferredBrowser,
          {
            userDataDir: detectedProfile?.userDataDir ?? config.chrome?.userDataDir,
            profileDirectory: detectedProfile?.profileDirectory ?? config.chrome?.profileDirectory,
          }
        );
      }
      if (!extensionId) {
        console.log(chalk.yellow('No extension id is configured yet.'));
        console.log(chalk.gray('Open the extension options page, copy the pairing command, then rerun it to enable direct /chrome handoff.'));
      }
      if (detectedProfile) {
        console.log(chalk.gray(`  profile: ${detectedProfile.browser} / ${detectedProfile.profileDirectory}`));
      }
      console.log();
    });
}
