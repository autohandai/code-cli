/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => '2026-07-14T00:00:00.000Z',
  generateId: (prefix: string) => `${prefix}_shutdown`,
}));

const modelSupportsImages = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../../../src/providers/modelCapabilities.js', () => ({ modelSupportsImages }));

import { RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { writeNotification } from '../../../src/modes/rpc/protocol.js';

describe('RPCAdapter shutdown', () => {
  const agent = {
    setStatusListener: vi.fn(),
    setOutputListener: vi.fn(),
    getImageManager: vi.fn().mockReturnValue({}),
    cancelCurrentInstruction: vi.fn(),
    shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
    getStatusSnapshot: vi.fn().mockReturnValue({ tokensUsed: 0 }),
    isSlashCommand: vi.fn().mockReturnValue(false),
    parseSlashCommand: vi.fn().mockReturnValue({ command: 'help', args: [] }),
    isSlashCommandSupported: vi.fn().mockReturnValue(true),
    handleSlashCommand: vi.fn().mockResolvedValue('done'),
    getFileManager: vi.fn().mockReturnValue(undefined),
    getHookManager: vi.fn().mockReturnValue(undefined),
    getPermissionManager: vi.fn().mockReturnValue({ setMode: vi.fn() }),
    runInstruction: vi.fn().mockResolvedValue(true),
  };
  const conversation = { history: vi.fn().mockReturnValue([]) };

  beforeEach(() => {
    vi.clearAllMocks();
    agent.getImageManager.mockReturnValue({});
    agent.isSlashCommand.mockReturnValue(false);
    agent.isSlashCommandSupported.mockReturnValue(true);
    agent.handleSlashCommand.mockResolvedValue('done');
    agent.getFileManager.mockReturnValue(undefined);
    agent.getHookManager.mockReturnValue(undefined);
    agent.getPermissionManager.mockReturnValue({ setMode: vi.fn() });
    agent.shutdownRuntimeResources.mockResolvedValue(undefined);
    agent.runInstruction.mockResolvedValue(true);
    modelSupportsImages.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is idempotent, settles pending work, detaches listeners, and emits agentEnd once', async () => {
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    const internals = adapter as unknown as Record<string, any>;

    const permission = adapter.requestPermission('write_file', 'Write?', { path: 'README.md' });
    const directory = adapter.requestDirectoryAccess('/outside', 'Read?');
    adapter.handleMcpSetVscodeTools('req', {
      tools: [{ name: 'read', description: 'Read', serverName: 'editor' }],
    });
    const vscodeInvocation = adapter.invokeVscodeTool('vscode__editor__read', {});

    const activePrompt = {
      identity: Symbol('active'),
      abortController: new AbortController(),
      turnId: 'turn-active',
      turnStartTime: Date.now(),
      messageId: 'message-active',
      messageContent: '',
      cancelRequested: false,
      finalized: false,
    };
    internals.activePrompt = activePrompt;
    internals.abortController = activePrompt.abortController;
    internals.yoloRevertTimer = setTimeout(() => {}, 60_000);

    vi.mocked(writeNotification).mockClear();
    const first = adapter.shutdown('disconnected');
    const second = adapter.shutdown('error');

    expect(second).toBe(first);
    await Promise.all([first, second]);
    const pendingResults = await Promise.allSettled([permission, directory, vscodeInvocation]);

    expect(pendingResults).toHaveLength(3);
    expect(agent.cancelCurrentInstruction).toHaveBeenCalledOnce();
    expect(agent.shutdownRuntimeResources).toHaveBeenCalledOnce();
    expect(agent.setStatusListener).toHaveBeenLastCalledWith(undefined);
    expect(agent.setOutputListener).toHaveBeenLastCalledWith(undefined);
    expect(internals.pendingPermissions.size).toBe(0);
    expect(internals.pendingDirectoryAccess.size).toBe(0);
    expect(internals.pendingVscodeInvocations.size).toBe(0);
    expect(internals.yoloRevertTimer).toBeNull();
    expect(activePrompt.abortController.signal.aborted).toBe(true);
    expect(activePrompt.finalized).toBe(true);
    expect(vi.mocked(writeNotification).mock.calls.filter(
      ([method]) => method === 'autohand.agentEnd',
    )).toHaveLength(1);
    expect(vi.mocked(writeNotification).mock.calls.find(
      ([method]) => method === 'autohand.agentEnd',
    )?.[1]).toEqual(expect.objectContaining({ reason: 'aborted' }));
    expect(vi.mocked(writeNotification).mock.calls.some(
      ([method]) => method === 'autohand.messageEnd' || method === 'autohand.turnEnd',
    )).toBe(false);
  });

  it('cancels a same-tick scheduled prompt before it can emit or restart keepalive', async () => {
    agent.shutdownRuntimeResources.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    const internals = adapter as unknown as Record<string, any>;
    vi.mocked(writeNotification).mockClear();

    adapter.startPrompt('req', { message: 'do not start' });
    const shutdown = adapter.shutdown('disconnected');
    await new Promise<void>((resolve) => setImmediate(resolve));
    await shutdown;

    const methods = vi.mocked(writeNotification).mock.calls.map(([method]) => method);
    expect(methods).toEqual(['autohand.agentEnd']);
    expect(agent.runInstruction).not.toHaveBeenCalled();
    expect(internals.keepaliveInterval).toBeNull();
  });

  it('waits for an already-running prompt to finalize before agentEnd', async () => {
    let resolveRun!: (value: boolean) => void;
    agent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveRun = resolve;
    }));
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', { message: 'running' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(agent.runInstruction).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    let settled = false;
    const shutdown = adapter.shutdown('disconnected').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveRun(false);
    await shutdown;

    expect(vi.mocked(writeNotification).mock.calls.map(([method]) => method)).toEqual([
      'autohand.messageEnd',
      'autohand.turnEnd',
      'autohand.agentEnd',
    ]);
  });

  it('bounds a non-cooperative active prompt with one shutdown deadline', async () => {
    vi.useFakeTimers();
    let resolveRun!: (value: boolean) => void;
    agent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveRun = resolve;
    }));
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', { message: 'ignores cancellation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.runInstruction).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    let settled = false;
    const shutdown = adapter.shutdown('disconnected').then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2_499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await shutdown;
    expect(settled).toBe(true);
    expect(vi.mocked(writeNotification).mock.calls.map(([method]) => method)).toEqual([
      'autohand.messageEnd',
      'autohand.turnEnd',
      'autohand.agentEnd',
    ]);

    resolveRun(false);
    await Promise.resolve();
    expect(vi.mocked(writeNotification).mock.calls.map(([method]) => method)).toEqual([
      'autohand.messageEnd',
      'autohand.turnEnd',
      'autohand.agentEnd',
    ]);
  });

  it('does not start agent work after vision preprocessing outlives shutdown', async () => {
    vi.useFakeTimers();
    let resolveVision!: (supported: boolean) => void;
    modelSupportsImages.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveVision = resolve;
    }));
    const imageManager = {
      add: vi.fn().mockReturnValue(1),
      formatPlaceholder: vi.fn().mockReturnValue('[Image #1]'),
    };
    agent.getImageManager.mockReturnValue(imageManager);
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', {
      message: 'inspect image',
      images: [{ data: '', mimeType: 'image/png' }],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(modelSupportsImages).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    const shutdown = adapter.shutdown('disconnected');
    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;
    const notificationCountAfterShutdown = vi.mocked(writeNotification).mock.calls.length;

    resolveVision(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.runInstruction).not.toHaveBeenCalled();
    expect(imageManager.add).not.toHaveBeenCalled();
    expect(vi.mocked(writeNotification)).toHaveBeenCalledTimes(notificationCountAfterShutdown);
  });

  it('does not emit after a slash command promise outlives shutdown', async () => {
    vi.useFakeTimers();
    let resolveSlash!: (result: string | null) => void;
    agent.isSlashCommand.mockReturnValue(true);
    agent.handleSlashCommand.mockImplementationOnce(() => new Promise<string | null>((resolve) => {
      resolveSlash = resolve;
    }));
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', { message: '/help' });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.handleSlashCommand).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    const shutdown = adapter.shutdown('disconnected');
    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;
    const notificationCountAfterShutdown = vi.mocked(writeNotification).mock.calls.length;

    resolveSlash('late output');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.runInstruction).not.toHaveBeenCalled();
    expect(vi.mocked(writeNotification)).toHaveBeenCalledTimes(notificationCountAfterShutdown);
  });

  it('settles preview mode before agentEnd and blocks late preview effects', async () => {
    vi.useFakeTimers();
    let resolveRun!: (value: boolean) => void;
    const fileManager = {
      enterPreviewMode: vi.fn(),
      getPendingChanges: vi.fn().mockReturnValue([]),
      exitPreviewMode: vi.fn(),
    };
    agent.getFileManager.mockReturnValue(fileManager);
    agent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      resolveRun = resolve;
    }));
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', { message: 'edit files' });
    await vi.advanceTimersByTimeAsync(0);
    expect(agent.runInstruction).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    const shutdown = adapter.shutdown('disconnected');
    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;
    const notificationCountAfterShutdown = vi.mocked(writeNotification).mock.calls.length;
    const methods = vi.mocked(writeNotification).mock.calls.map(([method]) => method);
    expect(methods.indexOf('autohand.changesBatchEnd')).toBeLessThan(
      methods.indexOf('autohand.agentEnd'),
    );
    expect(fileManager.exitPreviewMode).toHaveBeenCalledOnce();

    resolveRun(false);
    await vi.advanceTimersByTimeAsync(0);

    expect(fileManager.exitPreviewMode).toHaveBeenCalledOnce();
    expect(fileManager.getPendingChanges).toHaveBeenCalledOnce();
    expect(vi.mocked(writeNotification)).toHaveBeenCalledTimes(notificationCountAfterShutdown);
  });

  it('does not emit hook completion after agentEnd', async () => {
    vi.useFakeTimers();
    let resolveHook!: () => void;
    const hookManager = {
      executeHooks: vi.fn(() => new Promise<void>((resolve) => {
        resolveHook = resolve;
      })),
    };
    agent.getHookManager.mockReturnValue(hookManager);
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    adapter.startPrompt('req', { message: 'run hooks' });
    await vi.advanceTimersByTimeAsync(0);
    expect(hookManager.executeHooks).toHaveBeenCalledOnce();
    vi.mocked(writeNotification).mockClear();

    const shutdown = adapter.shutdown('disconnected');
    await vi.advanceTimersByTimeAsync(2_500);
    await shutdown;
    const notificationCountAfterShutdown = vi.mocked(writeNotification).mock.calls.length;

    resolveHook();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.mocked(writeNotification)).toHaveBeenCalledTimes(notificationCountAfterShutdown);
  });

  it('rejects timer-producing callbacks after shutdown without mutating adapter state', async () => {
    vi.useFakeTimers();
    const permissionManager = { setMode: vi.fn() };
    agent.getPermissionManager.mockReturnValue(permissionManager);
    const adapter = new RPCAdapter();
    adapter.initialize(agent as any, conversation as any, 'model', '/workspace');
    await adapter.shutdown('disconnected');
    vi.mocked(writeNotification).mockClear();
    const timersBeforeCallbacks = vi.getTimerCount();

    const permission = await adapter.requestPermission('write_file', 'Write?', { path: 'README.md' });
    const directory = await adapter.requestDirectoryAccess('/outside', 'Read?');
    const registration = adapter.handleMcpSetVscodeTools('req', {
      tools: [{ name: 'read', description: 'Read', serverName: 'editor' }],
    });
    let invocationResult: Error | undefined;
    void adapter.invokeVscodeTool('vscode__editor__read', {}).catch((error: Error) => {
      invocationResult = error;
    });
    await Promise.resolve();
    const yolo = adapter.handleYoloSet('req', { pattern: '*', timeoutSeconds: 30 });
    adapter.emitToolStart('read_file', { path: 'late.txt' });
    adapter.emitHookStop(0, 0, 0);
    const internals = adapter as unknown as Record<string, any>;

    expect(permission).toEqual({ decision: 'deny_once' });
    expect(directory).toBeUndefined();
    expect(registration).toEqual({ success: false });
    expect(invocationResult).toMatchObject({ message: 'Adapter shutdown' });
    expect(yolo).toEqual({ success: false });
    expect(permissionManager.setMode).not.toHaveBeenCalled();
    expect(internals.pendingPermissions.size).toBe(0);
    expect(internals.pendingDirectoryAccess.size).toBe(0);
    expect(internals.pendingVscodeInvocations.size).toBe(0);
    expect(internals.vscodeTools.size).toBe(0);
    expect(internals.keepaliveInterval).toBeNull();
    expect(internals.status).toBe('idle');
    expect(vi.getTimerCount()).toBe(timersBeforeCallbacks);
    expect(writeNotification).not.toHaveBeenCalled();
  });
});
