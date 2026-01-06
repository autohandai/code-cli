/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'path';
import os from 'os';

const GITHUB_API_URL = 'https://api.github.com/repos/autohandai/code-cli/releases/latest';
const CACHE_FILE = path.join(os.homedir(), '.autohand', 'version-check.json');
const DEFAULT_CHECK_INTERVAL_HOURS = 24;
const REQUEST_TIMEOUT_MS = 3000;

export interface VersionCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  isUpToDate: boolean;
  updateAvailable: boolean;
  releaseUrl?: string;
  error?: string;
}

interface VersionCache {
  lastCheck: string;
  latestVersion: string;
  releaseUrl: string;
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
async function readCache(): Promise<VersionCache | null> {
  try {
    if (await fs.pathExists(CACHE_FILE)) {
      const data = await fs.readJson(CACHE_FILE);
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
async function writeCache(cache: VersionCache): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(CACHE_FILE));
    await fs.writeJson(CACHE_FILE, cache, { spaces: 2 });
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
 * Fetch latest release from GitHub API
 */
async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(GITHUB_API_URL, {
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
        url: data.html_url || `https://github.com/autohandai/code-cli/releases/tag/${data.tag_name}`,
      };
    }
  } catch {
    // Network error, timeout, or abort - silently fail
  }
  return null;
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

  const result: VersionCheckResult = {
    currentVersion,
    latestVersion: null,
    isUpToDate: true,
    updateAvailable: false,
  };

  // Skip if disabled via environment variable
  if (process.env.AUTOHAND_SKIP_UPDATE_CHECK === '1') {
    return result;
  }

  try {
    // Check cache first (unless forcing)
    if (!forceCheck) {
      const cache = await readCache();
      if (cache && isCacheValid(cache, checkIntervalHours)) {
        result.latestVersion = cache.latestVersion;
        result.releaseUrl = cache.releaseUrl;
        const comparison = compareVersions(currentVersion, cache.latestVersion);
        result.isUpToDate = comparison >= 0;
        result.updateAvailable = comparison < 0;
        return result;
      }
    }

    // Fetch from GitHub
    const latest = await fetchLatestRelease();

    if (latest) {
      result.latestVersion = latest.version;
      result.releaseUrl = latest.url;

      const comparison = compareVersions(currentVersion, latest.version);
      result.isUpToDate = comparison >= 0;
      result.updateAvailable = comparison < 0;

      // Update cache
      await writeCache({
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
 * Clear the version check cache
 */
export async function clearVersionCache(): Promise<void> {
  try {
    if (await fs.pathExists(CACHE_FILE)) {
      await fs.remove(CACHE_FILE);
    }
  } catch {
    // Ignore errors
  }
}
