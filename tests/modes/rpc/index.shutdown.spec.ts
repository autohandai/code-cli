/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => {
  let resolveInitializationStarted!: () => void;
  let resolveInitializationFallback!: () => void;
  const initializationStarted = new Promise<void>((resolve) => {
    resolveInitializationStarted = resolve;
  });
  const initializationFallback = new Promise<void>((resolve) => {
    resolveInitializationFallback = resolve;
  });
  return {
    initializationStarted,
    releaseInitialization: resolveInitializationFallback,
    initializeForRPC: vi.fn((signal?: AbortSignal) => {
      resolveInitializationStarted();
      return new Promise<void>((resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        void initializationFallback.then(resolve);
      });
    }),
    shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
    shutdownBrowserToolBridge: vi.fn(),
    writeErrorResponse: vi.fn(),
    lineReaderConstructor: vi.fn(),
  };
});

vi.mock('fs-extra', () => ({ default: {} }));
vi.mock('../../../src/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    provider: 'openrouter',
    openrouter: { model: 'test-model' },
    ui: {},
  }),
}));
vi.mock('../../../src/auth/index.js', () => ({ checkAuthenticated: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../src/runtime/bareMode.js', () => ({
  prepareBareModeConfig: vi.fn(async (config: unknown) => config),
}));
vi.mock('../../../src/startup/workspaceSafety.js', () => ({
  checkWorkspaceSafety: vi.fn().mockReturnValue({ safe: true }),
}));
vi.mock('../../../src/startup/checks.js', () => ({
  validateWorkspacePath: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('../../../src/utils/sessionWorktree.js', () => ({
  isSessionWorktreeEnabled: vi.fn().mockReturnValue(false),
  prepareSessionWorktree: vi.fn(),
}));
vi.mock('../../../src/providers/ProviderFactory.js', () => ({
  ProviderFactory: { create: vi.fn().mockReturnValue({}) },
}));
vi.mock('../../../src/actions/filesystem.js', () => ({ FileActionManager: class {} }));
vi.mock('../../../src/core/conversationManager.js', () => ({
  ConversationManager: { getInstance: vi.fn().mockReturnValue({}) },
}));
vi.mock('../../../src/core/agent.js', () => ({
  AutohandAgent: class {
    initializeForRPC = rpcMocks.initializeForRPC;
    shutdownRuntimeResources = rpcMocks.shutdownRuntimeResources;
    setConfirmationCallback = vi.fn();
    setDirectoryAccessCallback = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/adapter.js', () => ({
  RPCAdapter: class {
    initialize = vi.fn();
    shutdown = vi.fn().mockResolvedValue(undefined);
    requestPermission = vi.fn();
    requestDirectoryAccess = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  LineReader: class {
    constructor() {
      rpcMocks.lineReaderConstructor();
    }
    dispose = vi.fn();
    readLine = vi.fn().mockRejectedValue(new Error('Stream closed'));
  },
  parseRequest: vi.fn(),
  writeErrorResponse: rpcMocks.writeErrorResponse,
  writeBatchResponse: vi.fn(),
  writeInternalError: vi.fn(),
}));
vi.mock('../../../src/browser/browserToolBridge.js', () => ({
  setBrowserBridgeOutput: vi.fn(),
  shutdownBrowserToolBridge: rpcMocks.shutdownBrowserToolBridge,
}));
vi.mock('../../../src/commands/plan.js', () => ({ getPlanModeManager: vi.fn() }));
vi.mock('../../../src/utils/debugLog.js', () => ({ writeAutohandDebugLine: vi.fn() }));

import { runRpcMode } from '../../../src/modes/rpc/index.js';

describe('runRpcMode initialization shutdown', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('aborts pre-reader initialization on SIGTERM and drains cleanup', async () => {
    rpcMocks.shutdownBrowserToolBridge.mockImplementationOnce(() => {
      throw new Error('browser bridge already unavailable');
    });
    const existingHandlers = new Set(process.listeners('SIGTERM'));
    const running = runRpcMode({} as never);
    await rpcMocks.initializationStarted;
    const shutdownHandler = process.listeners('SIGTERM')
      .find((handler) => !existingHandlers.has(handler));
    expect(shutdownHandler).toBeDefined();

    shutdownHandler?.();
    const completedPromptly = await Promise.race([
      running.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    if (!completedPromptly) {
      rpcMocks.releaseInitialization();
      await running;
    }

    expect(completedPromptly).toBe(true);
    expect(rpcMocks.initializeForRPC).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(rpcMocks.shutdownBrowserToolBridge).toHaveBeenCalledOnce();
    expect(rpcMocks.shutdownRuntimeResources).toHaveBeenCalledOnce();
    expect(rpcMocks.lineReaderConstructor).not.toHaveBeenCalled();
    expect(rpcMocks.writeErrorResponse).not.toHaveBeenCalled();
    expect(process.listeners('SIGTERM')).toEqual(expect.arrayContaining([...existingHandlers]));
    expect(process.listeners('SIGTERM').filter((handler) => !existingHandlers.has(handler))).toEqual([]);
  });
});
