/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { killAfter } from '../../src/utils/processTimeout.js';

function fakeChild(): ChildProcess {
  return new EventEmitter() as unknown as ChildProcess;
}

describe('killAfter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the timeout callback when the child outlives the deadline', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const onTimeout = vi.fn();

    killAfter(child, 1_000, onTimeout);
    vi.advanceTimersByTime(1_000);

    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('clears the timer once the child closes so nothing is retained', () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const onTimeout = vi.fn();

    killAfter(child, 1_000, onTimeout);
    child.emit('close', 0);

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('clears the timer when the child fails to spawn', () => {
    vi.useFakeTimers();
    const child = fakeChild();

    killAfter(child, 1_000, vi.fn());
    child.emit('error', new Error('ENOENT'));

    expect(vi.getTimerCount()).toBe(0);
  });
});
