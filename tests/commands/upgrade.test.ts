/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandContext } from '../../src/core/slashCommandTypes.js';

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return { workspaceRoot: '/tmp/project', ...overrides } as SlashCommandContext;
}

describe('/upgrade', () => {
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
    expect(result).toBe('Upgrade your Autohand plan: https://console.autohand.ai/?upgrade=max&source=cli');
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
