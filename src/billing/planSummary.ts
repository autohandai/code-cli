/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type PlanInterval = 'month' | 'year' | null;

export interface PlanSummary {
  tier: string;
  label: string;
  interval: PlanInterval;
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
  entitlement: { tier?: unknown; interval?: unknown } | null | undefined,
): PlanSummary | null {
  const tier = entitlement?.tier;
  if (typeof tier !== 'string' || tier.length === 0) return null;

  // Free has no subscription, so it can never have a renewal cycle.
  const interval = tier === 'free' ? null : readInterval(entitlement?.interval);

  return { tier, label: labelForTier(tier), interval };
}

/** One line describing the plan, e.g. "Pro · Monthly". */
export function formatPlan(plan: PlanSummary | null | undefined): string | null {
  if (!plan) return null;
  if (plan.interval === 'year') return `${plan.label} · Annual`;
  if (plan.interval === 'month') return `${plan.label} · Monthly`;
  return plan.label;
}
