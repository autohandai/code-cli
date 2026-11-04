/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcMocks = vi.hoisted(() => ({
  enabled: true,
  events: [] as string[],
  initializeAgent: vi.fn(async (_signal: AbortSignal, id?: string) => { rpcMocks.events.push('initialize:' + (id ?? 'new')); }),
  initializeAdapter: vi.fn(() => { rpcMocks.events.push('adapter'); }),
  readerCreated: vi.fn(),
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
vi.mock('../../../src/startup/workspaceTrustPrompt.js', () => ({ resolveWorkspaceTrust: vi.fn().mockResolvedValue(undefined) }));
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
vi.mock('../../../src/actions/web.js', () => ({ configureSearchFromAccount: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../src/core/conversationManager.js', () => ({
  ConversationManager: {
    getInstance: vi.fn().mockReturnValue({ addSystemNote: vi.fn() }),
  },
}));
vi.mock('../../../src/core/agent.js', () => ({
  AutohandAgent: class {
    initializeForRPC = rpcMocks.initializeAgent;
    shutdownRuntimeResources = vi.fn().mockResolvedValue(undefined);
    getSessionManager = () => ({ branchSession: rpcMocks.branchSession, initialize: rpcMocks.initializeSessions, resolveSessionReference: rpcMocks.resolveSessionReference, getLastSession: rpcMocks.getLastSession });
    setConfirmationCallback = vi.fn();
    setDirectoryAccessCallback = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/adapter.js', () => ({
  RPCAdapter: class {
    initialize = rpcMocks.initializeAdapter;
    handleSessionAttach = rpcMocks.attach;
    shutdown = vi.fn().mockResolvedValue(undefined);
    requestPermission = vi.fn();
    requestDirectoryAccess = vi.fn();
  },
}));
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  LineReader: class {
    constructor() { rpcMocks.readerCreated(); }
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
import type { CLIOptions } from '../../../src/types.js';
type StartupOptions = CLIOptions & { sdkSessionReference?: string; sdkResumeLast?: boolean };
const startup = (options: StartupOptions) => runRpcMode(options);

describe('RPC fork startup', () => {
  afterEach(() => { vi.clearAllMocks(); rpcMocks.enabled = true; rpcMocks.readCount = 0; rpcMocks.events.length = 0; });
  it('branches and attaches the fork before serving requests', async () => {
    await expect(startup({ fork: 'source-session' })).resolves.toBe(0);
    expect(rpcMocks.branchSession).toHaveBeenCalledWith('source-session', { type: 'fork' });
    expect(rpcMocks.initializeAgent).toHaveBeenCalledWith(expect.any(AbortSignal), 'forked-session');
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    expect(rpcMocks.events).toEqual(['initialize:forked-session', 'adapter']);
  });
  it('rejects a disabled fork instead of silently starting a new session', async () => {
    rpcMocks.enabled = false;
    await expect(startup({ fork: 'source-session' })).resolves.toBe(1);
    expect(rpcMocks.branchSession).not.toHaveBeenCalled();
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    expect(rpcMocks.writeErrorResponse).toHaveBeenCalledWith(null, expect.any(Number), 'RPC initialization failed.', expect.objectContaining({ kind: 'initialization_failed' }));
  });
  it('reports a missing source without attaching an unrelated session', async () => {
    rpcMocks.branchSession.mockRejectedValueOnce(new Error('Session not found: missing-source'));
    await expect(startup({ fork: 'missing-source' })).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    expect(rpcMocks.writeErrorResponse).toHaveBeenCalledWith(null, expect.any(Number), 'RPC initialization failed.', expect.objectContaining({ kind: 'initialization_failed' }));
  });
  it('resolves an SDK session ID or path before attaching its saved history', async () => {
    await expect(startup({ sdkSessionReference: '/saved/session' })).resolves.toBe(0);
    expect(rpcMocks.resolveSessionReference).toHaveBeenCalledWith('/saved/session');
    expect(rpcMocks.initializeAgent).toHaveBeenCalledWith(expect.any(AbortSignal), 'saved-session');
    expect(rpcMocks.initializeAdapter.mock.calls[0]?.at(-1)).toBe('resume');
    expect(rpcMocks.attach).not.toHaveBeenCalled();
  });
  it('continues the latest session from the requested workspace', async () => {
    await expect(startup({ sdkResumeLast: true })).resolves.toBe(0);
    expect(rpcMocks.getLastSession).toHaveBeenCalledWith(expect.any(String));
    expect(rpcMocks.initializeAgent).toHaveBeenCalledWith(expect.any(AbortSignal), 'latest-session');
    expect(rpcMocks.attach).not.toHaveBeenCalled();
  });
  it('rejects conflicting session references and ephemeral restores', async () => {
    await expect(startup({ sdkSessionReference: 'saved', fork: 'other' })).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
    await expect(startup({ sdkSessionReference: 'saved', ephemeral: true })).resolves.toBe(1);
    expect(rpcMocks.attach).not.toHaveBeenCalled();
  });

  it.each<StartupOptions>([
    { sdkSessionReference: 'saved', continue: true },
    { sdkSessionReference: 'saved', resume: 'public' },
    { sdkSessionReference: 'saved', resumeSessionId: 'public' },
    { sdkResumeLast: true, continue: true },
    { sdkResumeLast: true, resume: true },
    { sdkResumeLast: true, resumeSessionId: 'public' },
    { sdkSessionReference: 'saved', sdkResumeLast: true },
    { sdkResumeLast: true, fork: 'source' },
    { sdkResumeLast: true, ephemeral: true },
  ])('rejects ambiguous or ephemeral SDK selectors (%j)', async options => {
    await expect(startup(options)).resolves.toBe(1);
    expect(rpcMocks.initializeAgent).not.toHaveBeenCalled();
    expect(rpcMocks.initializeAdapter).not.toHaveBeenCalled();
    expect(rpcMocks.readerCreated).not.toHaveBeenCalled();
  });

  it('does not announce or serve a session when history restoration fails', async () => {
    rpcMocks.initializeAgent.mockRejectedValueOnce(new Error('Unable to restore saved history'));
    await expect(startup({ sdkSessionReference: 'saved' })).resolves.toBe(1);
    expect(rpcMocks.initializeAgent).toHaveBeenCalledTimes(1);
    expect(rpcMocks.initializeAdapter).not.toHaveBeenCalled();
    expect(rpcMocks.readerCreated).not.toHaveBeenCalled();
  });

  it('rejects an unavailable latest session instead of creating an unrelated new one', async () => {
    rpcMocks.getLastSession.mockResolvedValueOnce(undefined);
    await expect(startup({ sdkResumeLast: true })).resolves.toBe(1);
    expect(rpcMocks.initializeAgent).not.toHaveBeenCalled();
    expect(rpcMocks.initializeAdapter).not.toHaveBeenCalled();
  });

  it('cancels restoration before announcing success and releases its exit listeners', async () => {
    const before = process.listenerCount('SIGTERM');
    rpcMocks.initializeAgent.mockImplementationOnce(async () => { process.emit('SIGTERM'); });
    await expect(startup({ sdkSessionReference: 'saved' })).resolves.toBe(0);
    expect(rpcMocks.initializeAdapter).not.toHaveBeenCalled();
    expect(rpcMocks.readerCreated).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
