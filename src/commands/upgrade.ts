/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { buildUpgradeUrl, nextPlanTier } from '../billing/planSummary.js';
import { t } from '../i18n/index.js';
import { openBrowser as openBrowserDefault } from './login.js';
import { resolveAccountEntitlement } from './usage.js';

export interface UpgradeCommandDeps {
  openBrowser?: (url: string) => Promise<boolean>;
}

/**
 * Opens the console upgrade flow for the next plan up from the signed-in
 * account. Unlike the shell command `autohand upgrade`, which updates the
 * CLI binary, this is about the Autohand plan.
 */
export async function upgrade(
  ctx: SlashCommandContext,
  deps: UpgradeCommandDeps = {},
): Promise<string | null> {
  const entitlement = await resolveAccountEntitlement(ctx);
  if (!entitlement) {
    return t('commands.upgrade.signIn');
  }

  const target = nextPlanTier(entitlement.tier);
  const url = buildUpgradeUrl(target);
  await ctx.trackFeatureActivation?.('upgrade_link', { tier: entitlement.tier, target });

  if (ctx.isNonInteractive) {
    return t('commands.upgrade.link', { url });
  }

  await (deps.openBrowser ?? openBrowserDefault)(url);
  return t('commands.upgrade.opening', { url });
}

export const metadata = {
  command: '/upgrade',
  description: 'open the console to upgrade your Autohand plan',
  implemented: true,
};
