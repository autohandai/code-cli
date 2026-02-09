/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * McpRegistryFetcher - Fetches community MCP server registry from GitHub
 */
import type {
  CommunityMcpRegistry,
  GitHubCommunityMcp,
} from '../types.js';

const DEFAULT_REPO = 'autohandai/community-mcp';
const DEFAULT_BRANCH = 'main';

export interface McpRegistryFetcherConfig {
  /** GitHub repository in format "owner/repo" */
  repo?: string;
  /** Branch to fetch from */
  branch?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Fetches community MCP servers from a GitHub repository
 */
export class McpRegistryFetcher {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: McpRegistryFetcherConfig = {}) {
    const repo = config.repo || DEFAULT_REPO;
    const branch = config.branch || DEFAULT_BRANCH;
    this.baseUrl = `https://raw.githubusercontent.com/${repo}/${branch}`;
    this.timeout = config.timeout || 15000;
  }

  /**
   * Fetch the registry.json index file
   */
  async fetchRegistry(): Promise<CommunityMcpRegistry> {
    const url = `${this.baseUrl}/registry.json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'autohand-cli',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch MCP registry: HTTP ${response.status}`);
      }

      const data = await response.json();
      return this.validateRegistry(data);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch a README file for a specific MCP server
   */
  async fetchServerReadme(serverDirectory: string): Promise<string> {
    const url = `${this.baseUrl}/${serverDirectory}/README.md`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'autohand-cli',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch README: HTTP ${response.status}`);
      }

      return response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate and normalize the registry data
   */
  private validateRegistry(data: unknown): CommunityMcpRegistry {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid MCP registry: expected object');
    }

    const registry = data as Record<string, unknown>;

    if (!Array.isArray(registry.servers)) {
      throw new Error('Invalid MCP registry: missing servers array');
    }

    if (!Array.isArray(registry.categories)) {
      throw new Error('Invalid MCP registry: missing categories array');
    }

    const validatedServers: GitHubCommunityMcp[] = [];
    for (const server of registry.servers) {
      if (this.isValidServer(server)) {
        validatedServers.push(server);
      }
    }

    return {
      version: String(registry.version || '1.0.0'),
      updatedAt: String(registry.updatedAt || new Date().toISOString()),
      servers: validatedServers,
      categories: registry.categories as CommunityMcpRegistry['categories'],
    };
  }

  /**
   * Type guard for valid MCP server objects
   */
  private isValidServer(server: unknown): server is GitHubCommunityMcp {
    if (!server || typeof server !== 'object') return false;

    const s = server as Record<string, unknown>;

    return (
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.description === 'string' &&
      typeof s.directory === 'string' &&
      (s.transport === 'stdio' || s.transport === 'sse')
    );
  }

  /**
   * Search servers by query (client-side filtering)
   */
  filterServers(
    servers: GitHubCommunityMcp[],
    query: string
  ): GitHubCommunityMcp[] {
    if (!query.trim()) return servers;

    const lowerQuery = query.toLowerCase();

    return servers.filter((server) => {
      const searchText = [
        server.name,
        server.description,
        server.category,
        ...(server.tags || []),
      ]
        .join(' ')
        .toLowerCase();

      return searchText.includes(lowerQuery);
    });
  }

  /**
   * Get servers by category
   */
  getServersByCategory(
    servers: GitHubCommunityMcp[],
    categoryId: string
  ): GitHubCommunityMcp[] {
    return servers.filter((server) => server.category === categoryId);
  }

  /**
   * Get featured servers
   */
  getFeaturedServers(servers: GitHubCommunityMcp[]): GitHubCommunityMcp[] {
    return servers.filter((server) => server.isFeatured);
  }

  /**
   * Find a server by name or ID
   */
  findServer(
    servers: GitHubCommunityMcp[],
    nameOrId: string
  ): GitHubCommunityMcp | null {
    const lower = nameOrId.toLowerCase();
    return (
      servers.find(
        (s) => s.id.toLowerCase() === lower || s.name.toLowerCase() === lower
      ) || null
    );
  }

  /**
   * Find similar servers based on simple string matching
   */
  findSimilarServers(
    servers: GitHubCommunityMcp[],
    query: string,
    limit = 5
  ): GitHubCommunityMcp[] {
    const lower = query.toLowerCase();

    const scored = servers.map((server) => {
      let score = 0;

      if (server.name.toLowerCase().includes(lower)) score += 10;
      if (server.description.toLowerCase().includes(lower)) score += 5;
      if (server.tags?.some((t) => t.toLowerCase().includes(lower))) score += 3;

      return { server, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.server);
  }
}
