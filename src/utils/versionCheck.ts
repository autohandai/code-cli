/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const GITHUB_REPO = 'autohandai/code-cli';
const GITHUB_API_LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_API_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`;
const CACHE_DIR = path.join(os.homedir(), '.autohand');
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const REQUEST_TIMEOUT_MS = 3000;

export type ReleaseChannel = 'stable' | 'alpha';

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  isUpToDate: boolean;
  updateAvailable: boolean;
  releaseUrl?: string;
  channel: ReleaseChannel;
  error?: string;
}

interface VersionCache {
  lastCheck: string;
  latestVersion: string;
  releaseUrl: string;
}

/**
 * Detect release channel from version string.
 * Versions containing "-alpha." are on the alpha channel.
 */
export function detectChannel(version: string): ReleaseChannel {
  return version.includes('-alpha.') ? 'alpha' : 'stable';
}

/**
 * Get the cache file path for a given channel.
 */
function getCacheFile(channel: ReleaseChannel): string {
  return path.join(CACHE_DIR, `version-check-${channel}.json`);
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  // Strip leading 'v' if present
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  // Split into parts and handle pre-release tags
  const [versionA, preA] = cleanA.split('-');
  const [versionB, preB] = cleanB.split('-');

  const partsA = versionA.split('.').map(Number);
  const partsB = versionB.split('.').map(Number);

  // Compare major.minor.patch
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }

  // If versions are equal, check pre-release
  // A version without pre-release is greater than one with
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  if (preA && preB) {
    return preA.localeCompare(preB);
  }

  return 0;
}

/**
 * Read cached version check result
 */
async function readCache(channel: ReleaseChannel): Promise<VersionCache | null> {
  try {
    const cacheFile = getCacheFile(channel);
    if (await fs.pathExists(cacheFile)) {
      const data = await fs.readJson(cacheFile);
      return data as VersionCache;
    }
  } catch {
    // Ignore cache read errors
  }
  return null;
}

/**
 * Write version check result to cache
 */
async function writeCache(channel: ReleaseChannel, cache: VersionCache): Promise<void> {
  try {
    const cacheFile = getCacheFile(channel);
    await fs.ensureDir(path.dirname(cacheFile));
    await fs.writeJson(cacheFile, cache, { spaces: 2 });
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Check if cache is still valid based on interval
 */
function isCacheValid(cache: VersionCache, intervalHours: number): boolean {
  try {
    const lastCheck = new Date(cache.lastCheck);
    const now = new Date();
    const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);
    return hoursSinceCheck < intervalHours;
  } catch {
    return false;
  }
}

/**
 * Fetch latest stable release from GitHub API (uses /releases/latest)
 */
async function fetchLatestStableRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(GITHUB_API_LATEST_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'autohand-cli',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { tag_name?: string; html_url?: string };

    if (data.tag_name) {
      return {
        version: data.tag_name.replace(/^v/, ''),
        url: data.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${data.tag_name}`,
      };
    }
  } catch {
    // Network error, timeout, or abort - silently fail
  }
  return null;
}

/**
 * Fetch latest alpha (prerelease) from GitHub API
 */
async function fetchLatestAlphaRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(GITHUB_API_RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'autohand-cli',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const releases = await response.json() as Array<{
      tag_name?: string;
      html_url?: string;
      prerelease?: boolean;
    }>;

    for (const release of releases) {
      if (release.prerelease && release.tag_name) {
        return {
          version: release.tag_name.replace(/^v/, ''),
          url: release.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}`,
        };
      }
    }
  } catch {
    // Network error, timeout, or abort - silently fail
  }
  return null;
}

/**
 * Get the install command hint for a given channel
 */
export function getInstallHint(channel: ReleaseChannel): string {
  if (channel === 'alpha') {
    return 'curl -fsSL https://autohand.ai/install.sh | sh -s -- --alpha';
  }
  return 'curl -fsSL https://autohand.ai/install.sh | sh';
}

/**
 * Check for updates against GitHub releases
 *
 * @param currentVersion - Current CLI version from package.json
 * @param options - Configuration options
 * @returns Version check result
 */
export async function checkForUpdates(
  currentVersion: string,
  options: {
    checkIntervalHours?: number;
    forceCheck?: boolean;
  } = {}
): Promise<VersionCheckResult> {
  const {
    checkIntervalHours = DEFAULT_CHECK_INTERVAL_HOURS,
    forceCheck = false,
  } = options;

  const channel = detectChannel(currentVersion);

  const result: VersionCheckResult = {
    currentVersion,
    latestVersion: null,
    isUpToDate: true,
    updateAvailable: false,
    channel,
  };

  // Skip if disabled via environment variable
  if (process.env.AUTOHAND_SKIP_UPDATE_CHECK === '1') {
    return result;
  }

  try {
    // Check cache first (unless forcing)
    if (!forceCheck) {
      const cache = await readCache(channel);
      if (cache && isCacheValid(cache, checkIntervalHours)) {
        result.latestVersion = cache.latestVersion;
        result.releaseUrl = cache.releaseUrl;
        const comparison = compareVersions(currentVersion, cache.latestVersion);
        result.isUpToDate = comparison >= 0;
        result.updateAvailable = comparison < 0;
        return result;
      }
    }

    // Fetch from GitHub based on channel
    const latest = channel === 'alpha'
      ? await fetchLatestAlphaRelease()
      : await fetchLatestStableRelease();

    if (latest) {
      result.latestVersion = latest.version;
      result.releaseUrl = latest.url;

      const comparison = compareVersions(currentVersion, latest.version);
      result.isUpToDate = comparison >= 0;
      result.updateAvailable = comparison < 0;

      // Update cache
      await writeCache(channel, {
        lastCheck: new Date().toISOString(),
        latestVersion: latest.version,
        releaseUrl: latest.url,
      });
    }
  } catch (error) {
    // Don't fail startup due to version check errors
    result.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return result;
}

/**
 * Clear the version check cache for all channels
 */
export async function clearVersionCache(): Promise<void> {
  try {
    for (const channel of ['stable', 'alpha'] as ReleaseChannel[]) {
      const cacheFile = getCacheFile(channel);
      if (await fs.pathExists(cacheFile)) {
        await fs.remove(cacheFile);
      }
    }
    // Also clean up legacy cache file
    const legacyCacheFile = path.join(CACHE_DIR, 'version-check.json');
    if (await fs.pathExists(legacyCacheFile)) {
      await fs.remove(legacyCacheFile);
    }
  } catch {
    // Ignore errors
  }
}
