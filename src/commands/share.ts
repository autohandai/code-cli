/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /share Command
 * Share current session via public URL
 */

import chalk from 'chalk';
import { showModal, showConfirm, type ModalOption } from '../ui/ink/components/Modal.js';
import ora from 'ora';
import type { SlashCommand } from '../core/slashCommands.js';
import type { SessionManager, Session } from '../session/SessionManager.js';
import type { LoadedConfig, ProviderName } from '../types.js';
import {
  getShareApiClient,
  serializeSession,
  formatCost,
  formatTokens,
  formatDuration,
  type ShareVisibility,
} from '../share/index.js';

/**
 * Create a clickable terminal link using OSC 8 escape sequence
 * Falls back to plain URL if terminal doesn't support it
 */
function terminalLink(url: string, text?: string): string {
  const displayText = text || url;
  // OSC 8 escape sequence for clickable links
  // Format: \e]8;;URL\e\\TEXT\e]8;;\e\\
  const OSC = '\x1b]8;;';
  const ST = '\x1b\\';
  return `${OSC}${url}${ST}${chalk.cyan.underline(displayText)}${OSC}${ST}`;
}

// ============ Metadata ============

export const metadata: SlashCommand = {
  command: '/share',
  description: 'Share current session via public URL',
  implemented: true,
};

// ============ Context Type ============

interface ShareContext {
  sessionManager: SessionManager;
  currentSession?: Session;
  model: string;
  provider?: ProviderName;
  config?: LoadedConfig;
  getTotalTokensUsed?: () => number;
  workspaceRoot: string;
}

// ============ Command Implementation ============

export async function execute(
  _args?: string,
  context?: ShareContext
): Promise<void> {
  // Check if sharing is enabled via config
  if (context?.config?.share?.enabled === false) {
    console.log(chalk.yellow('Session sharing is disabled.'));
    console.log(
      chalk.gray('To enable, set share.enabled: true in your config file.')
    );
    return;
  }

  // Validate context
  if (!context?.currentSession) {
    console.log(chalk.yellow('No active session to share.'));
    console.log(
      chalk.gray('Start a conversation first, then use /share to share it.')
    );
    return;
  }

  const session = context.currentSession;
  const messages = session.getMessages();

  if (messages.length === 0) {
    console.log(chalk.yellow('Session has no messages to share.'));
    return;
  }

  // Get API client and device ID
  const client = getShareApiClient();
  const deviceId = await client.getDeviceId();

  // Calculate stats
  const totalTokens = context.getTotalTokensUsed?.() ?? 0;
  const duration = calculateDuration(session.metadata.createdAt);

  // Show session preview
  console.log();
  console.log(chalk.bold('Session Summary'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(`  Project:   ${chalk.cyan(session.metadata.projectName)}`);
  console.log(`  Model:     ${chalk.cyan(context.model)}`);
  console.log(`  Messages:  ${chalk.cyan(messages.length)}`);
  console.log(`  Tokens:    ${chalk.cyan(formatTokens(totalTokens))}`);
  console.log(
    `  Est. Cost: ${chalk.green(formatCost((totalTokens / 1000) * 0.003))}`
  );
  console.log(`  Duration:  ${chalk.cyan(formatDuration(duration))}`);
  console.log();

  // Ask for visibility
  const visibilityOptions: ModalOption[] = [
    { label: 'Public  - Anyone with the link can view', value: 'public' },
    { label: 'Private - Requires one-time passcode', value: 'private' },
  ];

  const visibilityResult = await showModal({
    title: 'Share visibility:',
    options: visibilityOptions
  });

  if (!visibilityResult) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  const visibility = visibilityResult.value as ShareVisibility;

  // Confirm sharing
  const confirmed = await showConfirm({
    title: `Share this session as ${visibility}?`,
    defaultValue: true
  });

  if (!confirmed) {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Serialize and upload
  console.log();
  const spinner = ora('Uploading session...').start();

  try {
    const payload = serializeSession(session, {
      model: context.model,
      provider: context.provider,
      totalTokens,
      visibility,
      deviceId,
    });

    const response = await client.createShare(payload);

    spinner.stop();

    if (response.success && response.url) {
      console.log();
      console.log(chalk.green.bold('Session shared successfully!'));
      console.log();
      console.log(`${chalk.bold('URL:')} ${terminalLink(response.url)}`);

      if (visibility === 'private' && response.passcode) {
        console.log();
        console.log(`${chalk.bold('Passcode:')} ${chalk.yellow.bold(response.passcode)}`);
        console.log(
          chalk.gray('  Share this passcode with people who need access.')
        );
      }

      console.log();
      console.log(chalk.gray('Tip: Click the URL or copy it to share with others!'));
      console.log();
    } else {
      console.log();
      console.log(
        chalk.red(`Failed to share: ${response.error || 'Unknown error'}`)
      );
      console.log();
    }
  } catch (error) {
    spinner.stop();
    console.log();
    console.log(chalk.red(`Failed to share: ${(error as Error).message}`));
    console.log();
  }
}

// ============ Helpers ============

/**
 * Calculate duration in seconds from start time to now
 */
function calculateDuration(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - start) / 1000));
}
