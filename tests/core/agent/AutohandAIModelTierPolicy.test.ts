/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../../src/types.js';

function baseConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    features: { autohand_inference: true },
    ...overrides,
  } as LoadedConfig;
}

function cloudMoaConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return baseConfig({
    provider: 'autohandai',
    autohandai: {
      plan: 'cloud',
      authMode: 'account',
      accountToken: 'ahc_token',
      baseUrl: 'https://api.autohand.ai/v1',
      model: 'moa',
      contextWindow: 1000000,
      reasoningEffort: 'high',
    },
    ...overrides,
  });
}

describe('applyAutohandAIModelTierPolicy', () => {
  it('switches moa to fantail for a free-tier account on the autohandai cloud plan', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const result = applyAutohandAIModelTierPolicy(cloudMoaConfig(), 'free');

    expect(result.switched).toBe(true);
    expect(result.config.autohandai?.model).toBe('fantail');
    expect(result.config.autohandai?.contextWindow).toBe(64000);
  });

  it('drops the Moa-only reasoningEffort when switching', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const result = applyAutohandAIModelTierPolicy(cloudMoaConfig(), 'free');

    expect(result.config.autohandai?.reasoningEffort).toBeUndefined();
  });

  it('reports the model the active session must switch to', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const result = applyAutohandAIModelTierPolicy(cloudMoaConfig(), 'free');

    expect(result.switched).toBe(true);
    // runtime.options.model shadows the persisted selection for the active
    // session and lives on AgentRuntime, not on the config, so the caller
    // applies it there.
    expect(result.resolvedModel).toBe('fantail');
  });

  it('reports no model switch when the policy does not apply', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const result = applyAutohandAIModelTierPolicy(cloudMoaConfig(), 'pro');

    expect(result.switched).toBe(false);
    expect(result.resolvedModel).toBeUndefined();
  });

  it('leaves paid-tier accounts on moa untouched', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = cloudMoaConfig();

    const result = applyAutohandAIModelTierPolicy(config, 'pro');

    expect(result.switched).toBe(false);
    expect(result.config).toBe(config);
    expect(result.config.autohandai?.model).toBe('moa');
  });

  it('leaves an unknown tier untouched (fail open, server still enforces)', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = cloudMoaConfig();

    const result = applyAutohandAIModelTierPolicy(config, undefined);

    expect(result.switched).toBe(false);
    expect(result.config).toBe(config);
  });

  it('is a no-op when the free account already runs fantail', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = baseConfig({
      provider: 'autohandai',
      autohandai: {
        plan: 'cloud',
        authMode: 'account',
        accountToken: 'ahc_token',
        baseUrl: 'https://api.autohand.ai/v1',
        model: 'fantail',
        contextWindow: 64000,
      },
    });

    const result = applyAutohandAIModelTierPolicy(config, 'free');

    expect(result.switched).toBe(false);
    expect(result.config).toBe(config);
  });

  it('ignores non-autohandai providers entirely', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = baseConfig({
      provider: 'openrouter',
      openrouter: { apiKey: 'sk-or-key', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5' },
      autohandai: {
        plan: 'cloud',
        authMode: 'account',
        accountToken: 'ahc_token',
        baseUrl: 'https://api.autohand.ai/v1',
        model: 'moa',
        contextWindow: 1000000,
      },
    });

    const result = applyAutohandAIModelTierPolicy(config, 'free');

    expect(result.switched).toBe(false);
    expect(result.config).toBe(config);
  });

  it('ignores the autohandai local plan (local MLX models are tier-agnostic)', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = baseConfig({
      provider: 'autohandai',
      autohandai: {
        plan: 'local',
        baseUrl: 'http://localhost:8080',
        model: 'moa',
        contextWindow: 1000000,
      },
    });

    const result = applyAutohandAIModelTierPolicy(config, 'free');

    expect(result.switched).toBe(false);
    expect(result.config).toBe(config);
  });

  it('matches the namespaced autohandai/moa model id too', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const config = cloudMoaConfig();
    config.autohandai = { ...config.autohandai!, model: 'autohandai/moa' };

    const result = applyAutohandAIModelTierPolicy(config, 'free');

    expect(result.switched).toBe(true);
    expect(result.config.autohandai?.model).toBe('fantail');
  });

  it('is idempotent: a second pass on the switched config is a no-op', async () => {
    const { applyAutohandAIModelTierPolicy } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    const first = applyAutohandAIModelTierPolicy(cloudMoaConfig(), 'free');
    const second = applyAutohandAIModelTierPolicy(first.config, 'free');

    expect(second.switched).toBe(false);
    expect(second.config).toBe(first.config);
  });
});

describe('resolveAutohandAIModelForTier', () => {
  it('returns fantail only for the free tier + moa + autohandai cloud combination', async () => {
    const { resolveAutohandAIModelForTier } = await import('../../../src/core/agent/AutohandAIModelTierPolicy.js');

    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'cloud', model: 'moa', tier: 'free' })).toBe('fantail');
    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'cloud', model: 'autohandai/moa', tier: 'free' })).toBe('fantail');
    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'cloud', model: 'moa', tier: 'pro' })).toBe('moa');
    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'cloud', model: 'fantail', tier: 'free' })).toBe('fantail');
    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'local', model: 'moa', tier: 'free' })).toBe('moa');
    expect(resolveAutohandAIModelForTier({ provider: 'openrouter', plan: 'cloud', model: 'moa', tier: 'free' })).toBe('moa');
    expect(resolveAutohandAIModelForTier({ provider: 'autohandai', plan: 'cloud', model: 'moa', tier: undefined })).toBe('moa');
  });
});
