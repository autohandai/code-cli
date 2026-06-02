/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import {
  FEATURE_REGISTRY,
  formatFeatureList,
  getFeatureState,
  isTokenUsageStatusEnabled,
  listFeatureStates,
  setFeatureState,
} from '../../src/features/featureRegistry.js';

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    ...overrides,
  };
}

describe('feature registry', () => {
  it('lists real config-backed features with stable ids', () => {
    const ids = FEATURE_REGISTRY.map((feature) => feature.id);

    expect(ids).toContain('mcp');
    expect(ids).toContain('hooks');
    expect(ids).toContain('prompt_suggestions');
    expect(ids).toContain('request_queue');
    expect(ids).toContain('usage_v2');
    expect(ids).toContain('slash_goal');
    expect(ids).toContain('experimental_fork');
    expect(ids).toContain('experimental_clone');
    expect(ids).toContain('chrome_integration');
  });

  it('reads default enabled state when config omits a feature path', () => {
    const config = makeConfig();

    expect(getFeatureState(config, 'mcp')?.enabled).toBe(true);
    expect(getFeatureState(config, 'chrome_integration')?.enabled).toBe(false);
    expect(getFeatureState(config, 'slash_goal')?.enabled).toBe(false);
    expect(getFeatureState(config, 'experimental_fork')?.enabled).toBe(false);
    expect(getFeatureState(config, 'experimental_clone')?.enabled).toBe(false);
  });

  it('updates nested config paths without disturbing adjacent settings', () => {
    const config = makeConfig({
      ui: {
        theme: 'dark',
        promptSuggestions: true,
      },
    });

    const result = setFeatureState(config, 'prompt_suggestions', false);

    expect(result.ok).toBe(true);
    expect(config.ui?.theme).toBe('dark');
    expect(config.ui?.promptSuggestions).toBe(false);
  });

  it('renders a codex-style feature list table', () => {
    const output = formatFeatureList(makeConfig({
      mcp: { enabled: false },
      hooks: { enabled: true, hooks: [] },
    }));

    expect(output).toContain('mcp');
    expect(output).toContain('stable');
    expect(output).toContain('false');
    expect(output).toContain('hooks');
    expect(output).toContain('true');
  });

  it('merges remote flags and applies local opt-outs only as disable overrides', () => {
    const config = makeConfig({
      features: {
        remoteOverrides: { remote_search: 'off' },
      },
    });
    const remoteSnapshot = {
      success: true as const,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'remote_search',
        enabled: true,
        reason: 'match',
        userOverridable: true,
      }],
    };

    expect(getFeatureState(config, 'remote_search', { remoteSnapshot })?.enabled).toBe(false);

    const enableResult = setFeatureState(config, 'remote_search', true, { remoteSnapshot });
    expect(enableResult.ok).toBe(true);
    expect(config.features?.remoteOverrides?.remote_search).toBeUndefined();
    expect(getFeatureState(config, 'remote_search', { remoteSnapshot })?.enabled).toBe(true);
  });

  it('keeps local registry features authoritative when remote flags reuse their ids', () => {
    const config = makeConfig({
      features: {
        usageV2: true,
      },
    });
    const remoteSnapshot = {
      success: true as const,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'usage_v2',
        enabled: false,
        reason: 'rollout_miss',
        userOverridable: true,
      }],
    };

    expect(getFeatureState(config, 'usage_v2', { remoteSnapshot })).toEqual(expect.objectContaining({
      enabled: true,
      source: 'local',
      configPath: 'features.usageV2',
    }));
    expect(listFeatureStates(config, { remoteSnapshot }).filter((feature) => feature.id === 'usage_v2')).toHaveLength(1);
  });

  it('filters remote flags scoped to other clients out of CLI feature states', () => {
    const config = makeConfig();
    const remoteSnapshot = {
      success: true as const,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [
        {
          key: 'cli_experiment',
          enabled: true,
          reason: 'match',
          userOverridable: true,
          clientTypes: ['cli'],
        },
        {
          key: 'website_experiment',
          enabled: true,
          reason: 'match',
          userOverridable: true,
          clientTypes: ['web'],
        },
      ],
    };

    const ids = listFeatureStates(config, { remoteSnapshot }).map((feature) => feature.id);

    expect(ids).toContain('cli_experiment');
    expect(ids).not.toContain('website_experiment');
    expect(getFeatureState(config, 'website_experiment', { remoteSnapshot })).toBeUndefined();
  });

  it('filters archived and client-mismatched remote flags out of experiment states', () => {
    const config = makeConfig();
    const remoteSnapshot = {
      success: true as const,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [
        {
          key: 'cli_experiment',
          enabled: true,
          reason: 'match',
          userOverridable: true,
          clientTypes: ['cli'],
        },
        {
          key: 'site_use_cases',
          enabled: false,
          reason: 'client_type mismatch',
          userOverridable: true,
        },
        {
          key: 'website_use_cases',
          enabled: false,
          reason: 'archived',
          userOverridable: true,
        },
      ],
    };

    const ids = listFeatureStates(config, { remoteSnapshot }).map((feature) => feature.id);

    expect(ids).toContain('cli_experiment');
    expect(ids).not.toContain('site_use_cases');
    expect(ids).not.toContain('website_use_cases');
    expect(getFeatureState(config, 'site_use_cases', { remoteSnapshot })).toBeUndefined();
    expect(getFeatureState(config, 'website_use_cases', { remoteSnapshot })).toBeUndefined();
  });

  it('enables slash_goal through the local feature config path', () => {
    const config = makeConfig();

    const result = setFeatureState(config, 'slash_goal', true);

    expect(result.ok).toBe(true);
    expect(config.features?.slashGoal).toBe(true);
    expect(getFeatureState(config, 'slash_goal')?.enabled).toBe(true);
  });

  it('enables experimental fork and clone through local feature config paths', () => {
    const config = makeConfig();

    const forkResult = setFeatureState(config, 'experimental_fork', true);
    const cloneResult = setFeatureState(config, 'experimental_clone', true);

    expect(forkResult.ok).toBe(true);
    expect(cloneResult.ok).toBe(true);
    expect(config.features?.experimentalFork).toBe(true);
    expect(config.features?.experimentalClone).toBe(true);
    expect(getFeatureState(config, 'experimental_fork')?.enabled).toBe(true);
    expect(getFeatureState(config, 'experimental_clone')?.enabled).toBe(true);
  });

  it('does not let users force-enable a remotely disabled flag', () => {
    const config = makeConfig({
      features: {
        remoteOverrides: { remote_disabled: 'off' },
      },
    });
    const remoteSnapshot = {
      success: true as const,
      environment: 'production',
      evaluatedAt: '2026-01-01T00:00:00.000Z',
      ttlSeconds: 300,
      flags: [{
        key: 'remote_disabled',
        enabled: false,
        reason: 'rollout_miss',
        userOverridable: true,
      }],
    };

    const result = setFeatureState(config, 'remote_disabled', true, { remoteSnapshot });

    expect(result.ok).toBe(true);
    expect(config.features?.remoteOverrides?.remote_disabled).toBeUndefined();
    expect(getFeatureState(config, 'remote_disabled', { remoteSnapshot })?.enabled).toBe(false);
  });

  it('registers token_usage_status as an experimental, default-off flag', () => {
    const definition = FEATURE_REGISTRY.find((feature) => feature.id === 'token_usage_status');
    expect(definition).toBeDefined();
    expect(definition?.stage).toBe('experimental');
    expect(definition?.defaultEnabled).toBe(false);
    expect(definition?.configPath).toBe('features.tokenUsageStatus');
  });

  it('enables token_usage_status through the local feature config path', () => {
    const config = makeConfig();

    const result = setFeatureState(config, 'token_usage_status', true);

    expect(result.ok).toBe(true);
    expect(config.features?.tokenUsageStatus).toBe(true);
    expect(getFeatureState(config, 'token_usage_status')?.enabled).toBe(true);
  });
});

describe('isTokenUsageStatusEnabled', () => {
  it('defaults to off', () => {
    expect(isTokenUsageStatusEnabled(makeConfig())).toBe(false);
    expect(isTokenUsageStatusEnabled(null)).toBe(false);
    expect(isTokenUsageStatusEnabled(undefined)).toBe(false);
  });

  it('reflects the config flag when set', () => {
    expect(isTokenUsageStatusEnabled(makeConfig({ features: { tokenUsageStatus: true } }))).toBe(true);
    expect(isTokenUsageStatusEnabled(makeConfig({ features: { tokenUsageStatus: false } }))).toBe(false);
  });
});
