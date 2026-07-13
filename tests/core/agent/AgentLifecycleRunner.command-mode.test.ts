/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  initializeAgentForRPC,
  requestAgentExit,
  runAgentCommandMode,
} from '../../../src/core/agent/AgentLifecycleRunner.js';
import { AutohandAgent } from '../../../src/core/agent.js';
import { McpClientManager } from '../../../src/mcp/McpClientManager.js';

function createHost(instructionSucceeded: boolean) {
  return {
    runtime: {
      isCommandMode: false,
      config: {
        ui: {
          terminalBell: true,
          showCompletionNotification: true,
        },
      },
      options: { autoCommit: true },
    },
    useInkRenderer: true,
    initializeForRPC: vi.fn().mockResolvedValue(undefined),
    runInstruction: vi.fn().mockResolvedValue(instructionSucceeded),
    sessionManager: {
      getCurrentSession: vi.fn().mockReturnValue({ metadata: { sessionId: 'session-1' } }),
    },
    getStatusSnapshot: vi.fn().mockReturnValue({
      tokensUsed: 42,
      tokensUsageStatus: 'actual',
    }),
    hookManager: {
      executeHooks: vi.fn().mockResolvedValue([]),
    },
    ensureStdinReady: vi.fn(),
    notificationService: {
      notify: vi.fn().mockResolvedValue(undefined),
    },
    getCompletionNotificationBody: vi.fn().mockReturnValue('Task completed'),
    getNotificationGuards: vi.fn().mockReturnValue({}),
    performAutoCommit: vi.fn().mockResolvedValue(undefined),
    telemetryManager: {
      endSession: vi.fn().mockResolvedValue(undefined),
    },
    sessionStartedAt: Date.now() - 100,
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function lifecycleHookOptions() {
  return expect.objectContaining({
    signal: expect.any(AbortSignal),
    killGracePeriodMs: 100,
  });
}

describe('runAgentCommandMode', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns false and suppresses success-only effects after a failed turn', async () => {
    const host = createHost(false);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const succeeded = await runAgentCommandMode(host, 'failing instruction');

    expect(succeeded).toBe(false);
    expect(host.runInstruction).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith('stop', expect.objectContaining({
      sessionId: 'session-1',
      tokensUsed: 42,
    }), lifecycleHookOptions());
    expect(host.notificationService.notify).not.toHaveBeenCalled();
    expect(host.performAutoCommit).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalledWith('\x07');
    expect(host.hookManager.executeHooks).not.toHaveBeenCalledWith(
      'session-end',
      expect.anything(),
    );
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.runtime.isCommandMode).toBe(false);
    expect(host.useInkRenderer).toBe(true);
  });

  it('does not reactivate terminal input while finalizing command mode', async () => {
    const host = createHost(false);

    await expect(runAgentCommandMode(host, 'failing instruction')).resolves.toBe(false);

    expect(host.ensureStdinReady).not.toHaveBeenCalled();
  });

  it('returns true and preserves successful command-mode completion effects', async () => {
    const host = createHost(true);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const succeeded = await runAgentCommandMode(host, 'successful instruction');

    expect(succeeded).toBe(true);
    expect(stdoutWrite).toHaveBeenCalledWith('\x07');
    expect(host.notificationService.notify).toHaveBeenCalledWith(
      { body: 'Task completed', reason: 'task_complete' },
      {},
    );
    expect(host.performAutoCommit).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).not.toHaveBeenCalledWith(
      'session-end',
      expect.anything(),
    );
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'exit',
      telemetryReason: 'completed',
      showSessionSummary: false,
    });
    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.runtime.isCommandMode).toBe(false);
    expect(host.useInkRenderer).toBe(true);
  });

  it('restores renderer and command-mode state when execution throws', async () => {
    const host = createHost(true);
    host.runInstruction.mockRejectedValueOnce(new Error('provider failed'));

    await expect(runAgentCommandMode(host, 'throwing instruction')).rejects.toThrow('provider failed');

    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith(
      'stop',
      expect.objectContaining({ sessionId: 'session-1' }),
      lifecycleHookOptions(),
    );
    expect(host.hookManager.executeHooks).not.toHaveBeenCalledWith(
      'session-end',
      expect.anything(),
    );
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
    expect(host.runtime.isCommandMode).toBe(false);
    expect(host.useInkRenderer).toBe(true);
  });

  it('finalizes a successful turn as crashed when auto-commit throws', async () => {
    const host = createHost(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    host.performAutoCommit.mockRejectedValueOnce(new Error('commit failed'));

    await expect(runAgentCommandMode(host, 'throwing commit')).rejects.toThrow('commit failed');

    expect(host.hookManager.executeHooks).toHaveBeenCalledWith('stop', expect.any(Object));
    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
  });

  it('still shuts down when command session lookup throws', async () => {
    const host = createHost(true);
    host.sessionManager.getCurrentSession.mockImplementation(() => {
      throw new Error('session unavailable');
    });

    await expect(runAgentCommandMode(host, 'throwing session')).rejects.toThrow('session unavailable');

    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith('stop', expect.objectContaining({
      sessionId: undefined,
    }));
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
  });

  it('finalizes the failed command session before terminal resource shutdown after a signal', async () => {
    const order: string[] = [];
    const host = createHost(false);
    let settleInstruction: ((succeeded: boolean) => void) | undefined;
    host.runInstruction.mockImplementation(() => new Promise<boolean>((resolve) => {
      settleInstruction = resolve;
    }));
    const originalExecuteHooks = host.hookManager.executeHooks;
    originalExecuteHooks.mockImplementation(async (event) => {
      order.push(event);
      return [];
    });
    host.shutdown.mockImplementation(async () => {
      order.push('shutdown');
    });
    const signalHost = {
      shouldExit: false,
      runtimeResourceShutdownController: new AbortController(),
      clearAllQueuesAndAbort: vi.fn(() => {
        order.push('abort');
        settleInstruction?.(false);
      }),
    };

    const command = runAgentCommandMode(host, 'held instruction');
    await vi.waitFor(() => expect(host.runInstruction).toHaveBeenCalledOnce());
    requestAgentExit(signalHost);
    await expect(command).resolves.toBe(false);
    order.push('resource-shutdown');

    expect(signalHost.shouldExit).toBe(true);
    expect(signalHost.runtimeResourceShutdownController.signal.aborted).toBe(true);
    expect(order).toEqual([
      'abort',
      'stop',
      'shutdown',
      'resource-shutdown',
    ]);
  });

  it('races a non-cooperative command turn before finalizing its session', async () => {
    const host = createHost(true);
    const controller = new AbortController();
    host.runInstruction.mockImplementation(() => new Promise<boolean>(() => {}));

    const command = runAgentCommandMode(host, 'held instruction', controller.signal);
    await vi.waitFor(() => expect(host.runInstruction).toHaveBeenCalledOnce());
    controller.abort();

    await expect(command).resolves.toBe(false);
    expect(host.runInstruction).toHaveBeenCalledWith('held instruction', {
      signal: controller.signal,
    });
    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith(
      'stop',
      expect.objectContaining({ sessionId: 'session-1' }),
      lifecycleHookOptions(),
    );
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(host.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
  });

  it('uses the runtime shutdown signal through the public agent boundary', async () => {
    const controller = new AbortController();
    const agent = Object.assign(Object.create(AutohandAgent.prototype), createHost(true), {
      runtimeResourceShutdownController: controller,
      clearAllQueuesAndAbort: vi.fn(),
    }) as AutohandAgent & ReturnType<typeof createHost>;
    agent.runInstruction.mockImplementation(() => new Promise<boolean>(() => {}));

    const command = agent.runCommandMode('held public command');
    await vi.waitFor(() => expect(agent.runInstruction).toHaveBeenCalledOnce());
    agent.requestExit();

    await expect(command).resolves.toBe(false);
    expect(controller.signal.aborted).toBe(true);
    expect(agent.hookManager.executeHooks).toHaveBeenCalledWith(
      'stop',
      expect.objectContaining({ sessionId: 'session-1' }),
      lifecycleHookOptions(),
    );
    expect(agent.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(agent.shutdown).toHaveBeenCalledWith({
      sessionEndReason: 'error',
      telemetryReason: 'crashed',
      showSessionSummary: false,
    });
  });

  it('threads command cancellation through held auto-commit work before finalization', async () => {
    const order: string[] = [];
    const host = createHost(true);
    const controller = new AbortController();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    host.performAutoCommit.mockImplementation((signal?: AbortSignal) => {
      order.push('auto-commit-start');
      return new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => {
          order.push('auto-commit-abort');
          resolve();
        }, { once: true });
      });
    });
    host.hookManager.executeHooks.mockImplementation(async (event: string) => {
      order.push(event);
      return [];
    });
    host.shutdown.mockImplementation(async () => {
      order.push('shutdown');
    });

    const command = runAgentCommandMode(host, 'successful turn', controller.signal);
    await vi.waitFor(() => expect(host.performAutoCommit).toHaveBeenCalledOnce());
    controller.abort();

    await expect(command).resolves.toBe(false);
    expect(host.performAutoCommit).toHaveBeenCalledWith(controller.signal);
    expect(order).toEqual([
      'stop',
      'auto-commit-start',
      'auto-commit-abort',
      'shutdown',
    ]);
  });

  it('bounds ordered lifecycle attempts when a stop hook ignores cancellation', async () => {
    const order: string[] = [];
    const host = createHost(true);
    const controller = new AbortController();
    host.runInstruction.mockImplementation(() => new Promise<boolean>(() => {}));
    host.hookManager.executeHooks.mockImplementation((event: string) => {
      order.push(event);
      return event === 'stop' ? new Promise(() => {}) : Promise.resolve([]);
    });
    host.shutdown.mockImplementation(async () => {
      order.push('shutdown');
    });

    let settled = false;
    const command = runAgentCommandMode(host, 'held turn and hook', controller.signal)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => expect(host.runInstruction).toHaveBeenCalledOnce());
    vi.useFakeTimers();
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(['stop']);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(command).resolves.toBe(false);
    expect(order).toEqual(['stop', 'shutdown']);
    expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    expect(host.telemetryManager.endSession).not.toHaveBeenCalled();
  });

  it('does not resolve until orderly shutdown has closed command-mode resources', async () => {
    const host = createHost(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let resolveShutdown!: () => void;
    host.shutdown = vi.fn(() => new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    }));

    let settled = false;
    const runPromise = runAgentCommandMode(host, 'finish then close').then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(host.shutdown).toHaveBeenCalledTimes(1));

    expect(settled).toBe(false);
    resolveShutdown();
    await runPromise;
    expect(settled).toBe(true);
  });

  it('keeps managers alive between explicit multi-turn command iterations', async () => {
    const host = createHost(true);
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    await expect(runAgentCommandMode(host, 'iteration', { keepAlive: true })).resolves.toBe(true);

    expect(host.shutdown).not.toHaveBeenCalled();
    expect(host.runtime.isCommandMode).toBe(false);
    expect(host.useInkRenderer).toBe(true);
  });
});

