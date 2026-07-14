/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * CommunitySkillsCache - TTL-based caching for community skills registry
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_HOME } from '../constants.js';
import type {
  CommunitySkillsRegistry,
  CachedRegistry,
  SkillsCacheConfig,
} from '../types.js';
import {
  assertCommunityPathSymlinkSafe,
  resolveContainedCommunityPath,
  validateCommunityRelativePath,
  validateCommunitySkillFileMap,
  validateCommunitySkillIdentifier,
  validateCommunitySkillsRegistry,
} from './communitySkillPaths.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_SKILLS_CACHE = 50;

/**
 * TTL-based cache for community skills registry and skill bodies
 */
export class CommunitySkillsCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly maxSkillsCache: number;

  constructor(config: SkillsCacheConfig = {}) {
    this.cacheDir = config.cacheDir || path.join(AUTOHAND_HOME, 'community-skills', 'cache');
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this.maxSkillsCache = config.maxSkillsCache ?? DEFAULT_MAX_SKILLS_CACHE;
  }

  /**
   * Get the cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Get cached registry if it exists and is not expired
   */
  async getRegistry(): Promise<CommunitySkillsRegistry | null> {
    const cached = await this.readCachedRegistry();
    if (!cached) return null;

    // Check if cache is expired
    if (Date.now() - cached.fetchedAt >= this.ttlMs) {
      return null;
    }

    return cached.registry;
  }

  /**
   * Get cached registry ignoring TTL (for offline fallback)
   */
  async getRegistryIgnoreTTL(): Promise<CommunitySkillsRegistry | null> {
    const cached = await this.readCachedRegistry();
    return cached?.registry || null;
  }

  /**
   * Get cache age in milliseconds, or null if no cache exists
   */
  async getCacheAge(): Promise<number | null> {
    const cached = await this.readCachedRegistry();
    if (!cached) return null;
    return Date.now() - cached.fetchedAt;
  }

  /**
   * Check if cache is expired
   */
  async isExpired(): Promise<boolean> {
    const age = await this.getCacheAge();
    if (age === null) return true;
    return age >= this.ttlMs;
  }

  /**
   * Save registry to cache
   */
  async setRegistry(registry: CommunitySkillsRegistry, etag?: string): Promise<void> {
    const validatedRegistry = validateCommunitySkillsRegistry(registry);
    const cached: CachedRegistry = {
      registry: validatedRegistry,
      fetchedAt: Date.now(),
      etag,
    };

    await assertCommunityPathSymlinkSafe(this.cacheDir, this.registryPath, 'registry cache path');
    await fs.ensureDir(this.cacheDir);
    await fs.writeJson(this.registryPath, cached, { spaces: 2 });
  }

  /**
   * Get a cached skill body by skill ID
   */
  async getSkillBody(skillId: string): Promise<string | null> {
    const validatedId = validateCommunitySkillIdentifier(skillId, 'community skill cache id');
    const skillPath = this.getSkillBodyPath(validatedId);

    try {
      await assertCommunityPathSymlinkSafe(this.cacheDir, skillPath, 'community skill body cache path');
      if (await fs.pathExists(skillPath)) {
        return await fs.readFile(skillPath, 'utf-8');
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Cache a skill body
   */
  async setSkillBody(skillId: string, body: string): Promise<void> {
    const validatedId = validateCommunitySkillIdentifier(skillId, 'community skill cache id');
    if (typeof body !== 'string') {
      throw new Error('Invalid community skill body cache content');
    }
    const skillsDir = path.join(this.cacheDir, 'skills');
    const skillPath = this.getSkillBodyPath(validatedId);
    await assertCommunityPathSymlinkSafe(this.cacheDir, skillPath, 'community skill body cache path');

    // Enforce max cache size
    await this.enforceMaxSkillsCache();

    await fs.ensureDir(skillsDir);
    await fs.writeFile(skillPath, body, 'utf-8');
  }

  /**
   * Get cached skill directory files
   * Returns Map of relative paths to contents, or null if not cached
   */
  async getSkillDirectory(skillId: string): Promise<Map<string, string> | null> {
    const validatedId = validateCommunitySkillIdentifier(skillId, 'community skill cache id');
    const skillCacheDir = this.getSkillDirectoryPath(validatedId);

    try {
      await assertCommunityPathSymlinkSafe(
        this.cacheDir,
        skillCacheDir,
        'community skill directory cache path'
      );
      if (!(await fs.pathExists(skillCacheDir))) {
        return null;
      }
      const files = new Map<string, string>();
      await this.readDirRecursive(skillCacheDir, skillCacheDir, files);
      return files.size > 0 ? validateCommunitySkillFileMap(files) : null;
    } catch {
      return null;
    }
  }

  /**
   * Cache a skill directory with all its files
   */
  async setSkillDirectory(skillId: string, files: Map<string, string>): Promise<void> {
    const validatedId = validateCommunitySkillIdentifier(skillId, 'community skill cache id');
    const validatedFiles = validateCommunitySkillFileMap(files);
    const skillCacheDir = this.getSkillDirectoryPath(validatedId);
    const destinations = [...validatedFiles.keys()].map((relativePath) => (
      resolveContainedCommunityPath(skillCacheDir, relativePath, 'community skill cache file')
    ));

    await assertCommunityPathSymlinkSafe(
      this.cacheDir,
      skillCacheDir,
      'community skill directory cache path'
    );
    await Promise.all(destinations.map((destination) => (
      assertCommunityPathSymlinkSafe(
        skillCacheDir,
        destination,
        'community skill cache file path'
      )
    )));

    // Enforce max cache size
    await this.enforceMaxSkillsCache();

    // Remove old cache for this skill if exists
    await fs.remove(skillCacheDir);

    // Write all files
    for (const [relativePath, content] of validatedFiles) {
      const fullPath = resolveContainedCommunityPath(
        skillCacheDir,
        relativePath,
        'community skill cache file'
      );
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content, 'utf-8');
    }
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    await fs.remove(this.cacheDir);
  }

  /**
   * Clear only the registry cache (keep skill bodies)
   */
  async clearRegistry(): Promise<void> {
    await assertCommunityPathSymlinkSafe(this.cacheDir, this.registryPath, 'registry cache path');
    await fs.remove(this.registryPath);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    hasRegistry: boolean;
    registryAge: number | null;
    isExpired: boolean;
    cachedSkillCount: number;
  }> {
    const skillsDir = path.join(this.cacheDir, 'skills');
    let cachedSkillCount = 0;

    try {
      await assertCommunityPathSymlinkSafe(this.cacheDir, skillsDir, 'community skills cache path');
      if (await fs.pathExists(skillsDir)) {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        cachedSkillCount = entries.filter((entry) => !entry.isSymbolicLink()).length;
      }
    } catch {
      cachedSkillCount = 0;
    }

    const cached = await this.readCachedRegistry();
    const registryAge = cached ? Date.now() - cached.fetchedAt : null;

    return {
      hasRegistry: cached !== null,
      registryAge,
      isExpired: registryAge !== null ? registryAge >= this.ttlMs : true,
      cachedSkillCount,
    };
  }

  // ========== Private Methods ==========

  private get registryPath(): string {
    return path.join(this.cacheDir, 'registry.json');
  }

  private getSkillBodyPath(skillId: string): string {
    return resolveContainedCommunityPath(
      path.join(this.cacheDir, 'skills'),
      `${skillId}.md`,
      'community skill body cache path'
    );
  }

  private getSkillDirectoryPath(skillId: string): string {
    return resolveContainedCommunityPath(
      path.join(this.cacheDir, 'skills'),
      skillId,
      'community skill directory cache path'
    );
  }

  private async readCachedRegistry(): Promise<CachedRegistry | null> {
    try {
      await assertCommunityPathSymlinkSafe(this.cacheDir, this.registryPath, 'registry cache path');
      if (!(await fs.pathExists(this.registryPath))) {
        return null;
      }
      const data = await fs.readJson(this.registryPath);

      // Validate the cached data structure
      if (
        typeof data === 'object' &&
        data !== null &&
        typeof data.fetchedAt === 'number' &&
        data.registry &&
        Array.isArray(data.registry.skills)
      ) {
        return {
          ...(data as CachedRegistry),
          registry: validateCommunitySkillsRegistry(data.registry),
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Recursively read directory contents into a Map
   */
  private async readDirRecursive(
    baseDir: string,
    currentDir: string,
    files: Map<string, string>
  ): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
      validateCommunityRelativePath(relativePath, 'cached community skill file path');

      if (entry.isSymbolicLink()) {
        throw new Error(`Invalid cached community skill file path: symbolic link ${relativePath}`);
      } else if (entry.isDirectory()) {
        await this.readDirRecursive(baseDir, fullPath, files);
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath, 'utf-8');
        files.set(relativePath, content);
      } else {
        throw new Error(`Invalid cached community skill file path: ${relativePath}`);
      }
    }
  }

  /**
   * Enforce maximum number of cached skills by removing oldest
   */
  private async enforceMaxSkillsCache(): Promise<void> {
    const skillsDir = path.join(this.cacheDir, 'skills');

    await assertCommunityPathSymlinkSafe(this.cacheDir, skillsDir, 'community skills cache path');
    if (!(await fs.pathExists(skillsDir))) {
      return;
    }

    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const candidates = entries.filter((entry) => (
      !entry.isSymbolicLink()
      && (entry.isDirectory() || entry.isFile())
      && isValidCacheEntryName(entry.name, entry.isFile())
    ));

    if (candidates.length < this.maxSkillsCache) {
      return;
    }

    // Get stats for each entry to sort by mtime
    const withStats = await Promise.all(
      candidates.map(async (entry) => {
        const entryPath = resolveContainedCommunityPath(
          skillsDir,
          entry.name,
          'community skill cache eviction path'
        );
        try {
          await assertCommunityPathSymlinkSafe(
            skillsDir,
            entryPath,
            'community skill cache eviction path'
          );
          const stat = await fs.lstat(entryPath);
          return { name: entry.name, path: entryPath, mtime: stat.mtime.getTime() };
        } catch {
          return null;
        }
      })
    );
    const removableEntries = withStats.filter((entry): entry is NonNullable<typeof entry> => (
      entry !== null
    ));

    // Sort by mtime (oldest first) and remove extras
    removableEntries.sort((a, b) => a.mtime - b.mtime);

    const toRemove = removableEntries.slice(
      0,
      Math.max(0, removableEntries.length - this.maxSkillsCache + 1)
    );

    for (const entry of toRemove) {
      await fs.remove(entry.path);
    }
  }
}

function isValidCacheEntryName(name: string, isFile: boolean): boolean {
  const identifier = isFile && name.endsWith('.md') ? name.slice(0, -3) : name;
  try {
    validateCommunitySkillIdentifier(identifier, 'community skill cache entry');
    return !isFile || name.endsWith('.md');
  } catch {
    return false;
  }
}
