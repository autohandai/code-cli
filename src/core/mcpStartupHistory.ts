/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface McpStartupConfiguredServer {
  name: string;
  autoConnect?: boolean;
}

export interface McpStartupRuntimeServer {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}

export interface McpStartupSummaryRow {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}

/**
 * Return configured MCP server names that should auto-connect on startup.
 */
export function getAutoConnectMcpServerNames(
  servers: McpStartupConfiguredServer[] | undefined
): string[] {
  if (!servers || servers.length === 0) {
    return [];
  }

  return servers
    .filter((server) => server.autoConnect !== false)
    .map((server) => server.name);
}

/**
 * Build a stable startup summary in configured order.
 */
export function buildMcpStartupSummaryRows(
  autoConnectServerNames: string[],
  runtimeServers: McpStartupRuntimeServer[]
): McpStartupSummaryRow[] {
  const runtimeMap = new Map(runtimeServers.map((server) => [server.name, server]));

  return autoConnectServerNames.map((name) => {
    const runtime = runtimeMap.get(name);
    if (!runtime) {
      return {
        name,
        status: 'disconnected',
        toolCount: 0,
      };
    }

    return {
      name,
      status: runtime.status,
      toolCount: runtime.toolCount,
      error: runtime.error,
    };
  });
}

export function truncateMcpStartupError(error: string, maxLength = 140): string {
  if (error.length <= maxLength) {
    return error;
  }
  return `${error.slice(0, maxLength - 1)}…`;
}

