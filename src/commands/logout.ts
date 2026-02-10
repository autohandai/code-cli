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
import type { LoadedConfig } from '../types.js';

export const metadata = {
  command: '/logout',
  description: t('commands.logout.description'),
  implemented: true,
};

type LogoutContext = Pick<SlashCommandContext, 'config'>;

export async function logout(ctx: LogoutContext): Promise<string | null> {
  const config = ctx.config as LoadedConfig;

  // Check if logged in
  if (!config?.auth?.token) {
    console.log(chalk.yellow('You are not currently logged in.'));
    console.log(chalk.gray('Use /login to sign in to your Autohand account.'));
    return null;
  }

  const userName = config.auth.user?.name || config.auth.user?.email || 'user';

  // Confirm logout
  const result = await safePrompt<{ confirm: boolean }>({
    type: 'confirm',
    name: 'confirm',
    message: `Log out from ${chalk.cyan(userName)}?`,
    initial: true,
  });

  if (!result || !result.confirm) {
    console.log(chalk.gray(t('commands.logout.cancelled')));
    return null;
  }

  // Call server logout (best effort)
  const authClient = getAuthClient();
  try {
    await authClient.logout(config.auth.token);
  } catch {
    // Server logout failed, but we still clear local token
  }

  // Clear auth from config
  const updatedConfig: LoadedConfig = {
    ...config,
    auth: undefined,
  };

  await saveConfig(updatedConfig);

  console.log();
  console.log(chalk.green(t('commands.logout.success')));
  console.log(chalk.gray('Your local session has been cleared.'));
  console.log();

  return null;
}
