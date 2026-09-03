/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * McpRegistryFetcher - Fetches installable community MCP server metadata
 */
import type {
  CommunityMcpRegistry,
  GitHubCommunityMcp,
} from '../types.js';

const DEFAULT_REPO = 'autohandai/community-mcp';
const DEFAULT_BRANCH = 'main';
const OFFICIAL_REGISTRY_API_ROOT = 'https://registry.modelcontextprotocol.io/v0.1/servers';
const OFFICIAL_REGISTRY_URL = `${OFFICIAL_REGISTRY_API_ROOT}?limit=100`;

export interface McpRegistryFetcherConfig {
  /** Legacy GitHub repository in format "owner/repo". */
  repo?: string;
  /** Legacy GitHub registry branch. */
  branch?: string;
  /** Override the registry endpoint. Custom endpoints use the legacy format. */
  registryUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

const VALID_TRANSPORTS = new Set<GitHubCommunityMcp['transport']>(['stdio', 'sse', 'http']);

/**
 * Validates and normalizes registry data from either the network or disk.
 * The cache calls this same function so a malformed cached command cannot
 * bypass the checks applied to fresh downloads.
 */
export function validateCommunityMcpRegistry(data: unknown): CommunityMcpRegistry {
  if (!isRecord(data)) {
    throw new Error('Invalid MCP registry: expected object');
  }
  if (!Array.isArray(data.servers)) {
    throw new Error('Invalid MCP registry: missing servers array');
  }
  if (!Array.isArray(data.categories)) {
    throw new Error('Invalid MCP registry: missing categories array');
  }

  const servers: GitHubCommunityMcp[] = [];
  const serverIds = new Set<string>();
  for (const candidate of data.servers) {
    const server = normalizeServer(candidate);
    if (server && !serverIds.has(server.id)) {
      servers.push(server);
      serverIds.add(server.id);
    }
  }
  if (data.servers.length > 0 && servers.length === 0) {
    throw new Error('Invalid MCP registry: no installable server entries');
  }

  return {
    version: typeof data.version === 'string' && data.version.trim() ? data.version : '1.0.0',
    updatedAt: typeof data.updatedAt === 'string' && data.updatedAt.trim()
      ? data.updatedAt
      : new Date().toISOString(),
    servers,
    categories: data.categories.flatMap(normalizeCategory),
  };
}

/**
 * Fetches community MCP servers from a GitHub repository
 */
export class McpRegistryFetcher {
  private readonly baseUrl: string;
  private readonly registryUrl: string;
  private readonly usesOfficialRegistry: boolean;
  private readonly timeout: number;

  constructor(config: McpRegistryFetcherConfig = {}) {
    const repo = config.repo || DEFAULT_REPO;
    const branch = config.branch || DEFAULT_BRANCH;
    this.baseUrl = `https://raw.githubusercontent.com/${repo}/${branch}`;
    this.usesOfficialRegistry = !config.repo && !config.registryUrl;
    this.registryUrl = config.registryUrl
      ?? (this.usesOfficialRegistry ? OFFICIAL_REGISTRY_URL : `${this.baseUrl}/registry.json`);
    this.timeout = config.timeout || 15000;
  }

  /**
   * Fetch the official MCP Registry by default. A legacy GitHub registry is
   * still accepted when explicitly configured for backwards compatibility.
   */
  async fetchRegistry(): Promise<CommunityMcpRegistry> {
    if (this.usesOfficialRegistry) {
      return this.fetchOfficialRegistry();
    }

    return this.validateRegistry(await this.fetchJson(this.registryUrl));
  }

  private async fetchOfficialRegistry(): Promise<CommunityMcpRegistry> {
    const page = parseOfficialRegistryPage(await this.fetchJson(this.registryUrl));
    return this.validateRegistry(adaptOfficialRegistry(page.servers));
  }

  /** Search the complete official catalog server-side without downloading it. */
  async searchRegistry(query: string, limit = 20): Promise<CommunityMcpRegistry> {
    if (!this.usesOfficialRegistry) {
      const registry = await this.fetchRegistry();
      return {
        ...registry,
        servers: this.filterServers(registry.servers, query).slice(0, limit),
      };
    }
    const url = new URL(OFFICIAL_REGISTRY_API_ROOT);
    url.searchParams.set('search', query);
    url.searchParams.set('limit', String(Math.max(1, Math.min(Math.floor(limit) || 20, 100))));
    const page = parseOfficialRegistryPage(await this.fetchJson(url.toString()));
    return this.validateRegistry(adaptOfficialRegistry(page.servers));
  }

