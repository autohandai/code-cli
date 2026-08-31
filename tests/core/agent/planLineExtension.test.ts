/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

describe('account plan display placement', () => {
  it('keeps billing-cycle text out of the composer label', async () => {
    const { formatComposerPlanLabel } = await import('../../../src/billing/planSummary.js');

    expect(formatComposerPlanLabel({ tier: 'pro', label: 'Pro', interval: 'month' })).toBe('Pro');
    expect(formatComposerPlanLabel({ tier: 'max', label: 'Max', interval: 'year' })).toBe('Max');
  });

  it('uses a team account name and leaves Enterprise unqualified', async () => {
    const { formatComposerPlanLabel } = await import('../../../src/billing/planSummary.js');

    expect(formatComposerPlanLabel({
      tier: 'team',
      label: 'Team',
      accountName: 'Launch Team',
      interval: 'month',
    })).toBe('Launch Team');
    expect(formatComposerPlanLabel({ tier: 'enterprise', label: 'Enterprise', interval: 'year' })).toBeUndefined();
  });
});
