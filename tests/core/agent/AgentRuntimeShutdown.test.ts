/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import {
  installAgentExitSignalHandlers,
  removeAgentExitSignalHandlers,
} from '../../../src/core/agent/AgentLifecycleRunner.js';

type ShutdownCapableAgent = AutohandAgent & {
  shutdownRuntimeResources(): Promise<void>;
};

function createShutdownAgent(overrides: Record<string, unknown> = {}): ShutdownCapableAgent {
  const persistentInput = {
    dispose: vi.fn(),
    hasQueued: vi.fn().mockReturnValue(false),
    setPendingSuggestion: vi.fn(),
  };

  return Object.assign(Object.create(AutohandAgent.prototype), {
    activeAbortController: { abort: vi.fn() },
    currentInkAbortController: { abort: vi.fn() },
    pendingInkInstructions: ['queued'],
    inkRenderer: {
      clearQueue: vi.fn(),
      setPendingSuggestion: vi.fn(),
      stop: vi.fn(),
    },
    inkInstructionResolver: vi.fn(),
    persistentInput,
    persistentInputActiveTurn: true,
    persistentConsoleBridgeCleanup: vi.fn(),
    pendingSuggestion: Promise.resolve(),
    suggestionEngine: { cancel: vi.fn() },
    shellSuggestionProvider: { abort: vi.fn() },
    repeatManager: { shutdown: vi.fn() },
    teamManager: { shutdown: vi.fn().mockResolvedValue(undefined) },
    mcpManager: { disconnectAll: vi.fn().mockResolvedValue(undefined) },
    telemetryManager: {
      shutdown: vi.fn().mockResolvedValue(undefined),
      endSession: vi.fn().mockResolvedValue(undefined),
    },
    flushScheduledSessionSnapshot: vi.fn(function (this: { sessionSyncTimer?: ReturnType<typeof setTimeout> }) {
      if (this.sessionSyncTimer) clearTimeout(this.sessionSyncTimer);
      this.sessionSyncTimer = undefined;
      return Promise.resolve();
    }),
    sessionManager: { closeSession: vi.fn().mockResolvedValue(undefined) },
    hookManager: { executeHooks: vi.fn().mockResolvedValue(undefined) },
    activeAgentHeartbeat: { stop: vi.fn().mockResolvedValue(undefined) },
    sessionSyncTimer: setTimeout(() => {}, 60_000),
    statusInterval: setInterval(() => {}, 60_000),
    resizeHandler: vi.fn(),
    ui: { stop: vi.fn().mockResolvedValue(undefined) },
    runtime: { config: {}, options: {}, spinner: { stop: vi.fn() } },
    exitSignalHandlersInstalled: false,
    exitSignalHandler: null,
    shouldExit: false,
    runtimeResourceShutdownController: new AbortController(),
    runtimeResourceShutdownPromise: null,
    ...overrides,
  }) as ShutdownCapableAgent;
}

