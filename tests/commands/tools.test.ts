/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tools } from '../../src/commands/tools.js';
import { ToolsRegistry } from '../../src/core/toolsRegistry.js';

describe('/tools command', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function createRegistry(): Promise<ToolsRegistry> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-tools-command-'));
    tempRoots.push(tempRoot);
    const registry = new ToolsRegistry(path.join(tempRoot, 'tools'));
    await registry.initialize();
    await registry.saveMetaTool({
      schemaVersion: 1,
      name: 'count_lines',
      description: 'Count lines in a file',
      handler: 'wc -l {{path}}',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      fingerprint: '1234567890abcdef',
      source: 'user',
      scope: 'user'
    });
    return registry;
  }

  it('lists persisted meta-tools with scope and enabled state', async () => {
    const registry = await createRegistry();

    const output = await tools({ toolsRegistry: registry }, ['list']);

    expect(output).toContain('count_lines');
    expect(output).toContain('user');
    expect(output).toContain('enabled');
  });

  it('shows a single tool without exposing full management internals', async () => {
    const registry = await createRegistry();

    const output = await tools({ toolsRegistry: registry }, ['show', 'count_lines']);

    expect(output).toContain('count_lines');
    expect(output).toContain('wc -l {{path}}');
    expect(output).toContain('Count lines in a file');
  });

  it('can disable and re-enable tools without deleting their persisted definition', async () => {
    const registry = await createRegistry();

    expect(await tools({ toolsRegistry: registry }, ['disable', 'count_lines'])).toContain('Disabled count_lines');
    expect(registry.getMetaTool('count_lines')).toBeUndefined();
    expect(registry.listMetaTools({ includeDisabled: true })[0]?.disabled).toBe(true);

    expect(await tools({ toolsRegistry: registry }, ['enable', 'count_lines'])).toContain('Enabled count_lines');
    expect(registry.getMetaTool('count_lines')).toMatchObject({ name: 'count_lines' });
  });

  it('can rename and delete persisted tools', async () => {
    const registry = await createRegistry();

    expect(await tools({ toolsRegistry: registry }, ['rename', 'count_lines', 'line_counter'])).toContain('Renamed count_lines to line_counter');
    expect(registry.getMetaTool('count_lines')).toBeUndefined();
    expect(registry.getMetaTool('line_counter')).toMatchObject({ name: 'line_counter' });

    expect(await tools({ toolsRegistry: registry }, ['delete', 'line_counter'])).toContain('Deleted line_counter');
    expect(registry.listMetaTools({ includeDisabled: true })).toEqual([]);
  });
});
