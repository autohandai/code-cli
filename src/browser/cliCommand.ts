/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { Option, type Command } from 'commander';
import { loadConfig, saveConfig } from '../config.js';
import { LEGACY_BROWSER_CLI_COMMAND_WARNING } from './compatibility.js';
import {
  applyChromeSettings,
  buildChromeOpenUrl,
  DEFAULT_CHROME_INSTALL_URL,
  detectExtensionProfile,
  installNativeHost,
  normalizeBrowsers,
  openChromeContinuation,
  resolveCliLaunchSpec,
  type BrowserPreference,
} from './chrome.js';

interface BrowserInstallOptions {
  browser: string;
  extensionId?: string;
  installUrl?: string;
  cliPath?: string;
  open?: boolean;
}

export function registerBrowserOptions(program: Command): void {
  program
    .addOption(new Option('--browser', 'Enable browser integration (same as /browser)'))
    .addOption(new Option('--no-browser', 'Disable browser integration'))
    .addOption(new Option('--chrome', 'Deprecated alias for --browser').hideHelp())
    .addOption(new Option('--no-chrome', 'Deprecated alias for --no-browser').hideHelp());
}

export function registerBrowserCommand(program: Command): void {
  registerBrowserInstallCommand(
    program
      .command('browser')
      .description('install and configure the Autohand browser extension bridge'),
  );
  registerBrowserInstallCommand(
    program
      .command('chrome', { hidden: true })
      .description('deprecated compatibility alias for the browser command'),
    true,
  );
}

function registerBrowserInstallCommand(command: Command, legacy = false): void {
  command
    .command('install')
    .description('install the native messaging bridge for supported browsers')
    .option('--browser <browser>', 'target browser: chrome, chromium, brave, edge, or all', 'all')
    .option('--extension-id <id>', 'installed browser extension id to use for direct handoff')
    .option('--install-url <url>', 'fallback install/continue URL', DEFAULT_CHROME_INSTALL_URL)
    .option('--cli-path <path>', 'CLI binary path to register in the native host')
    .option('--open', 'open the install/continue page after installation', false)
    .action(async (options: BrowserInstallOptions) => {
      if (legacy) {
        console.warn(chalk.yellow(LEGACY_BROWSER_CLI_COMMAND_WARNING));
      }
      const config = await loadConfig(undefined, process.cwd());
      const launchSpec = resolveCliLaunchSpec(options.cliPath);
      const browsers = normalizeBrowsers(options.browser);
      const extensionId = options.extensionId ?? config.chrome?.extensionId;
      const preferredBrowser: BrowserPreference = options.browser === 'all'
        ? (config.chrome?.browser ?? 'auto')
        : (browsers[0] ?? 'auto');
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

      console.log(chalk.green('\nInstalled Autohand browser bridge.'));
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
        console.log(chalk.gray('Open the extension options page, copy the pairing command, then rerun it to enable direct /browser handoff.'));
      }
      if (detectedProfile) {
        console.log(chalk.gray(`  profile: ${detectedProfile.browser} / ${detectedProfile.profileDirectory}`));
      }
      console.log();
    });
}

/** @deprecated Register the browser command instead. */
export const registerChromeCommand = registerBrowserCommand;
