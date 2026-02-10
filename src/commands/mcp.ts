/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP command - List and manage MCP (Model Context Protocol) servers
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import type { LoadedConfig } from '../types.js';
import { saveConfig } from '../config.js';
import {
  showMcpServerList,
  type McpServerItem,
} from '../ui/ink/components/McpServerList.js';

export interface McpCommandContext {
  mcpManager?: McpClientManager;
  config?: LoadedConfig;
}

/**
 * MCP command handler
 * /mcp - Interactive server toggle list (enable/disable servers)
 * /mcp connect <name> - Connect to a configured server
 * /mcp disconnect <name> - Disconnect from a server
 * /mcp list - List available tools from connected servers
 * /mcp add <name> <command> [args...] - Add a server to config
 * /mcp remove <name> - Remove a server from config
 */
export async function mcp(ctx: McpCommandContext, args: string[] = []): Promise<string | null> {
  const { mcpManager, config } = ctx;

  if (!mcpManager) {
    return 'MCP manager not available.';
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case 'connect':
      return handleConnect(mcpManager, config, args.slice(1));

    case 'disconnect':
      return handleDisconnect(mcpManager, args.slice(1));

    case 'list':
    case 'tools':
      return handleListTools(mcpManager);

    case 'add':
      return handleAdd(mcpManager, config, args.slice(1));

    case 'remove':
    case 'rm':
      return handleRemove(mcpManager, config, args.slice(1));

    default:
      return showInteractiveList(mcpManager, config);
  }
}

/**
 * Build the server items list, including both connected/runtime servers
 * and config-only servers that haven't been connected yet.
 */
function buildServerItems(
  manager: McpClientManager,
  config?: LoadedConfig
): McpServerItem[] {
  const runtimeServers = manager.listServers();
  const items: McpServerItem[] = runtimeServers.map((s) => ({
    name: s.name,
    status: s.status,
    toolCount: s.toolCount,
  }));

  // Add config-only servers that aren't in runtime yet
  const runtimeNames = new Set(runtimeServers.map((s) => s.name));
  const configServers = config?.mcp?.servers ?? [];
  for (const cs of configServers) {
    if (!runtimeNames.has(cs.name)) {
      items.push({
        name: cs.name,
        status: 'disconnected',
        toolCount: 0,
      });
    }
  }

  return items;
}

/**
 * Show interactive toggle list for enabling/disabling MCP servers
 */
async function showInteractiveList(
  manager: McpClientManager,
  config?: LoadedConfig
): Promise<string | null> {
  const items = buildServerItems(manager, config);

  if (items.length === 0) {
    const lines: string[] = [];
    lines.push('');
    lines.push(chalk.bold.cyan(t('commands.mcp.title')));
    lines.push(chalk.gray('─'.repeat(50)));
    lines.push('');
    lines.push(t('commands.mcp.noServers'));
    lines.push('');
    lines.push(chalk.gray('Add a server:'));
    lines.push(chalk.gray('  /mcp add <name> <command> [args...]'));
    lines.push('');
    lines.push(chalk.gray('Browse community servers:'));
    lines.push(chalk.gray('  /mcp install'));
    return lines.join('\n');
  }

  await showMcpServerList({
    servers: items,
    onToggle: async (serverName, currentStatus) => {
      if (currentStatus === 'connected') {
        // Disconnect
        try {
          await manager.disconnect(serverName);
        } catch {
          // Ignore disconnect errors
        }
      } else {
        // Connect - find config for this server
        const serverConfig = config?.mcp?.servers?.find((s) => s.name === serverName);
        if (serverConfig) {
          try {
            await manager.connect(serverConfig);
          } catch {
            // Error state will be reflected in the list
          }
        }
      }
      // Return updated server list
      return buildServerItems(manager, config);
    },
  });

  // After interactive list closes, show summary
  const updatedServers = manager.listServers();
  const connectedCount = updatedServers.filter((s) => s.status === 'connected').length;
  const totalTools = updatedServers.reduce(
    (sum, s) => sum + (s.status === 'connected' ? s.toolCount : 0),
    0
  );

  if (connectedCount > 0) {
    return `${connectedCount} server${connectedCount > 1 ? 's' : ''} connected (${totalTools} tools available)`;
  }

  return null;
}

/**
 * Connect to a configured server
 */
