/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as commandActions from '../../../src/actions/command.js';
import { BackgroundProcessRegistry } from '../../../src/core/agent/BackgroundProcessRegistry.js';

describe('BackgroundProcessRegistry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers an entry and lists it', () => {
    const registry = new BackgroundProcessRegistry();
    const id = registry.register(4242, 'bun run dev', 'apps/web');

    expect(id).toBe(1);
    expect(registry.list()).toEqual([
      { id: 1, pid: 4242, command: 'bun run dev', directory: 'apps/web', startedAt: expect.any(Number) },
    ]);
    expect(registry.get(1)).toEqual(registry.list()[0]);
  });

  it('never reuses an id after removal', () => {
    const registry = new BackgroundProcessRegistry();
    const first = registry.register(100, 'first', undefined);
    registry.remove(first);
    const second = registry.register(200, 'second', undefined);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(registry.list()).toEqual([
      { id: 2, pid: 200, command: 'second', directory: undefined, startedAt: expect.any(Number) },
    ]);
  });

  it('lists entries sorted by id ascending regardless of registration order edge cases', () => {
    const registry = new BackgroundProcessRegistry();
    registry.register(1, 'a', undefined);
    registry.register(2, 'b', undefined);
    registry.register(3, 'c', undefined);

    expect(registry.list().map((entry) => entry.id)).toEqual([1, 2, 3]);
  });

  it('stop() kills the process group by pid and removes the entry', async () => {
    const killProcessGroupSpy = vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();
    const id = registry.register(4242, 'bun run dev', undefined);

    const result = await registry.stop(id);

    expect(killProcessGroupSpy).toHaveBeenCalledWith(4242, undefined);
    expect(result).toEqual({ ok: true, message: expect.stringContaining('bun run dev') });
    expect(registry.list()).toEqual([]);
  });

  it('stop() reports failure for an unknown id without calling killProcessGroup', async () => {
    const killProcessGroupSpy = vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();

    const result = await registry.stop(999);

    expect(killProcessGroupSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, message: expect.stringContaining('999') });
  });

  it('killAll() stops every currently registered entry', async () => {
    const killProcessGroupSpy = vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();
    registry.register(1, 'a', undefined);
    registry.register(2, 'b', undefined);

    await registry.killAll();

    expect(killProcessGroupSpy).toHaveBeenCalledTimes(2);
    expect(killProcessGroupSpy).toHaveBeenCalledWith(1, undefined);
    expect(killProcessGroupSpy).toHaveBeenCalledWith(2, undefined);
    expect(registry.list()).toEqual([]);
  });

  it('killAll() on an empty registry resolves without calling killProcessGroup', async () => {
    const killProcessGroupSpy = vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();

    await expect(registry.killAll()).resolves.toBeUndefined();

    expect(killProcessGroupSpy).not.toHaveBeenCalled();
  });
});
