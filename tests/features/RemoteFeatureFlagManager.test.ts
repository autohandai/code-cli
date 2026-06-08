/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let originalAutohandHome: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-feature-flags-'));
    originalAutohandHome = process.env.AUTOHAND_HOME;
    originalFetch = globalThis.fetch;
    process.env.AUTOHAND_HOME = tmpHome;
  });

  beforeEach(async () => {
    await fs.emptyDir(tmpHome);
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterAll(async () => {
    if (originalAutohandHome === undefined) {
      delete process.env.AUTOHAND_HOME;
    } else {
      process.env.AUTOHAND_HOME = originalAutohandHome;
    }
    globalThis.fetch = originalFetch;
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

  it('drops remote flags scoped to non-CLI clients', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        environment: 'production',
        evaluatedAt: '2026-01-01T00:00:00.000Z',
        ttlSeconds: 300,
        flags: [
          {
            key: 'cli_only',
            enabled: true,
            reason: 'match',
            userOverridable: true,
            clientTypes: ['cli'],
          },
          {
            key: 'web_only',
            enabled: true,
            reason: 'match',
            userOverridable: true,
            clientTypes: ['web'],
          },
        ],
      }),
    });

    const snapshot = await loadRemoteFeatureFlags(makeConfig(), { forceRefresh: true });

    expect(snapshot?.flags.map((flag) => flag.key)).toEqual(['cli_only']);
  });

  it('drops archived and client-mismatched remote flags from cached and downloaded snapshots', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        environment: 'production',
        evaluatedAt: '2026-01-01T00:00:00.000Z',
        ttlSeconds: 300,
        flags: [
          {
            key: 'cli_experiment',
            enabled: true,
            reason: 'match',
            userOverridable: true,
            client_type: 'cli',
          },
          {
            key: 'site_use_cases',
            enabled: false,
            reason: 'client_type mismatch',
            userOverridable: true,
            client_type: 'web',
          },
          {
            key: 'website_use_cases',
            enabled: false,
            reason: 'archived',
            userOverridable: true,
            archived: true,
          },
        ],
      }),
    });

    const snapshot = await loadRemoteFeatureFlags(makeConfig(), { forceRefresh: true });

    expect(snapshot?.flags.map((flag) => flag.key)).toEqual(['cli_experiment']);
  });

  it('sends the CLI client type when evaluating remote flags', async () => {
    const { loadRemoteFeatureFlags } = await import('../../src/features/RemoteFeatureFlagManager.js');
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        flags: [],
      }),
    });

    await loadRemoteFeatureFlags(makeConfig(), { forceRefresh: true });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).searchParams.get('clientType')).toBe('cli');
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