async function handleConnect(
  manager: McpClientManager,
  config: LoadedConfig | undefined,
  args: string[]
): Promise<string> {
  const serverName = args[0];
  if (!serverName) {
    return 'Usage: /mcp connect <server-name>';
  }

  const serverConfig = config?.mcp?.servers?.find(s => s.name === serverName);
  if (!serverConfig) {
    return `Server "${serverName}" not found in config. Use /mcp add to add it first.`;
  }

  try {
    console.log(chalk.cyan(t('commands.mcp.connecting')));
    await manager.connect(serverConfig);
    const tools = manager.getToolsForServer(serverName);
    return `Connected to ${serverName} (${tools.length} tools available)`;
  } catch (error) {
    return `Failed to connect to ${serverName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Disconnect from a server
 */
async function handleDisconnect(
  manager: McpClientManager,
  args: string[]
): Promise<string> {
  const serverName = args[0];
  if (!serverName) {
    return 'Usage: /mcp disconnect <server-name>';
  }

  try {
    await manager.disconnect(serverName);
    return `Disconnected from ${serverName}`;
  } catch (error) {
    return `Failed to disconnect from ${serverName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * List all tools from connected servers
 */
function handleListTools(manager: McpClientManager): string {
  const tools = manager.getAllTools();
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.bold.cyan('MCP Tools'));
  lines.push(chalk.gray('─'.repeat(50)));

  if (tools.length === 0) {
    lines.push('');
    lines.push('No tools available. Connect to an MCP server first.');
    return lines.join('\n');
  }

  // Group by server
  const byServer = new Map<string, typeof tools>();
  for (const tool of tools) {
    const existing = byServer.get(tool.serverName) ?? [];
    existing.push(tool);
    byServer.set(tool.serverName, existing);
  }

  for (const [serverName, serverTools] of byServer) {
    lines.push('');
    lines.push(chalk.bold(`${serverName} (${serverTools.length} tools):`));
    for (const tool of serverTools) {
      const shortName = tool.name.replace(`mcp__${serverName}__`, '');
      lines.push(`  ${chalk.yellow(shortName)} ${chalk.gray(tool.description.slice(0, 60))}`);
    }
  }

  lines.push('');
  lines.push(chalk.gray(`Total: ${tools.length} tools from ${byServer.size} servers`));

  return lines.join('\n');
}

/**
 * Add a server to config
 */
async function handleAdd(
  manager: McpClientManager,
  config: LoadedConfig | undefined,
  args: string[]
): Promise<string> {
  if (args.length < 2) {
    return 'Usage: /mcp add <name> <command> [args...]';
  }

  if (!config) {
    return 'Config not available.';
  }

  const [name, command, ...serverArgs] = args;

  // Check if server already exists
  if (config.mcp?.servers?.some(s => s.name === name)) {
    return `Server "${name}" already exists in config. Use /mcp remove first.`;
  }

  // Add to config
  if (!config.mcp) {
    config.mcp = {};
  }
  if (!config.mcp.servers) {
    config.mcp.servers = [];
  }

  const newServer = {
    name,
    transport: 'stdio' as const,
    command,
    args: serverArgs.length > 0 ? serverArgs : undefined,
    autoConnect: true,
  };

  config.mcp.servers.push(newServer);

  try {
    await saveConfig(config);

    // Auto-connect
    try {
      await manager.connect(newServer);
      const tools = manager.getToolsForServer(name);
      return `Added and connected to "${name}" (${tools.length} tools available)`;
    } catch (connectError) {
      return `Added "${name}" to config but failed to connect: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`;
    }
  } catch (error) {
    return `Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Remove a server from config
 */
async function handleRemove(
  manager: McpClientManager,
  config: LoadedConfig | undefined,
  args: string[]
): Promise<string> {
  const serverName = args[0];
  if (!serverName) {
    return 'Usage: /mcp remove <server-name>';
  }

  if (!config) {
    return 'Config not available.';
  }

  const serverIndex = config.mcp?.servers?.findIndex(s => s.name === serverName);
  if (serverIndex === undefined || serverIndex < 0) {
    return `Server "${serverName}" not found in config.`;
  }

  // Disconnect if connected
  try {
    await manager.disconnect(serverName);
  } catch {
    // Ignore - might not be connected
  }

  // Remove from config
  config.mcp!.servers!.splice(serverIndex, 1);

  try {
    await saveConfig(config);
    return `Removed "${serverName}" from config`;
  } catch (error) {
    return `Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export const metadata = {
  command: '/mcp',
  description: t('commands.mcp.description'),
  implemented: true,
};

export const installMetadata = {
  command: '/mcp install',
  description: t('commands.mcp.installDescription'),
  implemented: true,
};
