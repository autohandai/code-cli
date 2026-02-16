/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for MCP Client Manager - static helpers, server state, and connection flow
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClientManager } from '../src/mcp/McpClientManager.js';
import type { McpServerConfig } from '../src/mcp/types.js';
import path from 'node:path';

const framedServerScript = path.resolve('tests/fixtures/mock-mcp-server-framed.mjs');

const stdioConfig: McpServerConfig = {
  name: 'test-server',
  transport: 'stdio',
  command: 'node',
  args: [framedServerScript],
  autoConnect: true,
};

const badConfig: McpServerConfig = {
  name: 'bad-server',
  transport: 'stdio',
  command: 'nonexistent-command-that-does-not-exist-12345',
  args: [],
  autoConnect: true,
};

describe('McpClientManager', () => {
  let manager: McpClientManager;

  beforeEach(() => {
    manager = new McpClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll().catch(() => {});
  });

  // ========================================================================
  // Static helper: isMcpTool
  // ========================================================================

  describe('isMcpTool', () => {
    it('returns true for MCP-prefixed tool names', () => {
      expect(McpClientManager.isMcpTool('mcp__server__tool')).toBe(true);
      expect(McpClientManager.isMcpTool('mcp__chrome-devtools__screenshot')).toBe(true);
    });

    it('returns false for non-MCP tool names', () => {
      expect(McpClientManager.isMcpTool('read_file')).toBe(false);
      expect(McpClientManager.isMcpTool('run_command')).toBe(false);
      expect(McpClientManager.isMcpTool('')).toBe(false);
    });
  });

  // ========================================================================
  // Static helper: parseMcpToolName
  // ========================================================================

  describe('parseMcpToolName', () => {
    it('extracts server and tool name from prefixed format', () => {
      expect(McpClientManager.parseMcpToolName('mcp__myserver__my_tool')).toEqual({
        serverName: 'myserver',
        toolName: 'my_tool',
      });
    });

    it('handles server names with hyphens', () => {
      expect(McpClientManager.parseMcpToolName('mcp__chrome-devtools__take_screenshot')).toEqual({
        serverName: 'chrome-devtools',
        toolName: 'take_screenshot',
      });
    });

    it('handles tool names with double underscores', () => {
      const result = McpClientManager.parseMcpToolName('mcp__server__nested__tool');
      expect(result).toEqual({
        serverName: 'server',
        toolName: 'nested__tool',
      });
    });

    it('returns null for non-MCP names', () => {
      expect(McpClientManager.parseMcpToolName('read_file')).toBeNull();
    });

    it('returns null for incomplete MCP names', () => {
      expect(McpClientManager.parseMcpToolName('mcp__')).toBeNull();
      expect(McpClientManager.parseMcpToolName('mcp__server')).toBeNull();
      expect(McpClientManager.parseMcpToolName('mcp____tool')).toBeNull();
    });
  });

  // ========================================================================
  // connectAll
  // ========================================================================

  describe('connectAll', () => {
    it('skips servers with autoConnect: false', async () => {
      const configs: McpServerConfig[] = [
        { ...stdioConfig, autoConnect: false },
      ];

      await manager.connectAll(configs);
      expect(manager.listServers()).toHaveLength(0);
    });

    it('connects servers with autoConnect: true (default)', async () => {
      await manager.connectAll([stdioConfig]);

      const servers = manager.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('test-server');
      expect(servers[0].status).toBe('connected');
    });

    it('stores error state for servers that fail to connect', async () => {
      await manager.connectAll([badConfig]);

      const servers = manager.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe('bad-server');
      expect(servers[0].status).toBe('error');
      expect(servers[0].error).toBeTruthy();
      expect(servers[0].toolCount).toBe(0);
    });

    it('connects multiple servers independently', async () => {
      await manager.connectAll([stdioConfig, badConfig]);

      const servers = manager.listServers();
      expect(servers).toHaveLength(2);

      const goodServer = servers.find(s => s.name === 'test-server');
      const badServer = servers.find(s => s.name === 'bad-server');

      expect(goodServer?.status).toBe('connected');
      expect(badServer?.status).toBe('error');
    });
  });

  // ========================================================================
  // connect + disconnect
  // ========================================================================

  describe('connect', () => {
    it('connects to a Content-Length framed stdio server', async () => {
      await manager.connect(stdioConfig);

      const servers = manager.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].status).toBe('connected');
      expect(servers[0].toolCount).toBeGreaterThan(0);
    });

    it('throws for invalid command', async () => {
      await expect(manager.connect(badConfig)).rejects.toThrow();
    });

    it('reconnects if server already exists', async () => {
      await manager.connect(stdioConfig);
      expect(manager.listServers()[0].status).toBe('connected');

      // Connect again — should disconnect old and reconnect
      await manager.connect(stdioConfig);
      expect(manager.listServers()).toHaveLength(1);
      expect(manager.listServers()[0].status).toBe('connected');
    });
  });

  describe('disconnect', () => {
    it('removes a connected server', async () => {
      await manager.connect(stdioConfig);
      expect(manager.listServers()).toHaveLength(1);

      await manager.disconnect('test-server');
      expect(manager.listServers()).toHaveLength(0);
    });

    it('throws for unknown server name', async () => {
      await expect(manager.disconnect('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('disconnectAll', () => {
    it('removes all connected servers', async () => {
      await manager.connect(stdioConfig);
      expect(manager.listServers()).toHaveLength(1);

      await manager.disconnectAll();
      expect(manager.listServers()).toHaveLength(0);
    });
  });

  // ========================================================================
  // Tool discovery
  // ========================================================================

  describe('getAllTools', () => {
    it('returns tools from connected servers', async () => {
      await manager.connect(stdioConfig);

      const tools = manager.getAllTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools[0].name).toMatch(/^mcp__test-server__/);
      expect(tools[0].serverName).toBe('test-server');
    });

    it('returns empty array when no servers connected', () => {
      expect(manager.getAllTools()).toEqual([]);
    });

    it('excludes tools from error-state servers', async () => {
      await manager.connectAll([badConfig]);
      expect(manager.getAllTools()).toEqual([]);
    });
  });

  describe('getToolsForServer', () => {
    it('returns tools for a connected server', async () => {
      await manager.connect(stdioConfig);

      const tools = manager.getToolsForServer('test-server');
      expect(tools.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown server', () => {
      expect(manager.getToolsForServer('nonexistent')).toEqual([]);
    });
  });

  // ========================================================================
  // listServers with error field
  // ========================================================================

  describe('listServers', () => {
    it('returns empty array when no servers configured', () => {
      expect(manager.listServers()).toEqual([]);
    });

    it('includes error message for failed connections', async () => {
      await manager.connectAll([badConfig]);

      const servers = manager.listServers();
      expect(servers[0].error).toBeTruthy();
      expect(typeof servers[0].error).toBe('string');
    });

    it('does not include error for connected servers', async () => {
      await manager.connect(stdioConfig);

      const servers = manager.listServers();
      expect(servers[0].error).toBeUndefined();
    });
  });

  // ========================================================================
  // Close handler status preservation
  // ========================================================================

  describe('close handler preserves error status', () => {
    it('error status is not overwritten to disconnected after connection failure', async () => {
      await manager.connectAll([badConfig]);

      // Give time for any async close events to fire
      await new Promise((r) => setTimeout(r, 200));

      const servers = manager.listServers();
      expect(servers[0].status).toBe('error');
      // Error status should NOT have been overwritten to 'disconnected'
    });
  });

  // ========================================================================
  // Tool execution
  // ========================================================================

  describe('callTool', () => {
    it('calls a tool on a connected server', async () => {
      await manager.connect(stdioConfig);

      const tools = manager.getAllTools();
      expect(tools.length).toBeGreaterThan(0);

      // Call the echo_test tool
      const parsed = McpClientManager.parseMcpToolName(tools[0].name);
      expect(parsed).toBeTruthy();

      const result = await manager.callTool(parsed!.serverName, parsed!.toolName, {
        message: 'hello',
      });

      expect(result).toBeTruthy();
    });

    it('strips internal action metadata from MCP tool arguments', async () => {
      await manager.connect(stdioConfig);

      const tools = manager.getAllTools();
      expect(tools.length).toBeGreaterThan(0);

      const parsed = McpClientManager.parseMcpToolName(tools[0].name);
      expect(parsed).toBeTruthy();

      const result = await manager.callTool(parsed!.serverName, parsed!.toolName, {
        type: tools[0].name,
        message: 'hello',
      });

      expect(result).toBeTruthy();
    });

    it('throws for disconnected server', async () => {
      await expect(
        manager.callTool('nonexistent', 'tool', {})
      ).rejects.toThrow('not found or not connected');
    });
  });
});
