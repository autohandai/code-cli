/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import { getAuthClient } from '../../../src/auth/index.js';
import { entitlementToken } from '../../../src/auth/accountSelection.js';
import type { AutohandConfig } from '../../../src/types.js';

/**
 * Regression: the status line showed "Autohand (Free)" for a Max subscriber. `/login` refreshed
 * `auth.token` (Max account) but left a stale `autohandai.accountToken` from an older sign-in
 * (a Free account). Inference already prefers `auth.token` (ProviderFactory), but the plan
 * refresh preferred the stale `accountToken`, so the label described an account the CLI was not
 * billing. The plan label must describe the same identity inference uses.
 */
const staleLoginConfig = (): AutohandConfig => ({
  provider: 'autohandai',
  auth: { token: 'max-login-token' },
  autohandai: { plan: 'cloud', authMode: 'account', accountToken: 'stale-free-token', model: 'moa' },
} as AutohandConfig);

describe('entitlementToken', () => {
  it('prefers the signed-in token over a stale cloud account token', () => {
    expect(entitlementToken(staleLoginConfig(), 'autohandai')).toBe('max-login-token');
  });

  it('falls back to the cloud account token when nobody is signed in', () => {
    const config = staleLoginConfig();
    delete config.auth;
    expect(entitlementToken(config, 'autohandai')).toBe('stale-free-token');
  });

  it('uses the API key in api-key mode, matching the key inference sends', () => {
    const config = {
      provider: 'autohandai',
      auth: { token: 'login-token' },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'team-api-key' },
    } as AutohandConfig;
    expect(entitlementToken(config, 'autohandai')).toBe('team-api-key');
  });

  it('treats a missing authMode as key mode, as the inference provider does', () => {
    const config = { provider: 'autohandai', auth: { token: 'login-token' }, autohandai: { plan: 'cloud', apiKey: 'team-api-key' } } as AutohandConfig;
    expect(entitlementToken(config, 'autohandai')).toBe('team-api-key');
  });

  it('falls back to the signed-in token in api-key mode without a key', () => {
    const config = { provider: 'autohandai', auth: { token: 'login-token' }, autohandai: { plan: 'cloud', authMode: 'api-key' } } as AutohandConfig;
    expect(entitlementToken(config, 'autohandai')).toBe('login-token');
  });

  it('uses the signed-in token for other providers', () => {
    expect(entitlementToken(staleLoginConfig(), 'openrouter')).toBe('max-login-token');
  });

  it('returns undefined when there are no credentials at all', () => {
    expect(entitlementToken({ provider: 'autohandai', autohandai: { plan: 'cloud', authMode: 'account' } } as AutohandConfig, 'autohandai')).toBeUndefined();
  });

  it('ignores blank tokens', () => {
    const config = staleLoginConfig();
    config.auth = { token: '   ' };
    expect(entitlementToken(config, 'autohandai')).toBe('stale-free-token');
  });
});

describe('status line plan refresh', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the plan for the signed-in account, not a stale cloud account token', async () => {
    const fetch = vi.spyOn(getAuthClient(), 'fetchEntitlement').mockImplementation(async token =>
      token === 'max-login-token' ? { tier: 'max', freeRemaining: null, interval: 'month' } : { tier: 'free', freeRemaining: 20 });
    const host = Object.assign(Object.create(AutohandAgent.prototype), {
      activeProvider: 'autohandai', isInstructionActive: false, accountPlan: null,
      runtime: { config: staleLoginConfig(), options: { model: 'moa' } },
      syncProviderModelStatusLine: vi.fn(), emitOutput: vi.fn(), notifyUser: vi.fn(),
      providerConfigManager: { applyModelChangeRemote: vi.fn() },
    });

    await host.refreshAccountPlan();

    expect(fetch).toHaveBeenCalledWith('max-login-token', undefined);
    expect(host.accountPlan.tier).toBe('max');
    expect(host.providerConfigManager.applyModelChangeRemote).not.toHaveBeenCalled();
  });
});
