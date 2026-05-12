/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import type { LoadedConfig } from '../../src/types.js';

function makeConfig(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/autohand-config.json',
    provider: 'openrouter',
    api: { baseUrl: 'https://api.test.local' },
    ...overrides,
  };
}

describe('remote feature flag loading', () => {
  let tmpHome: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-feature-flags-'));
    vi.stubEnv('AUTOHAND_HOME', tmpHome);
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await fs.remove(tmpHome);
  });

  it('downloads feature flags from the API and writes the cache', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    const { AUTOHAND_FILES } = await import('../../src/constants.js');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        environment: 'production',
        evaluatedAt: '2026-01-01T00:00:00.000Z',
        ttlSeconds: 300,
        flags: [{
          key: 'remote_search',
          enabled: true,
          reason: 'match',
          userOverridable: true,
        }],
      }),
    });

    const snapshot = await loadRemoteFeatureFlags(makeConfig(), { forceRefresh: true });

    expect(snapshot?.flags[0]?.key).toBe('remote_search');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/v1/feature-flags/evaluate',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(await fs.pathExists(AUTOHAND_FILES.featureFlagsCache)).toBe(true);
  });

  it('uses a fresh cache without contacting the API', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    const { AUTOHAND_FILES } = await import('../../src/constants.js');
    await fs.ensureDir(path.dirname(AUTOHAND_FILES.featureFlagsCache));
    await fs.writeJson(AUTOHAND_FILES.featureFlagsCache, {
      success: true,
      environment: 'production',
      evaluatedAt: new Date().toISOString(),
      ttlSeconds: 300,
      flags: [{
        key: 'cached_remote_search',
        enabled: true,
        reason: 'cached',
        userOverridable: true,
      }],
    });

    const snapshot = await loadRemoteFeatureFlags(makeConfig());

    expect(snapshot?.flags[0]?.key).toBe('cached_remote_search');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can force a refresh without falling back to cache', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    const { AUTOHAND_FILES } = await import('../../src/constants.js');
    await fs.ensureDir(path.dirname(AUTOHAND_FILES.featureFlagsCache));
    await fs.writeJson(AUTOHAND_FILES.featureFlagsCache, {
      success: true,
      environment: 'production',
      evaluatedAt: new Date().toISOString(),
      ttlSeconds: 300,
      flags: [{
        key: 'cached_remote_search',
        enabled: true,
        reason: 'cached',
        userOverridable: true,
      }],
    });
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    const snapshot = await loadRemoteFeatureFlags(makeConfig(), {
      forceRefresh: true,
      allowCachedFallback: false,
    });

    expect(snapshot).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not let remote flags override local registry feature ids', async () => {
    const { RemoteFeatureFlagManager } = await import('../../src/features/RemoteFeatureFlagManager.js');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        environment: 'production',
        evaluatedAt: '2026-01-01T00:00:00.000Z',
        ttlSeconds: 300,
        flags: [
          {
            key: 'usage_v2',
            enabled: false,
            reason: 'rollout_miss',
            userOverridable: true,
          },
          {
            key: 'remote_disabled',
            enabled: false,
            reason: 'rollout_miss',
            userOverridable: true,
          },
        ],
      }),
    });
    const manager = new RemoteFeatureFlagManager(makeConfig({
      features: {
        usageV2: true,
      },
    }));

    await manager.refreshFeatureFlags();

    expect(manager.isFeatureEnabled('usage_v2', true)).toBe(true);
    expect(manager.isFeatureEnabled('remote_disabled', true)).toBe(false);
  });
});
