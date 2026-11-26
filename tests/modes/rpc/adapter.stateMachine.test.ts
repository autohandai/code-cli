/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let idCounter = 0;
vi.mock('../../../src/modes/rpc/protocol.js', () => ({
  writeNotification: vi.fn(),
  createTimestamp: () => '2026-11-25T00:00:00.000Z',
  generateId: (prefix: string) => `${prefix}_${++idCounter}`,
}));

import { RPC_ADAPTER_LIFECYCLE, RPCAdapter } from '../../../src/modes/rpc/adapter.js';
import { writeNotification } from '../../../src/modes/rpc/protocol.js';
import {
  InvalidTransitionError,
  StateMachine,
  reachableStates,
  terminalStates,
} from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

function createAgent() {
  return {
    setStatusListener: vi.fn(),
    setOutputListener: vi.fn(),
    getImageManager: vi.fn().mockReturnValue({ clear: vi.fn() }),
    getSessionManager: vi.fn().mockReturnValue(undefined),
    cancelCurrentInstruction: vi.fn(),
    shutdownRuntimeResources: vi.fn().mockResolvedValue(undefined),
    getStatusSnapshot: vi.fn().mockReturnValue({ tokensUsed: 0 }),
    isSlashCommand: vi.fn().mockReturnValue(false),
    getFileManager: vi.fn().mockReturnValue(undefined),
    getHookManager: vi.fn().mockReturnValue(undefined),
    getLlmProvider: vi.fn().mockReturnValue(undefined),
    getMemoryManager: vi.fn().mockReturnValue(undefined),
    getAndResetFileModCount: vi.fn().mockReturnValue({ count: 0, paths: [] }),
    getAndResetExecutedActions: vi.fn().mockReturnValue([]),
    runInstruction: vi.fn().mockResolvedValue(true),
  };
}

function permissionIds(): string[] {
  return vi.mocked(writeNotification).mock.calls
    .filter(([method]) => method === 'autohand.permissionRequest')
    .map(([, params]) => (params as { requestId: string }).requestId);
}

describe('RPC_ADAPTER_LIFECYCLE', () => {
  it('moves open -> shuttingDown -> sealed and nothing else', () => {
    expect(RPC_ADAPTER_LIFECYCLE.initial).toBe('open');
    const machine = new StateMachine(RPC_ADAPTER_LIFECYCLE);
    expect(machine.can('seal')).toBe(false);
    expect(machine.send('shutdown')).toBe('shuttingDown');
    expect(machine.can('shutdown')).toBe(false);
    expect(machine.send('seal')).toBe('sealed');
    expect(() => machine.send('shutdown')).toThrow(InvalidTransitionError);
    expect(terminalStates(RPC_ADAPTER_LIFECYCLE)).toEqual(['sealed']);
    expect(reachableStates(RPC_ADAPTER_LIFECYCLE)).toEqual(new Set(['open', 'shuttingDown', 'sealed']));
  });

  it('accepts exactly the declared edges under random event sequences', () => {
    randomEventWalk(RPC_ADAPTER_LIFECYCLE, ['shutdown', 'seal'], { seeds: 50, steps: 20 });
  });
});

describe('RPCAdapter reported status', () => {
  let agent: ReturnType<typeof createAgent>;
  let adapter: RPCAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = createAgent();
    adapter = new RPCAdapter();
    adapter.initialize(agent as never, { history: () => [], reset: vi.fn() } as never, 'model', '/workspace');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startHeldPrompt(): Promise<() => void> {
    let release!: () => void;
    agent.runInstruction.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      release = () => resolve(true);
    }));
    adapter.startPrompt('req_prompt', { message: 'work' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(agent.runInstruction).toHaveBeenCalledOnce();
    return release;
  }

  it('returns to idle, not processing, when a permission outside a prompt is answered', async () => {
    const permission = adapter.requestPermission('run_command', 'Run?', { command: 'ls' });
    expect(adapter.getState().status).toBe('waiting_permission');

    adapter.handlePermissionResponse('req', permissionIds()[0]!, { decision: 'allow_once' });
    await permission;

    expect(adapter.getState().status).toBe('idle');
    expect(adapter.startPrompt('req_next', { message: 'next' })).toEqual({ success: true });
  });

  it('returns to idle when a directory request outside a prompt times out', async () => {
    vi.useFakeTimers();
    const access = adapter.requestDirectoryAccess('/outside', 'Read');
    expect(adapter.getState().status).toBe('waiting_permission');

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(access).resolves.toBeUndefined();
    expect(adapter.getState().status).toBe('idle');
  });

  it('returns to idle when an abort clears a permission requested outside a prompt', async () => {
    const permission = adapter.requestPermission('run_command', 'Run?', {});

    expect(adapter.handleAbort(null)).toEqual({ success: false });

    await expect(permission).resolves.toEqual({ decision: 'deny_once' });
    expect(adapter.getState().status).toBe('idle');
  });

  it('keeps waiting while a second permission is still pending', async () => {
    const release = await startHeldPrompt();
    const first = adapter.requestPermission('write_file', 'Write a?', { path: 'a' });
    const second = adapter.requestPermission('write_file', 'Write b?', { path: 'b' });
    const [firstId, secondId] = permissionIds();

    adapter.handlePermissionResponse('req', firstId!, { decision: 'allow_once' });
    await first;
    expect(adapter.getState().status).toBe('waiting_permission');

    adapter.handlePermissionResponse('req', secondId!, { decision: 'allow_once' });
    await second;
    expect(adapter.getState().status).toBe('processing');

    release();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
  });

  it('keeps waiting for a directory decision after an unrelated permission resolves', async () => {
    const release = await startHeldPrompt();
    const permission = adapter.requestPermission('write_file', 'Write?', { path: 'a' });
    const access = adapter.requestDirectoryAccess('/outside');

    adapter.handlePermissionResponse('req', permissionIds()[0]!, { decision: 'deny_once' });
    await permission;
    expect(adapter.getState().status).toBe('waiting_permission');

    adapter.handleAbort(null);
    await access;
    release();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
  });

  it('keeps reporting processing when reset arrives while a prompt is still running', async () => {
    const release = await startHeldPrompt();

    await adapter.handleReset('req_reset');

    expect(adapter.getState().status).toBe('processing');
    expect(() => adapter.startPrompt('req_busy', { message: 'busy' })).toThrow('Agent is already processing');
    release();
    await vi.waitFor(() => expect(adapter.getState().status).toBe('idle'));
  });
});
