/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileActionManager } from '../../src/actions/filesystem.js';
import * as commandActions from '../../src/actions/command.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { ToolManager } from '../../src/core/toolManager.js';
import { ToolsRegistry } from '../../src/core/toolsRegistry.js';
import { ExtensionService } from '../../src/extensions/ExtensionService.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import type { AgentRuntime, ToolCallRequest } from '../../src/types.js';

const EXAMPLES_ROOT = path.resolve(import.meta.dirname, '../../examples/extensions');

const EXPECTED_EXAMPLES = {
  'autohand.code-health': {
    tools: ['find_todos'],
    agents: ['code-health-reviewer'],
  },
  'autohand.test-triage': {
    tools: ['run_focused_test'],
    agents: ['failure-triage'],
  },
  'autohand.git-insights': {
    tools: ['recent_history', 'changed_files_since'],
    agents: [],
  },
  'autohand.security-audit': {
    tools: ['audit_bun_dependencies', 'find_suspicious_patterns'],
    agents: ['security-reviewer'],
  },
  'autohand.release-assistant': {
    tools: ['release_range', 'changelog_context'],
    agents: ['release-planner'],
  },
} as const;

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  find_todos: { path: 'src' },
  run_focused_test: { file: 'tests/example.test.ts' },
  recent_history: { count: 5 },
  changed_files_since: { base: 'main' },
  audit_bun_dependencies: {},
  find_suspicious_patterns: { path: 'src' },
  release_range: { from: 'v1.0.0' },
  changelog_context: { from: 'v1.0.0', path: 'CHANGELOG.md' },
};

describe('extension example compatibility', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempRoots.splice(0).map((root) => fs.remove(root)));
  });

  async function createService() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-extension-examples-'));
    tempRoots.push(root);
    return {
      root,
      userRoot: path.join(root, 'extensions'),
      service: new ExtensionService({
        userRoot: path.join(root, 'extensions'),
        projectRoot: path.join(root, 'workspace', '.autohand', 'extensions'),
      }),
    };
  }

  it('ships exactly five portable, documented, independently valid packages', async () => {
    const directories = (await fs.readdir(EXAMPLES_ROOT)).sort();

    expect(directories).toEqual(Object.keys(EXPECTED_EXAMPLES).sort());

    const { service } = await createService();
    for (const [id, expected] of Object.entries(EXPECTED_EXAMPLES)) {
      const source = path.join(EXAMPLES_ROOT, id);
      const validation = await service.validate(source);
      expect(validation.extension.manifest).toMatchObject({ id, version: '1.0.0' });
      expect(validation.tools.map((tool) => tool.definition.name)).toEqual(expected.tools);
      expect(validation.agents.map((agent) => agent.name)).toEqual(expected.agents);

      const readme = await fs.readFile(path.join(source, 'README.md'), 'utf8');
      expect(readme).toContain(`extensions validate ./examples/extensions/${id}`);
      expect(readme).toContain(`extensions install ./examples/extensions/${id}`);
      expect(readme).toContain(`extensions remove ${id} --yes`);
    }
  });

  it('runs the complete lifecycle for all five packages and reloads them in a fresh service', async () => {
    const { service, userRoot } = await createService();

    for (const id of Object.keys(EXPECTED_EXAMPLES)) {
      const result = await service.install(path.join(EXAMPLES_ROOT, id), { scope: 'user' });
      expect(result.status).toBe('installed');
    }

    const freshService = new ExtensionService({ userRoot });
    const snapshot = await freshService.list();
    expect(snapshot.extensions.map((extension) => extension.manifest.id)).toEqual(
      Object.keys(EXPECTED_EXAMPLES).sort(),
    );
    expect(snapshot.tools).toHaveLength(8);
    expect(snapshot.agents).toHaveLength(4);
    for (const [id, expected] of Object.entries(EXPECTED_EXAMPLES)) {
      expect(snapshot.tools
        .filter((tool) => tool.provenance.extensionId === id)
        .map((tool) => tool.definition.name)).toEqual(expected.tools);
      expect(snapshot.agents
        .filter((agent) => agent.provenance.extensionId === id)
        .map((agent) => agent.name)).toEqual(expected.agents);
    }

    for (const id of Object.keys(EXPECTED_EXAMPLES)) {
      await freshService.setEnabled(id, false, { scope: 'user' });
      expect((await freshService.show(id, { scope: 'user' }))?.disabled).toBe(true);
      await freshService.setEnabled(id, true, { scope: 'user' });
      expect((await freshService.show(id, { scope: 'user' }))?.disabled).toBe(false);
    }

    for (const id of Object.keys(EXPECTED_EXAMPLES)) {
      await freshService.remove(id, { scope: 'user' });
    }
    expect((await freshService.list()).extensions).toEqual([]);
  });

  it('routes every example tool through canonical authorization and the real meta-tool executor', async () => {
    const { root, service } = await createService();
    for (const id of Object.keys(EXPECTED_EXAMPLES)) {
      await service.install(path.join(EXAMPLES_ROOT, id), { scope: 'user' });
    }
    const snapshot = await service.list();
    const toolsRegistry = new ToolsRegistry(path.join(root, 'standalone-tools'));
    await toolsRegistry.initialize();
    toolsRegistry.setExtensionTools(snapshot.tools);

    const runtime = {
      config: { configPath: '' },
      workspaceRoot: root,
      options: {},
    } as AgentRuntime;
    const permissionManager = new PermissionManager({ workspaceRoot: root });
    const runCommand = vi.spyOn(commandActions, 'runCommand').mockResolvedValue({
      stdout: 'example tool output',
      stderr: '',
      code: 0,
    });
    const confirmation = vi.fn().mockResolvedValue(true);
    const executor = new ActionExecutor({
      runtime,
      files: { root } as FileActionManager,
      resolveWorkspacePath: (relativePath) => path.join(root, relativePath),
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      toolsRegistry,
      permissionManager,
      getRegisteredTools: () => manager.listAllDefinitions(),
    });
    const manager = new ToolManager({
      definitions: [],
      executor: (action, context) => executor.executeForTool(action, context),
      confirmApproval: confirmation,
      authorization: {
        permissionManager,
        resolvePermissionContext: (action) => executor.getPermissionContext(action),
      },
    });
    manager.replaceRuntimeMetaTools(toolsRegistry.toToolDefinitions());

    const calls: ToolCallRequest[] = snapshot.tools.map((tool) => ({
      tool: tool.definition.name,
      args: SAMPLE_ARGS[tool.definition.name] ?? {},
    })) as ToolCallRequest[];
    const results = await manager.execute(calls);

    expect(results).toHaveLength(8);
    expect(results.every((result) => result.success)).toBe(true);
    expect(confirmation).toHaveBeenCalledTimes(8);
    expect(runCommand).toHaveBeenCalledTimes(8);
    expect(runCommand.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
      "git grep -n -E 'TODO|FIXME' -- 'src'",
      "bun test 'tests/example.test.ts'",
      "git log --max-count='5' --oneline",
      'bun audit',
      "git log 'v1.0.0'..HEAD --oneline",
    ]));
  });
});