describe('AutohandAgent runtime resource shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shares one cleanup promise across concurrent callers and excludes session finalization', async () => {
    const agent = createShutdownAgent();
    const internals = agent as unknown as Record<string, any>;
    const pauseStdin = vi.spyOn(process.stdin, 'pause');

    const first = agent.shutdownRuntimeResources();
    const second = agent.shutdownRuntimeResources();

    expect(second).toBe(first);
    await Promise.all([first, second]);

    expect(internals.activeAbortController).toBeNull();
    expect(internals.currentInkAbortController).toBeNull();
    expect(internals.suggestionEngine.cancel).toHaveBeenCalledOnce();
    expect(internals.shellSuggestionProvider.abort).toHaveBeenCalledOnce();
    expect(internals.repeatManager.shutdown).toHaveBeenCalledOnce();
    expect(internals.teamManager.shutdown).toHaveBeenCalledOnce();
    expect(internals.mcpManager.disconnectAll).toHaveBeenCalledOnce();
    expect(internals.telemetryManager.shutdown).toHaveBeenCalledOnce();
    expect(internals.flushScheduledSessionSnapshot).toHaveBeenCalledOnce();
    expect(internals.activeAgentHeartbeat).toBeNull();
    expect(internals.persistentInput.dispose).toHaveBeenCalledOnce();
    expect(pauseStdin).toHaveBeenCalledOnce();
    expect(internals.persistentConsoleBridgeCleanup).toBeNull();
    expect(internals.sessionSyncTimer).toBeUndefined();

    expect(internals.hookManager.executeHooks).not.toHaveBeenCalled();
    expect(internals.telemetryManager.endSession).not.toHaveBeenCalled();
    expect(internals.sessionManager.closeSession).not.toHaveBeenCalled();
  });

  it('starts all cleanup concurrently and applies one absolute deadline', async () => {
    vi.useFakeTimers();
    const uiStop = vi.fn(() => new Promise<void>(() => {}));
    const teamShutdown = vi.fn(() => new Promise<void>(() => {}));
    const agent = createShutdownAgent({
      ui: { stop: uiStop },
      teamManager: { shutdown: teamShutdown },
    });

    let settled = false;
    const shutdown = agent.shutdownRuntimeResources().then(() => {
      settled = true;
    });

    expect(uiStop).toHaveBeenCalledOnce();
    expect(teamShutdown).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(settled).toBe(true);
  });

  it('continues cleanup and clears its deadline when an abort step throws', async () => {
    vi.useFakeTimers();
    const teamShutdown = vi.fn().mockResolvedValue(undefined);
    const disconnectAll = vi.fn().mockResolvedValue(undefined);
    const agent = createShutdownAgent({
      inkRenderer: {
        clearQueue: vi.fn(() => {
          throw new Error('renderer already closed');
        }),
        setPendingSuggestion: vi.fn(),
        stop: vi.fn(),
      },
      mcpManager: { disconnectAll },
      sessionSyncTimer: undefined,
      statusInterval: null,
      teamManager: { shutdown: teamShutdown },
    });
    const timerCountBeforeShutdown = vi.getTimerCount();

    await expect(agent.shutdownRuntimeResources()).resolves.toBeUndefined();

    expect(teamShutdown).toHaveBeenCalledOnce();
    expect(disconnectAll).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(timerCountBeforeShutdown);
  });

  it('starts telemetry shutdown even when the snapshot flush never settles', async () => {
    vi.useFakeTimers();
    const telemetryShutdown = vi.fn().mockResolvedValue(undefined);
    const agent = createShutdownAgent({
      flushScheduledSessionSnapshot: vi.fn(() => new Promise<void>(() => {})),
      sessionSyncTimer: undefined,
      statusInterval: null,
      telemetryManager: {
        shutdown: telemetryShutdown,
        endSession: vi.fn().mockResolvedValue(undefined),
      },
    });

    const shutdown = agent.shutdownRuntimeResources();
    expect(telemetryShutdown).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2_500);
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('awaits active turn-memory reflection and blocks reflection queued after shutdown starts', async () => {
    let releaseReflection: (() => void) | undefined;
    const reflection = new Promise<void>((resolve) => {
      releaseReflection = resolve;
    });
    const runQueuedTurnMemoryReflection = vi.fn().mockResolvedValue(undefined);
    const agent = createShutdownAgent({
      turnMemoryReflectionInFlight: reflection,
      turnMemoryReflectionQueued: false,
      runQueuedTurnMemoryReflection,
    });
    const internals = agent as unknown as Record<string, any>;
    let settled = false;

    const shutdown = agent.shutdownRuntimeResources().then(() => {
      settled = true;
    });
    internals.scheduleTurnMemoryReflection(true);
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(internals.turnMemoryReflectionQueued).toBe(false);
    expect(runQueuedTurnMemoryReflection).not.toHaveBeenCalled();

    releaseReflection?.();
    await shutdown;

    expect(settled).toBe(true);
  });

  it('aborts a held turn-memory reflection before its bounded flush and blocks late persistence', async () => {
    vi.useFakeTimers();
    let releaseResponse: ((response: {
      id: string;
      created: number;
      content: string;
      raw: Record<string, never>;
    }) => void) | undefined;
    const complete = vi.fn(() => new Promise<{
      id: string;
      created: number;
      content: string;
      raw: Record<string, never>;
    }>((resolve) => {
      releaseResponse = resolve;
    }));
    const store = vi.fn().mockResolvedValue({ id: 'late-memory' });
    const addSystemNote = vi.fn();
    const agent = createShutdownAgent({
      llm: { complete },
      memoryManager: { store },
      conversation: {
        history: vi.fn(() => [
          { role: 'user', content: 'remember this preference' },
          { role: 'assistant', content: 'understood' },
        ]),
        addSystemNote,
      },
      sessionSyncTimer: undefined,
      statusInterval: null,
    });
    const internals = agent as unknown as Record<string, any>;

    internals.scheduleTurnMemoryReflection(true);
    const reflection = internals.turnMemoryReflectionInFlight as Promise<void>;
    const request = complete.mock.calls[0]?.[0] as { signal?: AbortSignal };
    const shutdown = agent.shutdownRuntimeResources();

    expect(request.signal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1_500);
    await expect(shutdown).resolves.toBeUndefined();

    releaseResponse?.({
      id: 'late-response',
      created: Date.now(),
      content: JSON.stringify([
        { content: 'Late memory', level: 'project', tags: ['shutdown'] },
      ]),
      raw: {},
    });
    await reflection;

    expect(store).not.toHaveBeenCalled();
    expect(addSystemNote).not.toHaveBeenCalled();
  });

  it('unrefs and clears a successful turn-memory reflection deadline', async () => {
    const agent = createShutdownAgent({
      turnMemoryReflectionInFlight: Promise.resolve(),
    });
    const timeout = { unref: vi.fn() };
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
      .mockReturnValue(timeout as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {});
    const internals = agent as unknown as Record<string, any>;

    await internals.flushTurnMemoryReflection();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1_500);
    expect(timeout.unref).toHaveBeenCalledOnce();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeout);

    await agent.shutdownRuntimeResources();
  });

  it('prevents held background initialization from creating resources after shutdown', async () => {
    vi.useFakeTimers();
    let releaseManagers: (() => void) | undefined;
    const managersHeld = new Promise<void>((resolve) => {
      releaseManagers = resolve;
    });
    const connectAll = vi.fn().mockResolvedValue(undefined);
    const setWorkspace = vi.fn().mockResolvedValue(undefined);
    const startHeartbeat = vi.fn().mockResolvedValue(undefined);
    const startTelemetry = vi.fn().mockResolvedValue(undefined);
    const agent = createShutdownAgent({
      initReady: null,
      initDone: false,
      initializeManagers: vi.fn(() => managersHeld),
      mcpManager: {
        connectAll,
        disconnectAll: vi.fn().mockResolvedValue(undefined),
      },
      mcpStartupCoordinator: {
        markConnectStarted: vi.fn(),
        markSummaryPending: vi.fn(),
      },
      syncMcpTools: vi.fn(),
      skillsRegistry: {
        setWorkspace,
        activateSkill: vi.fn(),
      },
      feedbackManager: { startSession: vi.fn() },
      resetConversationContext: vi.fn().mockResolvedValue(undefined),
      sessionManager: {
        createSession: vi.fn().mockResolvedValue({ metadata: { sessionId: 'late-session' } }),
        closeSession: vi.fn().mockResolvedValue(undefined),
      },
      startActiveAgentHeartbeat: startHeartbeat,
      injectSessionBootstrap: vi.fn().mockResolvedValue(undefined),
      telemetryManager: {
        startSession: startTelemetry,
        shutdown: vi.fn().mockResolvedValue(undefined),
        endSession: vi.fn().mockResolvedValue(undefined),
      },
      runtime: {
        config: { mcp: { enabled: true, servers: [] } },
        options: {},
        workspaceRoot: '/workspace',
      },
      sessionSyncTimer: undefined,
      statusInterval: null,
    });
    const internals = agent as unknown as Record<string, any>;

    const initialization = internals.performBackgroundInit() as Promise<void>;
    internals.initReady = initialization;
    const shutdown = agent.shutdownRuntimeResources();

    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;
    releaseManagers?.();
    await initialization;

    expect(connectAll).not.toHaveBeenCalled();
    expect(setWorkspace).not.toHaveBeenCalled();
    expect(startHeartbeat).not.toHaveBeenCalled();
    expect(startTelemetry).not.toHaveBeenCalled();
    expect(internals.activeAgentHeartbeat).toBeNull();
  });

  it('does not replace a heartbeat whose previous stop overlaps runtime shutdown', async () => {
    vi.useFakeTimers();
    let releasePreviousStop: (() => void) | undefined;
    const previousStop = new Promise<void>((resolve) => {
      releasePreviousStop = resolve;
    });
    const previousHeartbeat = {
      stop: vi.fn(() => previousStop),
    };
    const agent = createShutdownAgent({
      activeAgentHeartbeat: previousHeartbeat,
      activeProvider: 'openrouter',
      sessionManager: {
        getCurrentSession: vi.fn().mockReturnValue(null),
        closeSession: vi.fn().mockResolvedValue(undefined),
      },
      runtime: {
        config: {},
        options: {},
        workspaceRoot: '/workspace',
      },
      sessionSyncTimer: undefined,
      statusInterval: null,
    });
    const internals = agent as unknown as Record<string, any>;
    const timerCountBefore = vi.getTimerCount();

    const starting = internals.startActiveAgentHeartbeat() as Promise<void>;
    await vi.waitFor(() => expect(previousHeartbeat.stop).toHaveBeenCalledOnce());
    const shutdown = agent.shutdownRuntimeResources();
    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;

    releasePreviousStop?.();
    await starting;

    expect(internals.activeAgentHeartbeat).toBeNull();
    expect(vi.getTimerCount()).toBe(timerCountBefore);
  });
});

describe('agent exit signal listeners', () => {
  it('removes the exact SIGINT and SIGTERM listener that it installed', () => {
    const host = {
      exitSignalHandlersInstalled: false,
      exitSignalHandler: null,
      shouldExit: false,
      clearAllQueuesAndAbort: vi.fn(),
    };
    const sigintBefore = new Set(process.listeners('SIGINT'));
    const sigtermBefore = new Set(process.listeners('SIGTERM'));

    try {
      installAgentExitSignalHandlers(host);
      const sigintHandler = process.listeners('SIGINT').find((listener) => !sigintBefore.has(listener));
      const sigtermHandler = process.listeners('SIGTERM').find((listener) => !sigtermBefore.has(listener));

      expect(sigintHandler).toBeDefined();
      expect(sigtermHandler).toBe(sigintHandler);

      removeAgentExitSignalHandlers(host);

      expect(process.listeners('SIGINT')).not.toContain(sigintHandler);
      expect(process.listeners('SIGTERM')).not.toContain(sigtermHandler);
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!sigintBefore.has(listener)) process.off('SIGINT', listener);
      }
      for (const listener of process.listeners('SIGTERM')) {
        if (!sigtermBefore.has(listener)) process.off('SIGTERM', listener);
      }
    }
  });
});
