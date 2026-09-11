/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { t } from '../i18n/index.js';

export type PlanInterval = 'month' | 'year' | null;

export interface PlanSummary {
  tier: string;
  label: string;
  interval: PlanInterval;
  accountName?: string;
}

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
};

function labelForTier(tier: string): string {
  return TIER_LABELS[tier] ?? tier.charAt(0).toUpperCase() + tier.slice(1);
}

function readInterval(value: unknown): PlanInterval {
  return value === 'month' || value === 'year' ? value : null;
}

/**
 * Turn the entitlement the API reports into something the CLI can show.
 * Returns null when the plan is unknown, so callers show nothing rather than
 * guessing at a tier the customer may not be on.
 */
export function planSummaryFromEntitlement(
  entitlement: { tier?: unknown; interval?: unknown; accountName?: unknown } | null | undefined,
): PlanSummary | null {
  const tier = entitlement?.tier;
  if (typeof tier !== 'string' || tier.length === 0) return null;

  // Free has no subscription, so it can never have a renewal cycle.
  const interval = tier === 'free' ? null : readInterval(entitlement?.interval);

  const accountName = typeof entitlement?.accountName === 'string' && entitlement.accountName.trim().length > 0
    ? entitlement.accountName.trim()
    : undefined;

  return { tier, label: labelForTier(tier), interval, ...(accountName ? { accountName } : {}) };
}

/** One line describing the plan, e.g. "Pro · Monthly". */
export function formatPlan(plan: PlanSummary | null | undefined): string | null {
  if (!plan) return null;
  if (plan.interval === 'year') return `${plan.label} · Annual`;
  if (plan.interval === 'month') return `${plan.label} · Monthly`;
  return plan.label;
}

/** The optional account label shown after the Autohand product name in the composer. */
export function formatComposerPlanLabel(plan: PlanSummary | null | undefined): string | undefined {
  if (!plan || plan.tier === 'enterprise') return undefined;
  return plan.tier === 'team' ? plan.accountName || plan.label : plan.label;
}

export type UpgradeTarget = 'pro' | 'max' | 'team';

/** Self-serve tiers in purchase order. Team and enterprise are managed in billing. */
const PLAN_LADDER: ReadonlyArray<'free' | UpgradeTarget> = ['free', 'pro', 'max', 'team'];

/** Next paid tier for a self-serve plan; null for team, enterprise and unknown tiers. */
export function nextPlanTier(tier: string | undefined): UpgradeTarget | null {
  const index = PLAN_LADDER.indexOf(tier as 'free' | UpgradeTarget);
  if (index < 0) return null;
  return (PLAN_LADDER[index + 1] as UpgradeTarget | undefined) ?? null;
}

export const CONSOLE_ORIGIN = 'https://console.autohand.ai';

/** Console deep link that starts checkout for `target`, or the billing page when there is nothing to sell. */
export function buildUpgradeUrl(target: UpgradeTarget | null, source = 'cli'): string {
  const url = new URL(target ? '/' : '/billing', CONSOLE_ORIGIN);
  if (target) url.searchParams.set('upgrade', target);
  url.searchParams.set('source', source);
  return url.toString();
}

/** One-line hint shown after an Autohand quota ends a turn. */
export function formatUpgradeHint(plan: PlanSummary | null | undefined): string {
  const target = nextPlanTier(plan?.tier);
  if (!plan || !target) return t('ui.upgradeHintManaged');
  return t('ui.upgradeHint', { plan: plan.label, next: labelForTier(target) });
}
