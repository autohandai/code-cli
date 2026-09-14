/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

type FakeProcess = EventEmitter & { kill: ReturnType<typeof vi.fn> };

function createExitingProcess(): FakeProcess {
  const proc = Object.assign(new EventEmitter(), {
    kill: vi.fn(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
  });
  // The launchers await command coordination before attaching handlers, so the
  // fake exits only once something listens for it, like a real child would.
  let closed = false;
  proc.on('newListener', (event) => {
    if (event !== 'close' || closed) return;
    closed = true;
    queueMicrotask(() => proc.emit('close', 0));
  });
  return proc;
}

describe('external tool watchdog timers', () => {
  const processes: FakeProcess[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    processes.length = 0;
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => {
      const proc = createExitingProcess();
      processes.push(proc);
      return proc;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops formatter probe timers once every probe process has exited', async () => {
    const { checkAvailableFormatters } = await import('../../src/actions/formatters.js');

    const pending = checkAvailableFormatters();
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(spawnMock).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops linter probe timers once every probe process has exited', async () => {
    const { checkAvailableLinters } = await import('../../src/actions/linters.js');

    const pending = checkAvailableLinters();
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(spawnMock).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not kill a formatter process after it has already finished', async () => {
    const { applyFormatter } = await import('../../src/actions/formatters.js');

    const pending = applyFormatter('prettier', 'const a = 1;', 'a.ts');
    await vi.advanceTimersByTimeAsync(0);
    await pending;

    expect(processes.length).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    for (const proc of processes) {
      expect(proc.kill).not.toHaveBeenCalled();
    }
  });
});
