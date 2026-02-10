/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Interactive MCP Server toggle list - Ink component
 * Allows users to enable/disable MCP servers with arrow keys + space
 */
import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, render } from 'ink';
import { I18nProvider } from '../../i18n/index.js';

export interface McpServerItem {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  toolCount: number;
  error?: string;
}

interface McpServerListProps {
  servers: McpServerItem[];
  onToggle: (serverName: string, currentStatus: McpServerItem['status']) => void;
  onDone: () => void;
}

function McpServerList({ servers, onToggle, onDone }: McpServerListProps) {
  const [cursor, setCursor] = useState(0);
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = useCallback(async () => {
    const server = servers[cursor];
    if (!server || toggling) return;
    setToggling(server.name);
    onToggle(server.name, server.status);
    // Parent will re-render with updated status
    setToggling(null);
  }, [cursor, servers, toggling, onToggle]);

  useInput((char, key) => {
    if (key.escape || (char === 'q' && !key.ctrl)) {
      onDone();
      return;
    }

    if (key.upArrow) {
      setCursor((prev) => (prev > 0 ? prev - 1 : servers.length - 1));
      return;
    }

    if (key.downArrow) {
      setCursor((prev) => (prev < servers.length - 1 ? prev + 1 : 0));
      return;
    }

    if (char === ' ' || key.return) {
      handleToggle();
      return;
    }
  });

  if (servers.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="cyan" bold>MCP Servers</Text>
        <Text> </Text>
        <Text color="gray">No MCP servers configured.</Text>
        <Text> </Text>
        <Text color="gray">Add a server:  /mcp add {'<name>'} {'<command>'} [args...]</Text>
        <Text color="gray">Browse:        /mcp install</Text>
        <Text> </Text>
        <Text color="gray">Press ESC or q to close</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan" bold>MCP Servers</Text>
      <Box marginBottom={1}>
        <Text color="gray">{'─'.repeat(56)}</Text>
      </Box>

      {servers.map((server, i) => {
        const isSelected = i === cursor;
        const isToggling = toggling === server.name;

        const statusIcon =
          server.status === 'connected'
            ? '●'
            : server.status === 'error'
              ? '●'
              : '○';

        const statusColor =
          server.status === 'connected'
            ? 'green'
            : server.status === 'error'
              ? 'red'
              : 'gray';

        const statusLabel =
          server.status === 'connected'
            ? 'enabled'
            : server.status === 'error'
              ? 'error'
              : 'disabled';

        const toolsInfo =
          server.status === 'connected' && server.toolCount > 0
            ? ` (${server.toolCount} tools)`
            : '';

        return (
          <Box key={server.name} flexDirection="column">
            <Box>
              <Text color={isSelected ? 'yellow' : undefined}>
                {isSelected ? '\u25b8 ' : '  '}
              </Text>
              <Text color={statusColor}>{statusIcon} </Text>
              <Text bold={isSelected}>{server.name.padEnd(24)}</Text>
              <Text color={statusColor}>{isToggling ? 'toggling...' : statusLabel}</Text>
              <Text color="gray">{toolsInfo}</Text>
            </Box>
            {isSelected && server.status === 'error' && server.error && (
              <Box marginLeft={4}>
                <Text color="red" dimColor>  {server.error}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Text> </Text>
      <Box flexDirection="column">
        <Text color="gray">{'↑↓'} navigate  {'⏎/space'} toggle  {'q/esc'} close</Text>
        <Text color="gray">Connected servers provide tools to the agent</Text>
      </Box>
    </Box>
  );
}

export interface ShowMcpServerListOptions {
  servers: McpServerItem[];
  onToggle: (serverName: string, currentStatus: McpServerItem['status']) => Promise<McpServerItem[]>;
}

/**
 * Show an interactive MCP server toggle list.
 * Returns when user presses ESC or q.
 */
export async function showMcpServerList(
  options: ShowMcpServerListOptions
): Promise<void> {
  if (!process.stdout.isTTY) {
    return;
  }

  let currentServers = [...options.servers];

  return new Promise<void>((resolve) => {
    let completed = false;
    let instance: ReturnType<typeof render>;

    const renderList = () => {
      const element = (
        <I18nProvider>
          <McpServerList
            servers={currentServers}
            onToggle={async (name, status) => {
              currentServers = await options.onToggle(name, status);
              // Re-render with updated state
              instance.rerender(
                <I18nProvider>
                  <McpServerList
                    servers={currentServers}
                    onToggle={async (n, s) => {
                      currentServers = await options.onToggle(n, s);
                      renderList();
                    }}
                    onDone={() => {
                      if (completed) return;
                      completed = true;
                      instance.unmount();
                      resolve();
                    }}
                  />
                </I18nProvider>
              );
            }}
            onDone={() => {
              if (completed) return;
              completed = true;
              instance.unmount();
              resolve();
            }}
          />
        </I18nProvider>
      );

      if (instance) {
        instance.rerender(element);
      } else {
        instance = render(element, { exitOnCtrlC: false });
      }
    };

    renderList();
  });
}

export { McpServerList };
export default McpServerList;