describe('initializeAgentForRPC', () => {
  it('short-circuits initialization when its lifecycle signal is aborted', async () => {
    const controller = new AbortController();
    const host = {
      initializeManagers: vi.fn(() => new Promise<void>(() => {})),
      runtime: { config: {}, options: {}, workspaceRoot: '/workspace' },
    };

    const initialization = initializeAgentForRPC(host, controller.signal);
    controller.abort();

    await expect(initialization).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not expose the first RPC turn before MCP tools are registered', async () => {
    let resolveMcp: (() => void) | undefined;
    const host = {
      runtime: {
        config: {
          provider: 'openrouter',
          openrouter: { model: 'openai/gpt-4o-mini' },
          mcp: { enabled: true, servers: [{ name: 'first-turn' }] },
        },
        options: {},
        workspaceRoot: '/workspace',
      },
      activeProvider: 'openrouter',
      initializeManagers: vi.fn().mockResolvedValue(undefined),
      mcpManager: {
        connectAll: vi.fn().mockReturnValue(new Promise<void>((resolve) => {
          resolveMcp = resolve;
        })),
      },
      syncMcpTools: vi.fn(),
      mcpStartupCoordinator: { markSummaryPending: vi.fn() },
      skillsRegistry: { setWorkspace: vi.fn().mockResolvedValue(undefined) },
      resetConversationContext: vi.fn().mockResolvedValue(undefined),
      sessionManager: {
        createSession: vi.fn().mockResolvedValue({ metadata: { sessionId: 'session-1' } }),
      },
      startActiveAgentHeartbeat: vi.fn().mockResolvedValue(undefined),
      injectSessionBootstrap: vi.fn().mockResolvedValue(undefined),
      telemetryManager: { startSession: vi.fn().mockResolvedValue(undefined) },
      hookManager: { executeHooks: vi.fn().mockResolvedValue(undefined) },
      sessionStartedAt: 0,
      mcpReady: null,
    };

    let completed = false;
    const initialization = initializeAgentForRPC(host).then(() => {
      completed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(completed).toBe(false);
    expect(host.syncMcpTools).not.toHaveBeenCalled();
    expect(host.hookManager.executeHooks).not.toHaveBeenCalled();

    resolveMcp?.();
    await initialization;

    expect(host.syncMcpTools).toHaveBeenCalledOnce();
    expect(host.hookManager.executeHooks).toHaveBeenCalledWith('session-start', {
      sessionId: 'session-1',
      sessionType: 'startup',
    });
  });

  it('registers tools from a real stdio MCP server before session startup', async () => {
    const mcpManager = new McpClientManager();
    const registeredToolNames: string[] = [];
    const host = {
      runtime: {
        config: {
          provider: 'openrouter',
          openrouter: { model: 'openai/gpt-4o-mini' },
          mcp: {
            enabled: true,
            servers: [{
              name: 'first-turn',
              transport: 'stdio',
              command: 'node',
              args: [path.resolve('tests/fixtures/mock-mcp-server-framed.mjs')],
              autoConnect: true,
            }],
          },
        },
        options: {},
        workspaceRoot: '/workspace',
      },
      activeProvider: 'openrouter',
      initializeManagers: vi.fn().mockResolvedValue(undefined),
      mcpManager,
      syncMcpTools: vi.fn(() => {
        registeredToolNames.push(...mcpManager.getAllTools().map((tool) => tool.name));
      }),
      mcpStartupCoordinator: { markSummaryPending: vi.fn() },
      skillsRegistry: { setWorkspace: vi.fn().mockResolvedValue(undefined) },
      resetConversationContext: vi.fn().mockResolvedValue(undefined),
      sessionManager: {
        createSession: vi.fn().mockResolvedValue({ metadata: { sessionId: 'session-1' } }),
      },
      startActiveAgentHeartbeat: vi.fn().mockResolvedValue(undefined),
      injectSessionBootstrap: vi.fn().mockResolvedValue(undefined),
      telemetryManager: { startSession: vi.fn().mockResolvedValue(undefined) },
      hookManager: {
        executeHooks: vi.fn(async () => {
          expect(registeredToolNames).toContain('mcp__first-turn__echo_test');
        }),
      },
      sessionStartedAt: 0,
      mcpReady: null,
    };

    try {
      await initializeAgentForRPC(host);

      expect(host.syncMcpTools).toHaveBeenCalledOnce();
      expect(host.hookManager.executeHooks).toHaveBeenCalledOnce();
    } finally {
      await mcpManager.disconnectAll();
    }
  });
});
