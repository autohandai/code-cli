/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

var mockCreateBrowserHandoff: ReturnType<typeof vi.fn>;
var mockAttachBrowserHandoff: ReturnType<typeof vi.fn>;
var mockAttachLatestBrowserHandoff: ReturnType<typeof vi.fn>;

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
  attachSession: vi.fn().mockResolvedValue({
    sessionId: 'attached-session',
    model: 'claude-3.7-sonnet',
    workspaceRoot: '/attached/workspace',
    messageCount: 12,
  }),
  getMcpManager: vi.fn().mockReturnValue(mockMcpManager),
  getToolsRegistry: vi.fn(),
  getPermissionManager: vi.fn().mockReturnValue(mockPermissionManager),
  getFileManager: vi.fn(),
  getHookManager: vi.fn(),
  getMemoryManager: vi.fn(),
  getSkillsRegistry: vi.fn(),
  getAutomodeManager: vi.fn(),
  getAndResetFileModCount: vi.fn(),
  getAndResetExecutedActions: vi.fn(),
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
  runCommandMode: vi.fn().mockResolvedValue(true),
  cancelCurrentInstruction: vi.fn(),
  shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
};

const mockConversation = {
  history: vi.fn().mockReturnValue([]),
  reset: vi.fn(),
};

// Mock protocol.js to suppress stdout writes
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => new Date().toISOString(),
  generateId: (prefix: string) => `${prefix}_test123`,
}));

vi.mock('../../../src/browser/chrome.js', () => ({
  createBrowserHandoff: (mockCreateBrowserHandoff = vi.fn()),
  attachBrowserHandoff: (mockAttachBrowserHandoff = vi.fn()),
  attachLatestBrowserHandoff: (mockAttachLatestBrowserHandoff = vi.fn()),
}));

