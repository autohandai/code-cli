/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * McpRegistryCache - TTL-based caching for community MCP registry
 */
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';
import type {
  CommunityMcpRegistry,
  CachedMcpRegistry,
} from '../types.js';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface McpCacheConfig {
  /** TTL in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Cache directory path */
  cacheDir?: string;
}

/**
 * TTL-based cache for community MCP registry
 */
export class McpRegistryCache {
  private readonly cacheDir: string;
  private readonly ttlMs: number;

  constructor(config: McpCacheConfig = {}) {
    this.cacheDir = config.cacheDir || AUTOHAND_PATHS.mcpCache;
    this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Get cached registry if it exists and is not expired
   */
  async getRegistry(): Promise<CommunityMcpRegistry | null> {
    const cached = await this.readCachedRegistry();
    if (!cached) return null;

    if (Date.now() - cached.fetchedAt >= this.ttlMs) {
      return null;
    }

    return cached.registry;
  }

  /**
   * Get cached registry ignoring TTL (for offline fallback)
   */
  async getRegistryIgnoreTTL(): Promise<CommunityMcpRegistry | null> {
    const cached = await this.readCachedRegistry();
    return cached?.registry || null;
  }

  /**
   * Save registry to cache
   */
  async setRegistry(registry: CommunityMcpRegistry, etag?: string): Promise<void> {
    const cached: CachedMcpRegistry = {
      registry,
      fetchedAt: Date.now(),
      etag,
    };

    await fs.ensureDir(this.cacheDir);
    await fs.writeJson(this.registryPath, cached, { spaces: 2 });
  }

  /**
   * Clear all cached data
   */
  async clear(): Promise<void> {
    await fs.remove(this.cacheDir);
  }

  // ========== Private Methods ==========

  private get registryPath(): string {
    return path.join(this.cacheDir, 'registry.json');
  }

  private async readCachedRegistry(): Promise<CachedMcpRegistry | null> {
    if (!(await fs.pathExists(this.registryPath))) {
      return null;
    }

    try {
      const data = await fs.readJson(this.registryPath);

      if (
        typeof data === 'object' &&
        data !== null &&
        typeof data.fetchedAt === 'number' &&
        data.registry &&
        Array.isArray(data.registry.servers)
      ) {
        return data as CachedMcpRegistry;
      }

      return null;
    } catch {
      return null;
    }
  }
}
