/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP install command - Browse and install community MCP servers from GitHub
 */
import chalk from 'chalk';
import { safePrompt } from '../utils/prompt.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import { McpRegistryFetcher } from '../mcp/McpRegistryFetcher.js';
import { McpRegistryCache } from '../mcp/McpRegistryCache.js';
import { saveConfig } from '../config.js';
import type {
  GitHubCommunityMcp,
  CommunityMcpRegistry,
  LoadedConfig,
} from '../types.js';

export interface McpInstallContext {
  mcpManager?: McpClientManager;
  config?: LoadedConfig;
}

/**
 * Main entry point for /mcp install command
 */
export async function mcpInstall(
  ctx: McpInstallContext,
  serverName?: string
): Promise<string | null> {
  const { mcpManager, config } = ctx;

  if (!mcpManager || !config) {
    console.log(chalk.red('MCP manager or config not available.'));
    return null;
  }

  const cache = new McpRegistryCache();
  const fetcher = new McpRegistryFetcher();

  // Fetch registry (with cache)
  let registry: CommunityMcpRegistry;
  try {
    const cached = await cache.getRegistry();
    if (cached) {
      registry = cached;
    } else {
      console.log(chalk.cyan('Fetching community MCP registry...'));
      registry = await fetcher.fetchRegistry();
      await cache.setRegistry(registry);
    }
  } catch (error) {
    const stale = await cache.getRegistryIgnoreTTL();
    if (stale) {
      console.log(chalk.yellow('Using cached registry (offline mode)'));
      registry = stale;
    } else {
      console.log(chalk.red('Failed to fetch MCP registry. Please check your internet connection.'));
      console.log(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
      return null;
    }
  }

  // Direct install if name provided
  if (serverName) {
    return directInstall(ctx, registry, fetcher, serverName);
  }

  // Interactive browser
  return interactiveBrowser(ctx, registry, fetcher);
}

/**
 * Direct install a server by name
 */
async function directInstall(
  ctx: McpInstallContext,
  registry: CommunityMcpRegistry,
  fetcher: McpRegistryFetcher,
  serverName: string
): Promise<string | null> {
  const server = fetcher.findServer(registry.servers, serverName);
  if (!server) {
    console.log(chalk.red(`MCP server not found: ${serverName}`));

    const similar = fetcher.findSimilarServers(registry.servers, serverName, 3);
    if (similar.length > 0) {
      console.log(chalk.gray('Did you mean:'));
      for (const s of similar) {
        console.log(chalk.gray(`  - ${s.name}: ${s.description}`));
      }
    }

    return null;
  }

  return installServer(ctx, server);
}

/**
 * Interactive browser for browsing and installing MCP servers
 */
async function interactiveBrowser(
  ctx: McpInstallContext,
  registry: CommunityMcpRegistry,
  fetcher: McpRegistryFetcher
): Promise<string | null> {
  console.log();
  console.log(chalk.bold.cyan('Community MCP Servers'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`${registry.servers.length} servers available`));
  console.log();

  // Show categories
  console.log(chalk.bold('Categories:'));
  for (const cat of registry.categories) {
    const count = registry.servers.filter(s => s.category === cat.id).length;
    console.log(chalk.gray(`  ${cat.name} (${count})`));
  }
  console.log();

  // Show featured servers
  const featured = fetcher.getFeaturedServers(registry.servers);
  if (featured.length > 0) {
    console.log(chalk.bold.yellow('Featured Servers:'));
    for (const server of featured) {
      const rating = server.rating ? `★ ${server.rating.toFixed(1)}` : '';
      console.log(`  ${chalk.green('●')} ${chalk.bold(server.name)} ${chalk.gray(rating)}`);
      console.log(chalk.gray(`      ${server.description}`));
    }
    console.log();
  }

  // Build choices
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
    } as any,
  ]);

  if (!answer?.server) {
    console.log(chalk.gray('No server selected.'));
    return null;
  }

  const selectedServer = registry.servers.find((s) => s.id === answer.server);
  if (!selectedServer) {
    console.log(chalk.red('Server not found.'));
    return null;
  }

  // Show server details and confirm
  console.log();
  console.log(chalk.bold.cyan(`Server: ${selectedServer.name}`));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.white('Description: ') + selectedServer.description);
  console.log(chalk.white('Category: ') + selectedServer.category);
  console.log(chalk.white('Transport: ') + selectedServer.transport);
  if (selectedServer.npmPackage) {
    console.log(chalk.white('Package: ') + selectedServer.npmPackage);
  }
  if (selectedServer.tags?.length) {
    console.log(chalk.white('Tags: ') + selectedServer.tags.join(', '));
  }
  if (selectedServer.envVars?.length) {
    console.log(chalk.white('Required Env Vars: ') + selectedServer.envVars.join(', '));
  }
  if (selectedServer.requiredArgs?.length) {
    console.log(chalk.white('Required Args: ') + selectedServer.requiredArgs.join(' '));
  }
  console.log();

  return installServer(ctx, selectedServer);
}

