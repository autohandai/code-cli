/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockAgent,
  mockConversation,
  mockSessionManager,
  mockMcpManager,
  mockPermissionManager,
} = vi.hoisted(() => {
  const mockSessionManager = {
    listSessions: vi.fn<() => Promise<any[]>>(),
  };

  const mockMcpManager = {
    getServers: vi.fn<() => any[]>(),
    getAllTools: vi.fn<() => any[]>(),
    getToolsForServer: vi.fn<() => any[]>(),
  };

  const mockPermissionManager = {
    setMode: vi.fn(),
    getMode: vi.fn().mockReturnValue('interactive'),
  };

  const mockAgent = {
    getSessionManager: vi.fn().mockReturnValue(mockSessionManager),
    getMcpManager: vi.fn().mockReturnValue(mockMcpManager),
    getPermissionManager: vi.fn().mockReturnValue(mockPermissionManager),
    getFileManager: vi.fn(),
    getHookManager: vi.fn(),
    getSkillsRegistry: vi.fn(),
    getAutomodeManager: vi.fn(),
    getImageManager: vi.fn().mockReturnValue({ clear: vi.fn() }),
    getStatusSnapshot: vi.fn().mockReturnValue({ tokensUsed: 0, contextPercent: 0, model: 'test' }),
    setStatusListener: vi.fn(),
    setOutputListener: vi.fn(),
    setConfirmationCallback: vi.fn(),
    isSlashCommand: vi.fn().mockReturnValue(false),
    isSlashCommandSupported: vi.fn().mockReturnValue(false),
    handleSlashCommand: vi.fn(),
    parseSlashCommand: vi.fn(),
    runInstruction: vi.fn().mockResolvedValue(true),
  };

  const mockConversation = {
    history: vi.fn().mockReturnValue([]),
    reset: vi.fn(),
  };

  return { mockAgent, mockConversation, mockSessionManager, mockMcpManager, mockPermissionManager };
});

// Mock protocol.js to suppress stdout writes
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => new Date().toISOString(),
  generateId: (prefix: string) => `${prefix}_test123`,
}));

