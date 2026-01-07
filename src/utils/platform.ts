/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform detection utilities for Apple Silicon and other platform-specific features
 */

export interface PlatformInfo {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  isMacOS: boolean;
  isAppleSilicon: boolean;
  isWindows: boolean;
  isLinux: boolean;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const platform = process.platform;
  const arch = process.arch;

  return {
    platform,
    arch,
    isMacOS: platform === 'darwin',
    isAppleSilicon: platform === 'darwin' && arch === 'arm64',
    isWindows: platform === 'win32',
    isLinux: platform === 'linux'
  };
}

/**
 * Check if running on Apple Silicon (M1, M2, M3, etc.)
 * Returns true only on macOS with ARM64 architecture
 */
export function isAppleSilicon(): boolean {
  return process.platform === 'darwin' && process.arch === 'arm64';
}

/**
 * Check if MLX is supported on this platform
 * MLX only works on macOS with Apple Silicon
 */
export function isMLXSupported(): boolean {
  return isAppleSilicon();
}
