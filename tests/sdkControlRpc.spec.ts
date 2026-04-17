/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RPCAdapter } from '../src/modes/rpc/adapter.js';
import type {
  SetPermissionModeParams,
  SetModelParams,
  SetMaxThinkingTokensParams,
  ApplyFlagSettingsParams,
} from '../src/modes/rpc/types.js';

describe('SDK Control RPC Methods', () => {
  let adapter: RPCAdapter;

  beforeEach(() => {
    adapter = new RPCAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setPermissionMode', () => {
    it('should set permission mode', async () => {
      const params: SetPermissionModeParams = {
        mode: 'bypassPermissions',
      };

      const result = await adapter.handleSetPermissionMode(params);

      expect(result.success).toBe(true);
      expect(result.currentMode).toBe('bypassPermissions');
      expect(result.previousMode).toBe('default');
    });
  });

  describe('setModel', () => {
    it('should set model', async () => {
      const params: SetModelParams = {
        model: 'anthropic/claude-sonnet-4-20250514',
      };

      const result = await adapter.handleSetModel(params);

      expect(result.success).toBe(true);
      expect(result.currentModel).toBe('anthropic/claude-sonnet-4-20250514');
    });

    it('should reset model to undefined', async () => {
      const params: SetModelParams = {
        model: undefined,
      };

      const result = await adapter.handleSetModel(params);

      expect(result.success).toBe(true);
      expect(result.currentModel).toBeUndefined();
    });
  });

  describe('setMaxThinkingTokens', () => {
    it('should set max thinking tokens to 50000', async () => {
      const params: SetMaxThinkingTokensParams = {
        maxThinkingTokens: 50000,
      };

      const result = await adapter.handleSetMaxThinkingTokens(params);

      expect(result.success).toBe(true);
      expect(result.currentMaxThinkingTokens).toBe(50000);
    });

    it('should disable thinking with null', async () => {
      const params: SetMaxThinkingTokensParams = {
        maxThinkingTokens: null,
      };

      const result = await adapter.handleSetMaxThinkingTokens(params);

      expect(result.success).toBe(true);
      expect(result.currentMaxThinkingTokens).toBeNull();
    });
  });

  describe('applyFlagSettings', () => {
    it('should apply flag settings', async () => {
      const params: ApplyFlagSettingsParams = {
        settings: {
          permissionMode: 'bypassPermissions',
          maxTurns: 50,
        },
      };

      const result = await adapter.handleApplyFlagSettings(params);

      expect(result.success).toBe(true);
      expect(result.appliedSettings).toContain('permissionMode');
    });

    it('should handle empty settings', async () => {
      const params: ApplyFlagSettingsParams = {
        settings: {},
      };

      const result = await adapter.handleApplyFlagSettings(params);

      expect(result.success).toBe(true);
      expect(result.appliedSettings).toHaveLength(0);
    });
  });

  describe('getSupportedModels', () => {
    it('should return list of supported models', async () => {
      const result = await adapter.handleGetSupportedModels();

      expect(result.models).toBeDefined();
      expect(result.models.length).toBeGreaterThan(0);
      expect(result.models[0]).toHaveProperty('id');
      expect(result.models[0]).toHaveProperty('displayName');
    });

    it('should include claude models', async () => {
      const result = await adapter.handleGetSupportedModels();

      const claudeModels = result.models.filter(m => m.id.includes('claude'));
      expect(claudeModels.length).toBeGreaterThan(0);
    });
  });

  describe('getSupportedCommands', () => {
    it('should return list of supported commands', async () => {
      const result = await adapter.handleGetSupportedCommands();

      expect(result.commands).toBeDefined();
      expect(result.commands.length).toBeGreaterThan(0);
      expect(result.commands).toContain('help');
      expect(result.commands).toContain('model');
    });
  });

  describe('getContextUsage', () => {
    it('should return context usage breakdown', async () => {
      const result = await adapter.handleGetContextUsage();

      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('tools');
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('mcpTools');
      expect(result).toHaveProperty('memoryFiles');
      expect(result).toHaveProperty('total');
      expect(result.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reloadPlugins', () => {
    it('should reload plugins', async () => {
      const result = await adapter.handleReloadPlugins();

      expect(result.success).toBe(true);
      expect(result.reloadedPlugins).toBeDefined();
      expect(Array.isArray(result.reloadedPlugins)).toBe(true);
    });
  });

  describe('getAccountInfo', () => {
    it('should return account information', async () => {
      const result = await adapter.handleGetAccountInfo();

      expect(result.email).toBeDefined();
      expect(typeof result.email).toBe('string');
    });
  });

  describe('MCP server management', () => {
    it('should toggle MCP server', async () => {
      const result = await adapter.handleMcpToggleServer({
        serverName: 'test-server',
        enabled: true,
      });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.status).toBe('enabled');
    });

    it('should reconnect MCP server', async () => {
      const result = await adapter.handleMcpReconnectServer({
        serverName: 'test-server',
      });

      expect(result.success).toBe(true);
      expect(result.serverName).toBe('test-server');
      expect(result.status).toBe('connected');
    });

    it('should set MCP servers', async () => {
      const result = await adapter.handleMcpSetServers({
        servers: {
          'test-server': {
            transport: 'stdio',
            command: 'test',
            args: [],
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.configuredServers).toContain('test-server');
    });
  });
});
