/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => ({
  readCount: 0,
  writeErrorResponse: vi.fn(),
}));

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
vi.mock('../../../src/actions/web.js', () => ({ configureSearchFromSettings: vi.fn() }));
vi.mock('../../../src/core/conversationManager.js', () => ({
  ConversationManager: {
    getInstance: vi.fn().mockReturnValue({ addSystemNote: vi.fn() }),
  },
}));
vi.mock('../../../src/core/agent.js', () => ({
  AutohandAgent: class {
    initializeForRPC = vi.fn().mockResolvedValue(undefined);
    shutdownRuntimeResources = vi.fn().mockResolvedValue(undefined);
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
    dispose = vi.fn();
    readLine = vi.fn(() => {
      rpcMocks.readCount += 1;
      if (rpcMocks.readCount === 1) {
        return Promise.resolve('{"jsonrpc":"2.0","method":"RAW_JSON_SENTINEL"}');
      }
      return Promise.reject(new Error('Stream closed'));
    });
  },
  parseRequest: vi.fn(() => ({
    type: 'error',
    code: -32600,
    message: 'Invalid request',
  })),
  writeErrorResponse: rpcMocks.writeErrorResponse,
  writeBatchResponse: vi.fn(),
  writeInternalError: vi.fn(),
}));
vi.mock('../../../src/browser/browserToolBridge.js', () => ({
  setBrowserBridgeOutput: vi.fn(),
  shutdownBrowserToolBridge: vi.fn(),
}));
vi.mock('../../../src/commands/plan.js', () => ({ getPlanModeManager: vi.fn() }));

import { runRpcMode } from '../../../src/modes/rpc/index.js';

describe('runRpcMode debug logging', () => {
  const originalDebugValue = process.env.AUTOHAND_DEBUG;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    rpcMocks.readCount = 0;
    process.exitCode = originalExitCode;
    if (originalDebugValue === undefined) {
      delete process.env.AUTOHAND_DEBUG;
    } else {
      process.env.AUTOHAND_DEBUG = originalDebugValue;
    }
    vi.restoreAllMocks();
  });

  it('logs request metadata without the raw JSON payload', async () => {
    process.env.AUTOHAND_DEBUG = '1';
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runRpcMode({} as never)).resolves.toBe(0);

    const diagnostics = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(diagnostics).toContain('[RPC DEBUG] stdin read line size=');
    expect(diagnostics).toContain('[RPC DEBUG] handleLine inputLength=');
    expect(diagnostics).not.toContain('RAW_JSON_SENTINEL');
    expect(rpcMocks.writeErrorResponse).toHaveBeenCalledWith(null, -32600, 'Invalid request');
  });
});
