/**
 * MCP (Model Context Protocol) Client Tests
 * TDD: Tests written first, implementation follows
 */
import { describe, it, expect } from 'vitest';
import {
  validateMcpServerConfig,
  convertMcpToolToAutohand,
  type McpServerConfig,
} from '../../src/mcp/types.js';
import { McpClientManager } from '../../src/mcp/McpClientManager.js';

// ============================================================================
// Types: validateMcpServerConfig
// ============================================================================

describe('validateMcpServerConfig', () => {
  it('validates a valid stdio server config', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    };
    expect(() => validateMcpServerConfig(config)).not.toThrow();
  });

  it('validates a valid sse server config', () => {
    const config: McpServerConfig = {
      name: 'test-sse-server',
      transport: 'sse',
      url: 'http://localhost:3000/sse',
    };
    expect(() => validateMcpServerConfig(config)).not.toThrow();
  });

  it('rejects config missing name', () => {
    const config = {
      transport: 'stdio',
      command: 'node',
    } as McpServerConfig;
    expect(() => validateMcpServerConfig(config)).toThrow(/name/i);
  });

  it('rejects config with empty name', () => {
    const config: McpServerConfig = {
      name: '',
      transport: 'stdio',
      command: 'node',
    };
    expect(() => validateMcpServerConfig(config)).toThrow(/name/i);
  });

  it('rejects stdio config missing command', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
    };
    expect(() => validateMcpServerConfig(config)).toThrow(/command/i);
  });

  it('rejects sse config missing url', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'sse',
    };
    expect(() => validateMcpServerConfig(config)).toThrow(/url/i);
  });

  it('rejects config with invalid transport type', () => {
    const config = {
      name: 'test-server',
      transport: 'websocket',
      command: 'node',
    } as unknown as McpServerConfig;
    expect(() => validateMcpServerConfig(config)).toThrow(/transport/i);
  });

  it('accepts stdio config with env and autoConnect', () => {
    const config: McpServerConfig = {
      name: 'test-server',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@some/mcp-server'],
      env: { API_KEY: 'test-key' },
      autoConnect: false,
    };
    expect(() => validateMcpServerConfig(config)).not.toThrow();
  });
});

// ============================================================================
// Types: convertMcpToolToAutohand
// ============================================================================

describe('convertMcpToolToAutohand', () => {
  it('converts MCP tool to Autohand format with mcp__ prefix', () => {
    const mcpTool = {
      name: 'read_file',
      description: 'Read a file from disk',
      inputSchema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    };

    const result = convertMcpToolToAutohand(mcpTool, 'filesystem');

    expect(result.name).toBe('mcp__filesystem__read_file');
    expect(result.description).toBe('Read a file from disk');
    expect(result.serverName).toBe('filesystem');
    expect(result.parameters.type).toBe('object');
    expect(result.parameters.properties).toHaveProperty('path');
    expect(result.parameters.required).toEqual(['path']);
  });

  it('includes server name in prefix', () => {
    const mcpTool = {
      name: 'query',
      description: 'Run a database query',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sql: { type: 'string' },
        },
      },
    };

    const result = convertMcpToolToAutohand(mcpTool, 'postgres-db');

    expect(result.name).toBe('mcp__postgres-db__query');
    expect(result.serverName).toBe('postgres-db');
  });

  it('handles tools with no required fields', () => {
    const mcpTool = {
      name: 'list_items',
      description: 'List all items',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filter: { type: 'string' },
        },
      },
    };

    const result = convertMcpToolToAutohand(mcpTool, 'store');

    expect(result.name).toBe('mcp__store__list_items');
    expect(result.parameters.required).toBeUndefined();
  });

  it('handles tools with empty properties', () => {
    const mcpTool = {
      name: 'ping',
      description: 'Ping the server',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    };

    const result = convertMcpToolToAutohand(mcpTool, 'health');

    expect(result.name).toBe('mcp__health__ping');
    expect(result.parameters.properties).toEqual({});
  });
});

// ============================================================================
// McpClientManager: Static Methods
// ============================================================================

describe('McpClientManager', () => {
  describe('isMcpTool', () => {
    it('returns true for mcp__ prefixed tools', () => {
      expect(McpClientManager.isMcpTool('mcp__server__tool')).toBe(true);
      expect(McpClientManager.isMcpTool('mcp__fs__read_file')).toBe(true);
      expect(McpClientManager.isMcpTool('mcp__db__query')).toBe(true);
    });

    it('returns false for non-mcp tools', () => {
      expect(McpClientManager.isMcpTool('read_file')).toBe(false);
      expect(McpClientManager.isMcpTool('run_command')).toBe(false);
      expect(McpClientManager.isMcpTool('mcp_not_prefixed')).toBe(false);
      expect(McpClientManager.isMcpTool('')).toBe(false);
    });
  });

  describe('parseMcpToolName', () => {
    it('extracts server and tool name', () => {
      const result = McpClientManager.parseMcpToolName('mcp__filesystem__read_file');
      expect(result).toEqual({
        serverName: 'filesystem',
        toolName: 'read_file',
      });
    });

    it('handles tool names with underscores', () => {
      const result = McpClientManager.parseMcpToolName('mcp__my-server__my_complex_tool');
      expect(result).toEqual({
        serverName: 'my-server',
        toolName: 'my_complex_tool',
      });
    });

    it('handles server names with hyphens', () => {
      const result = McpClientManager.parseMcpToolName('mcp__postgres-db__run_query');
      expect(result).toEqual({
        serverName: 'postgres-db',
        toolName: 'run_query',
      });
    });

    it('returns null for invalid format', () => {
      expect(McpClientManager.parseMcpToolName('read_file')).toBeNull();
      expect(McpClientManager.parseMcpToolName('mcp__')).toBeNull();
      expect(McpClientManager.parseMcpToolName('mcp__server')).toBeNull();
      expect(McpClientManager.parseMcpToolName('mcp__server__')).toBeNull();
      expect(McpClientManager.parseMcpToolName('')).toBeNull();
    });
  });

  describe('listServers', () => {
    it('returns empty array when no servers connected', () => {
      const manager = new McpClientManager();
      expect(manager.listServers()).toEqual([]);
    });
  });

  describe('getAllTools', () => {
    it('returns empty array when no servers connected', () => {
      const manager = new McpClientManager();
      expect(manager.getAllTools()).toEqual([]);
    });
  });

  describe('disconnectAll', () => {
    it('does nothing when no servers are connected', async () => {
      const manager = new McpClientManager();
      await expect(manager.disconnectAll()).resolves.toBeUndefined();
    });
  });

  describe('disconnect', () => {
    it('throws when server not found', async () => {
      const manager = new McpClientManager();
      await expect(manager.disconnect('nonexistent')).rejects.toThrow(/not found/i);
    });
  });

  describe('callTool', () => {
    it('throws when server not connected', async () => {
      const manager = new McpClientManager();
      await expect(manager.callTool('nonexistent', 'tool', {})).rejects.toThrow(/not found|not connected/i);
    });
  });
});
