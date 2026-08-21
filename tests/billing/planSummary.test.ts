/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

describe('plan summary', () => {
  it('names every tier the API can report', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    expect(planSummaryFromEntitlement({ tier: 'free' })?.label).toBe('Free');
    expect(planSummaryFromEntitlement({ tier: 'pro' })?.label).toBe('Pro');
    expect(planSummaryFromEntitlement({ tier: 'max' })?.label).toBe('Max');
    expect(planSummaryFromEntitlement({ tier: 'team' })?.label).toBe('Team');
    expect(planSummaryFromEntitlement({ tier: 'enterprise' })?.label).toBe('Enterprise');
  });

  it('carries the billing cycle when the API reports one', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    expect(planSummaryFromEntitlement({ tier: 'pro', interval: 'month' })?.interval).toBe('month');
    expect(planSummaryFromEntitlement({ tier: 'max', interval: 'year' })?.interval).toBe('year');
  });

  it('treats an unknown or missing cycle as no cycle', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    expect(planSummaryFromEntitlement({ tier: 'pro' })?.interval).toBeNull();
    expect(planSummaryFromEntitlement({ tier: 'pro', interval: 'weekly' })?.interval).toBeNull();
    expect(planSummaryFromEntitlement({ tier: 'free', interval: null })?.interval).toBeNull();
  });

  it('never claims a cycle for a free account', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    // A free account has no subscription, so a cycle would be meaningless.
    expect(planSummaryFromEntitlement({ tier: 'free', interval: 'month' })?.interval).toBeNull();
  });

  it('returns nothing when entitlement is unavailable', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    expect(planSummaryFromEntitlement(null)).toBeNull();
    expect(planSummaryFromEntitlement({ tier: '' })).toBeNull();
  });

  it('falls back to a readable label for a tier it does not know', async () => {
    const { planSummaryFromEntitlement } = await import('../../src/billing/planSummary.js');

    expect(planSummaryFromEntitlement({ tier: 'scholar' })?.label).toBe('Scholar');
  });

  it('formats a plan for a single line of output', async () => {
    const { formatPlan } = await import('../../src/billing/planSummary.js');

    expect(formatPlan({ tier: 'pro', label: 'Pro', interval: 'month' })).toBe('Pro · Monthly');
    expect(formatPlan({ tier: 'max', label: 'Max', interval: 'year' })).toBe('Max · Annual');
    expect(formatPlan({ tier: 'free', label: 'Free', interval: null })).toBe('Free');
    expect(formatPlan(null)).toBeNull();
  });
});
