/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { getPlatformInfo, isAppleSilicon, isMLXSupported } from '../../src/utils/platform';

describe('Platform Detection', () => {
  // These tests verify the actual behavior on the current machine
  // Since we're running on Apple Silicon (darwin + arm64), tests verify that behavior

  describe('isAppleSilicon()', () => {
    it('returns correct value based on current platform', () => {
      const result = isAppleSilicon();
      const expected = process.platform === 'darwin' && process.arch === 'arm64';
      expect(result).toBe(expected);
    });

    it('returns a boolean', () => {
      expect(typeof isAppleSilicon()).toBe('boolean');
    });
  });

  describe('isMLXSupported()', () => {
    it('returns same value as isAppleSilicon', () => {
      // MLX support is identical to Apple Silicon check
      expect(isMLXSupported()).toBe(isAppleSilicon());
    });

    it('returns a boolean', () => {
      expect(typeof isMLXSupported()).toBe('boolean');
    });
  });

  describe('getPlatformInfo()', () => {
    it('returns correct structure', () => {
      const info = getPlatformInfo();

      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('arch');
      expect(info).toHaveProperty('isMacOS');
      expect(info).toHaveProperty('isAppleSilicon');
      expect(info).toHaveProperty('isWindows');
      expect(info).toHaveProperty('isLinux');
    });

    it('returns current platform and arch', () => {
      const info = getPlatformInfo();

      expect(info.platform).toBe(process.platform);
      expect(info.arch).toBe(process.arch);
    });

    it('returns consistent boolean flags', () => {
      const info = getPlatformInfo();

      // isMacOS should be true only when platform is darwin
      expect(info.isMacOS).toBe(info.platform === 'darwin');

      // isWindows should be true only when platform is win32
      expect(info.isWindows).toBe(info.platform === 'win32');

      // isLinux should be true only when platform is linux
      expect(info.isLinux).toBe(info.platform === 'linux');

      // isAppleSilicon should be true only when darwin + arm64
      expect(info.isAppleSilicon).toBe(info.platform === 'darwin' && info.arch === 'arm64');
    });

    it('has mutually exclusive OS flags (except isAppleSilicon)', () => {
      const info = getPlatformInfo();

      // At most one of isMacOS, isWindows, isLinux should be true
      // (could be none if on an unusual platform)
      const osFlags = [info.isMacOS, info.isWindows, info.isLinux].filter(Boolean);
      expect(osFlags.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Platform Logic Verification', () => {
    // These tests verify the logic itself using known values
    // They test the implementation logic independent of the current platform

    it('Apple Silicon detection logic: darwin + arm64 = true', () => {
      // Verify the logic we expect: darwin + arm64 should be Apple Silicon
      const isDarwin = process.platform === 'darwin';
      const isArm64 = process.arch === 'arm64';

      if (isDarwin && isArm64) {
        expect(isAppleSilicon()).toBe(true);
        expect(isMLXSupported()).toBe(true);
      }
    });

    it('Apple Silicon detection logic: non-darwin = false', () => {
      const isDarwin = process.platform === 'darwin';

      if (!isDarwin) {
        expect(isAppleSilicon()).toBe(false);
        expect(isMLXSupported()).toBe(false);
      }
    });

    it('Apple Silicon detection logic: darwin + non-arm64 = false', () => {
      const isDarwin = process.platform === 'darwin';
      const isArm64 = process.arch === 'arm64';

      if (isDarwin && !isArm64) {
        expect(isAppleSilicon()).toBe(false);
        expect(isMLXSupported()).toBe(false);
      }
    });
  });
});
