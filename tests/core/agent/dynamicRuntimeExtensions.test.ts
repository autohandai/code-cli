/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntime } from '../../../src/types.js';
import {
  configureAgentRegistry,
  syncDynamicRuntimeExtensions,
} from '../../../src/core/agent/dynamicRuntimeExtensions.js';
import { ToolsRegistry } from '../../../src/core/toolsRegistry.js';
import type { ToolDefinition, ToolManager } from '../../../src/core/toolManager.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';
import { ExtensionRegistry } from '../../../src/extensions/ExtensionRegistry.js';

describe('syncDynamicRuntimeExtensions', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    (AgentRegistry as unknown as { instance?: AgentRegistry }).instance = undefined;
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  it('loads persisted meta-tools into the active tool manager and applies external agent paths', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-'));
    tempRoots.push(tempRoot);

    const toolsDir = path.join(tempRoot, 'tools');
    const externalAgentsDir = path.join(tempRoot, 'external-agents');
    await fs.ensureDir(toolsDir);
    await fs.ensureDir(externalAgentsDir);
    await fs.writeJson(path.join(toolsDir, 'count_lines.json'), {
      name: 'count_lines',
      description: 'Count lines in a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        },
        required: ['path']
      },
      handler: 'wc -l {{path}}',
      createdAt: '2026-01-01T00:00:00.000Z',
      source: 'user'
    });

    const registeredTools: ToolDefinition[][] = [];
    const toolManager = {
      replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => {
        registeredTools.push(definitions);
      })
    } as unknown as ToolManager;

    const runtime = {
      config: {
        configPath: '',
        externalAgents: {
          enabled: true,
          paths: [externalAgentsDir]
        }
      },
      workspaceRoot: tempRoot,
      options: {}
    } as AgentRuntime;

    await syncDynamicRuntimeExtensions(
      { toolsRegistry: new ToolsRegistry(toolsDir), toolManager },
      runtime
    );

    expect(toolManager.replaceRuntimeMetaTools).toHaveBeenCalledTimes(1);
    expect(registeredTools[0]).toEqual([
      expect.objectContaining({
        name: 'count_lines',
        description: 'Count lines in a file',
        parameters: expect.objectContaining({
          properties: expect.objectContaining({
            path: { type: 'string' }
          }),
          required: ['path']
        })
      })
    ]);
    expect(AgentRegistry.getInstance().getExternalPaths()).toEqual([externalAgentsDir]);
  });

  it('loads extension tools and agents through the existing runtime registries', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-package-'));
    tempRoots.push(tempRoot);
    const extensionsRoot = path.join(tempRoot, 'extensions');
    const packageRoot = path.join(extensionsRoot, 'autohand.test-triage');
    await fs.ensureDir(path.join(packageRoot, 'tools'));
    await fs.ensureDir(path.join(packageRoot, 'agents'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.test-triage',
      name: 'Test Triage',
      version: '1.0.0',
      description: 'Triage focused test failures.',
      contributes: {
        tools: ['tools/run-focused-test.json'],
        agents: ['agents/failure-triage.md'],
      },
    });
    await fs.writeJson(path.join(packageRoot, 'tools', 'run-focused-test.json'), {
      name: 'run_focused_test',
      description: 'Run one focused test file',
      parameters: {
        type: 'object',
        properties: { file: { type: 'string' } },
        required: ['file'],
      },
      handler: 'bun test {{file}}',
      source: 'user',
    });
    await fs.writeFile(
      path.join(packageRoot, 'agents', 'failure-triage.md'),
      '---\ndescription: Triage failing tests\ntools: run_focused_test\n---\nInspect the failure.\n',
    );

    const registeredTools: ToolDefinition[][] = [];
    const toolManager = {
      replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => registeredTools.push(definitions)),
    } as unknown as ToolManager;
    const toolsRegistry = new ToolsRegistry(path.join(tempRoot, 'tools'));
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: tempRoot,
      options: {},
    } as AgentRuntime;

    const snapshot = await syncDynamicRuntimeExtensions(
      {
        toolsRegistry,
        toolManager,
        extensionRegistry: new ExtensionRegistry({ userRoot: extensionsRoot }),
      },
      runtime,
    );

    expect(snapshot?.extensions.map((extension) => extension.manifest.id)).toEqual(['autohand.test-triage']);
    expect(registeredTools[0]).toEqual([
      expect.objectContaining({ name: 'run_focused_test', description: 'Run one focused test file' }),
    ]);
    expect(toolsRegistry.getMetaTool('run_focused_test')).toBeDefined();
    expect(toolsRegistry.getMetaToolProvenance('run_focused_test')).toMatchObject({
      extensionId: 'autohand.test-triage',
    });
    expect(AgentRegistry.getInstance().getAgent('failure-triage')).toMatchObject({
      source: 'extension',
      extensionId: 'autohand.test-triage',
      tools: ['run_focused_test'],
    });
  });

  it('removes stale extension tools and agents on the next runtime snapshot', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-dynamic-ext-refresh-'));
    tempRoots.push(tempRoot);
    const extensionsRoot = path.join(tempRoot, 'extensions');
    const packageRoot = path.join(extensionsRoot, 'autohand.refresh');
    await fs.ensureDir(path.join(packageRoot, 'tools'));
    await fs.ensureDir(path.join(packageRoot, 'agents'));
    await fs.writeJson(path.join(packageRoot, 'autohand.extension.json'), {
      schemaVersion: 1,
      extensionApi: 1,
      id: 'autohand.refresh',
      name: 'Refresh',
      version: '1.0.0',
      description: 'Refresh test.',
      contributes: { tools: ['tools/refresh.json'], agents: ['agents/refresh.md'] },
    });
    await fs.writeJson(path.join(packageRoot, 'tools', 'refresh.json'), {
      name: 'refresh_tool',
      description: 'Refresh tool',
      parameters: { type: 'object', properties: {} },
      handler: 'echo refresh',
      source: 'user',
    });
    await fs.writeFile(path.join(packageRoot, 'agents', 'refresh.md'), '# Refresh Agent\n\nRefresh.\n');

    const snapshots: ToolDefinition[][] = [];
    const host = {
      toolsRegistry: new ToolsRegistry(path.join(tempRoot, 'tools')),
      toolManager: {
        replaceRuntimeMetaTools: vi.fn((definitions: ToolDefinition[]) => snapshots.push(definitions)),
      } as unknown as ToolManager,
      extensionRegistry: new ExtensionRegistry({ userRoot: extensionsRoot }),
    };
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: tempRoot,
      options: {},
    } as AgentRuntime;

    await syncDynamicRuntimeExtensions(host, runtime);
    await fs.remove(packageRoot);
    await syncDynamicRuntimeExtensions(host, runtime);

    expect(snapshots[0]?.map((definition) => definition.name)).toContain('refresh_tool');
    expect(snapshots[1]?.map((definition) => definition.name)).not.toContain('refresh_tool');
    expect(host.toolsRegistry.getMetaTool('refresh_tool')).toBeUndefined();
    expect(AgentRegistry.getInstance().getAgent('refresh')).toBeUndefined();
  });

  it('registers inline session agents passed through CLI options', () => {
    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: '/tmp',
      options: {
        inlineAgents: [
          {
            name: 'reviewer',
            description: 'Reviews code',
            systemPrompt: 'You are a code reviewer',
            tools: ['*'],
          },
        ],
      },
    } as unknown as AgentRuntime;

    configureAgentRegistry(runtime);

    const reviewer = AgentRegistry.getInstance().getAgent('reviewer');
    expect(reviewer).toMatchObject({ source: 'session', description: 'Reviews code' });
  });

  it('clears stale session agents when CLI provides none', () => {
    const registry = AgentRegistry.getInstance();
    registry.setSessionAgents([
      { name: 'stale', description: 'd', systemPrompt: 'p', tools: ['*'] },
    ]);

    const runtime = {
      config: { configPath: '', externalAgents: { enabled: false, paths: [] } },
      workspaceRoot: '/tmp',
      options: {},
    } as unknown as AgentRuntime;

    configureAgentRegistry(runtime);

    expect(registry.getAgent('stale')).toBeUndefined();
  });
});
