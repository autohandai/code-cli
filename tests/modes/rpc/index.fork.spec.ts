/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => ({
  enabled: true,
  readCount: 0,
  initializeSessions: vi.fn().mockResolvedValue(undefined),
  resolveSessionReference: vi.fn().mockResolvedValue('saved-session'),
  getLastSession: vi.fn().mockResolvedValue({ sessionId: 'latest-session' }),
  branchSession: vi.fn().mockResolvedValue({ metadata: { sessionId: 'forked-session' } }),
  attach: vi.fn().mockResolvedValue({ success: true }),
  writeErrorResponse: vi.fn(),
}));

vi.mock('fs-extra', () => ({ default: {} }));
vi.mock('../../../src/config.js', () => ({
  applyCliProviderOverride: vi.fn((config: unknown) => config),
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
    getSessionManager = () => ({ branchSession: rpcMocks.branchSession, initialize: rpcMocks.initializeSessions, resolveSessionReference: rpcMocks.resolveSessionReference, getLastSession: rpcMocks.getLastSession });
    setConfirmationCallback = vi.fn();
    setDirectoryAccessCallback = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/adapter.js', () => ({
  RPCAdapter: class {
    initialize = vi.fn();
    handleSessionAttach = rpcMocks.attach;
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

vi.mock('../../../src/features/featureRegistry.js', () => ({ getFeatureState: () => ({ enabled: rpcMocks.enabled }) }));

import { runRpcMode } from '../../../src/modes/rpc/index.js';

describe('RPC fork startup', () => {
  afterEach(() => { vi.clearAllMocks(); rpcMocks.enabled = true; rpcMocks.readCount = 0; });
  it('branches and attaches the fork before serving requests', async () => {
    await expect(runRpcMode({ fork: 'source-session' } as never)).resolves.toBe(0);
    expect(rpcMocks.branchSession).toHaveBeenCalledWith('source-session', { type: 'fork' });
    expect(rpcMocks.attach).toHaveBeenCalledWith(null, { sessionId: 'forked-session' });
  });
  it('rejects a disabled fork instead of silently starting a new session', async () => {
    rpcMocks.enabled = false;
    await expect(runRpcMode({ fork: 'source-session' } as never)).resolves.toBe(1);
    expect(rpcMocks.branchSession).not.toHaveBeenCalled();
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    expect(rpcMocks.writeErrorResponse).toHaveBeenCalledWith(null, expect.any(Number), 'RPC initialization failed.', expect.objectContaining({ kind: 'initialization_failed' }));
  });
  it('reports a missing source without attaching an unrelated session', async () => {
    rpcMocks.branchSession.mockRejectedValueOnce(new Error('Session not found: missing-source'));
    await expect(runRpcMode({ fork: 'missing-source' } as never)).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    expect(rpcMocks.writeErrorResponse).toHaveBeenCalledWith(null, expect.any(Number), 'RPC initialization failed.', expect.objectContaining({ kind: 'initialization_failed' }));
  });
  it('resolves an SDK session ID or path before attaching its saved history', async () => {
    await expect(runRpcMode({ sdkSessionReference: '/saved/session' } as never)).resolves.toBe(0);
    expect(rpcMocks.resolveSessionReference).toHaveBeenCalledWith('/saved/session');
    expect(rpcMocks.attach).toHaveBeenCalledWith(null, { sessionId: 'saved-session' });
  });
  it('continues the latest session from the requested workspace', async () => {
    await expect(runRpcMode({ sdkResumeLast: true } as never)).resolves.toBe(0);
    expect(rpcMocks.getLastSession).toHaveBeenCalledWith(expect.any(String));
    expect(rpcMocks.attach).toHaveBeenCalledWith(null, { sessionId: 'latest-session' });
  });
  it('rejects conflicting session references and ephemeral restores', async () => {
    await expect(runRpcMode({ sdkSessionReference: 'saved', fork: 'other' } as never)).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    await expect(runRpcMode({ sdkSessionReference: 'saved', ephemeral: true } as never)).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
  });

});
