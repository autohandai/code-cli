/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

describe('plan line extension', () => {
  it('adds the plan to the status line', async () => {
    const { withPlanLineExtension } = await import('../../../src/core/agent/AgentUIRuntime.js');

    const result = withPlanLineExtension(undefined, {
      tier: 'pro',
      label: 'Pro',
      interval: 'month',
    });

    const segment = result?.status?.segments?.find((s) => s.id === 'plan');
    expect(segment?.text).toBe('Pro · Monthly');
  });

  it('keeps existing status segments alongside the plan', async () => {
    const { withPlanLineExtension } = await import('../../../src/core/agent/AgentUIRuntime.js');

    const configured = {
      status: { segments: [{ id: 'session-lines-added', text: '+12 lines' }] },
      help: { segments: [{ id: 'session-peers', text: '2 peers' }] },
    };

    const result = withPlanLineExtension(configured, {
      tier: 'max',
      label: 'Max',
      interval: 'year',
    });

    const ids = result?.status?.segments?.map((s) => s.id) ?? [];
    expect(ids).toContain('session-lines-added');
    expect(ids).toContain('plan');
    // The help slot must survive untouched.
    expect(result?.help?.segments?.map((s) => s.id)).toContain('session-peers');
  });

  it('leaves the configuration alone when the plan is unknown', async () => {
    const { withPlanLineExtension } = await import('../../../src/core/agent/AgentUIRuntime.js');

    const configured = {
      status: { segments: [{ id: 'session-lines-added', text: '+12 lines' }] },
    };

    expect(withPlanLineExtension(configured, null)).toBe(configured);
    expect(withPlanLineExtension(undefined, null)).toBeUndefined();
  });

  it('shows a free plan without a cycle', async () => {
    const { withPlanLineExtension } = await import('../../../src/core/agent/AgentUIRuntime.js');

    const result = withPlanLineExtension(undefined, {
      tier: 'free',
      label: 'Free',
      interval: null,
    });

    expect(result?.status?.segments?.find((s) => s.id === 'plan')?.text).toBe('Free');
  });
});
