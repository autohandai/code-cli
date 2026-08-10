/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';

function baseConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    features: { autohand_inference: true },
    ...overrides,
  } as LoadedConfig;
}

describe('applyPostLoginProviderDefault', () => {
  it('defaults a fresh login to autohandai account mode when no provider is set', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const result = applyPostLoginProviderDefault(baseConfig(), 'ahc_test_token');

    expect(result.provider).toBe('autohandai');
    expect(result.autohandai).toMatchObject({
      plan: 'cloud',
      authMode: 'account',
      accountToken: 'ahc_test_token',
      model: 'fantail',
    });
    expect(result.autohandai?.baseUrl).toMatch(/^https:\/\//);
  });

  it('also defaults when provider is the untouched factory default (createDefaultConfig sets ' +
    'provider: "openrouter" with an empty apiKey before any login ever happens)', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const result = applyPostLoginProviderDefault(
      baseConfig({ provider: 'openrouter', openrouter: { apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' } }),
      'ahc_test_token',
    );

    expect(result.provider).toBe('autohandai');
  });

  it('never overrides openrouter once the user has actually configured a real key for it', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const result = applyPostLoginProviderDefault(
      baseConfig({ provider: 'openrouter', openrouter: { apiKey: 'sk-or-real-key', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' } }),
      'ahc_test_token',
    );

    expect(result.provider).toBe('openrouter');
    expect(result.autohandai).toBeUndefined();
  });

  it('never overrides any other provider the user explicitly chose', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const result = applyPostLoginProviderDefault(
      baseConfig({ provider: 'azure' }),
      'ahc_test_token',
    );

    expect(result.provider).toBe('azure');
    expect(result.autohandai).toBeUndefined();
  });

  it('does not default the provider when the autohand_inference feature flag is off', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const result = applyPostLoginProviderDefault(
      baseConfig({ features: { autohand_inference: false } }),
      'ahc_test_token',
    );

    expect(result.provider).toBeUndefined();
    expect(result.autohandai).toBeUndefined();
  });

  it('leaves every other config field untouched', async () => {
    const { applyPostLoginProviderDefault } = await import('../../src/commands/login.js');

    const input = baseConfig({
      auth: { token: 'ahc_test_token', user: { id: 'u1', email: 'a@b.com', name: 'A' }, expiresAt: '2030-01-01' },
    });
    const result = applyPostLoginProviderDefault(input, 'ahc_test_token');

    expect(result.auth).toEqual(input.auth);
    expect(result.configPath).toBe(input.configPath);
  });
});

describe('applyStartupProviderDefaults', () => {
  it('retroactively defaults an already-authenticated user who never re-runs /login', async () => {
    const { applyStartupProviderDefaults } = await import('../../src/commands/login.js');

    const result = applyStartupProviderDefaults(baseConfig({
      auth: { token: 'ahc_existing_token', user: { id: 'u1', email: 'a@b.com', name: 'A' }, expiresAt: '2030-01-01' },
    }));

    expect(result.provider).toBe('autohandai');
    expect(result.autohandai?.accountToken).toBe('ahc_existing_token');
  });

  it('does nothing for an anonymous config with no account token', async () => {
    const { applyStartupProviderDefaults } = await import('../../src/commands/login.js');

    const result = applyStartupProviderDefaults(baseConfig());

    expect(result.provider).toBeUndefined();
  });

  it('never overrides an explicit provider choice, even for an authenticated user', async () => {
    const { applyStartupProviderDefaults } = await import('../../src/commands/login.js');

    const result = applyStartupProviderDefaults(baseConfig({
      provider: 'openrouter',
      openrouter: { apiKey: 'sk-or-real-key', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
      auth: { token: 'ahc_existing_token', user: { id: 'u1', email: 'a@b.com', name: 'A' }, expiresAt: '2030-01-01' },
    }));

    expect(result.provider).toBe('openrouter');
  });

  it('does nothing when the autohand_inference feature flag is off', async () => {
    const { applyStartupProviderDefaults } = await import('../../src/commands/login.js');

    const result = applyStartupProviderDefaults(baseConfig({
      features: { autohand_inference: false },
      auth: { token: 'ahc_existing_token', user: { id: 'u1', email: 'a@b.com', name: 'A' }, expiresAt: '2030-01-01' },
    }));

    expect(result.provider).toBeUndefined();
  });
});

describe('maybeOfferAutohandAISwitch', () => {
  const AUTH = { token: 'ahc_token', user: { id: 'u1', email: 'a@b.com', name: 'A' }, expiresAt: '2030-01-01' };

  function deps(overrides: Record<string, unknown> = {}) {
    return {
      config: baseConfig({ provider: 'openrouter', openrouter: { apiKey: 'sk-real', baseUrl: 'https://o', model: 'm' }, auth: AUTH }),
      errorCode: 'rate_limited',
      activeProvider: 'openrouter',
      providerLabel: 'OpenRouter',
      isInteractive: true,
      fetchEntitlement: async () => ({ tier: 'free', freeRemaining: 12 }),
      confirm: async () => true,
      persist: async () => {},
      ...overrides,
    };
  }

  it('switches to autohandai and persists when the user accepts', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let persisted: unknown;
    const result = await maybeOfferAutohandAISwitch(deps({ persist: async (c: unknown) => { persisted = c; } }));

    expect(result.provider).toBe('autohandai');
    expect(result.autohandai?.accountToken).toBe('ahc_token');
    expect(result.autohandaiSwitchPromptShown).toBe(true);
    expect((persisted as { provider: string }).provider).toBe('autohandai');
  });

  it('keeps the user\'s provider but still records the prompt as shown when they decline', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    const result = await maybeOfferAutohandAISwitch(deps({ confirm: async () => false }));

    expect(result.provider).toBe('openrouter');
    expect(result.autohandaiSwitchPromptShown).toBe(true);
  });

  it('never fires twice — a config that already shows it dismissed is a no-op', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const config = baseConfig({ provider: 'openrouter', openrouter: { apiKey: 'sk', baseUrl: 'https://o', model: 'm' }, auth: AUTH, autohandaiSwitchPromptShown: true });
    const result = await maybeOfferAutohandAISwitch(deps({ config, confirm: async () => { confirmed = true; return true; } }));

    expect(result.provider).toBe('openrouter');
    expect(confirmed).toBe(false);
  });

  it('ignores non-rate-limit errors', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({ errorCode: 'context_overflow', confirm: async () => { confirmed = true; return true; } }));
    expect(result.provider).toBe('openrouter');
    expect(confirmed).toBe(false);
  });

  it('does not offer to switch to autohandai when it is already the active provider', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({ activeProvider: 'autohandai', confirm: async () => { confirmed = true; return true; } }));
    expect(confirmed).toBe(false);
    expect(result.provider).toBe('openrouter');
  });

  it('does nothing for an anonymous user', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    const config = baseConfig({ provider: 'openrouter', openrouter: { apiKey: 'sk', baseUrl: 'https://o', model: 'm' } });
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({ config, confirm: async () => { confirmed = true; return true; } }));
    expect(confirmed).toBe(false);
    expect(result.provider).toBe('openrouter');
  });

  it('does nothing in a non-interactive session', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({ isInteractive: false, confirm: async () => { confirmed = true; return true; } }));
    expect(confirmed).toBe(false);
    expect(result.provider).toBe('openrouter');
  });

  it('does not offer when Autohand would have no room either (free tier, zero grant)', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({
      fetchEntitlement: async () => ({ tier: 'free', freeRemaining: 0 }),
      confirm: async () => { confirmed = true; return true; },
    }));
    expect(confirmed).toBe(false);
    expect(result.provider).toBe('openrouter');
  });

  it('offers for a paid tier, where freeRemaining is null', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    const result = await maybeOfferAutohandAISwitch(deps({
      fetchEntitlement: async () => ({ tier: 'pro', freeRemaining: null }),
    }));
    expect(result.provider).toBe('autohandai');
  });

  it('does nothing when the entitlement check fails', async () => {
    const { maybeOfferAutohandAISwitch } = await import('../../src/commands/login.js');
    let confirmed = false;
    const result = await maybeOfferAutohandAISwitch(deps({
      fetchEntitlement: async () => { throw new Error('network'); },
      confirm: async () => { confirmed = true; return true; },
    }));
    expect(confirmed).toBe(false);
    expect(result.provider).toBe('openrouter');
  });
});
