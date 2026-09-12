/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIFECYCLE_HOOK_LEVELS,
  normalizeLifecycleHookLevel,
  resolveLifecycleHookLevelPath,
  upsertLifecycleHookAtLevel,
} from '../../src/core/lifecycleHookLevels.js';
import type { HookDefinition } from '../../src/types.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.remove(root)));
});

async function tempRoot(): Promise<{ workspaceRoot: string; configPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-hook-levels-'));
  roots.push(root);
  const workspaceRoot = path.join(root, 'workspace');
  await fs.ensureDir(workspaceRoot);
  const configPath = path.join(root, 'home', 'config.json');
  await fs.outputJson(configPath, { provider: 'autohandai', hooks: { hooks: [] } });
  return { workspaceRoot, configPath };
}

const lintHook: HookDefinition = {
  event: 'post-tool',
  command: 'bun run lint',
  description: 'Run lint after every tool call',
  enabled: true,
};

describe('lifecycle hook levels', () => {
  it('accepts project, local, and user, treats global as user, and defaults to project', () => {
    expect(LIFECYCLE_HOOK_LEVELS).toEqual(['project', 'local', 'user']);
    expect(normalizeLifecycleHookLevel('global')).toBe('user');
    expect(normalizeLifecycleHookLevel(' Project ')).toBe('project');
    expect(normalizeLifecycleHookLevel(undefined)).toBe('project');
    expect(() => normalizeLifecycleHookLevel('team')).toThrow(/project, local, or user/);
  });

  it('resolves each level to its file and reuses an existing project config format', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    expect(await resolveLifecycleHookLevelPath({ level: 'user', workspaceRoot, configPath })).toBe(configPath);
    expect(await resolveLifecycleHookLevelPath({ level: 'local', workspaceRoot, configPath }))
      .toBe(path.join(workspaceRoot, '.autohand', 'settings.local.json'));
    expect(await resolveLifecycleHookLevelPath({ level: 'project', workspaceRoot, configPath }))
      .toBe(path.join(workspaceRoot, '.autohand', 'config.json'));

    await fs.outputFile(path.join(workspaceRoot, '.autohand', 'config.toml'), 'provider = "autohandai"\n');
    expect(await resolveLifecycleHookLevelPath({ level: 'project', workspaceRoot, configPath }))
      .toBe(path.join(workspaceRoot, '.autohand', 'config.toml'));
  });

  it('appends a new project hook and replaces one with the same identity in place', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    const first = await upsertLifecycleHookAtLevel({ level: 'project', workspaceRoot, configPath, hook: lintHook });
    expect(first).toEqual({ path: path.join(workspaceRoot, '.autohand', 'config.json'), replaced: false });
    const other: HookDefinition = { event: 'session-end', command: 'echo bye', description: 'Say goodbye' };
    await upsertLifecycleHookAtLevel({ level: 'project', workspaceRoot, configPath, hook: other });

    const updated = await upsertLifecycleHookAtLevel({
      level: 'project', workspaceRoot, configPath,
      hook: { ...lintHook, command: 'bun run lint --fix', timeout: 20_000 },
    });
    expect(updated.replaced).toBe(true);

    const written = await fs.readJson(path.join(workspaceRoot, '.autohand', 'config.json'));
    expect(written.hooks.hooks).toEqual([
      { ...lintHook, command: 'bun run lint --fix', timeout: 20_000 },
      { ...other, enabled: true },
    ]);
    expect((await fs.readJson(configPath)).hooks.hooks).toEqual([]);
    expect(await fs.pathExists(path.join(workspaceRoot, '.autohand', 'config.json.lock'))).toBe(false);
  });

  it('writes local hooks into settings.local.json with its version stamp and keeps other sections', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    const settingsPath = path.join(workspaceRoot, '.autohand', 'settings.local.json');
    await fs.outputJson(settingsPath, { version: 1, permissions: { allow: ['git status'] } });

    await upsertLifecycleHookAtLevel({ level: 'local', workspaceRoot, configPath, hook: lintHook });

    expect(await fs.readJson(settingsPath)).toEqual({
      version: 1,
      permissions: { allow: ['git status'] },
      hooks: { hooks: [lintHook] },
    });
  });

  it('converts an event-keyed legacy hooks section before adding to it', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    const projectPath = path.join(workspaceRoot, '.autohand', 'config.json');
    await fs.outputJson(projectPath, { hooks: { 'pre-prompt': ['echo before'] } });

    await upsertLifecycleHookAtLevel({ level: 'project', workspaceRoot, configPath, hook: lintHook });

    const written = await fs.readJson(projectPath);
    expect(written.hooks.hooks).toHaveLength(2);
    expect(written.hooks.hooks[0]).toMatchObject({ event: 'pre-prompt', command: 'echo before' });
    expect(written.hooks.hooks[1]).toEqual(lintHook);
  });

  it('writes user hooks to the active config file and preserves its other keys', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    await upsertLifecycleHookAtLevel({ level: 'user', workspaceRoot, configPath, hook: lintHook });
    expect(await fs.readJson(configPath)).toEqual({ provider: 'autohandai', hooks: { hooks: [lintHook] } });
  });

  it('round-trips a TOML project config', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    const tomlPath = path.join(workspaceRoot, '.autohand', 'config.toml');
    await fs.outputFile(tomlPath, 'provider = "autohandai"\n');
    const result = await upsertLifecycleHookAtLevel({ level: 'project', workspaceRoot, configPath, hook: lintHook });
    expect(result.path).toBe(tomlPath);
    const raw = await fs.readFile(tomlPath, 'utf8');
    expect(raw).toContain('provider = "autohandai"');
    expect(raw).toContain('bun run lint');
  });

  it('rejects a file whose hooks section is not an object', async () => {
    const { workspaceRoot, configPath } = await tempRoot();
    await fs.outputJson(path.join(workspaceRoot, '.autohand', 'config.json'), { hooks: 'nope' });
    await expect(upsertLifecycleHookAtLevel({ level: 'project', workspaceRoot, configPath, hook: lintHook }))
      .rejects.toThrow(/invalid hooks section/);
  });
});
