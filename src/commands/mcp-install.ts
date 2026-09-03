/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP install command - browse and install compatible official MCP servers.
 */
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import { McpRegistryFetcher } from '../mcp/McpRegistryFetcher.js';
import { McpRegistryCache } from '../mcp/McpRegistryCache.js';
import { normalizeMcpCommandForConfig } from '../mcp/commandNormalization.js';
import { saveConfig } from '../config.js';
import type {
  CommunityMcpRegistry,
  GitHubCommunityMcp,
  LoadedConfig,
  McpServerConfigEntry,
} from '../types.js';

export interface McpInstallContext {
  mcpManager?: McpClientManager;
  config?: LoadedConfig;
}

type CommunityMcpRegistrySource = 'cache' | 'network' | 'stale-cache';

interface LoadedCommunityMcpRegistry {
  registry: CommunityMcpRegistry;
  source: CommunityMcpRegistrySource;
}

export interface CommunityMcpSearchResult {
  id: string;
  name: string;
  description: string;
  category: string;
  transport: GitHubCommunityMcp['transport'];
  requiredArgs: string[];
  requiredEnvironmentVariables: string[];
  sourceUrl?: string;
}

export interface CommunityMcpInstallOptions {
  /** Values for each catalog-declared required argument, in catalog order. */
  requiredArgs?: string[];
  /** Replace an existing configuration with the same catalog server ID. */
  overwrite?: boolean;
}

export interface CommunityMcpInstallResult {
  success: boolean;
  connected: boolean;
  message: string;
  kind?: 'validation' | 'configuration';
}

/**
 * Loads the MCP registry with a fresh-cache preference and an offline
 * stale-cache fallback. Callers never execute registry-provided configuration
 * until a subsequent, separately approved installation action.
 */
async function loadCommunityMcpRegistry(): Promise<LoadedCommunityMcpRegistry> {
  const cache = new McpRegistryCache();
  const fetcher = new McpRegistryFetcher();

  try {
    const cached = await cache.getRegistry();
    if (cached) {
      return { registry: cached, source: 'cache' };
    }

    const registry = await fetcher.fetchRegistry();
    await cache.setRegistry(registry);
    return { registry, source: 'network' };
  } catch (error) {
    const stale = await cache.getRegistryIgnoreTTL();
    if (stale) {
      return { registry: stale, source: 'stale-cache' };
    }

    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(`Failed to fetch the MCP registry.${detail}`);
  }
}

/**
 * Returns non-executable official-catalog metadata for LLM discovery. The command,
 * endpoint, and environment values remain registry-controlled during install.
 */
export async function findCommunityMcpServers(
  query: string,
  category?: string,
  limit = 10,
): Promise<CommunityMcpSearchResult[]> {
  const fetcher = new McpRegistryFetcher();
  const normalizedLimit = Math.max(1, Math.min(Math.floor(limit) || 10, 20));
  const normalizedCategory = category?.trim().toLowerCase();
  let registry: CommunityMcpRegistry;
  try {
    registry = await fetcher.searchRegistry(query, normalizedLimit);
  } catch {
    registry = (await loadCommunityMcpRegistry()).registry;
  }
  const matches = fetcher
    .filterServers(registry.servers, query)
    .filter((server) => !normalizedCategory || server.category.toLowerCase() === normalizedCategory)
    .slice(0, normalizedLimit);

  return matches.map((server) => ({
    id: server.id,
    name: server.name,
    description: server.description,
    category: server.category,
    transport: server.transport,
    requiredArgs: server.requiredArgs ?? [],
    requiredEnvironmentVariables: server.envVars ?? [],
    sourceUrl: server.sourceUrl,
  }));
}

/**
 * Resolves a catalog server by its exact identifier. This deliberately does
 * not resolve by display name or partial match so an agent cannot install a
 * similarly named command by accident.
 */
export async function resolveCommunityMcpServer(
  serverId: string,
): Promise<GitHubCommunityMcp | null> {
  const normalizedId = serverId.trim();
  if (!normalizedId) return null;

  const fetcher = new McpRegistryFetcher();
  try {
    return await fetcher.fetchServer(normalizedId);
  } catch {
    const { registry } = await loadCommunityMcpRegistry();
    return registry.servers.find((server) => server.id === normalizedId) ?? null;
  }
}

