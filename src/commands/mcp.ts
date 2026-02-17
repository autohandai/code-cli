/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * MCP command - List and manage MCP (Model Context Protocol) servers
 */
import chalk from 'chalk';
import path from 'node:path';
import { t } from '../i18n/index.js';
import type { McpClientManager } from '../mcp/McpClientManager.js';
import { normalizeMcpCommandForConfig } from '../mcp/commandNormalization.js';
import type { LoadedConfig } from '../types.js';
import { loadConfig, saveConfig } from '../config.js';
import { PROJECT_DIR_NAME } from '../constants.js';
import {
  showMcpServerList,
  type McpServerItem,
} from '../ui/ink/components/McpServerList.js';

type McpConfigScope = 'user' | 'project';

export interface McpCommandContext {
  mcpManager?: McpClientManager;
  config?: LoadedConfig;
  workspaceRoot?: string;
}

function normalizeMcpScope(scopeInput?: string): McpConfigScope | null {
  const scope = (scopeInput ?? 'user').toLowerCase();
  if (scope === 'user' || scope === 'project') {
    return scope;
  }
  return null;
}

async function loadConfigForScope(
  scopeInput: string,
  workspaceRoot?: string
): Promise<{ config: LoadedConfig; scope: McpConfigScope }> {
  const scope = normalizeMcpScope(scopeInput);
  if (!scope) {
    throw new Error(`Invalid scope "${scopeInput}". Use: user or project.`);
  }

  if (scope === 'user') {
    return { config: await loadConfig(), scope };
  }

  if (!workspaceRoot) {
    throw new Error('Workspace root is required for project scope.');
  }

  const projectConfigPath = path.join(workspaceRoot, PROJECT_DIR_NAME, 'config.json');
  return { config: await loadConfig(projectConfigPath), scope };
}