// Import after mocks
import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RPC Adapter — P2 Handlers', () => {
  let adapter: RPCAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish mocks after clearAllMocks
    mockAgent.getSessionManager.mockReturnValue(mockSessionManager);
    mockAgent.getMcpManager.mockReturnValue(mockMcpManager);
    mockAgent.getPermissionManager.mockReturnValue(mockPermissionManager);
    mockAgent.getImageManager.mockReturnValue({ clear: vi.fn() });
    mockAgent.getStatusSnapshot.mockReturnValue({ tokensUsed: 0, contextPercent: 0, model: 'test' });
    mockPermissionManager.getMode.mockReturnValue('interactive');

    adapter = new RPCAdapter();
    adapter.initialize(
      mockAgent as any,
      mockConversation as any,
      'test-model',
      '/test/workspace'
    );
  });

  // -------------------------------------------------------------------------
  // handleGetHistory()
  // -------------------------------------------------------------------------

  describe('handleGetHistory()', () => {
    it('returns empty result when session manager is unavailable', async () => {
      mockAgent.getSessionManager.mockReturnValue(undefined);

      const result = await adapter.handleGetHistory('req_1');

      expect(result.sessions).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it('returns paginated session history', async () => {
      const sessions = [
        {
          sessionId: 's1',
          createdAt: '2025-01-01T00:00:00Z',
          lastActiveAt: '2025-01-01T01:00:00Z',
          projectName: 'proj1',
          model: 'claude-3.5-sonnet',
          messageCount: 10,
          status: 'completed',
        },
        {
          sessionId: 's2',
          createdAt: '2025-01-02T00:00:00Z',
          lastActiveAt: '2025-01-02T01:00:00Z',
          projectName: 'proj2',
          model: 'gpt-4o',
          messageCount: 5,
          status: 'active',
        },
        {
          sessionId: 's3',
          createdAt: '2025-01-03T00:00:00Z',
          lastActiveAt: '2025-01-03T01:00:00Z',
          projectName: 'proj3',
          model: 'claude-3.5-sonnet',
          messageCount: 20,
          status: 'completed',
        },
      ];
      mockSessionManager.listSessions.mockResolvedValue(sessions);

      const result = await adapter.handleGetHistory('req_1', { page: 1, pageSize: 2 });

      expect(result.sessions).toHaveLength(2);
      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(2);
      expect(result.totalItems).toBe(3);
      expect(result.sessions[0].sessionId).toBe('s1');
      expect(result.sessions[1].sessionId).toBe('s2');
    });

    it('returns page 2 with remaining sessions', async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => ({
        sessionId: `s${i}`,
        createdAt: `2025-01-0${i + 1}T00:00:00Z`,
        projectName: `proj${i}`,
        model: 'test',
        messageCount: i * 5,
        status: 'completed',
      }));
      mockSessionManager.listSessions.mockResolvedValue(sessions);

      const result = await adapter.handleGetHistory('req_1', { page: 2, pageSize: 3 });

      expect(result.sessions).toHaveLength(2);
      expect(result.currentPage).toBe(2);
      expect(result.sessions[0].sessionId).toBe('s3');
    });

    it('uses default page size of 20', async () => {
      mockSessionManager.listSessions.mockResolvedValue([]);

      const result = await adapter.handleGetHistory('req_1');

      expect(result.currentPage).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('handles listSessions errors gracefully', async () => {
      mockSessionManager.listSessions.mockRejectedValue(new Error('disk error'));

      const result = await adapter.handleGetHistory('req_1');

      expect(result.sessions).toEqual([]);
      expect(result.totalItems).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // handleYoloSet()
  // -------------------------------------------------------------------------

  describe('handleYoloSet()', () => {
    it('sets unrestricted mode', () => {
      const result = adapter.handleYoloSet('req_1', { pattern: '*' });

      expect(result.success).toBe(true);
      expect(mockPermissionManager.setMode).toHaveBeenCalledWith('unrestricted');
    });

    it('returns expiresIn when timeout is set', () => {
      const result = adapter.handleYoloSet('req_1', {
        pattern: 'run_command',
        timeoutSeconds: 300,
      });

      expect(result.success).toBe(true);
      expect(result.expiresIn).toBe(300);
    });

    it('returns success false when permission manager unavailable', () => {
      mockAgent.getPermissionManager.mockReturnValue(undefined);

      const result = adapter.handleYoloSet('req_1', { pattern: '*' });

      expect(result.success).toBe(false);
    });

    it('does not set expiresIn without timeout', () => {
      const result = adapter.handleYoloSet('req_1', { pattern: '*' });

      expect(result.expiresIn).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // handleMcpListServers()
  // -------------------------------------------------------------------------

  describe('handleMcpListServers()', () => {
    it('returns empty list when MCP manager unavailable', () => {
      mockAgent.getMcpManager.mockReturnValue(undefined);

      const result = adapter.handleMcpListServers('req_1');

      expect(result.servers).toEqual([]);
    });

    it('returns server list from MCP manager', () => {
      mockMcpManager.getServers.mockReturnValue([
        { name: 'filesystem', status: 'connected', toolCount: 3 },
        { name: 'context7', status: 'connected', toolCount: 2 },
        { name: 'broken', status: 'error', toolCount: 0 },
      ]);

      const result = adapter.handleMcpListServers('req_1');

      expect(result.servers).toHaveLength(3);
      expect(result.servers[0]).toEqual({ name: 'filesystem', status: 'connected', toolCount: 3 });
      expect(result.servers[2]).toEqual({ name: 'broken', status: 'error', toolCount: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // handleMcpListTools()
  // -------------------------------------------------------------------------

  describe('handleMcpListTools()', () => {
    it('returns empty list when MCP manager unavailable', () => {
      mockAgent.getMcpManager.mockReturnValue(undefined);

      const result = adapter.handleMcpListTools('req_1');

      expect(result.tools).toEqual([]);
    });

    it('returns all tools when no server filter', () => {
      mockMcpManager.getAllTools.mockReturnValue([
        { name: 'mcp__fs__read_file', description: 'Read a file' },
        { name: 'mcp__fs__write_file', description: 'Write a file' },
        { name: 'mcp__context7__query-docs', description: 'Query docs' },
      ]);

      const result = adapter.handleMcpListTools('req_1');

      expect(result.tools).toHaveLength(3);
      expect(result.tools[0].name).toBe('mcp__fs__read_file');
      expect(result.tools[0].serverName).toBe('fs');
      expect(result.tools[2].serverName).toBe('context7');
    });

    it('filters tools by server name', () => {
      mockMcpManager.getToolsForServer.mockReturnValue([
        { name: 'mcp__fs__read_file', description: 'Read a file' },
      ]);

      const result = adapter.handleMcpListTools('req_1', { serverName: 'fs' });

      expect(mockMcpManager.getToolsForServer).toHaveBeenCalledWith('fs');
      expect(result.tools).toHaveLength(1);
    });

    it('parses server name from tool name correctly', () => {
      mockMcpManager.getAllTools.mockReturnValue([
        { name: 'mcp__my_server__my_tool', description: 'A tool' },
      ]);

      const result = adapter.handleMcpListTools('req_1');

      expect(result.tools[0].serverName).toBe('my_server');
    });
  });
});