/**
 * Installs one already-resolved official catalog entry. It never accepts a
 * caller-provided command, URL, headers, or secret; only declared positional
 * arguments and inherited environment-variable names are considered.
 */
export async function installCommunityMcpServer(
  ctx: McpInstallContext,
  server: GitHubCommunityMcp,
  options: CommunityMcpInstallOptions = {},
): Promise<CommunityMcpInstallResult> {
  const { mcpManager, config } = ctx;
  if (!mcpManager || !config) {
    return {
      success: false,
      connected: false,
      kind: 'configuration',
      message: 'MCP manager or config is not available.',
    };
  }

  const validationError = validateInstallRequest(server, options);
  if (validationError) {
    return {
      success: false,
      connected: false,
      kind: 'validation',
      message: validationError,
    };
  }

  const newServer = buildServerConfig(server, options.requiredArgs ?? []);
  if (!newServer) {
    return {
      success: false,
      connected: false,
      kind: 'validation',
      message: `MCP server "${server.name}" has an incomplete ${server.transport} catalog configuration.`,
    };
  }

  const existing = config.mcp?.servers?.find((item) => item.name === server.id);
  if (existing && !options.overwrite) {
    return {
      success: false,
      connected: false,
      kind: 'validation',
      message: `MCP server "${server.name}" is already installed. Set overwrite to replace its catalog configuration.`,
    };
  }

  const previousMcp = config.mcp;
  const previousServers = previousMcp?.servers ?? [];
  config.mcp = {
    ...previousMcp,
    enabled: true,
    servers: existing
      ? previousServers.map((item) => item.name === server.id ? newServer : item)
      : [...previousServers, newServer],
  };

  try {
    await saveConfig(config);
  } catch (error) {
    config.mcp = previousMcp;
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      connected: false,
      kind: 'configuration',
      message: `Failed to save the MCP configuration: ${detail}`,
    };
  }

  if (existing) {
    await mcpManager.disconnect(server.id).catch(() => {});
  }

  try {
    await mcpManager.connect(newServer);
    const tools = mcpManager.getToolsForServer(server.id);
    return {
      success: true,
      connected: true,
      message: `MCP server "${server.name}" installed and connected (${tools.length} tools available).`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: true,
      connected: false,
      message: `MCP server "${server.name}" was saved but could not connect: ${detail}`,
    };
  }
}

