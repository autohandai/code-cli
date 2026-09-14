/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChildProcess } from 'node:child_process';

/**
 * Arm a watchdog for a spawned child process.
 *
 * The timer is released as soon as the child closes or fails to spawn, so a
 * finished process never keeps its closure (and whatever buffers it captured)
 * alive for the remainder of the deadline. The timer is unref'd so it never
 * pins the event loop on its own.
 */
export function killAfter(child: ChildProcess, timeoutMs: number, onTimeout: () => void): void {
  const timer = setTimeout(onTimeout, timeoutMs);
  timer.unref?.();
  const release = (): void => {
    clearTimeout(timer);
  };
  child.once('close', release);
  child.once('error', release);
}
