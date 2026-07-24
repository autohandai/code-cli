/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as commandActions from '../../src/actions/command.js';
import { BackgroundProcessRegistry } from '../../src/core/agent/BackgroundProcessRegistry.js';
import { stop } from '../../src/commands/stop.js';

describe('/stop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports nothing running when the registry is empty and no index is given', async () => {
    const registry = new BackgroundProcessRegistry();
    const output = await stop({ backgroundProcessRegistry: registry }, []);

    expect(output).toBe('No background processes running.');
  });

  it('stops the sole running process when no index is given', async () => {
    vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();
    registry.register(4242, 'bun run dev', undefined);

    const output = await stop({ backgroundProcessRegistry: registry }, []);

    expect(output).toContain('bun run dev');
    expect(output).toContain('4242');
    expect(registry.list()).toEqual([]);
  });

  it('asks the user to specify an index when multiple processes are running', async () => {
    const registry = new BackgroundProcessRegistry();
    registry.register(4242, 'bun run dev', undefined);
    registry.register(4343, 'npm run watch:css', undefined);

    const output = await stop({ backgroundProcessRegistry: registry }, []);

    expect(output).toContain('Multiple background processes');
    expect(output).toContain('bun run dev');
    expect(output).toContain('npm run watch:css');
    expect(registry.list()).toHaveLength(2);
  });

  it('stops the process at a given index', async () => {
    vi.spyOn(commandActions, 'killProcessGroup').mockResolvedValue(undefined);
    const registry = new BackgroundProcessRegistry();
    registry.register(4242, 'bun run dev', undefined);
    registry.register(4343, 'npm run watch:css', undefined);

    const output = await stop({ backgroundProcessRegistry: registry }, ['2']);

    expect(output).toContain('npm run watch:css');
    expect(registry.list()).toEqual([expect.objectContaining({ id: 1, pid: 4242 })]);
  });

  it('reports an error for a non-numeric index', async () => {
    const registry = new BackgroundProcessRegistry();
    const output = await stop({ backgroundProcessRegistry: registry }, ['abc']);

    expect(output).toContain('not a valid process index');
  });

  it('reports an error for an unknown index', async () => {
    const registry = new BackgroundProcessRegistry();
    registry.register(4242, 'bun run dev', undefined);

    const output = await stop({ backgroundProcessRegistry: registry }, ['99']);

    expect(output).toContain('No background process with index 99');
    expect(registry.list()).toHaveLength(1);
  });
});
