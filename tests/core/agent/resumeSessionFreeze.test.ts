/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for the session resume freeze bug.
 * When resuming a session, the CLI would freeze because:
 * 1. initDone was false, causing describeStartupWait to return STARTUP_WAIT_STATUS
 *    which leaves the composer in a "working" state instead of idle-ready
 * 2. initReady was null, so ensureInitComplete could not await startup completion.
 *    On resume it is set to a resolved promise (not performBackgroundInit) because
 *    the background-init pipeline would wipe the restored conversation and
 *    double-create a session; the resumed session is already restored.
 * 3. MCP startup coordinator was not prepared for interactive startup, so auto-connect
 *    servers were never identified and MCP tools were unavailable on the first turn
 * 4. Exit signal handlers were not installed, so SIGINT during resume was unhandled
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resumeAgentSession } from '../../../src/core/agent/AgentLifecycleRunner.js';

function makeResumeHost() {
  return {
    sessionManager: {
      initialize: vi.fn().mockResolvedValue(undefined),
      loadSession: vi.fn().mockResolvedValue({
        getMessages: () => [],
        metadata: { model: 'test-model', sessionId: 'sess-123' },
      }),
      createSession: vi.fn().mockResolvedValue({
        getMessages: () => [],
        metadata: { model: 'test-model', sessionId: 'sess-fallback' },
      }),
    },
    projectManager: { initialize: vi.fn().mockResolvedValue(undefined) },
    memoryManager: { initialize: vi.fn().mockResolvedValue(undefined) },
    skillsRegistry: { initialize: vi.fn().mockResolvedValue(undefined) },
    hookManager: { initialize: vi.fn().mockResolvedValue(undefined) },
    workspaceFileCollector: {
      collectWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
    },
    mcpStartupCoordinator: {
      prepareForInteractiveStartup: vi.fn(),
      markConnectStarted: vi.fn(),
      markSummaryPending: vi.fn(),
      describePendingConnections: vi.fn().mockReturnValue(null),
    },
    mcpManager: {
      connectAll: vi.fn().mockResolvedValue(undefined),
    },
    mcpReady: null,
    runtime: {
      config: { mcp: { enabled: true, servers: [] } },
      isRpcMode: false,
    },
    runtimeMcpServers: [],
    initDone: false,
    initReady: null,
    installExitSignalHandlers: vi.fn(),
    removeExitSignalHandlers: vi.fn(),
    resetConversationContext: vi.fn().mockResolvedValue(undefined),
    injectSessionBootstrap: vi.fn().mockResolvedValue(undefined),
    conversation: {
      history: () => [],
      addMessage: vi.fn(),
      addSystemNote: vi.fn(),
    },
    injectProjectKnowledge: vi.fn().mockResolvedValue(undefined),
    updateContextUsage: vi.fn(),
    telemetryManager: {
      startSession: vi.fn().mockResolvedValue(undefined),
      trackError: vi.fn().mockResolvedValue(undefined),
    },
    activeProvider: 'openrouter',
    runInteractiveLoop: vi.fn().mockResolvedValue(undefined),
    shouldExit: false,
    pendingInkInstructions: [],
    inkInstructionResolver: null,
    restoredChatMessages: [],
    inkRenderer: {
      setChatMessages: vi.fn(),
      setWorking: vi.fn(),
    },
    ui: {
      setWorking: vi.fn(),
    },
    sessionStartedAt: 0,
    flushMcpStartupSummaryIfPending: vi.fn(),
    syncMcpTools: vi.fn(),
    initializeManagers: vi.fn().mockResolvedValue(undefined),
    restoreSessionState: vi.fn().mockResolvedValue({
      getMessages: () => [],
      metadata: { model: 'test-model', sessionId: 'sess-123' },
    }),
    performBackgroundInit: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('resumeAgentSession freeze fix', () => {
  it('mounts input before manager initialization and waits before restoring or executing', async () => {
    const initializing = Promise.withResolvers<void>();
    const original = makeResumeHost();
    const host = {
      ...original,
      useInkRenderer: true,
      inkRenderer: undefined as typeof original.inkRenderer | undefined,
      initializeUI: vi.fn(async () => { host.inkRenderer = original.inkRenderer; }),
      setComposerIdle: vi.fn(),
    };
    host.initializeManagers.mockImplementation(async () => {
      expect(host.inkRenderer).toBe(original.inkRenderer);
      expect(host.setComposerIdle).toHaveBeenCalled();
      await initializing.promise;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const resume = resumeAgentSession(host, 'sess-123');
    try {
      await vi.waitFor(() => expect(host.initializeManagers).toHaveBeenCalledOnce());
      expect(host.installExitSignalHandlers).toHaveBeenCalledOnce();
      expect(host.restoreSessionState).not.toHaveBeenCalled();
      expect(host.runInteractiveLoop).not.toHaveBeenCalled();
    } finally {
      initializing.resolve();
      await resume;
    }
    expect(host.initializeUI).toHaveBeenCalledOnce();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });

  it('releases signal handlers when manager initialization fails after mounting input', async () => {
    const host = makeResumeHost();
    host.initializeManagers.mockRejectedValue(new Error('manager unavailable'));
    await expect(resumeAgentSession(host, 'sess-123')).rejects.toThrow('manager unavailable');
    expect(host.installExitSignalHandlers).toHaveBeenCalledOnce();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('does not restore or execute after the user exits during manager initialization', async () => {
    const host = makeResumeHost();
    host.initializeManagers.mockImplementation(async () => { host.shouldExit = true; });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await resumeAgentSession(host, 'sess-123');
    expect(host.restoreSessionState).not.toHaveBeenCalled();
    expect(host.runInteractiveLoop).not.toHaveBeenCalled();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });

  it('does not create a fallback session when restoration fails after the user exits', async () => {
    const host = makeResumeHost();
    host.restoreSessionState.mockImplementation(async () => {
      host.shouldExit = true;
      throw new Error('restore interrupted');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await resumeAgentSession(host, 'sess-123');
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(host.runInteractiveLoop).not.toHaveBeenCalled();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });

  it('keeps an existing composer editable while the saved session is loading', async () => {
    const restoring = Promise.withResolvers<void>();
    const host = { ...makeResumeHost(), useInkRenderer: true, setComposerIdle: vi.fn() };
    host.restoreSessionState.mockImplementation(async () => {
      await restoring.promise;
      return { getMessages: () => [], metadata: { model: 'test-model', sessionId: 'sess-123' } };
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const resume = resumeAgentSession(host, 'sess-123');
    try {
      await vi.waitFor(() => expect(host.restoreSessionState).toHaveBeenCalledOnce());
      expect(host.setComposerIdle).toHaveBeenCalled();
      expect(host.runInteractiveLoop).not.toHaveBeenCalled();
      expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    } finally {
      restoring.resolve();
      await resume;
    }
    expect(host.runInteractiveLoop).toHaveBeenCalledOnce();
  });

  it('sets initDone and initReady so ensureInitComplete does not hang', async () => {
    const host = makeResumeHost();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();

    // initDone must be true so describeStartupWait returns null
    expect(host.initDone).toBe(true);
    // initReady must be a resolved promise so ensureInitComplete returns immediately
    expect(host.initReady).toBeInstanceOf(Promise);
    await expect(host.initReady).resolves.toBeUndefined();
  });

  it('installs and removes exit signal handlers around the interactive loop', async () => {
    const host = makeResumeHost();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();

    expect(host.installExitSignalHandlers).toHaveBeenCalledTimes(1);
    expect(host.removeExitSignalHandlers).toHaveBeenCalledTimes(1);
  });

  it('prepares MCP startup coordinator and starts background connections', async () => {
    const host = makeResumeHost();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();

    expect(host.mcpStartupCoordinator.prepareForInteractiveStartup).toHaveBeenCalledTimes(1);
    expect(host.mcpStartupCoordinator.markConnectStarted).toHaveBeenCalledTimes(1);
    expect(host.mcpManager.connectAll).toHaveBeenCalledTimes(1);
  });

  it('skips MCP connections when MCP is disabled', async () => {
    const host = makeResumeHost();
    host.runtime.config.mcp.enabled = false;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();

    expect(host.mcpStartupCoordinator.prepareForInteractiveStartup).toHaveBeenCalledTimes(1);
    expect(host.mcpStartupCoordinator.markConnectStarted).not.toHaveBeenCalled();
    expect(host.mcpManager.connectAll).not.toHaveBeenCalled();
  });

  it('cleans up signal handlers on error path', async () => {
    const host = makeResumeHost();
    host.restoreSessionState = vi.fn().mockRejectedValue(new Error('session load failed'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();
    errorSpy.mockRestore();

    // Handlers must be installed before the try so the fallback path (which
    // creates a new session) also has them active during the interactive loop.
    expect(host.installExitSignalHandlers).toHaveBeenCalledTimes(1);
    expect(host.removeExitSignalHandlers).toHaveBeenCalledTimes(1);
  });

  it('sets init state on the fallback path so the composer does not freeze', async () => {
    const host = makeResumeHost();
    host.restoreSessionState = vi.fn().mockRejectedValue(new Error('session load failed'));
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();
    errorSpy.mockRestore();

    // The fallback creates a new session; initDone must still be true so
    // describeStartupWait() returns null and ensureInitComplete() does not hang.
    expect(host.initDone).toBe(true);
    expect(host.initReady).toBeInstanceOf(Promise);
    await expect(host.initReady).resolves.toBeUndefined();
  });

  it('accepts a resumed session without awaiting a stalled MCP handshake', async () => {
    const host = makeResumeHost();
    host.mcpManager.connectAll.mockImplementation(() => new Promise(() => {}));
    host.runInteractiveLoop.mockImplementation(async () => {
      expect(host.initDone).toBe(true);
      await expect(host.initReady).resolves.toBeUndefined();
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await resumeAgentSession(host, 'sess-123');
    expect(host.runInteractiveLoop).toHaveBeenCalledOnce();
    expect(host.performBackgroundInit).not.toHaveBeenCalled();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });

  it('retains signal cleanup and resumed history when MCP startup throws synchronously', async () => {
    const host = makeResumeHost();
    host.mcpManager.connectAll.mockImplementation(() => { throw new Error('MCP startup failed'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await resumeAgentSession(host, 'sess-123');
    expect(host.initDone).toBe(true);
    expect(host.runInteractiveLoop).toHaveBeenCalledOnce();
    expect(host.sessionManager.createSession).not.toHaveBeenCalled();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledOnce();
  });

  it('skips MCP connections when mcpManager is absent', async () => {
    const host = { ...makeResumeHost(), mcpManager: undefined };
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeAgentSession(host, 'sess-123');

    consoleSpy.mockRestore();

    expect(host.mcpStartupCoordinator.prepareForInteractiveStartup).toHaveBeenCalledTimes(1);
    expect(host.mcpStartupCoordinator.markConnectStarted).not.toHaveBeenCalled();
    expect(host.removeExitSignalHandlers).toHaveBeenCalledTimes(1);
  });
});
