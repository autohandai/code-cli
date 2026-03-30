/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import {
  buildChromeOpenUrl,
  createBrowserHandoff,
  detectExtensionProfile,
  ensureNativeHostInstalled,
  getManifestTarget,
  hasActiveHandoff,
  openChromeContinuation,
} from '../browser/chrome.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { saveConfig } from '../config.js';

export const metadata = {
  command: '/chrome',
  description: 'continue the current session in the Autohand Chrome extension',
  implemented: true,
};

type ChromeCommandContext = SlashCommandContext;

async function withModalPause<T>(ctx: ChromeCommandContext, fn: () => Promise<T>): Promise<T> {
  ctx.onBeforeModal?.();
  try {
    return await fn();
  } finally {
    ctx.onAfterModal?.();
  }
}

export async function chrome(ctx: ChromeCommandContext, args: string[] = []): Promise<string | null> {
  const subcommand = args[0]?.toLowerCase();

  // /chrome disconnect — close the browser bridge connection
  if (subcommand === 'disconnect') {
    if (!ctx.config) return 'Config not available.';
    const chromeConfig = (ctx.config.chrome ?? {}) as Record<string, unknown>;
    chromeConfig.enabledByDefault = false;
    ctx.config.chrome = chromeConfig as typeof ctx.config.chrome;
    await saveConfig(ctx.config);
    return `${chalk.green('✓')} Browser bridge disconnected and disabled.`;
  }

  const currentSession = ctx.sessionManager.getCurrentSession();
  const sessionId = currentSession?.metadata.sessionId;

  if (!sessionId) {
    return 'No active session. Start a task first, then run /chrome.';
  }

  const extensionId = ctx.config?.chrome?.extensionId;
  const nativeHostInstalled = await fs.pathExists(getManifestTarget('chrome').manifestPath);

  let extensionDetected = false;
  if (extensionId) {
    extensionDetected = (await detectExtensionProfile(extensionId)) !== null;
  }

  // Start native host installation in the background immediately so it's
  // ready by the time the user picks an option — don't wait for "Reconnect".
  const nativeHostReady = ensureNativeHostInstalled({ extensionId }).catch(() => {});

  const activeHandoff = await hasActiveHandoff();
  let connectionLabel;
  if (activeHandoff) {
    connectionLabel = chalk.green('Handoff pending');
  } else if (nativeHostInstalled && extensionDetected) {
    connectionLabel = chalk.green('Extension ready');
  } else if (nativeHostInstalled) {
    connectionLabel = chalk.yellow('Native host installed');
  } else {
    connectionLabel = chalk.red('Not installed');
  }
  const statusLabel = nativeHostInstalled ? 'Ready' : 'Disabled';
  const extLabel = nativeHostInstalled
    ? (extensionDetected ? chalk.green('Installed') : chalk.yellow('Native host only'))
    : chalk.red('Not installed');
  let selected: ModalOption | null = null;
  let isReshow = false;

  while (true) {
    const enabledByDefault = (ctx.config?.chrome as Record<string, unknown>)?.enabledByDefault ? 'Yes' : 'No';

    const options: ModalOption[] = [
      { label: 'Open in Chrome', value: 'open', description: 'Hand off session and open browser' },
      { label: 'Manage permissions', value: 'permissions', description: 'Open extension settings page' },
      { label: 'Reconnect extension', value: 'reconnect', description: 'Reinstall native messaging host' },
      { label: `Enabled by default: ${enabledByDefault}`, value: 'toggle', description: 'Start browser bridge with the CLI' },
    ];

    const title = [
      chalk.yellow.bold('Autohand in Chrome (Beta)'),
      '',
      'Autohand in Chrome works with the extension to control your browser',
      'from the CLI. Navigate, fill forms, capture screenshots, and debug.',
      '',
      `Connection: ${connectionLabel}`,
      `Status: ${statusLabel}`,
      `Extension: ${extLabel}`,
      '',
      `Usage: ${chalk.yellow('autohand --chrome')} or ${chalk.yellow('autohand --no-chrome')}`,
      '',
      'Site-level permissions are inherited from the Chrome extension.',
      `Learn more: ${chalk.gray('https://autohand.ai/docs/chrome')}`,
    ].join('\n');

    // Clear previous modal output before re-showing after a toggle.
    // Title lines + 1 blank + options (label + description each) + 1 nav hint + padding.
    if (isReshow) {
      const titleLines = title.split('\n').length;
      const optionLines = options.length * 2; // label + description
      const chrome = 1; // nav hint line
      const totalLines = titleLines + optionLines + chrome + 3; // padding
      process.stdout.write(`\x1b[${totalLines}A\x1b[0J`);
    }

    selected = await withModalPause(ctx, () =>
      showModal({ title, options, initialIndex: isReshow ? 3 : undefined }),
    );

    if (!selected) return null; // ESC

    if (selected.value === 'toggle' && ctx.config) {
      const chromeConfig = (ctx.config.chrome ?? {}) as Record<string, unknown>;
      chromeConfig.enabledByDefault = !chromeConfig.enabledByDefault;
      ctx.config.chrome = chromeConfig as typeof ctx.config.chrome;
      await saveConfig(ctx.config);
      isReshow = true;
      continue; // Re-show the menu with updated label
    }

    break; // Non-toggle selection — proceed to execute
  }

  switch (selected.value) {
    case 'open': {
      await nativeHostReady;
      await createBrowserHandoff({
        sessionId,
        workspaceRoot: ctx.workspaceRoot,
        extensionId,
        installUrl: ctx.config?.chrome?.installUrl,
      });
      await openChromeContinuation(
        buildChromeOpenUrl({ installUrl: ctx.config?.chrome?.installUrl }),
        ctx.config?.chrome?.browser ?? 'auto',
        { userDataDir: ctx.config?.chrome?.userDataDir, profileDirectory: ctx.config?.chrome?.profileDirectory },
      );
      return `${chalk.green('✓')} Opened Chrome. Side panel ${chalk.gray('(Cmd+E)')} to continue.\n  Session: ${chalk.gray(sessionId)}`;
    }

    case 'permissions': {
      return 'Open the Chrome extension options page to manage permissions.';
    }

    case 'reconnect': {
      await nativeHostReady;
      return `${chalk.green('✓')} Native messaging host reinstalled. Open the Chrome side panel manually if needed.`;
    }
  }

  return null;
}
