/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for MCP Client Manager - static helpers, server state, and connection flow
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { McpClientManager, McpStdioConnection } from '../src/mcp/McpClientManager.js';
import type { McpServerConfig } from '../src/mcp/types.js';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

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

const earlyExitConfig: McpServerConfig = {
  name: 'early-exit-server',
  transport: 'stdio',
  command: 'node',
  args: ['-e', 'process.exit(42)'],
  autoConnect: true,
};

async function waitForEvents(
  eventLog: string,
  predicate: (events: Array<Record<string, unknown>>) => boolean,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const contents = await readFile(eventLog, 'utf8').catch(() => '');
    const events = contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    if (predicate(events)) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for MCP fixture events');
}

function getPendingRequestCount(manager: McpClientManager, serverName: string): number {
  const internals = manager as unknown as {
    connections: Map<string, { pendingRequests?: Map<number, unknown> }>;
  };
  return internals.connections.get(serverName)?.pendingRequests?.size ?? 0;
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} remained alive after MCP disconnect`);
}

async function forceCleanupProcesses(pids: number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  await Promise.all(pids.map((pid) => waitForProcessExit(pid).catch(() => {})));
}

function createHttpFetchMock(): {
  fetchMock: ReturnType<typeof vi.fn>;
  getToolSignal: () => AbortSignal | undefined;
  getToolCallCount: () => number;
} {
  let toolSignal: AbortSignal | undefined;
  let toolCallCount = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = JSON.parse(String(init?.body ?? '{}')) as {
      id?: number;
      method?: string;
    };

    if (request.method === 'tools/call') {
      toolCallCount += 1;
      toolSignal = init?.signal ?? undefined;
      return await new Promise<Response>(() => {});
    }

    const result = request.method === 'initialize'
      ? {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'http-test', version: '1.0.0' },
        }
      : request.method === 'tools/list'
        ? {
            tools: [{
              name: 'slow_http',
              description: 'Never resolves',
              inputSchema: { type: 'object', properties: {} },
            }],
          }
        : {};
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    fetchMock,
    getToolSignal: () => toolSignal,
    getToolCallCount: () => toolCallCount,
  };
}

describe('McpClientManager', () => {
  let manager: McpClientManager;

  beforeEach(() => {
    manager = new McpClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll().catch(() => {});
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

    it('includes exit code when a stdio server exits during startup', async () => {
      await expect(manager.connect(earlyExitConfig)).rejects.toThrow('code 42');
    });

    it('reconnects if server already exists', async () => {
      await manager.connect(stdioConfig);
      expect(manager.listServers()[0].status).toBe('connected');

      // Connect again - should disconnect old and reconnect
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

    it('closes an in-flight real stdio connection before late registration', async () => {
      const tempDirectory = await mkdtemp(path.join(tmpdir(), 'autohand-mcp-connect-race-'));
      const eventLog = path.join(tempDirectory, 'events.jsonl');
      const config: McpServerConfig = {
        ...stdioConfig,
        env: {
          MCP_TEST_EVENT_LOG: eventLog,
          MCP_TEST_INITIALIZE_DELAY_MS: '250',
        },
      };

      try {
        const connecting = manager.connect(config);
        const initialEvents = await waitForEvents(eventLog, (events) =>
          events.some((event) => event.event === 'initialize_received')
        );
        const pid = Number(initialEvents.find((event) => event.event === 'started')?.pid);
        expect(pid).toBeGreaterThan(0);

        await manager.disconnectAll();
        const [connectionResult] = await Promise.allSettled([connecting]);

        expect(connectionResult.status).toBe('rejected');
        expect(manager.listServers()).toEqual([]);
        expect((manager as unknown as { connections: Map<string, unknown> }).connections.size).toBe(0);
        await waitForProcessExit(pid);
      } finally {
        await manager.disconnectAll().catch(() => {});
        await rm(tempDirectory, { recursive: true, force: true });
      }
    });

    it('aborts an in-flight HTTP handshake before late registration', async () => {
      let initializeSignal: AbortSignal | undefined;
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
          initializeSignal = init?.signal ?? undefined;
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (initializeSignal?.aborted) {
              abort();
              return;
            }
            initializeSignal?.addEventListener('abort', abort, { once: true });
          });
        },
      );
      vi.stubGlobal('fetch', fetchMock);
      const config: McpServerConfig = {
        name: 'http-handshake-race',
        transport: 'http',
        url: 'https://mcp.test/rpc',
      };

      const connecting = manager.connect(config);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      await manager.disconnectAll();

      await expect(connecting).rejects.toMatchObject({ name: 'AbortError' });
      expect(initializeSignal?.aborted).toBe(true);
      expect(manager.listServers()).toEqual([]);
      expect((manager as unknown as { connections: Map<string, unknown> }).connections.size).toBe(0);
    });

    it('rejects a same-tick connection until real-child shutdown settles', async () => {
      await manager.connect(stdioConfig);
      const internals = manager as unknown as {
        connections: Map<string, { process?: { pid?: number } }>;
      };
      const pid = Number(internals.connections.get(stdioConfig.name)?.process?.pid);
      expect(pid).toBeGreaterThan(0);

      const closing = manager.disconnectAll();
      const connecting = manager.connect({
        ...stdioConfig,
        name: 'late-during-shutdown',
      });
      const [, connectionResult] = await Promise.all([
        closing,
        Promise.allSettled([connecting]),
      ]);

      expect(connectionResult[0]).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      });
      expect(manager.listServers()).toEqual([]);
      expect(internals.connections.size).toBe(0);
      await waitForProcessExit(pid);

      await manager.connect({ ...stdioConfig, name: 'after-shutdown' });
      expect(manager.listServers()).toEqual([
        expect.objectContaining({ name: 'after-shutdown', status: 'connected' }),
      ]);
    });

    it('invalidates a same-name replacement that began before shutdown', async () => {
      await manager.connect(stdioConfig);
      const internals = manager as unknown as {
        connections: Map<string, { process?: { pid?: number } }>;
      };
      const originalPid = Number(internals.connections.get(stdioConfig.name)?.process?.pid);
      expect(originalPid).toBeGreaterThan(0);

      const replacing = manager.connect(stdioConfig);
      const closing = manager.disconnectAll();
      const [replacementResult] = await Promise.all([
        Promise.allSettled([replacing]),
        closing,
      ]);

      expect(replacementResult[0]).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ name: 'AbortError' }),
      });
      expect(manager.listServers()).toEqual([]);
      expect(internals.connections.size).toBe(0);
      await waitForProcessExit(originalPid);
    });

    it('shares one owned child across concurrent same-name connect calls', async () => {
      const tempDirectory = await mkdtemp(path.join(tmpdir(), 'autohand-mcp-connect-dedupe-'));
      const eventLog = path.join(tempDirectory, 'events.jsonl');
      const config: McpServerConfig = {
        ...stdioConfig,
        env: { MCP_TEST_EVENT_LOG: eventLog },
      };
      let spawnedPids: number[] = [];

      try {
        await Promise.all([manager.connect(config), manager.connect(config)]);
        const events = await waitForEvents(eventLog, (current) =>
          current.some((event) => event.event === 'started')
        );
        spawnedPids = events
          .filter((event) => event.event === 'started')
          .map((event) => Number(event.pid));

        await manager.disconnectAll();
        await Promise.all(spawnedPids.map(waitForProcessExit));

        expect(spawnedPids).toHaveLength(1);
        expect(manager.listServers()).toEqual([]);
      } finally {
        await manager.disconnectAll().catch(() => {});
        await forceCleanupProcesses(spawnedPids);
        await rm(tempDirectory, { recursive: true, force: true });
      }
    });

    it('deduplicates duplicate server names in connectAll without orphaning a child', async () => {
      const tempDirectory = await mkdtemp(path.join(tmpdir(), 'autohand-mcp-connect-all-dedupe-'));
      const eventLog = path.join(tempDirectory, 'events.jsonl');
      const config: McpServerConfig = {
        ...stdioConfig,
        env: { MCP_TEST_EVENT_LOG: eventLog },
      };
      let spawnedPids: number[] = [];

      try {
        await manager.connectAll([config, config]);
        const events = await waitForEvents(eventLog, (current) =>
          current.some((event) => event.event === 'started')
        );
        spawnedPids = events
          .filter((event) => event.event === 'started')
          .map((event) => Number(event.pid));

        await manager.disconnectAll();
        await Promise.all(spawnedPids.map(waitForProcessExit));

        expect(spawnedPids).toHaveLength(1);
        expect(manager.listServers()).toEqual([]);
      } finally {
        await manager.disconnectAll().catch(() => {});
        await forceCleanupProcesses(spawnedPids);
        await rm(tempDirectory, { recursive: true, force: true });
      }
    });

    it('stops stdio child processes that are still initializing', async () => {
      const hangingConfig: McpServerConfig = {
        name: 'hanging-server',
        transport: 'stdio',
        command: 'node',
        args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
      };
      const connecting = manager.connectAll([hangingConfig]);
      await new Promise((resolve) => setTimeout(resolve, 150));

      await expect(manager.disconnectAll()).resolves.toBeUndefined();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await expect(Promise.race([
          connecting,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('connect still pending')), 1000);
          }),
        ])).resolves.toBeUndefined();
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      expect(manager.listServers()).toEqual([]);
    });
  });

  it('waits for stdio close after exit before stop settles', async () => {
    const connection = new McpStdioConnection(stdioConfig, 'content-length');
    const child = Object.assign(new EventEmitter(), {
      stdin: { end: vi.fn() },
      exitCode: null,
      signalCode: null,
      kill: vi.fn().mockReturnValue(true),
    });
    (connection as unknown as { process: typeof child }).process = child;

    let settled = false;
    const stopping = connection.stop().then(() => {
      settled = true;
    });
    child.exitCode = 0;
    child.emit('exit', 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    child.emit('close', 0);
    await stopping;
    expect(settled).toBe(true);
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

    it('rejects a cancelled stdio request, clears local state, and ignores a late response', async () => {
      const tempDirectory = await mkdtemp(path.join(tmpdir(), 'autohand-mcp-cancel-'));
      const eventLog = path.join(tempDirectory, 'events.jsonl');
      const config: McpServerConfig = {
        ...stdioConfig,
        env: { MCP_TEST_EVENT_LOG: eventLog },
      };
      const controller = new AbortController();

      try {
        await manager.connect(config);
        const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
        const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const result = manager.callTool('test-server', 'slow_test', { delayMs: 150 }, {
          signal: controller.signal,
        });
        const requestEvents = await waitForEvents(eventLog, (events) =>
          events.some((event) => event.event === 'request')
        );
        const requestId = requestEvents.find((event) => event.event === 'request')?.requestId;

        controller.abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });

        const cancellationEvents = await waitForEvents(eventLog, (events) =>
          events.some((event) => event.event === 'cancelled' && event.requestId === requestId)
        );
        expect(cancellationEvents).toContainEqual(expect.objectContaining({
          event: 'cancelled',
          requestId,
        }));
        expect(getPendingRequestCount(manager, 'test-server')).toBe(0);
        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
        expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));

        await waitForEvents(eventLog, (events) =>
          events.some((event) => event.event === 'late_response' && event.requestId === requestId)
        );
        expect(getPendingRequestCount(manager, 'test-server')).toBe(0);
        await expect(manager.callTool('test-server', 'echo_test', { message: 'still connected' }))
          .resolves.toBeTruthy();
      } finally {
        await manager.disconnectAll().catch(() => {});
        await rm(tempDirectory, { recursive: true, force: true });
      }
    });

    it('does not send an already-aborted stdio request', async () => {
      await manager.connect(stdioConfig);
      const controller = new AbortController();
      controller.abort();

      await expect(manager.callTool('test-server', 'slow_test', {}, {
        signal: controller.signal,
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(getPendingRequestCount(manager, 'test-server')).toBe(0);
    });

    it('bounds HTTP cancellation even when fetch does not cooperate', async () => {
      const http = createHttpFetchMock();
      vi.stubGlobal('fetch', http.fetchMock);
      await manager.connect({
        name: 'http-test',
        transport: 'http',
        url: 'https://mcp.test/rpc',
      });
      const controller = new AbortController();
      const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
      const result = manager.callTool('http-test', 'slow_http', {}, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(http.getToolCallCount()).toBe(1));

      controller.abort();
      await expect(Promise.race([
        result,
        new Promise((_resolve, reject) => setTimeout(
          () => reject(new Error('HTTP cancellation did not settle locally')),
          250,
        )),
      ])).rejects.toMatchObject({ name: 'AbortError' });
      expect(http.getToolSignal()?.aborted).toBe(true);
      expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
      expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });
});
