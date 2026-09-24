/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  deriveNextAlphaVersion,
  resolveRuntimeVersion,
  selectLatestStableRepositoryVersion,
} from '../../src/utils/runtimeVersion.js';

describe('runtimeVersion', () => {
  it('selects the highest stable semantic version from repository tags', () => {
    const version = selectLatestStableRepositoryVersion([
      'v0.9.3-alpha.f910b60',
      'v0.9.2',
      'v0.10.0',
      'v0.9.10',
      'vv99.0.0',
      'release-100.0.0',
    ]);

    expect(version).toBe('0.10.0');
  });

  it('derives the next alpha version from the latest stable tag and current commit', () => {
    const readRepositoryTags = vi.fn(() => ['v0.9.1', 'v0.9.2']);
    const readRepositoryCommit = vi.fn(() => 'abcdef0123456789');

    const version = resolveRuntimeVersion({
      manifestVersion: '0.8.3',
      versionSource: 'git',
      readRepositoryTags,
      readRepositoryCommit,
    });

    expect(version).toBe('0.9.3-alpha.abcdef0');
    expect(readRepositoryTags).toHaveBeenCalledOnce();
    expect(readRepositoryCommit).toHaveBeenCalledOnce();
  });

  it('uses an embedded build version before the package manifest or repository', () => {
    const readRepositoryTags = vi.fn(() => ['v0.9.8']);

    expect(resolveRuntimeVersion({
      manifestVersion: '0.8.2',
      buildVersion: '0.9.9-alpha.1234abc',
      versionSource: 'git',
      readRepositoryTags,
    })).toBe('0.9.9-alpha.1234abc');
    expect(readRepositoryTags).not.toHaveBeenCalled();
  });

  it('increments only the patch component for alpha builds', () => {
    expect(deriveNextAlphaVersion('0.9.8', 'ABCDEF012345')).toBe('0.9.9-alpha.abcdef0');
  });

  it('keeps the packaged manifest version unless repository lookup is explicitly enabled', () => {
    const readRepositoryTags = vi.fn(() => ['v0.9.2']);

    // The env var is an implicit version source; neutralize any ambient value
    // (e.g. when the suite runs inside an Autohand session) so the test stays
    // hermetic and asserts the no-explicit-source contract.
    const originalVersionSource = process.env.AUTOHAND_VERSION_SOURCE;
    delete process.env.AUTOHAND_VERSION_SOURCE;

    try {
      const version = resolveRuntimeVersion({
        manifestVersion: '0.8.3',
        readRepositoryTags,
      });

      expect(version).toBe('0.8.3');
      expect(readRepositoryTags).not.toHaveBeenCalled();
    } finally {
      if (originalVersionSource === undefined) {
        delete process.env.AUTOHAND_VERSION_SOURCE;
      } else {
        process.env.AUTOHAND_VERSION_SOURCE = originalVersionSource;
      }
    }
  });

  it('falls back to the manifest version when repository tags are unavailable', () => {
    const version = resolveRuntimeVersion({
      manifestVersion: '0.8.3',
      versionSource: 'git',
      readRepositoryTags: () => {
        throw new Error('git is unavailable');
      },
    });

    expect(version).toBe('0.8.3');
  });
});
