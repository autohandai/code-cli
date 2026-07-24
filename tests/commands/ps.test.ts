/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { BackgroundProcessRegistry } from '../../src/core/agent/BackgroundProcessRegistry.js';
import { ps } from '../../src/commands/ps.js';

describe('/ps', () => {
  it('reports no background processes when the registry is empty', async () => {
    const registry = new BackgroundProcessRegistry();
    const output = await ps({ backgroundProcessRegistry: registry });

    expect(output).toBe('No background processes running.');
  });

  it('reports no background processes when there is no registry at all', async () => {
    const output = await ps({});

    expect(output).toBe('No background processes running.');
  });

  it('lists running background processes with index, command, and pid', async () => {
    const registry = new BackgroundProcessRegistry();
    registry.register(4242, 'bun run dev', undefined);
    registry.register(4343, 'npm run watch:css', undefined);

    const output = await ps({ backgroundProcessRegistry: registry });

    expect(output).toContain('1  bun run dev');
    expect(output).toContain('pid 4242');
    expect(output).toContain('2  npm run watch:css');
    expect(output).toContain('pid 4343');
    expect(output).toMatch(/running \d+m\d{2}s/);
  });
});