  /** Resolve one exact official server ID without relying on a catalog page. */
  async fetchServer(serverId: string): Promise<GitHubCommunityMcp | null> {
    if (!this.usesOfficialRegistry) {
      return this.findServer((await this.fetchRegistry()).servers, serverId);
    }
    const url = `${OFFICIAL_REGISTRY_API_ROOT}/${encodeURIComponent(serverId)}/versions/latest`;
    const registry = this.validateRegistry(adaptOfficialRegistry([
      await this.fetchJson(url),
    ]));
    return registry.servers[0] ?? null;
  }

  private async fetchJson(url: string): Promise<unknown> {
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

      return response.json();
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
    return validateCommunityMcpRegistry(data);
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

interface OfficialRegistryPage {
  servers: unknown[];
}

function parseOfficialRegistryPage(value: unknown): OfficialRegistryPage {
  if (!isRecord(value) || !Array.isArray(value.servers)) {
    throw new Error('Invalid official MCP registry response: missing servers array');
  }
  return {
    servers: value.servers,
  };
}

function adaptOfficialRegistry(entries: unknown[]): CommunityMcpRegistry {
  const servers = entries.flatMap(adaptOfficialRegistryEntry);
  return {
    version: 'official-v0.1',
    updatedAt: new Date().toISOString(),
    servers,
    categories: [{
      id: 'official-registry',
      name: 'Official MCP Registry',
      description: 'Installable entries from the official MCP Registry.',
    }],
  };
}

function adaptOfficialRegistryEntry(entry: unknown): GitHubCommunityMcp[] {
  if (!isRecord(entry) || !isLatestOfficialEntry(entry) || !isRecord(entry.server)) {
    return [];
  }
  const server = entry.server;
  if (!hasNonEmptyString(server, 'name')) return [];
  const description = hasNonEmptyString(server, 'description')
    ? server.description
    : hasNonEmptyString(server, 'title')
      ? server.title
      : undefined;
  if (!description) return [];

  const metadata = getPublisherMetadata(entry);
  const common = {
    id: server.name,
    name: hasNonEmptyString(server, 'title') ? server.title : server.name,
    description,
    category: 'official-registry',
    tags: getStringArray(metadata?.keywords),
    directory: server.name,
    files: ['registry.json'],
    ...(typeof server.version === 'string' ? { version: server.version } : {}),
    ...(getSourceUrl(server) ? { sourceUrl: getSourceUrl(server) } : {}),
  };

  const remote = getInstallableHttpRemote(server.remotes);
  if (remote) {
    return [{ ...common, transport: 'http', url: remote.url }];
  }

  const npmPackage = getInstallableNpmPackage(server.packages);
  if (!npmPackage) return [];
  return [{
    ...common,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', npmPackage.version ? `${npmPackage.identifier}@${npmPackage.version}` : npmPackage.identifier],
    envVars: npmPackage.requiredEnvironmentVariables,
    npmPackage: npmPackage.identifier,
  }];
}

function isLatestOfficialEntry(entry: Record<string, unknown>): boolean {
  const metadata = isRecord(entry._meta) ? entry._meta : undefined;
  const official = metadata && isRecord(metadata['io.modelcontextprotocol.registry/official'])
    ? metadata['io.modelcontextprotocol.registry/official']
    : undefined;
  return !official || official.isLatest !== false;
}

function getPublisherMetadata(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  const metadata = isRecord(entry._meta) ? entry._meta : undefined;
  const publisher = metadata && isRecord(metadata['io.modelcontextprotocol.registry/publisher-provided'])
    ? metadata['io.modelcontextprotocol.registry/publisher-provided']
    : undefined;
  return publisher;
}

function getSourceUrl(server: Record<string, unknown>): string | undefined {
  if (isHttpUrl(server.websiteUrl)) return server.websiteUrl;
  if (isRecord(server.repository) && isHttpUrl(server.repository.url)) return server.repository.url;
  return undefined;
}

function getInstallableHttpRemote(value: unknown): { url: string } | null {
  if (!Array.isArray(value)) return null;
  for (const remote of value) {
    if (!isRecord(remote)
      || remote.type !== 'streamable-http'
      || !isHttpUrl(remote.url)
      || remote.url.includes('{')
      || (Array.isArray(remote.headers) && remote.headers.length > 0)
      || (isRecord(remote.variables) && Object.keys(remote.variables).length > 0)) {
      continue;
    }
    return { url: remote.url };
  }
  return null;
}

function getInstallableNpmPackage(value: unknown): {
  identifier: string;
  version?: string;
  requiredEnvironmentVariables: string[];
} | null {
  if (!Array.isArray(value)) return null;
  for (const packageInfo of value) {
    if (!isRecord(packageInfo)
      || packageInfo.registryType !== 'npm'
      || !hasNonEmptyString(packageInfo, 'identifier')
      || !isRecord(packageInfo.transport)
      || packageInfo.transport.type !== 'stdio'
      || hasUnrepresentableArguments(packageInfo.packageArguments)
      || hasUnrepresentableArguments(packageInfo.runtimeArguments)) {
      continue;
    }
    const requiredEnvironmentVariables = Array.isArray(packageInfo.environmentVariables)
      ? packageInfo.environmentVariables.flatMap((environmentVariable) => (
        isRecord(environmentVariable)
          && environmentVariable.isRequired === true
          && hasNonEmptyString(environmentVariable, 'name')
          ? [environmentVariable.name]
          : []
      ))
      : [];
    return {
      identifier: packageInfo.identifier,
      ...(typeof packageInfo.version === 'string' && packageInfo.version ? { version: packageInfo.version } : {}),
      requiredEnvironmentVariables,
    };
  }
  return null;
}

function hasUnrepresentableArguments(value: unknown): boolean {
  return value !== undefined && (!Array.isArray(value) || value.length > 0);
}

function getStringArray(value: unknown): string[] | undefined {
  return isStringArray(value) ? value : undefined;
}

function normalizeServer(value: unknown): GitHubCommunityMcp | null {
  if (!isRecord(value)
    || !hasNonEmptyString(value, 'id')
    || !hasNonEmptyString(value, 'name')
    || !hasNonEmptyString(value, 'description')
    || !hasNonEmptyString(value, 'category')
    || !hasNonEmptyString(value, 'directory')
    || !isStringArray(value.files)
    || typeof value.transport !== 'string'
    || !VALID_TRANSPORTS.has(value.transport as GitHubCommunityMcp['transport'])) {
    return null;
  }

  const transport = value.transport as GitHubCommunityMcp['transport'];
  if (transport === 'stdio' && !hasNonEmptyString(value, 'command')) return null;
  if ((transport === 'http' || transport === 'sse') && !isHttpUrl(value.url)) return null;
  if (!hasValidOptionalStringArray(value, 'tags')
    || !hasValidOptionalStringArray(value, 'args')
    || !hasValidOptionalStringArray(value, 'envVars')
    || !hasValidOptionalStringArray(value, 'requiredArgs')) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    description: value.description,
    category: value.category,
    transport,
    ...(typeof value.command === 'string' ? { command: value.command } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(Array.isArray(value.args) ? { args: value.args } : {}),
    ...(Array.isArray(value.envVars) ? { envVars: value.envVars } : {}),
    ...(Array.isArray(value.requiredArgs) ? { requiredArgs: value.requiredArgs } : {}),
    ...(Array.isArray(value.tags) ? { tags: value.tags } : {}),
    ...(typeof value.isFeatured === 'boolean' ? { isFeatured: value.isFeatured } : {}),
    ...(typeof value.isCurated === 'boolean' ? { isCurated: value.isCurated } : {}),
    ...(typeof value.rating === 'number' && Number.isFinite(value.rating) ? { rating: value.rating } : {}),
    ...(typeof value.installCount === 'number' && Number.isFinite(value.installCount)
      ? { installCount: value.installCount }
      : {}),
    directory: value.directory,
    files: value.files,
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.license === 'string' ? { license: value.license } : {}),
    ...(typeof value.author === 'string' ? { author: value.author } : {}),
    ...(typeof value.npmPackage === 'string' ? { npmPackage: value.npmPackage } : {}),
    ...(isHttpUrl(value.sourceUrl) ? { sourceUrl: value.sourceUrl } : {}),
  };
}

function normalizeCategory(value: unknown): CommunityMcpRegistry['categories'][number][] {
  if (!isRecord(value)
    || !hasNonEmptyString(value, 'id')
    || !hasNonEmptyString(value, 'name')
    || !hasNonEmptyString(value, 'description')) {
    return [];
  }
  return [{ id: value.id, name: value.name, description: value.description }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasNonEmptyString<K extends string>(
  value: Record<string, unknown>,
  key: K,
): value is Record<string, unknown> & Record<K, string> {
  return typeof value[key] === 'string' && value[key].trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function hasValidOptionalStringArray(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isStringArray(value[key]);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