// Import after mocks
import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { writeNotification } from '../../../src/modes/rpc/protocol.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RPC Adapter - P2 Handlers', () => {
  let adapter: RPCAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish mocks after clearAllMocks
    mockAgent.getSessionManager.mockReturnValue(mockSessionManager);
    mockAgent.getMcpManager.mockReturnValue(mockMcpManager);
    mockAgent.getToolsRegistry.mockReturnValue(undefined);
    mockAgent.getPermissionManager.mockReturnValue(mockPermissionManager);
    mockAgent.getAutomodeManager.mockReturnValue(undefined);
    mockAgent.getAndResetFileModCount.mockReturnValue({ count: 0, paths: [] });
    mockAgent.getAndResetExecutedActions.mockReturnValue([]);
    mockAgent.runCommandMode.mockResolvedValue(true);
    mockAgent.shutdownRuntimeResources.mockResolvedValue(undefined);
    mockAgent.getImageManager.mockReturnValue({ clear: vi.fn() });
    mockAgent.getStatusSnapshot.mockReturnValue({ tokensUsed: 0, contextPercent: 0, model: 'test' });
    mockPermissionManager.getMode.mockReturnValue('interactive');
    mockConversation.history.mockReturnValue([]);

    adapter = new RPCAdapter();
    adapter.initialize(
      mockAgent as any,
      mockConversation as any,
      'test-model',
      '/test/workspace'
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('tool lifecycle notifications', () => {
    it('preserves explicit runtime failure output and error on toolEnd', () => {
      const outputListener = mockAgent.setOutputListener.mock.calls[0]?.[0];

      outputListener({
        type: 'tool_end',
        toolId: 'tool_failed',
        toolName: 'run_command',
        toolSuccess: false,
        toolOutput: 'partial stdout',
        toolError: 'Command exited with code 9.',
      });

      expect(writeNotification).toHaveBeenCalledWith('autohand.toolEnd', expect.objectContaining({
        toolId: 'tool_failed',
        toolName: 'run_command',
        success: false,
        output: 'partial stdout',
        error: 'Command exited with code 9.',
      }));
    });

    it('does not infer success when a runtime tool_end omits status', () => {
      const outputListener = mockAgent.setOutputListener.mock.calls[0]?.[0];

      outputListener({
        type: 'tool_end',
        toolId: 'tool_missing_status',
        toolName: 'read_file',
      });

      expect(writeNotification).toHaveBeenCalledWith('autohand.toolEnd', expect.objectContaining({
        toolId: 'tool_missing_status',
        success: false,
      }));
    });
  });

  // -------------------------------------------------------------------------
  // prompt handling
  // -------------------------------------------------------------------------

  describe('prompt handling', () => {
    it('accepts a prompt without waiting for the agent turn to finish', async () => {
      let resolveRun!: (success: boolean) => void;
      const runPromise = new Promise<boolean>((resolve) => {
        resolveRun = resolve;
      });
      mockAgent.runInstruction.mockReturnValueOnce(runPromise);

      const result = adapter.startPrompt('req_1', { message: 'hello' });

      expect(result).toEqual({ success: true });
      expect(adapter.getState().status).toBe('processing');
      expect(mockAgent.runInstruction).not.toHaveBeenCalled();

      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mockAgent.runInstruction).toHaveBeenCalledWith('hello', {
        signal: expect.any(AbortSignal),
      });

      resolveRun(true);
      await runPromise;
      await Promise.resolve();
      await Promise.resolve();

      expect(adapter.getState().status).toBe('idle');
    });

    it('keeps an aborted prompt busy until quiescence and finalizes it exactly once', async () => {
      let resolveRun!: (success: boolean) => void;
      mockAgent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveRun = resolve;
      }));

      adapter.startPrompt('req_abort', { message: 'keep working' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(mockAgent.runInstruction).toHaveBeenCalledOnce();

      const permission = adapter.requestPermission(
        'run_command',
        'Run a command?',
        { command: 'sleep 30' },
      );
      const directoryAccess = adapter.requestDirectoryAccess('/outside', 'Read a file');
      expect(adapter.getState().status).toBe('waiting_permission');

      expect(adapter.handleAbort(null)).toEqual({ success: true });
      expect(adapter.handleAbort(null)).toEqual({ success: true });
      await expect(permission).resolves.toEqual({ decision: 'deny_once' });
      await expect(directoryAccess).resolves.toBeUndefined();
      expect(mockAgent.cancelCurrentInstruction).toHaveBeenCalledTimes(1);
      expect(adapter.getState().status).toBe('processing');
      expect(() => adapter.startPrompt('req_busy', { message: 'too soon' })).toThrow(
        'Agent is already processing',
      );

      const outputListener = mockAgent.setOutputListener.mock.calls[0]?.[0];
      const terminalCountBeforeLateOutput = vi.mocked(writeNotification).mock.calls.filter(
        ([method]) => method === 'autohand.messageEnd' || method === 'autohand.turnEnd',
      ).length;
      outputListener({ type: 'thinking', thought: 'late thought' });
      outputListener({ type: 'message', content: 'late answer' });
      expect(vi.mocked(writeNotification).mock.calls).not.toContainEqual([
        'autohand.messageUpdate',
        expect.objectContaining({ thought: 'late thought' }),
      ]);
      expect(vi.mocked(writeNotification).mock.calls).not.toContainEqual([
        'autohand.messageUpdate',
        expect.objectContaining({ delta: 'late answer' }),
      ]);
      expect(vi.mocked(writeNotification).mock.calls.filter(
        ([method]) => method === 'autohand.messageEnd' || method === 'autohand.turnEnd',
      )).toHaveLength(terminalCountBeforeLateOutput);

      resolveRun(true);
      await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));

      const terminalMethods = vi.mocked(writeNotification).mock.calls
        .map(([method]) => method)
        .filter((method) => method === 'autohand.messageEnd' || method === 'autohand.turnEnd');
      expect(terminalMethods).toEqual(['autohand.messageEnd', 'autohand.turnEnd']);
      expect(vi.mocked(writeNotification)).toHaveBeenCalledWith(
        'autohand.messageEnd',
        expect.objectContaining({ aborted: true }),
      );
    });

    it('rejects a second prompt while the active prompt is waiting for permission', async () => {
      let resolveRun!: (success: boolean) => void;
      mockAgent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveRun = resolve;
      }));
      adapter.startPrompt('req_first', { message: 'first' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const permission = adapter.requestPermission('write_file', 'Write?', { path: 'README.md' });

      expect(adapter.getState().status).toBe('waiting_permission');
      expect(() => adapter.startPrompt('req_second', { message: 'second' })).toThrow(
        'Agent is already processing',
      );

      adapter.handlePermissionResponse('req_permission', 'perm_test123', false);
      await permission;
      resolveRun(true);
      await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
    });

    it('does not let a stale prompt finalizer clear a newer active prompt', async () => {
      let resolveRun!: (success: boolean) => void;
      mockAgent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveRun = resolve;
      }));
      adapter.startPrompt('req_active', { message: 'active' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      const internals = adapter as unknown as {
        finalizePrompt(prompt: {
          identity: symbol;
          abortController: AbortController;
          turnId: null;
          turnStartTime: null;
          messageId: null;
          messageContent: string;
          cancelRequested: boolean;
          finalized: boolean;
        }): void;
      };
      internals.finalizePrompt({
        identity: Symbol('stale-prompt'),
        abortController: new AbortController(),
        turnId: null,
        turnStartTime: null,
        messageId: null,
        messageContent: '',
        cancelRequested: false,
        finalized: false,
      });

      expect(adapter.getState().status).toBe('processing');
      expect(() => adapter.startPrompt('req_second', { message: 'second' })).toThrow(
        'Agent is already processing',
      );

      resolveRun(true);
      await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
    });
  });

  // -------------------------------------------------------------------------
  // permission handling
  // -------------------------------------------------------------------------

  describe('permission handling', () => {
    it('resolves structured permission decisions from the client', async () => {
      const promise = adapter.requestPermission(
        'run_command',
        'Run this command?',
        { command: 'git status' }
      );

      const result = adapter.handlePermissionResponse('req_1', 'perm_test123', {
        decision: 'allow_session',
      });

      await expect(promise).resolves.toEqual({ decision: 'allow_session' });
      expect(result).toEqual({ success: true });
    });

    it('falls back to boolean permission responses for older clients', async () => {
      const promise = adapter.requestPermission(
        'run_command',
        'Run this command?',
        { command: 'git status' }
      );

      const result = adapter.handlePermissionResponse('req_1', 'perm_test123', false);

      await expect(promise).resolves.toEqual({ decision: 'deny_once' });
      expect(result).toEqual({ success: true });
    });
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

  describe('handleGetState()', () => {
    it('returns the authenticated user without exposing auth credentials', () => {
      const authenticatedAdapter = new RPCAdapter();
      authenticatedAdapter.initialize(
        mockAgent as any,
        mockConversation as any,
        'test-model',
        '/test/workspace',
        {
          configPath: '/test/config.json',
          auth: {
            token: 'must-not-leave-the-cli',
            user: {
              id: 'user-1',
              email: 'igor@example.com',
              name: 'Igor Costa',
              avatar: 'https://example.com/avatar.png',
            },
          },
        },
      );

      const result = authenticatedAdapter.handleGetState('req_1');

      expect(result.authenticatedUser).toEqual({
        id: 'user-1',
        email: 'igor@example.com',
        name: 'Igor Costa',
        avatar: 'https://example.com/avatar.png',
      });
      expect(JSON.stringify(result)).not.toContain('must-not-leave-the-cli');
    });
  });

  describe('handleAutomodeStart()', () => {
    it('starts the manager and runs iterations through the RPC agent', async () => {
      const manager = Object.assign(new EventEmitter(), {
        isActive: vi.fn().mockReturnValue(false),
        isPausedState: vi.fn().mockReturnValue(false),
        getState: vi.fn().mockReturnValue({
          sessionId: 'automode-test',
          status: 'running',
          currentIteration: 0,
          maxIterations: 3,
          filesCreated: 0,
          filesModified: 0,
        }),
        start: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
      });
      let runIteration:
        | ((iteration: number, prompt: string, signal: AbortSignal) => Promise<unknown>)
        | undefined;
      let finishRun!: () => void;
      const runFinished = new Promise<void>((resolve) => {
        finishRun = resolve;
      });
      manager.start.mockImplementation(async (options, callback) => {
        runIteration = callback;
        manager.emit('automode:start', {
          automodeSessionId: 'automode-test',
          automodePrompt: options.prompt,
          automodeMaxIterations: options.maxIterations ?? 50,
        });
        await runFinished;
      });
      mockAgent.getAutomodeManager.mockReturnValue(manager as never);
      mockAgent.getAndResetFileModCount
        .mockReturnValueOnce({ count: 0, paths: [] })
        .mockReturnValueOnce({ count: 1, paths: ['src/example.ts'] });
      mockAgent.getAndResetExecutedActions
        .mockReturnValueOnce([])
        .mockReturnValueOnce(['browser_navigate']);
      mockAgent.runCommandMode.mockResolvedValue(true);

      const result = await adapter.handleAutomodeStart('req_1', {
        prompt: 'Finish the browser task',
        maxIterations: 3,
        useWorktree: false,
      });

      expect(result).toEqual({ success: true, sessionId: 'automode-test' });
      expect(manager.start).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Finish the browser task',
          maxIterations: 3,
          useWorktree: false,
        }),
        expect.any(Function),
      );
      expect(runIteration).toBeTypeOf('function');

      const outputListener = mockAgent.setOutputListener.mock.calls[0]?.[0];
      outputListener({ type: 'message', content: 'Automode streamed output' });
      expect(writeNotification).toHaveBeenCalledWith(
        'autohand.messageUpdate',
        expect.objectContaining({ delta: 'Automode streamed output' }),
      );

      const signal = new AbortController().signal;
      const iterationResult = await runIteration?.(
        1,
        'Finish the browser task',
        signal,
      );
      expect(mockAgent.runCommandMode).toHaveBeenCalledWith(
        expect.stringContaining('Auto-Mode Task (Iteration 1)'),
        { signal, keepAlive: true },
      );
      expect(iterationResult).toEqual(
        expect.objectContaining({
          success: true,
          actions: ['browser_navigate'],
          filesModified: 1,
          modifiedFiles: ['src/example.ts'],
        }),
      );
      finishRun();
      await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
    });

    it('creates and completes a real manager when the agent has no prebuilt manager', async () => {
      const workspace = await mkdtemp(path.join(tmpdir(), 'autohand-rpc-automode-'));
      const productionAdapter = new RPCAdapter();
      mockAgent.getAutomodeManager.mockReturnValue(undefined);
      mockAgent.getSessionManager.mockReturnValue({
        ...mockSessionManager,
        getCurrentSession: vi.fn().mockReturnValue(undefined),
      });
      mockAgent.runCommandMode.mockImplementation(async () => {
        mockConversation.history.mockReturnValue([
          { role: 'assistant', content: '<promise>DONE</promise>' },
        ]);
        return true;
      });
      productionAdapter.initialize(
        mockAgent as any,
        mockConversation as any,
        'test-model',
        workspace,
        { configPath: path.join(workspace, 'config.json') },
      );

      try {
        const result = await productionAdapter.handleAutomodeStart('req_1', {
          prompt: 'Complete without provider work',
          maxIterations: 1,
          useWorktree: false,
        });

        expect(result.success).toBe(true);
        expect(result.sessionId).toMatch(/^automode-/);
        await vi.waitFor(() => {
          expect(productionAdapter.handleAutomodeStatus('status_1').active).toBe(
            false,
          );
        });
        expect(mockAgent.runCommandMode).toHaveBeenCalledWith(
          expect.stringContaining('Auto-Mode Task (Iteration 1)'),
          expect.objectContaining({ keepAlive: true }),
        );
      } finally {
        await productionAdapter.shutdown('completed');
        await rm(workspace, { recursive: true, force: true });
      }
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

    it('turns YOLO off and cancels a pending expiry timer', () => {
      vi.useFakeTimers();

      adapter.handleYoloSet('req_1', {
        pattern: '*',
        timeoutSeconds: 5,
      });
      const result = adapter.handleYoloSet('req_2', { pattern: '' });

      expect(result).toEqual({ success: true });
      expect(mockPermissionManager.setMode).toHaveBeenNthCalledWith(1, 'unrestricted');
      expect(mockPermissionManager.setMode).toHaveBeenNthCalledWith(2, 'interactive');

      vi.advanceTimersByTime(5000);
      expect(mockPermissionManager.setMode).toHaveBeenCalledTimes(2);
    });

    it('does not let an older YOLO timeout revert a newer YOLO grant', () => {
      vi.useFakeTimers();

      adapter.handleYoloSet('req_1', {
        pattern: 'run_command',
        timeoutSeconds: 5,
      });
      vi.advanceTimersByTime(4000);

      adapter.handleYoloSet('req_2', {
        pattern: 'write_file',
        timeoutSeconds: 5,
      });
      vi.advanceTimersByTime(1000);

      expect(mockPermissionManager.setMode).toHaveBeenCalledTimes(2);
      expect(mockPermissionManager.setMode).toHaveBeenNthCalledWith(1, 'unrestricted');
      expect(mockPermissionManager.setMode).toHaveBeenNthCalledWith(2, 'unrestricted');

      vi.advanceTimersByTime(4000);

      expect(mockPermissionManager.setMode).toHaveBeenCalledTimes(3);
      expect(mockPermissionManager.setMode).toHaveBeenNthCalledWith(3, 'interactive');
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

  describe('handleGetToolsRegistry()', () => {
    it('returns persisted meta-tools and diagnostics for non-interactive clients', () => {
      mockAgent.getToolsRegistry.mockReturnValue({
        getRegistryEntries: vi.fn().mockReturnValue([
          {
            name: 'count_lines',
            description: 'Count lines',
            source: 'meta',
            scope: 'project',
            disabled: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            schemaVersion: 1,
            handlerPreview: 'wc -l {{path}}',
            reuseHint: 'Use count_lines instead of creating another tool for: Count lines',
          }
        ]),
        getDiagnostics: vi.fn().mockReturnValue([
          { file: '/workspace/.autohand/tools/bad.json', reason: 'invalid meta-tool definition' }
        ])
      });

      const result = adapter.handleGetToolsRegistry();

      expect(result.tools).toEqual([
        expect.objectContaining({
          name: 'count_lines',
          source: 'meta',
          scope: 'project',
          handlerPreview: 'wc -l {{path}}'
        })
      ]);
      expect(result.diagnostics).toEqual([
        { file: '/workspace/.autohand/tools/bad.json', reason: 'invalid meta-tool definition' }
      ]);
    });

    it('preserves additive extension provenance in the existing registry response', () => {
      mockAgent.getToolsRegistry.mockReturnValue({
        getRegistryEntries: vi.fn().mockReturnValue([
          {
            name: 'find_todos',
            description: 'Find TODO and FIXME markers',
            source: 'extension',
            scope: 'project',
            extensionId: 'autohand.code-health',
            extensionVersion: '1.0.0',
          },
        ]),
        getDiagnostics: vi.fn().mockReturnValue([]),
      });

      const result = adapter.handleGetToolsRegistry();

      expect(result.tools).toEqual([
        expect.objectContaining({
          name: 'find_todos',
          source: 'extension',
          scope: 'project',
          extensionId: 'autohand.code-health',
          extensionVersion: '1.0.0',
        }),
      ]);
    });
  });
});


describe('RPC Adapter - Browser handoff', () => {
  let adapter: RPCAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgent.getSessionManager.mockReturnValue({
      ...mockSessionManager,
      getCurrentSession: vi.fn().mockReturnValue({
        metadata: {
          sessionId: 'session-current',
          projectPath: '/workspace',
        },
      }),
    });
    adapter = new RPCAdapter();
    adapter.initialize(
      mockAgent as any,
      mockConversation as any,
      'test-model',
      '/test/workspace'
    );
  });

  it('creates a browser handoff from the active session', async () => {
    mockCreateBrowserHandoff.mockResolvedValue({
      token: 'token-1',
      sessionId: 'session-current',
      workspaceRoot: '/workspace',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
      url: 'chrome-extension://ext/sidepanel.html?handoff=token-1',
    });

    const result = await adapter.handleBrowserHandoffCreate('req_1', { extensionId: 'ext' });

    expect(mockCreateBrowserHandoff).toHaveBeenCalledWith({
      sessionId: 'session-current',
      workspaceRoot: '/workspace',
      extensionId: 'ext',
      installUrl: undefined,
    });
    expect(result.token).toBe('token-1');
  });

  it('attaches a browser handoff into the current agent session', async () => {
    mockAttachBrowserHandoff.mockResolvedValue({
      token: 'token-1',
      sessionId: 'session-current',
      workspaceRoot: '/workspace',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
    });

    const result = await adapter.handleBrowserHandoffAttach('req_1', { token: 'token-1' });

    expect(mockAttachBrowserHandoff).toHaveBeenCalledWith('token-1');
    expect(mockAgent.attachSession).toHaveBeenCalledWith('session-current');
    expect(result).toEqual({
      success: true,
      sessionId: 'attached-session',
      workspaceRoot: '/attached/workspace',
      messageCount: 12,
    });
  });

  it('attaches the latest available browser handoff when no token is provided', async () => {
    mockAttachLatestBrowserHandoff.mockResolvedValue({
      token: 'token-latest',
      sessionId: 'session-current',
      workspaceRoot: '/workspace',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:10:00.000Z',
    });

    const result = await adapter.handleBrowserHandoffAttachLatest('req_1');

    expect(mockAttachLatestBrowserHandoff).toHaveBeenCalledWith();
    expect(mockAgent.attachSession).toHaveBeenCalledWith('session-current');
    expect(result).toEqual({
      success: true,
      sessionId: 'attached-session',
      workspaceRoot: '/attached/workspace',
      messageCount: 12,
    });
  });

  it('attaches a selected session from extension history', async () => {
    const result = await adapter.handleSessionAttach('req_1', {
      sessionId: 'session-history',
    });

    expect(mockAgent.attachSession).toHaveBeenCalledWith('session-history');
    expect(result).toEqual({
      success: true,
      sessionId: 'attached-session',
      workspaceRoot: '/attached/workspace',
      messageCount: 12,
    });
  });
});
