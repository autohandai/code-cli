import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  CLI_RUNTIME_LIFECYCLE,
  CliRuntimeResourceOwner,
  type CliRuntimeProcess,
} from '../../src/runtime/CliRuntimeResourceOwner.js';
import { reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

class TestProcess extends EventEmitter implements CliRuntimeProcess {
  override on(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.on(event, listener);
  }

  override off(event: 'exit' | 'SIGINT' | 'SIGTERM', listener: () => void): this {
    return super.off(event, listener);
  }
}

function makeOwner(runtimeProcess = new TestProcess()) {
  const onSignal = vi.fn();
  const setSyncService = vi.fn();
  const stopPing = vi.fn();
  const owner = new CliRuntimeResourceOwner<{ id: string }, string>({
    process: runtimeProcess,
    stopPing,
    setSyncService,
    onSignal,
    shutdownTimeoutMs: 20,
  });
  return { owner, runtimeProcess, onSignal, setSyncService, stopPing };
}

describe('CLI_RUNTIME_LIFECYCLE transition table', () => {
  it('declares open → signalled → closed with shutdown allowed from either live state', () => {
    expect(CLI_RUNTIME_LIFECYCLE.initial).toBe('open');
    expect(CLI_RUNTIME_LIFECYCLE.transitions).toEqual({
      open: { signal: 'signalled', shutdown: 'closed' },
      signalled: { shutdown: 'closed' },
      closed: {},
    });
    expect(terminalStates(CLI_RUNTIME_LIFECYCLE)).toEqual(['closed']);
    expect(reachableStates(CLI_RUNTIME_LIFECYCLE)).toEqual(new Set(['open', 'signalled', 'closed']));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(CLI_RUNTIME_LIFECYCLE, ['signal', 'shutdown'], { seeds: 30, steps: 20 });
  });
});

describe('CliRuntimeResourceOwner lifecycle', () => {
  it('hands only the first signal to the agent and stops listening', async () => {
    const { owner, runtimeProcess, onSignal } = makeOwner();
    runtimeProcess.emit('SIGINT');
    runtimeProcess.emit('SIGTERM');
    await vi.waitFor(() => expect(onSignal).toHaveBeenCalledOnce());
    expect(onSignal).toHaveBeenCalledWith('SIGINT');
    expect(owner.lifecycleState).toBe('signalled');
    expect(runtimeProcess.eventNames()).toEqual([]);
  });

  it('refuses new background work once signalled and closes on shutdown', async () => {
    const { owner, runtimeProcess, setSyncService } = makeOwner();
    runtimeProcess.emit('SIGTERM');
    const startPing = vi.fn();
    const resolveAuthAndVersion = vi.fn();
    owner.startPing(startPing);
    owner.startBackgroundStartup({
      resolveAuthAndVersion,
      onVersionResult: vi.fn(),
      shouldStartSync: () => true,
      createSyncService: vi.fn(),
    });
    expect(startPing).not.toHaveBeenCalled();
    expect(resolveAuthAndVersion).not.toHaveBeenCalled();

    await owner.shutdown();
    expect(owner.lifecycleState).toBe('closed');
    expect(setSyncService).toHaveBeenCalledOnce();
    expect(setSyncService).toHaveBeenCalledWith(null);
  });

  it('ignores a signal that arrives after shutdown has closed the runtime', async () => {
    const { owner, runtimeProcess, onSignal } = makeOwner();
    await owner.shutdown();
    runtimeProcess.emit('SIGINT');
    await Promise.resolve();
    expect(onSignal).not.toHaveBeenCalled();
    expect(owner.lifecycleState).toBe('closed');
  });

  it('installs process listeners exactly once while open', () => {
    const { owner, runtimeProcess } = makeOwner();
    owner.startPing(vi.fn());
    owner.startPing(vi.fn());
    expect(runtimeProcess.listenerCount('exit')).toBe(1);
    expect(runtimeProcess.listenerCount('SIGINT')).toBe(1);
    expect(runtimeProcess.listenerCount('SIGTERM')).toBe(1);
    void owner.shutdown();
  });
});
