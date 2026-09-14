/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdates,
  evaluateUpdateStatus,
  selectLatestPrereleaseRelease,
} from '../../src/utils/versionCheck.js';

describe('versionCheck prerelease selection', () => {
  it('selects the newest prerelease by published_at when API order is not chronological', () => {
    const releases = [
      {
        tag_name: 'v0.7.15-alpha.f3027a4',
        prerelease: true,
        published_at: '2026-02-17T08:58:33Z',
      },
      {
        tag_name: 'v0.7.15-alpha.6c4b609',
        prerelease: true,
        published_at: '2026-02-17T22:56:51Z',
      },
      {
        tag_name: 'v0.7.14',
        prerelease: false,
        published_at: '2026-02-11T16:41:25Z',
      },
    ];

    const selected = selectLatestPrereleaseRelease(releases);
    expect(selected?.tag_name).toBe('v0.7.15-alpha.6c4b609');
  });

  it('falls back to created_at when published_at is missing', () => {
    const releases = [
      {
        tag_name: 'v0.7.15-alpha.1111111',
        prerelease: true,
        created_at: '2026-02-17T10:00:00Z',
      },
      {
        tag_name: 'v0.7.15-alpha.2222222',
        prerelease: true,
        created_at: '2026-02-17T11:00:00Z',
      },
    ];

    const selected = selectLatestPrereleaseRelease(releases);
    expect(selected?.tag_name).toBe('v0.7.15-alpha.2222222');
  });

  it('returns null when no prerelease is present', () => {
    const selected = selectLatestPrereleaseRelease([
      { tag_name: 'v0.7.14', prerelease: false, published_at: '2026-02-11T16:41:25Z' },
    ]);

    expect(selected).toBeNull();
  });
});

describe('evaluateUpdateStatus', () => {
  it('treats alpha versions as up to date only when exactly equal', () => {
    const status = evaluateUpdateStatus(
      '0.7.15-alpha.f3027a4',
      '0.7.15-alpha.6c4b609',
      'alpha'
    );

    expect(status.isUpToDate).toBe(false);
    expect(status.updateAvailable).toBe(true);
  });

  it('uses semver comparison rules for stable versions', () => {
    const status = evaluateUpdateStatus('0.7.14', '0.7.15', 'stable');

    expect(status.isUpToDate).toBe(false);
    expect(status.updateAvailable).toBe(true);
  });
});

describe('checkForUpdates request timeout handling', () => {
  const originalFetch = globalThis.fetch;
  const originalSkip = process.env.AUTOHAND_SKIP_UPDATE_CHECK;

  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.AUTOHAND_SKIP_UPDATE_CHECK;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    if (originalSkip === undefined) {
      delete process.env.AUTOHAND_SKIP_UPDATE_CHECK;
    } else {
      process.env.AUTOHAND_SKIP_UPDATE_CHECK = originalSkip;
    }
  });

  it.each(['0.8.2', '0.8.2-alpha.abc1234'])(
    'leaves no abort timer behind when the release fetch rejects for %s',
    async (currentVersion) => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error('offline');
      }) as typeof fetch;

      const result = await checkForUpdates(currentVersion, { forceCheck: true });

      expect(result.latestVersion).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
