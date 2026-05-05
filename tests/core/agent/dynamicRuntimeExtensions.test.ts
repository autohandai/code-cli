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
import { syncDynamicRuntimeExtensions } from '../../../src/core/agent/dynamicRuntimeExtensions.js';
import { ToolsRegistry } from '../../../src/core/toolsRegistry.js';
import type { ToolDefinition, ToolManager } from '../../../src/core/toolManager.js';
import { AgentRegistry } from '../../../src/core/agents/AgentRegistry.js';

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
      registerMetaTools: vi.fn((definitions: ToolDefinition[]) => {
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

    expect(toolManager.registerMetaTools).toHaveBeenCalledTimes(1);
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
});