function syncRuntimeConfig(runtimeConfig: LoadedConfig | undefined, updatedConfig: LoadedConfig): void {
  if (!runtimeConfig) return;
  if (runtimeConfig.configPath !== updatedConfig.configPath) return;
  runtimeConfig.mcp = updatedConfig.mcp;
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
  const { mcpManager, config, workspaceRoot } = ctx;

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
      return handleAdd(mcpManager, config, args.slice(1), workspaceRoot);

    case 'remove':
    case 'rm':
      return handleRemove(mcpManager, config, args.slice(1), workspaceRoot);

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
    error: s.error,
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
    lines.push(chalk.gray('  /mcp add [--scope user|project] <name> <command> [args...]'));
    lines.push(chalk.gray('  /mcp add --transport http <name> <url>'));
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
  args: string[],
  workspaceRoot?: string
): Promise<string> {
  type Transport = 'stdio' | 'http' | 'sse';

  let transport: Transport = 'stdio';
  let scopeInput: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--transport' || token === '-t') {
      const value = args[i + 1];
      if (!value) {
        return 'Usage: /mcp add [--transport <stdio|http|sse>] [--scope <user|project>] <name> <command-or-url> [args...]';
      }
      const lowered = value.toLowerCase();
      if (lowered !== 'stdio' && lowered !== 'http' && lowered !== 'sse') {
        return `Invalid transport "${value}". Use: stdio or http.`;
      }
      transport = lowered;
      i++;
      continue;
    }
    if (token === '--scope' || token === '-s') {
      const value = args[i + 1];
      if (!value) {
        return 'Usage: /mcp add [--transport <stdio|http|sse>] [--scope <user|project>] <name> <command-or-url> [args...]';
      }
      scopeInput = value;
      i++;
      continue;
    }
    positional.push(token);
  }

  if (positional.length < 2) {
    return 'Usage: /mcp add [--transport <stdio|http|sse>] [--scope <user|project>] <name> <command-or-url> [args...]';
  }

  const [name, target, ...serverArgs] = positional;
  if (transport === 'sse') {
    return 'SSE transport is not implemented yet. Use --transport http or stdio.';
  }

  if (transport === 'http' && serverArgs.length > 0) {
    return `Transport "${transport}" does not accept extra args. Usage: /mcp add --transport ${transport} <name> <url>`;
  }

  let targetConfig = config;
  let scopeLabel: McpConfigScope | undefined;
  if (scopeInput) {
    try {
      const scoped = await loadConfigForScope(scopeInput, workspaceRoot);
      targetConfig = scoped.config;
      scopeLabel = scoped.scope;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  if (!targetConfig) {
    return 'Config not available.';
  }

  const normalized = normalizeMcpCommandForConfig(
    target,
    serverArgs.length > 0 ? serverArgs : undefined
  );
  const normalizedCommand = normalized.command ?? target;
  const normalizedArgs = normalized.args;

  if (!targetConfig.mcp) {
    targetConfig.mcp = {};
  }
  if (!targetConfig.mcp.servers) {
    targetConfig.mcp.servers = [];
  }
  const wasMcpDisabled = targetConfig.mcp.enabled === false;
  if (wasMcpDisabled) {
    targetConfig.mcp.enabled = true;
  }

  const newServer = transport === 'stdio'
    ? {
        name,
        transport: 'stdio' as const,
        command: normalizedCommand,
        args: normalizedArgs,
        autoConnect: true,
      }
      : {
          name,
          transport: 'http' as const,
          url: target,
          autoConnect: true,
        };

  const displayTarget = transport === 'stdio'
    ? `${normalizedCommand} ${(normalizedArgs ?? []).join(' ')}`.trim()
    : target;

  const existing = targetConfig.mcp.servers.find(s => s.name === name);
  const scopeSuffix = scopeLabel ? ` in ${scopeLabel} config` : '';

  if (existing) {
    const sameConfig = transport === 'stdio'
      ? existing.transport === 'stdio'
        && existing.command === normalizedCommand
        && JSON.stringify(existing.args) === JSON.stringify(normalizedArgs)
      : existing.transport === transport
        && existing.url === target;

    if (sameConfig) {
      const wasAutoConnectDisabled = existing.autoConnect === false;
      if (!wasAutoConnectDisabled && !wasMcpDisabled) {
        return `Server "${name}" is already configured with the same settings${scopeSuffix}.`;
      }

      existing.autoConnect = true;
      const reenabledParts: string[] = [];
      if (wasMcpDisabled) reenabledParts.push('MCP support');
      if (wasAutoConnectDisabled) reenabledParts.push('auto-connect');
      const reenabled = reenabledParts.join(' and ');

      try {
        await saveConfig(targetConfig);
        syncRuntimeConfig(config, targetConfig);

        try {
          await manager.connect(existing);
          const tools = manager.getToolsForServer(name);
          return `Server "${name}" is already configured${scopeSuffix}. Re-enabled ${reenabled} and connected (${tools.length} tools available).`;
        } catch (connectError) {
          return `Server "${name}" is already configured${scopeSuffix}. Re-enabled ${reenabled} but failed to connect: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`;
        }
      } catch (error) {
        return `Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    // Update in-place
    existing.transport = newServer.transport;
    if (newServer.transport === 'stdio') {
      existing.command = newServer.command;
      existing.args = newServer.args;
      existing.url = undefined;
    } else {
      existing.url = newServer.url;
      existing.command = undefined;
      existing.args = undefined;
    }
    existing.autoConnect = true;

    try {
      await saveConfig(targetConfig);
      syncRuntimeConfig(config, targetConfig);

      // Disconnect old, reconnect with new config
      try {
        await manager.disconnect(name);
      } catch { /* may not be connected */ }

      try {
        await manager.connect(existing);
        const tools = manager.getToolsForServer(name);
        return `Updated and reconnected "${name}"${scopeSuffix} (${transport}: ${displayTarget}, ${tools.length} tools available)`;
      } catch (connectError) {
        return `Updated "${name}" config${scopeSuffix} but failed to reconnect: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`;
      }
    } catch (error) {
      return `Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  targetConfig.mcp.servers.push(newServer);

  try {
    await saveConfig(targetConfig);
    syncRuntimeConfig(config, targetConfig);

    // Auto-connect
    try {
      await manager.connect(newServer);
      const tools = manager.getToolsForServer(name);
      return `Added and connected to "${name}"${scopeSuffix} (${transport}: ${displayTarget}, ${tools.length} tools available)`;
    } catch (connectError) {
      return `Added "${name}" to config${scopeSuffix} but failed to connect: ${connectError instanceof Error ? connectError.message : 'Unknown error'}`;
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
  args: string[],
  workspaceRoot?: string
): Promise<string> {
  let scopeInput: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--scope' || token === '-s') {
      const value = args[i + 1];
      if (!value) {
        return 'Usage: /mcp remove [--scope <user|project>] <server-name>';
      }
      scopeInput = value;
      i++;
      continue;
    }
    positional.push(token);
  }

  const serverName = positional[0];
  if (!serverName) {
    return 'Usage: /mcp remove [--scope <user|project>] <server-name>';
  }

  let targetConfig = config;
  let scopeLabel: McpConfigScope | undefined;
  if (scopeInput) {
    try {
      const scoped = await loadConfigForScope(scopeInput, workspaceRoot);
      targetConfig = scoped.config;
      scopeLabel = scoped.scope;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  if (!targetConfig) {
    return 'Config not available.';
  }

  const serverIndex = targetConfig.mcp?.servers?.findIndex(s => s.name === serverName);
  if (serverIndex === undefined || serverIndex < 0) {
    return `Server "${serverName}" not found in ${scopeLabel ? `${scopeLabel} config` : 'config'}.`;
  }

  // Disconnect if connected
  try {
    await manager.disconnect(serverName);
  } catch {
    // Ignore - might not be connected
  }

  // Remove from config
  targetConfig.mcp!.servers!.splice(serverIndex, 1);

  try {
    await saveConfig(targetConfig);
    syncRuntimeConfig(config, targetConfig);
    return `Removed "${serverName}" from ${scopeLabel ? `${scopeLabel} config` : 'config'}`;
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
