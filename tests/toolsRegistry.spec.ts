/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { ToolsRegistry, createToolsRegistry } from '../src/core/toolsRegistry.js';
import type { ToolDefinition } from '../src/core/toolManager.js';
import type { ExtensionToolContribution } from '../src/extensions/types.js';

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
      description: 'Extra helper tool',
      handler: 'echo {{message}}',
      parameters: { type: 'object', properties: { message: { type: 'string' } } },
      source: 'agent'
    });

    // This one should be ignored because it collides with a built-in name
    await fs.writeJson(path.join(metaDir, 'duplicate.json'), {
      name: 'read_file',
      description: 'Should not override',
      handler: 'cat {{path}}',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      source: 'agent'
    });

    const builtIns: ToolDefinition[] = [
      { name: 'read_file', description: 'Read files' } as ToolDefinition,
      { name: 'write_file', description: 'Write files' } as ToolDefinition
    ];

    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();
    const tools = await registry.listTools(builtIns);
    const names = tools.map((t) => t.name);

    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('custom_helper');

    const sources = Object.fromEntries(tools.map((t) => [t.name, t.source]));
    expect(sources.read_file).toBe('builtin');
    expect(sources.custom_helper).toBe('meta');
    const customTool = tools.find((tool) => tool.name === 'custom_helper');
    expect(customTool).toMatchObject({
      handlerPreview: 'echo {{message}}',
      reuseHint: expect.stringContaining('Use custom_helper'),
      schemaVersion: 1
    });

    // Ensure duplicate built-in was not overridden
    expect(tools.filter((t) => t.name === 'read_file').length).toBe(1);
  });

  it('skips persisted tools with dangerous handlers during startup load', async () => {
    const metaDir = path.join(tempRoot, 'dangerous-tools');
    await fs.ensureDir(metaDir);
    await fs.writeJson(path.join(metaDir, 'danger.json'), {
      name: 'dangerous_wipe',
      description: 'Dangerous wipe',
      handler: 'rm -rf /',
      parameters: { type: 'object', properties: {} },
      source: 'user'
    });

    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();

    expect(registry.getMetaTool('dangerous_wipe')).toBeUndefined();
    expect(await registry.listTools([])).toEqual([]);
    expect(registry.getDiagnostics()).toEqual([
      expect.objectContaining({
        file: path.join(metaDir, 'danger.json'),
        reason: expect.stringContaining('dangerous pattern')
      })
    ]);
  });

  it('loads project-scoped tools before user-scoped tools for future sessions', async () => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const userToolsDir = path.join(tempRoot, 'user-tools');
    const projectToolsDir = path.join(workspaceRoot, '.autohand', 'tools');
    await fs.ensureDir(userToolsDir);
    await fs.ensureDir(projectToolsDir);

    await fs.writeJson(path.join(userToolsDir, 'shared_tool.json'), {
      name: 'shared_tool',
      description: 'User-scoped helper',
      handler: 'echo user {{message}}',
      parameters: { type: 'object', properties: { message: { type: 'string' } } },
      source: 'user',
      scope: 'user'
    });
    await fs.writeJson(path.join(projectToolsDir, 'shared_tool.json'), {
      name: 'shared_tool',
      description: 'Project-scoped helper',
      handler: 'echo project {{message}}',
      parameters: { type: 'object', properties: { message: { type: 'string' } } },
      source: 'user',
      scope: 'project'
    });

    const registry = createToolsRegistry(workspaceRoot, userToolsDir);
    await registry.initialize();

    expect(registry.getMetaTool('shared_tool')).toMatchObject({
      description: 'Project-scoped helper',
      scope: 'project'
    });
    expect(registry.listMetaTools({ includeDisabled: true }).map((tool) => tool.scope)).toEqual(['project', 'user']);

    const nextSessionRegistry = createToolsRegistry(workspaceRoot, userToolsDir);
    await nextSessionRegistry.initialize();
    expect(nextSessionRegistry.getMetaTool('shared_tool')).toMatchObject({
      description: 'Project-scoped helper',
      scope: 'project'
    });
  });

  it('does not register disabled tools but keeps them manageable', async () => {
    const metaDir = path.join(tempRoot, 'disabled-tools');
    await fs.ensureDir(metaDir);
    await fs.writeJson(path.join(metaDir, 'disabled_tool.json'), {
      name: 'disabled_tool',
      description: 'Disabled helper',
      handler: 'echo disabled',
      parameters: { type: 'object', properties: {} },
      source: 'user',
      disabled: true
    });

    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();

    expect(registry.getMetaTool('disabled_tool')).toBeUndefined();
    expect(registry.listMetaTools({ includeDisabled: true })).toEqual([
      expect.objectContaining({ name: 'disabled_tool', disabled: true })
    ]);
  });

  it('serializes concurrent same-definition saves with a lock', async () => {
    const metaDir = path.join(tempRoot, 'locked-tools');
    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();

    const definition = {
      schemaVersion: 1 as const,
      name: 'count_lines',
      description: 'Count lines',
      handler: 'wc -l {{path}}',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      fingerprint: '1234567890abcdef',
      source: 'agent' as const,
      scope: 'user' as const
    };

    const [first, second] = await Promise.all([
      registry.saveMetaTool(definition),
      registry.saveMetaTool(definition)
    ]);

    expect(first).toEqual(second);
    expect(await fs.readdir(metaDir)).toEqual(['count_lines.json']);
  });

  it('adds and transactionally replaces extension-owned runtime tools with provenance', async () => {
    const metaDir = path.join(tempRoot, 'extension-tools');
    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();
    const extensionTool: ExtensionToolContribution = {
      definition: {
        schemaVersion: 1,
        name: 'find_todos',
        description: 'Find TODO comments',
        handler: 'git grep -n TODO -- {{path}}',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
        createdAt: '2026-01-01T00:00:00.000Z',
        fingerprint: '1234567890abcdef',
        source: 'user',
        scope: 'user',
      },
      provenance: {
        extensionId: 'autohand.code-health',
        extensionVersion: '1.0.0',
        scope: 'user',
        packageRoot: '/tmp/code-health',
        file: '/tmp/code-health/tools/find-todos.json',
      },
    };

    expect(registry.setExtensionTools([extensionTool])).toEqual([]);
    expect(registry.getMetaTool('find_todos')).toMatchObject({ name: 'find_todos' });
    expect(registry.getMetaToolProvenance('find_todos')).toEqual(extensionTool.provenance);
    expect(await registry.listTools([])).toEqual([
      expect.objectContaining({
        name: 'find_todos',
        source: 'extension',
        extensionId: 'autohand.code-health',
        extensionVersion: '1.0.0',
      }),
    ]);

    registry.setExtensionTools([]);
    expect(registry.getMetaTool('find_todos')).toBeUndefined();
    expect(registry.getMetaToolProvenance('find_todos')).toBeUndefined();
  });

  it('keeps standalone meta-tools ahead of conflicting extension tools', async () => {
    const metaDir = path.join(tempRoot, 'extension-conflict-tools');
    await fs.ensureDir(metaDir);
    await fs.writeJson(path.join(metaDir, 'shared_tool.json'), {
      name: 'shared_tool',
      description: 'Standalone tool',
      handler: 'echo standalone',
      parameters: { type: 'object', properties: {} },
      source: 'user',
    });
    const registry = new ToolsRegistry(metaDir);
    await registry.initialize();

    const diagnostics = registry.setExtensionTools([{
      definition: {
        schemaVersion: 1,
        name: 'shared_tool',
        description: 'Extension tool',
        handler: 'echo extension',
        parameters: { type: 'object', properties: {} },
        createdAt: '2026-01-01T00:00:00.000Z',
        fingerprint: '1234567890abcdef',
        source: 'user',
        scope: 'user',
      },
      provenance: {
        extensionId: 'autohand.conflict',
        extensionVersion: '1.0.0',
        scope: 'user',
        packageRoot: '/tmp/conflict',
        file: '/tmp/conflict/tools/shared.json',
      },
    }]);

    expect(registry.getMetaTool('shared_tool')).toMatchObject({ description: 'Standalone tool' });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: '/tmp/conflict/tools/shared.json',
        reason: expect.stringMatching(/conflicts with standalone meta-tool/i),
      }),
    ]);
  });
});
