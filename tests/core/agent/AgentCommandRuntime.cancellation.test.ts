/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { runCancellableAgentCommand } from '../../../src/core/agent/AgentCommandRuntime.js';

describe('cancellable command runtime', () => {
  function createHost(ink = true) {
    const cleanup = vi.fn();
    return {
      cleanup,
      activeAbortController: null as AbortController | null,
      currentInkAbortController: null as AbortController | null,
      currentInkOnCancel: null as (() => void) | null,
      runtimeResourceShutdownController: new AbortController(),
      inkRenderer: ink ? { isRunning: () => true } : null,
      setupEscListener: vi.fn(() => cleanup),
    };
  }

  it('routes Ink cancellation to the operation and restores prior controllers', async () => {
    const host = createHost();
    const previous = new AbortController();
    host.activeAbortController = previous;
    host.currentInkAbortController = previous;
    const result = await runCancellableAgentCommand(host, async signal => {
      expect(host.currentInkAbortController).not.toBe(previous);
      host.currentInkOnCancel?.();
      return signal.aborted;
    });
    expect(result).toBe(true);
    expect(host.activeAbortController).toBe(previous);
    expect(host.currentInkAbortController).toBe(previous);
    expect(previous.signal.aborted).toBe(false);
    expect(host.setupEscListener).not.toHaveBeenCalled();
  });

  it('registers and cleans up fallback ESC/Ctrl+C even when a command throws', async () => {
    const host = createHost(false);
    await expect(runCancellableAgentCommand(host, async () => { throw new Error('capture failed'); }))
      .rejects.toThrow('capture failed');
    expect(host.setupEscListener).toHaveBeenCalledWith(expect.any(AbortController), expect.any(Function), true);
    expect(host.cleanup).toHaveBeenCalledOnce();
    expect(host.activeAbortController).toBeNull();
  });

  it('propagates parent and shutdown cancellation', async () => {
    const host = createHost();
    const parent = new AbortController();
    host.activeAbortController = parent;
    await runCancellableAgentCommand(host, async signal => {
      parent.abort();
      expect(signal.aborted).toBe(true);
    });
    host.activeAbortController = null;
    await runCancellableAgentCommand(host, async signal => {
      host.runtimeResourceShutdownController.abort();
      expect(signal.aborted).toBe(true);
    });
  });

  it('does not start work after shutdown has already been requested', async () => {
    const host = createHost();
    host.runtimeResourceShutdownController.abort();
    const operation = vi.fn();
    await expect(runCancellableAgentCommand(host, operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
    expect(host.activeAbortController).toBeNull();
  });
});
