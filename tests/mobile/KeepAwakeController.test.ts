/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { KeepAwakeController } from '../../src/mobile/KeepAwakeController.js';

function fakeChildProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    kill: vi.fn(() => true),
    unref: vi.fn(),
  }) as unknown as ChildProcess;
}

describe('KeepAwakeController', () => {
  it('owns and terminates the macOS caffeinate process', () => {
    const child = fakeChildProcess();
    const factory = vi.fn(() => child);
    const controller = new KeepAwakeController('darwin', factory);

    expect(controller.enable()).toEqual({ supported: true, enabled: true });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);

    expect(controller.disable()).toEqual({ supported: true, enabled: false });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reports unsupported platforms without starting a process', () => {
    const factory = vi.fn(() => fakeChildProcess());
    const controller = new KeepAwakeController('linux', factory);

    expect(controller.enable()).toEqual({
      supported: false,
      enabled: false,
      reason: 'Keep awake currently requires macOS',
    });
    expect(factory).not.toHaveBeenCalled();
  });
});
