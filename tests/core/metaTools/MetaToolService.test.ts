/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetaToolService } from '../../../src/core/metaTools/MetaToolService.js';
import { ToolsRegistry } from '../../../src/core/toolsRegistry.js';
import type { ToolDefinition } from '../../../src/core/toolManager.js';

describe('MetaToolService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function createService(): Promise<{ service: MetaToolService; registry: ToolsRegistry; toolsDir: string }> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-meta-tools-'));
    tempRoots.push(tempRoot);
    const toolsDir = path.join(tempRoot, 'tools');
    const registry = new ToolsRegistry(toolsDir);
    await registry.initialize();
    return { service: new MetaToolService(registry), registry, toolsDir };
  }

  const builtIns: ToolDefinition[] = [
    { name: 'read_file', description: 'Read files from the workspace' } as ToolDefinition,
    { name: 'run_command', description: 'Run a shell command' } as ToolDefinition,
  ];

  it('creates schema-versioned tools with a stable fingerprint', async () => {
    const { service, registry, toolsDir } = await createService();

    const result = await service.createMetaTool({
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      handler: 'wc -l {{path}}',
      source: 'agent'
    }, builtIns);

    expect(result.status).toBe('created');
    expect(result.definition).toMatchObject({
      schemaVersion: 1,
      name: 'count_lines',
      source: 'agent',
      fingerprint: expect.any(String)
    });
    expect(registry.getMetaTool('count_lines')).toEqual(result.definition);

    const persisted = await fs.readJson(path.join(toolsDir, 'count_lines.json'));
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      name: 'count_lines',
      fingerprint: result.definition.fingerprint
    });
    expect(await fs.readdir(toolsDir)).toEqual(['count_lines.json']);
  });

  it('is idempotent when the same tool definition already exists', async () => {
    const { service } = await createService();
    const input = {
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      },
      handler: 'wc -l {{path}}',
      source: 'agent' as const
    };

    const first = await service.createMetaTool(input, builtIns);
    const second = await service.createMetaTool(input, builtIns);

    expect(first.status).toBe('created');
    expect(second.status).toBe('existing');
    expect(second.definition.fingerprint).toBe(first.definition.fingerprint);
  });

  it('rejects same-name tools when the definition changed', async () => {
    const { service } = await createService();
    await service.createMetaTool({
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: 'wc -l {{path}}',
      source: 'agent'
    }, builtIns);

    await expect(service.createMetaTool({
      name: 'count_lines',
      description: 'Count non-empty lines in a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: 'grep -cve "^$" {{path}}',
      source: 'agent'
    }, builtIns)).rejects.toThrow('already exists with a different definition');
  });

  it('rejects handler duplicates and semantically similar tools', async () => {
    const { service } = await createService();
    await service.createMetaTool({
      name: 'find_todos',
      description: 'Find TODO comments in a codebase',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: 'grep -rn "TODO\\|FIXME" {{path}}',
      source: 'agent'
    }, builtIns);

    await expect(service.createMetaTool({
      name: 'todo_finder',
      description: 'Find TODO comments in a codebase',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: 'grep -rn "TODO\\|FIXME" {{path}}',
      source: 'agent'
    }, builtIns)).rejects.toThrow('same handler');

    await expect(service.createMetaTool({
      name: 'search_todos',
      description: 'Search TODO comments across source files',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      handler: 'rg "TODO|FIXME" {{path}}',
      source: 'agent'
    }, builtIns)).rejects.toThrow('similar existing tool');
  });

  it('rejects invalid schemas and dangerous handlers before persistence', async () => {
    const { service, toolsDir } = await createService();

    await expect(service.createMetaTool({
      name: '../escape',
      description: 'Bad name',
      parameters: { type: 'object', properties: {} },
      handler: 'echo nope',
      source: 'agent'
    }, builtIns)).rejects.toThrow('snake_case');

    await expect(service.createMetaTool({
      name: 'dangerous_wipe',
      description: 'Dangerous wipe',
      parameters: { type: 'object', properties: {} },
      handler: 'rm -rf /',
      source: 'agent'
    }, builtIns)).rejects.toThrow('dangerous pattern');

    expect(await fs.readdir(toolsDir)).toEqual([]);
  });
});
