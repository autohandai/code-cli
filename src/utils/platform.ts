/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Platform detection utilities for Apple Silicon and other platform-specific features
 */

import os from 'node:os';
import { spawnSync } from 'node:child_process';

const BYTES_PER_GB = 1024 ** 3;

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

/**
 * Total physical memory in gigabytes. On Apple Silicon this is the unified
 * memory pool shared by CPU and GPU, which is the real ceiling for how large a
 * model MLX can load.
 */
export function getTotalMemoryGb(): number {
  return os.totalmem() / BYTES_PER_GB;
}

/**
 * Currently free physical memory in gigabytes. Note macOS reports only truly
 * free pages here (excluding reclaimable cache), so it under-reports what is
 * usable; treat it as a lower bound, not the capacity ceiling.
 */
export function getFreeMemoryGb(): number {
  return os.freemem() / BYTES_PER_GB;
}

/**
 * Realistically usable memory in gigabytes. On macOS `os.freemem()` excludes
 * reclaimable pages and badly under-reports, so we parse `vm_stat` and sum the
 * pages the kernel can hand to a new process (free + inactive + speculative +
 * purgeable). Falls back to {@link getFreeMemoryGb} off macOS or on any parse
 * failure.
 */
export function getAvailableMemoryGb(): number {
  if (process.platform === 'darwin') {
    try {
      const result = spawnSync('vm_stat', [], { encoding: 'utf8', timeout: 5000 });
      if (result.status === 0 && typeof result.stdout === 'string') {
        const out = result.stdout;
        const pageSize = Number(out.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
        const pages = (name: string): number =>
          Number(out.match(new RegExp(`Pages ${name}:\\s+(\\d+)`))?.[1] ?? 0);
        const availablePages =
          pages('free') + pages('inactive') + pages('speculative') + pages('purgeable');
        if (Number.isFinite(pageSize) && availablePages > 0) {
          return (availablePages * pageSize) / BYTES_PER_GB;
        }
      }
    } catch {
      // Fall through to the freemem lower bound.
    }
  }
  return getFreeMemoryGb();
}
