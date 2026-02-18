/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
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
