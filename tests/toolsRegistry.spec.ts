/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { ToolsRegistry } from '../src/core/toolsRegistry.js';
import type { ToolDefinition } from '../src/core/toolManager.js';

describe('ToolsRegistry', () => {
  const tempRoot = path.join(os.tmpdir(), `autohand-tools-${Date.now()}`);

  afterAll(async () => {
    await fs.remove(tempRoot);
  });

  it('merges built-in and meta tools without overriding existing definitions', async () => {
    const metaDir = path.join(tempRoot, 'tools');
    await fs.ensureDir(metaDir);

    await fs.writeJson(path.join(metaDir, 'custom.json'), {
      name: 'custom_helper',
      description: 'Extra helper tool'
    });

    // This one should be ignored because it collides with a built-in name
    await fs.writeJson(path.join(metaDir, 'duplicate.json'), {
      name: 'read_file',
      description: 'Should not override'
    });

    const builtIns: ToolDefinition[] = [
      { name: 'read_file', description: 'Read files' } as ToolDefinition,
      { name: 'write_file', description: 'Write files' } as ToolDefinition
    ];

    const registry = new ToolsRegistry(metaDir);
    const tools = await registry.listTools(builtIns);
    const names = tools.map((t) => t.name);

    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('custom_helper');

    const sources = Object.fromEntries(tools.map((t) => [t.name, t.source]));
    expect(sources.read_file).toBe('builtin');
    expect(sources.custom_helper).toBe('meta');

    // Ensure duplicate built-in was not overridden
    expect(tools.filter((t) => t.name === 'read_file').length).toBe(1);
  });
});