/**
 * Install an MCP server to config and optionally connect
 */
async function installServer(
  ctx: McpInstallContext,
  server: GitHubCommunityMcp
): Promise<string | null> {
  const { mcpManager, config } = ctx;

  if (!mcpManager || !config) {
    return 'MCP manager or config not available.';
  }

  // Check if already installed
  if (config.mcp?.servers?.some(s => s.name === server.id)) {
    const confirm = await safePrompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `Server "${server.name}" already installed. Overwrite?`,
        initial: false,
      },
    ]);

    if (!confirm?.overwrite) {
      console.log(chalk.gray('Installation cancelled.'));
      return null;
    }

    // Remove existing
    const idx = config.mcp.servers.findIndex(s => s.name === server.id);
    if (idx >= 0) {
      try {
        await mcpManager.disconnect(server.id);
      } catch {
        // Ignore
      }
      config.mcp.servers.splice(idx, 1);
    }
  }

  // Check for required env vars
  if (server.envVars && server.envVars.length > 0) {
    const missingVars = server.envVars.filter(v => !process.env[v]);
    if (missingVars.length > 0) {
      console.log(chalk.yellow(`Required environment variables not set: ${missingVars.join(', ')}`));
      console.log(chalk.gray('Set them in your shell profile or pass via env config.'));
    }
  }

  // Build args - include required args if any
  const serverArgs = server.args ? [...server.args] : [];
  if (server.requiredArgs && server.requiredArgs.length > 0) {
    console.log(chalk.yellow(`This server requires additional arguments: ${server.requiredArgs.join(' ')}`));

    for (const reqArg of server.requiredArgs) {
      const answer = await safePrompt<{ value: string }>([
        {
          type: 'input',
          name: 'value',
          message: `Enter value for ${reqArg}:`,
        },
      ]);

      if (answer?.value) {
        serverArgs.push(answer.value);
      }
    }
  }

  // Build env from required env vars
  const env: Record<string, string> = {};
  if (server.envVars) {
    for (const v of server.envVars) {
      if (process.env[v]) {
        env[v] = process.env[v]!;
      }
    }
  }

  // Build server config
  const newServer = {
    name: server.id,
    transport: server.transport,
    command: server.command,
    args: serverArgs.length > 0 ? serverArgs : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    autoConnect: true,
  };

  // Save to config
  if (!config.mcp) {
    config.mcp = {};
  }
  if (!config.mcp.servers) {
    config.mcp.servers = [];
  }
  config.mcp.servers.push(newServer);

  try {
    await saveConfig(config);
    console.log(chalk.green(`✓ Installed ${server.name} to config`));

    // Auto-connect
    try {
      console.log(chalk.cyan(`Connecting to ${server.name}...`));
      await mcpManager.connect(newServer);
      const tools = mcpManager.getToolsForServer(server.id);
      console.log(chalk.green(`✓ Connected (${tools.length} tools available)`));
      return `MCP server "${server.name}" installed and connected successfully.`;
    } catch (connectError) {
      console.log(chalk.yellow(`Installed but could not connect: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`));
      return `MCP server "${server.name}" installed. Connect manually with /mcp connect ${server.id}`;
    }
  } catch (error) {
    console.log(chalk.red('Failed to save config.'));
    console.log(chalk.gray(error instanceof Error ? error.message : 'Unknown error'));
    return null;
  }
}

/**
 * Format a server as a choice for the autocomplete prompt
 */
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

  if (server.rating) {
    parts.push(chalk.gray(`${server.rating.toFixed(1)}`));
  }

  parts.push(chalk.gray(server.description.slice(0, 40)));

  return parts.join(' ');
}
