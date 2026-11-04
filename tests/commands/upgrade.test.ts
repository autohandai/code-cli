/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return { workspaceRoot: '/tmp/project', ...overrides } as SlashCommandContext;
}

describe('/upgrade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    ['2026-12-31T23:59:59.999Z', true],
    ['2027-01-01T00:00:00.000Z', false],
    ['2027-01-02T12:00:00.000Z', false],
  ])('shows the approved annual offer at %s only while active', async (now, active) => {
    vi.setSystemTime(new Date(now));
    const { upgrade } = await import('../../src/commands/upgrade.js');
    const offer = 'Annual plans are 20% off for the first year only, until 1 Jan 2027: autohand.ai/code/pricing';
    for (const isNonInteractive of [false, true]) {
      const result = await upgrade(makeContext({
        isNonInteractive,
        getAccountEntitlement: async () => ({ tier: 'pro', freeRemaining: null }),
      }), { openBrowser: vi.fn().mockResolvedValue(true) });
      expect(result?.includes(offer)).toBe(active);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('asks the user to sign in when there is no entitlement', async () => {
    const { upgrade } = await import('../../src/commands/upgrade.js');
    const openBrowser = vi.fn();
    const result = await upgrade(makeContext({ getAccountEntitlement: async () => null }), { openBrowser });
    expect(result).toBe('Sign in with /login to see upgrade options.');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('opens checkout for the next plan and records the activation', async () => {
    const { upgrade } = await import('../../src/commands/upgrade.js');
    const openBrowser = vi.fn().mockResolvedValue(true);
    const trackFeatureActivation = vi.fn();
    const result = await upgrade(
      makeContext({
        getAccountEntitlement: async () => ({ tier: 'free', freeRemaining: 0 }),
        trackFeatureActivation,
      }),
      { openBrowser },
    );
    expect(openBrowser).toHaveBeenCalledWith('https://console.autohand.ai/?upgrade=pro&source=cli');
    expect(result).toBe('Opening https://console.autohand.ai/?upgrade=pro&source=cli');
    expect(trackFeatureActivation).toHaveBeenCalledWith('upgrade_link', { tier: 'free', target: 'pro' });
  });

  it('sends managed plans to the billing page', async () => {
    const { upgrade } = await import('../../src/commands/upgrade.js');
    const openBrowser = vi.fn().mockResolvedValue(true);
    await upgrade(
      makeContext({ getAccountEntitlement: async () => ({ tier: 'team', freeRemaining: null }) }),
      { openBrowser },
    );
    expect(openBrowser).toHaveBeenCalledWith('https://console.autohand.ai/billing?source=cli');
  });

  it('returns the link without opening a browser in non-interactive mode', async () => {
    const { upgrade } = await import('../../src/commands/upgrade.js');
    const openBrowser = vi.fn();
    const result = await upgrade(
      makeContext({
        isNonInteractive: true,
        getAccountEntitlement: async () => ({ tier: 'pro', freeRemaining: null }),
      }),
      { openBrowser },
    );
    expect(result).toBe('Upgrade your Autohand plan: https://console.autohand.ai/?upgrade=pro_plus&source=cli');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
