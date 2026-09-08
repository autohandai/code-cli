/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { AUTOHAND_PATHS } from '../../src/constants.js';
import { AgentRegistry } from '../../src/core/agents/AgentRegistry.js';

describe('runtime catalogue installation', () => {
  let workspaceRoot: string;
  const originalAgentsDir = AUTOHAND_PATHS.agents;

  beforeAll(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-catalog-runtime-'));
    AUTOHAND_PATHS.agents = path.join(workspaceRoot, 'agents');
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    AUTOHAND_PATHS.agents = originalAgentsDir;
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function executorFor(name: string, tools: string[]) {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/registry.json')) {
        return new Response(JSON.stringify({ schemaVersion: 1, agents: [{
          name, description: 'Runtime catalogue fixture', category: 'quality',
          path: `categories/quality/${name}.md`, tools,
        }] }));
      }
      if (url.endsWith(`/categories/quality/${name}.md`)) {
        return new Response(`---\ndescription: Runtime catalogue fixture\ntools: ${tools.join(', ')}\n---\nReturn evidence to the lead.\n`);
      }
      return new Response('Not found', { status: 404 });
    });
    return new ActionExecutor({
      runtime: { workspaceRoot, options: {}, config: { configPath: path.join(workspaceRoot, 'config.json') } },
      files: new FileActionManager(workspaceRoot),
      resolveWorkspacePath: (filePath) => path.resolve(workspaceRoot, filePath),
      confirmDangerousAction: async () => true,
    });
  }

  it('rejects a catalogue agent whose tool contract the current runtime cannot execute', async () => {
    const executor = executorFor('unsupported-runtime-fixture', ['unknown_remote_tool']);
    const outcome = await executor.executeForTool({ type: 'install_sub_agent', name: 'unsupported-runtime-fixture' });

    expect(outcome.success).toBe(false);
    if (!outcome.success) expect(outcome.error).toContain('unsupported tool: unknown_remote_tool');
  });

  it('makes a compatible installed definition immediately available for delegation', async () => {
    const executor = executorFor('compatible-runtime-fixture', ['read_file']);
    const outcome = await executor.executeForTool({ type: 'install_sub_agent', name: 'compatible-runtime-fixture' });

    expect(outcome.success).toBe(true);
    expect(AgentRegistry.getInstance().getAgent('compatible-runtime-fixture')).toMatchObject({
      name: 'compatible-runtime-fixture', source: 'catalog', tools: ['read_file'],
    });
  });
});
