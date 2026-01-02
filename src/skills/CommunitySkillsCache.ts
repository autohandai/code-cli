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
    const cached: CachedRegistry = {
      registry,
      fetchedAt: Date.now(),
      etag,
    };

    await fs.ensureDir(this.cacheDir);
    await fs.writeJson(this.registryPath, cached, { spaces: 2 });
  }

  /**
   * Get a cached skill body by skill ID
   */
  async getSkillBody(skillId: string): Promise<string | null> {
    const skillPath = this.getSkillBodyPath(skillId);

    if (await fs.pathExists(skillPath)) {
      try {
        return await fs.readFile(skillPath, 'utf-8');
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Cache a skill body
   */
  async setSkillBody(skillId: string, body: string): Promise<void> {
    const skillsDir = path.join(this.cacheDir, 'skills');
    await fs.ensureDir(skillsDir);

    // Enforce max cache size
    await this.enforceMaxSkillsCache();

    await fs.writeFile(this.getSkillBodyPath(skillId), body, 'utf-8');
  }

  /**
   * Get cached skill directory files
   * Returns Map of relative paths to contents, or null if not cached
   */
  async getSkillDirectory(skillId: string): Promise<Map<string, string> | null> {
    const skillCacheDir = path.join(this.cacheDir, 'skills', skillId);

    if (!(await fs.pathExists(skillCacheDir))) {
      return null;
    }

    try {
      const files = new Map<string, string>();
      await this.readDirRecursive(skillCacheDir, skillCacheDir, files);
      return files.size > 0 ? files : null;
    } catch {
      return null;
    }
  }

  /**
   * Cache a skill directory with all its files
   */
  async setSkillDirectory(skillId: string, files: Map<string, string>): Promise<void> {
    const skillCacheDir = path.join(this.cacheDir, 'skills', skillId);

    // Enforce max cache size
    await this.enforceMaxSkillsCache();

    // Remove old cache for this skill if exists
    await fs.remove(skillCacheDir);

    // Write all files
    for (const [relativePath, content] of files) {
      const fullPath = path.join(skillCacheDir, relativePath);
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

    if (await fs.pathExists(skillsDir)) {
      const entries = await fs.readdir(skillsDir);
      cachedSkillCount = entries.length;
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
    return path.join(this.cacheDir, 'skills', `${skillId}.md`);
  }

  private async readCachedRegistry(): Promise<CachedRegistry | null> {
    if (!(await fs.pathExists(this.registryPath))) {
      return null;
    }

    try {
      const data = await fs.readJson(this.registryPath);

      // Validate the cached data structure
      if (
        typeof data === 'object' &&
        data !== null &&
        typeof data.fetchedAt === 'number' &&
        data.registry &&
        Array.isArray(data.registry.skills)
      ) {
        return data as CachedRegistry;
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
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        await this.readDirRecursive(baseDir, fullPath, files);
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath, 'utf-8');
        files.set(relativePath, content);
      }
    }
  }

  /**
   * Enforce maximum number of cached skills by removing oldest
   */
  private async enforceMaxSkillsCache(): Promise<void> {
    const skillsDir = path.join(this.cacheDir, 'skills');

    if (!(await fs.pathExists(skillsDir))) {
      return;
    }

    const entries = await fs.readdir(skillsDir);

    if (entries.length < this.maxSkillsCache) {
      return;
    }

    // Get stats for each entry to sort by mtime
    const withStats = await Promise.all(
      entries.map(async (name) => {
        const entryPath = path.join(skillsDir, name);
        try {
          const stat = await fs.stat(entryPath);
          return { name, path: entryPath, mtime: stat.mtime.getTime() };
        } catch {
          return { name, path: entryPath, mtime: 0 };
        }
      })
    );

    // Sort by mtime (oldest first) and remove extras
    withStats.sort((a, b) => a.mtime - b.mtime);

    const toRemove = withStats.slice(0, entries.length - this.maxSkillsCache + 1);

    for (const entry of toRemove) {
      await fs.remove(entry.path);
    }
  }
}
