/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * /share Command
 * Share current session via public URL
 */

import chalk from 'chalk';
import enquirer from 'enquirer';
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
  const { Select, Confirm } = enquirer as any;

  const visibilityPrompt = new Select({
    name: 'visibility',
    message: 'Share visibility:',
    choices: [
      { name: 'public', message: 'Public  - Anyone with the link can view' },
      { name: 'private', message: 'Private - Requires one-time passcode' },
    ],
  });

  let visibility: ShareVisibility;
  try {
    visibility = await visibilityPrompt.run();
  } catch {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

  // Confirm sharing
  const confirmPrompt = new Confirm({
    name: 'confirm',
    message: `Share this session as ${visibility}?`,
    initial: true,
  });

  let confirmed: boolean;
  try {
    confirmed = await confirmPrompt.run();
  } catch {
    console.log(chalk.gray('Cancelled.'));
    return;
  }

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
      console.log(`${chalk.bold('URL:')} ${chalk.cyan.underline(response.url)}`);

      if (visibility === 'private' && response.passcode) {
        console.log();
        console.log(`${chalk.bold('Passcode:')} ${chalk.yellow.bold(response.passcode)}`);
        console.log(
          chalk.gray('  Share this passcode with people who need access.')
        );
      }

      console.log();
      console.log(chalk.gray('Tip: Copy the URL and share it with others!'));
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
