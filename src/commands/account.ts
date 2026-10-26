/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { safePrompt } from '../utils/prompt.js';
import { getAuthClient } from '../auth/index.js';
import type { AccountSummary } from '../auth/AuthClient.js';
import { selectedAccountId } from '../auth/accountSelection.js';
import { saveConfig } from '../config.js';
import type { LoadedConfig } from '../types.js';

export const metadata = {
  command: '/account',
  description: t('commands.account.description'),
  implemented: true,
};

const DEFAULT_CHOICE = '__default__';

export interface AccountCommandOptions {
  config?: LoadedConfig;
  args?: string[];
  /** Re-reads the plan and rebuilds the hosted provider so the switch applies to this session. */
  applyAccountChange?: () => Promise<void>;
}

function describe(account: AccountSummary, currentId: string | null | undefined): string {
  const marker = account.id === currentId ? chalk.green('●') : chalk.dim('○');
  const kind = account.type === 'team' ? t('commands.account.team') : t('commands.account.personal');
  const role = account.role ? ` · ${account.role}` : '';
  return `${marker} ${account.name} ${chalk.dim(`(${kind}${role})`)}`;
}

function findAccount(accounts: AccountSummary[], target: string): AccountSummary | undefined {
  const wanted = target.trim().toLowerCase();
  return accounts.find((account) => account.id.toLowerCase() === wanted)
    ?? accounts.find((account) => account.name.toLowerCase() === wanted)
    ?? (wanted === 'personal' ? accounts.find((account) => account.type === 'personal') : undefined);
}

async function apply(
  config: LoadedConfig,
  account: AccountSummary | null,
  applyAccountChange?: () => Promise<void>,
): Promise<string> {
  const api = { ...config.api };
  if (account) api.accountId = account.id;
  else delete api.accountId;
  config.api = Object.keys(api).length ? api : undefined;
  await saveConfig(config);
  await applyAccountChange?.();
  return account
    ? t('commands.account.switched', { name: account.name })
    : t('commands.account.cleared');
}

export async function account(options: AccountCommandOptions): Promise<string | null> {
  const { config } = options;
  const token = config?.auth?.token;
  if (!config || !token) return t('commands.account.signedOut');

  const chosen = selectedAccountId(config);
  const listing = await getAuthClient().listAccounts(token, chosen);
  if (!listing) return t('commands.account.unavailable');
  const currentId = chosen ?? listing.activeAccountId;

  const [action = '', ...rest] = options.args ?? [];
  const target = rest.join(' ').trim();

  if (action === 'use' || action === 'switch' || action === 'select') {
    if (!target) return t('commands.account.usage');
    const match = findAccount(listing.accounts, target);
    if (!match) return t('commands.account.notFound', { target });
    return apply(config, match, options.applyAccountChange);
  }
  if (action === 'clear' || action === 'default') return apply(config, null, options.applyAccountChange);
  if (action && action !== 'list') return t('commands.account.usage');

  const lines = listing.accounts.map((item) => describe(item, currentId));
  if (action === 'list' || !process.stdin.isTTY || listing.accounts.length < 2) {
    return [...lines, chalk.dim(t('commands.account.hint'))].join('\n');
  }

  const picked = await safePrompt<{ accountId: string }>({
    type: 'select',
    name: 'accountId',
    message: t('commands.account.choose'),
    choices: [
      ...listing.accounts.map((item) => ({ name: item.id, message: describe(item, currentId) })),
      { name: DEFAULT_CHOICE, message: chalk.dim(t('commands.account.useDefault')) },
    ],
  });
  if (!picked) return null;
  if (picked.accountId === DEFAULT_CHOICE) return apply(config, null, options.applyAccountChange);
  const match = listing.accounts.find((item) => item.id === picked.accountId);
  return match ? apply(config, match, options.applyAccountChange) : null;
}
