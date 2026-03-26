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
  openChromeContinuation,
} from '../browser/chrome.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';

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

export async function chrome(ctx: ChromeCommandContext): Promise<string | null> {
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

  const statusLabel = nativeHostInstalled ? 'Ready' : 'Disabled';
  const extLabel = nativeHostInstalled
    ? (extensionDetected ? chalk.green('Installed') : chalk.yellow('Native host only'))
    : chalk.red('Not installed');
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
    `Status: ${statusLabel}`,
    `Extension: ${extLabel}`,
    '',
    `Usage: ${chalk.yellow('autohand --chrome')} or ${chalk.yellow('autohand --no-chrome')}`,
    '',
    'Site-level permissions are inherited from the Chrome extension.',
    `Learn more: ${chalk.gray('https://autohand.ai/docs/chrome')}`,
  ].join('\n');

  const selected = await withModalPause(ctx, () =>
    showModal({ title, options }),
  );

  if (!selected) return null;

  switch (selected.value) {
    case 'open': {
      await ensureNativeHostInstalled({ extensionId });
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
      await ensureNativeHostInstalled({ extensionId });
      return `${chalk.green('✓')} Native messaging host reinstalled.`;
    }

    case 'toggle': {
      return chalk.gray('Configure in ~/.autohand/config.json → chrome.enabledByDefault');
    }
  }

  return null;
}