/** Main entry point for the human `/mcp install` command. */
export async function mcpInstall(
  ctx: McpInstallContext,
  serverName?: string,
): Promise<string | null> {
  if (!ctx.mcpManager || !ctx.config) {
    return 'MCP manager or config not available.';
  }

  let loaded: LoadedCommunityMcpRegistry;
  try {
    loaded = await loadCommunityMcpRegistry();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (loaded.source === 'network') {
    console.log(chalk.cyan('Fetched Official MCP Registry.'));
  } else if (loaded.source === 'stale-cache') {
    console.log(chalk.yellow('Using cached MCP registry (offline mode).'));
  }

  if (serverName) {
    return directInstall(ctx, loaded.registry, serverName);
  }

  return interactiveBrowser(ctx, loaded.registry);
}

async function directInstall(
  ctx: McpInstallContext,
  registry: CommunityMcpRegistry,
  serverName: string,
): Promise<string | null> {
  const fetcher = new McpRegistryFetcher();
  const server = await fetcher.fetchServer(serverName).catch(() => null)
    ?? fetcher.findServer(registry.servers, serverName);
  if (!server) {
    const similar = fetcher.findSimilarServers(registry.servers, serverName, 3);
    const alternatives = similar.length > 0
      ? ` Did you mean: ${similar.map((item) => item.id).join(', ')}?`
      : '';
    return `MCP server not found: ${serverName}.${alternatives}`;
  }

  return promptAndInstallServer(ctx, server);
}

async function interactiveBrowser(
  ctx: McpInstallContext,
  registry: CommunityMcpRegistry,
): Promise<string | null> {
  console.log();
  console.log(chalk.bold.cyan('Official MCP Registry'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`${registry.servers.length} servers available`));
  console.log();

  const choices = registry.servers.map((server) => ({
    name: server.id,
    message: formatServerChoice(server),
    value: server.id,
  }));
  const answer = await safePrompt<{ server: string }>([
    {
      type: 'autocomplete',
      name: 'server',
      message: 'Select a server to install (type to search)',
      choices,
    } as never,
  ]);

  if (!answer?.server) return 'No MCP server selected.';
  const server = registry.servers.find((item) => item.id === answer.server);
  if (!server) return 'Selected MCP server is no longer present in the registry.';

  printServerDetails(server);
  return promptAndInstallServer(ctx, server);
}

async function promptAndInstallServer(
  ctx: McpInstallContext,
  server: GitHubCommunityMcp,
): Promise<string | null> {
  const existing = ctx.config?.mcp?.servers?.some((item) => item.name === server.id);
  if (existing) {
    const answer = await safePrompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Server "${server.name}" is already installed. Replace its catalog configuration?`,
        initial: false,
      },
    ]);
    if (!answer?.overwrite) return 'MCP installation cancelled.';
  }

  const requiredArgs: string[] = [];
  for (const requiredArg of server.requiredArgs ?? []) {
    const answer = await safePrompt<{ value: string }>([
      {
        type: 'input',
        name: 'value',
        message: `Enter value for ${requiredArg}:`,
      },
    ]);
    if (!answer?.value?.trim()) {
      return `MCP installation cancelled: ${requiredArg} is required.`;
    }
    requiredArgs.push(answer.value);
  }

  const result = await installCommunityMcpServer(ctx, server, {
    requiredArgs,
    overwrite: existing,
  });
  return result.message;
}

function validateInstallRequest(
  server: GitHubCommunityMcp,
  options: CommunityMcpInstallOptions,
): string | null {
  if (server.transport === 'sse') {
    return `MCP server "${server.name}" uses SSE transport, which is not implemented. Use a stdio or HTTP server.`;
  }

  if (server.transport === 'stdio' && !server.command?.trim()) {
    return `MCP server "${server.name}" is missing its stdio command in the community registry.`;
  }
  if (server.transport === 'http' && !isHttpUrl(server.url)) {
    return `MCP server "${server.name}" is missing a valid HTTP URL in the community registry.`;
  }

  const missingEnvVars = (server.envVars ?? []).filter((name) => !process.env[name]);
  if (missingEnvVars.length > 0) {
    return `MCP server "${server.name}" requires environment variables that are not set: ${missingEnvVars.join(', ')}. Set them in the shell that launches Autohand, then retry.`;
  }

  const expectedArgs = server.requiredArgs ?? [];
  const suppliedArgs = options.requiredArgs ?? [];
  if (suppliedArgs.length !== expectedArgs.length || suppliedArgs.some((value) => !value.trim())) {
    return `MCP server "${server.name}" requires values for: ${expectedArgs.join(', ')}.`;
  }

  return null;
}

function buildServerConfig(
  server: GitHubCommunityMcp,
  requiredArgs: string[],
): McpServerConfigEntry | null {
  if (server.transport === 'stdio' && server.command) {
    const args = [...(server.args ?? []), ...requiredArgs];
    const normalized = normalizeMcpCommandForConfig(
      server.command,
      args.length > 0 ? args : undefined,
    );
    return {
      name: server.id,
      transport: 'stdio',
      command: normalized.command,
      args: normalized.args,
      autoConnect: true,
    };
  }

  if (server.transport === 'http' && isHttpUrl(server.url)) {
    return {
      name: server.id,
      transport: 'http',
      url: server.url,
      autoConnect: true,
    };
  }

  return null;
}

function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function printServerDetails(server: GitHubCommunityMcp): void {
  console.log();
  console.log(chalk.bold.cyan(`Server: ${server.name}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white('Description: ') + server.description);
  console.log(chalk.white('Category: ') + server.category);
  console.log(chalk.white('Transport: ') + server.transport);
  if (server.envVars?.length) {
    console.log(chalk.white('Required environment variables: ') + server.envVars.join(', '));
  }
  if (server.requiredArgs?.length) {
    console.log(chalk.white('Required arguments: ') + server.requiredArgs.join(', '));
  }
  console.log();
}

function formatServerChoice(server: GitHubCommunityMcp): string {
  const parts: string[] = [];
  if (server.isFeatured) {
    parts.push(chalk.yellow('★'));
  } else if (server.isCurated) {
    parts.push(chalk.green('✓'));
  } else {
    parts.push(' ');
  }
  parts.push(chalk.bold(server.name.padEnd(25)));
  if (server.rating) parts.push(chalk.gray(`${server.rating.toFixed(1)}`));
  parts.push(chalk.gray(server.description.slice(0, 40)));
  return parts.join(' ');
}
