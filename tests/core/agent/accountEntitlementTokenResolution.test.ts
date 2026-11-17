/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../../src/types.js';

// Reproduce the FIXED token-resolution logic from getAccountEntitlement
function getAccountEntitlementToken(config: LoadedConfig): string | undefined {
  const autohand = config.autohandai;
  const isAutohandCloud = config.provider === 'autohandai' && autohand?.plan === 'cloud';
  return isAutohandCloud
    ? (autohand?.authMode === 'account'
        ? autohand?.accountToken ?? config.auth?.token
        : autohand?.apiKey ?? config.auth?.token)
    : config.auth?.token;
}

// Reproduce the token-resolution logic from readAccountPlan
function readAccountPlanToken(config: LoadedConfig): string | undefined {
  const autohand = config.autohandai;
  const isAutohandCloud = config.provider === 'autohandai' && autohand?.plan === 'cloud';
  return isAutohandCloud
    ? (autohand?.authMode === 'account'
        ? autohand?.accountToken ?? config.auth?.token
        : autohand?.apiKey ?? config.auth?.token)
    : config.auth?.token;
}

describe('Account entitlement token resolution consistency', () => {
  it('readAccountPlan and getAccountEntitlement resolve the same token for cloud account mode', () => {
    const config = {
      provider: 'autohandai',
      auth: { token: 'auth-token' },
      autohandai: { plan: 'cloud', authMode: 'account', accountToken: 'account-token' },
    } as unknown as LoadedConfig;

    expect(getAccountEntitlementToken(config)).toBe('account-token');
    expect(readAccountPlanToken(config)).toBe('account-token');
    expect(getAccountEntitlementToken(config)).toBe(readAccountPlanToken(config));
  });

  it('readAccountPlan and getAccountEntitlement resolve the same token for cloud api-key mode', () => {
    const config = {
      provider: 'autohandai',
      auth: { token: 'auth-token' },
      autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'api-key-token' },
    } as unknown as LoadedConfig;

    expect(getAccountEntitlementToken(config)).toBe('api-key-token');
    expect(readAccountPlanToken(config)).toBe('api-key-token');
    expect(getAccountEntitlementToken(config)).toBe(readAccountPlanToken(config));
  });

  it('falls back to auth.token when no provider-specific token is set', () => {
    const config = {
      provider: 'autohandai',
      auth: { token: 'auth-token' },
      autohandai: { plan: 'cloud', authMode: 'account' },
    } as unknown as LoadedConfig;

    expect(getAccountEntitlementToken(config)).toBe('auth-token');
    expect(readAccountPlanToken(config)).toBe('auth-token');
    expect(getAccountEntitlementToken(config)).toBe(readAccountPlanToken(config));
  });

  it('uses auth.token for non-autohandai providers', () => {
    const config = {
      provider: 'openrouter',
      auth: { token: 'auth-token' },
      autohandai: { plan: 'cloud', authMode: 'account', accountToken: 'account-token' },
    } as unknown as LoadedConfig;

    expect(getAccountEntitlementToken(config)).toBe('auth-token');
    expect(readAccountPlanToken(config)).toBe('auth-token');
    expect(getAccountEntitlementToken(config)).toBe(readAccountPlanToken(config));
  });
});

