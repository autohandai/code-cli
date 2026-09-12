/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { HookManager } from '../../src/core/HookManager.js';
import { executeHookTool, HOOK_TOOL_DEFINITIONS, HOOK_TOOL_NAMES } from '../../src/core/hookTools.js';
import type { LoadedConfig } from '../../src/types.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function fixture(options: { provider?: string; trusted?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-set-hook-'));
  roots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  await fs.ensureDir(workspaceRoot);
  const configPath = path.join(root, 'home', 'config.json');
  await fs.outputJson(configPath, { provider: 'autohandai', hooks: { hooks: [{ event: 'session-end', command: 'echo bye', description: 'Global goodbye' }] } });
  const trustStorePath = path.join(root, 'home', 'trusted-workspaces.json');
  const config: LoadedConfig = await loadConfig(configPath, workspaceRoot, { createIfMissing: false, initializeTheme: false, workspaceTrustStorePath: trustStorePath });
  const runtime = { config, workspaceRoot };
  const persist = vi.fn().mockResolvedValue(undefined);
  const manager = new HookManager({ settings: config.hooks, workspaceRoot, onPersist: persist });
  const confirm = vi.fn().mockResolvedValue(true);
  const context = {
    manager,
    persist,
    confirm,
    authoring: { create: vi.fn() },
    getActiveProvider: () => options.provider ?? 'autohandai',
    levels: { runtime, trustStorePath },
  };
  return { root, workspaceRoot, configPath, trustStorePath, runtime, ...context };
}

const lintAction = {
  type: 'set_lifecycle_hook' as const,
  event: 'post-tool' as const,
  command: 'bun run lint',
  description: 'Run lint after every tool call',
};

describe('set_lifecycle_hook', () => {
  it('is a registered, provider-gated hook tool with the level enum', () => {
    expect(HOOK_TOOL_NAMES.has('set_lifecycle_hook')).toBe(true);
    const definition = HOOK_TOOL_DEFINITIONS.find((entry) => entry.name === 'set_lifecycle_hook');
    expect(definition?.parameters?.required).toEqual(['event', 'command', 'description']);
    expect(definition?.parameters?.properties.level?.enum).toEqual(['project', 'local', 'user']);
    expect(HOOK_TOOL_DEFINITIONS.find((entry) => entry.name === 'create_hook')?.parameters?.properties.level?.enum)
      .toEqual(['project', 'local', 'user']);
  });

  it('previews, writes a project hook, trusts the workspace for it, and arms the running manager', async () => {
    const f = await fixture();
    const result = JSON.parse(await executeHookTool(lintAction, f));

    expect(f.confirm).toHaveBeenCalledWith(expect.stringContaining('Event: post-tool'));
    expect(f.confirm.mock.calls[0][0]).toContain('Command: bun run lint');
    expect(f.confirm.mock.calls[0][0]).toContain(`Level: project (${path.join(f.workspaceRoot, '.autohand', 'config.json')})`);
    expect(result).toMatchObject({ status: 'created', level: 'project', trusted: true, active: true });
    const projectConfig = await fs.readJson(path.join(f.workspaceRoot, '.autohand', 'config.json'));
    expect(projectConfig.hooks.hooks).toEqual([{ ...lintAction, type: undefined, enabled: true }].map(({ type: _type, ...hook }) => hook));
    expect((await fs.readJson(f.configPath)).hooks.hooks).toEqual([{ event: 'session-end', command: 'echo bye', description: 'Global goodbye' }]);
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.manager.getHooksForEvent('post-tool')).toHaveLength(1);
    expect(f.manager.getHooksForEvent('session-end')).toHaveLength(1);
    expect(f.runtime.config.workspaceTrust?.trusted).toBe(true);
    expect(await fs.pathExists(f.trustStorePath)).toBe(true);
  });

  it('updates a hook with the same event and description in place and reports it', async () => {
    const f = await fixture();
    await executeHookTool(lintAction, f);
    const result = JSON.parse(await executeHookTool({ ...lintAction, command: 'bun run lint --fix', timeout: 20_000 }, f));

    expect(result).toMatchObject({ status: 'updated', level: 'project' });
    const projectConfig = await fs.readJson(path.join(f.workspaceRoot, '.autohand', 'config.json'));
    expect(projectConfig.hooks.hooks).toHaveLength(1);
    expect(projectConfig.hooks.hooks[0]).toMatchObject({ command: 'bun run lint --fix', timeout: 20_000 });
    expect(f.manager.getHooksForEvent('post-tool')[0]?.command).toBe('bun run lint --fix');
  });

  it('writes local and user levels to their own files and accepts global as user', async () => {
    const f = await fixture();
    const local = JSON.parse(await executeHookTool({ ...lintAction, level: 'local' }, f));
    expect(local.path).toBe(path.join(f.workspaceRoot, '.autohand', 'settings.local.json'));
    expect((await fs.readJson(local.path)).hooks.hooks[0]).toMatchObject({ command: 'bun run lint' });

    const user = JSON.parse(await executeHookTool({ ...lintAction, level: 'global', description: 'Lint everywhere' }, f));
    expect(user).toMatchObject({ level: 'user', path: f.configPath });
    expect((await fs.readJson(f.configPath)).hooks.hooks.map((hook: { description: string }) => hook.description))
      .toEqual(['Global goodbye', 'Lint everywhere']);
    expect(f.manager.getHooksForEvent('post-tool')).toHaveLength(2);
  });

  it('writes nothing when the user declines the preview', async () => {
    const f = await fixture();
    f.confirm.mockResolvedValueOnce(false);
    expect(JSON.parse(await executeHookTool(lintAction, f))).toEqual({ status: 'cancelled' });
    expect(await fs.pathExists(path.join(f.workspaceRoot, '.autohand'))).toBe(false);
    expect(f.manager.getHooksForEvent('post-tool')).toHaveLength(0);
  });

  it('rejects bad input before asking for approval', async () => {
    const f = await fixture();
    await expect(executeHookTool({ ...lintAction, event: 'never' as never }, f)).rejects.toThrow(/Unknown lifecycle event/);
    await expect(executeHookTool({ ...lintAction, command: '  ' }, f)).rejects.toThrow('Hook command is required.');
    await expect(executeHookTool({ ...lintAction, level: 'team' }, f)).rejects.toThrow(/project, local, or user/);
    await expect(executeHookTool({ ...lintAction, timeout: 5 }, f)).rejects.toThrow(/timeout must be an integer/);
    await expect(executeHookTool({ ...lintAction, filter: { tool: ['', 'x'] } }, f)).rejects.toThrow(/filter.tool/);
    expect(f.confirm).not.toHaveBeenCalled();
  });

  it('keeps filters and matcher, and saves a disabled hook inactive', async () => {
    const f = await fixture();
    const result = JSON.parse(await executeHookTool({
      ...lintAction, filter: { tool: ['write_file'], path: ['src/**/*.ts'] }, matcher: '^write', enabled: false, async: true,
    }, f));
    expect(result.active).toBe(false);
    expect(result.hook).toEqual({
      event: 'post-tool', command: 'bun run lint', description: 'Run lint after every tool call',
      enabled: false, async: true, matcher: '^write', filter: { tool: ['write_file'], path: ['src/**/*.ts'] },
    });
  });

  it('refuses outside the Autohand AI provider and without level support', async () => {
    const other = await fixture({ provider: 'openrouter' });
    await expect(executeHookTool(lintAction, other)).rejects.toThrow('Autohand AI provider');
    const f = await fixture();
    await expect(executeHookTool(lintAction, { ...f, levels: undefined })).rejects.toThrow('not available in this session');
  });
});
