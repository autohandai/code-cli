/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => {
  let markRequestStarted: (() => void) | undefined;
  let releaseRequest: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve;
  });
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  return {
    requestStarted,
    releaseRequest: () => releaseRequest?.(),
    handleReset: vi.fn(async () => {
      markRequestStarted?.();
      await heldRequest;
      return { success: true };
    }),
    adapterShutdown: vi.fn().mockResolvedValue(undefined),
    shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
    stdoutWrite: vi.fn((...args: unknown[]) => {
      const callback = args.find((arg): arg is () => void => typeof arg === 'function');
      callback?.();
      return true;
    }),
    readCount: 0,
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
    initializeForRPC = vi.fn().mockResolvedValue(undefined);
    shutdownRuntimeResources = rpcMocks.shutdownRuntimeResources;
    setConfirmationCallback = vi.fn();
    setDirectoryAccessCallback = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/adapter.js', () => ({
  RPCAdapter: class {
    initialize = vi.fn();
    shutdown = rpcMocks.adapterShutdown;
    requestPermission = vi.fn();
    requestDirectoryAccess = vi.fn();
    handleReset = rpcMocks.handleReset;
  },
}));
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  LineReader: class {
    dispose = vi.fn();
    readLine = vi.fn(() => {
      rpcMocks.readCount += 1;
      if (rpcMocks.readCount === 1) return Promise.resolve('held request');
      return Promise.reject(new Error('Stream closed'));
    });
  },
  parseRequest: vi.fn(() => ({
    type: 'request',
    request: { jsonrpc: '2.0', id: 1, method: 'autohand.reset' },
  })),
  writeErrorResponse: vi.fn(),
  writeBatchResponse: vi.fn(),
  writeInternalError: vi.fn(),
}));
vi.mock('../../../src/browser/browserToolBridge.js', () => ({
  setBrowserBridgeOutput: vi.fn(),
  shutdownBrowserToolBridge: vi.fn(),
}));
vi.mock('../../../src/commands/plan.js', () => ({ getPlanModeManager: vi.fn() }));
vi.mock('../../../src/utils/debugLog.js', () => ({ writeAutohandDebugLine: vi.fn() }));

import { runRpcMode } from '../../../src/modes/rpc/index.js';

describe('runRpcMode in-flight request shutdown', () => {
  const originalExitCode = process.exitCode;

  afterEach(async () => {
    rpcMocks.releaseRequest();
    await Promise.resolve();
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('starts cleanup on SIGTERM without waiting for a held request or writing its late response', async () => {
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(rpcMocks.stdoutWrite);
    const existingHandlers = new Set(process.listeners('SIGTERM'));
    const running = runRpcMode({} as never);
    await rpcMocks.requestStarted;
    const shutdownHandler = process.listeners('SIGTERM')
      .find((handler) => !existingHandlers.has(handler));
    expect(shutdownHandler).toBeDefined();

    shutdownHandler?.();
    const completedPromptly = await Promise.race([
      running.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);

    if (!completedPromptly) {
      rpcMocks.releaseRequest();
      await running;
    }

    expect(completedPromptly).toBe(true);
    expect(rpcMocks.adapterShutdown).toHaveBeenCalledOnce();
    expect(rpcMocks.shutdownRuntimeResources).toHaveBeenCalledOnce();
    expect(process.listeners('SIGTERM').filter((handler) => !existingHandlers.has(handler))).toEqual([]);

    rpcMocks.releaseRequest();
    await new Promise((resolve) => setImmediate(resolve));

    const protocolWrites = stdoutWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .filter((chunk) => chunk.includes('"id":1'));
    expect(protocolWrites).toEqual([]);
  });
});
