/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import type { AgentRuntime } from '../src/types.js';
import type { FileActionManager } from '../src/actions/filesystem.js';
import { ActionExecutor } from '../src/core/actionExecutor.js';
import * as gitActions from '../src/actions/git.js';
import type { ToolDefinition } from '../src/core/toolManager.js';

function createRuntime(): AgentRuntime {
  return {
    config: {
      configPath: '',
      openrouter: { apiKey: 'test', model: 'model' }
    },
    workspaceRoot: '/repo',
    options: {}
  } as AgentRuntime;
}

function createFiles(overrides: Partial<FileActionManager> = {}): Partial<FileActionManager> {
  return {
    root: '/repo',
    readFile: vi.fn().mockResolvedValue('console.log("ok")'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    applyPatch: vi.fn().mockResolvedValue(undefined),
    deletePath: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as Partial<FileActionManager>;
}

describe('ActionExecutor', () => {
  it('reads files via FileActionManager', async () => {
    const files = createFiles();
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
    });

    const result = await executor.execute({ type: 'read_file', path: 'src/index.ts' });

    expect(files.readFile).toHaveBeenCalledWith('src/index.ts');
    expect(result).toContain('console.log');
  });

  it('requires confirmation before deleting paths', async () => {
    const files = createFiles();
    const confirm = vi.fn().mockResolvedValue(false);
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: confirm
    });

    const result = await executor.execute({ type: 'delete_path', path: 'dist' });

    expect(confirm).toHaveBeenCalled();
    expect(files.deletePath).not.toHaveBeenCalled();
    expect(result).toContain('Skipped');
  });

  it('writes file contents provided via content alias', async () => {
    const files = createFiles({
      readFile: vi.fn().mockResolvedValue('old'),
      writeFile: vi.fn().mockResolvedValue(undefined)
    });
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
    });

    await executor.execute({ type: 'write_file', path: 'README.md', content: '# hello' } as any);

    expect(files.writeFile).toHaveBeenCalledWith('README.md', '# hello');
  });

  it('appends file contents provided via content alias', async () => {
    const files = createFiles({
      readFile: vi.fn().mockResolvedValue('old'),
      appendFile: vi.fn().mockResolvedValue(undefined)
    });
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
    });

    await executor.execute({ type: 'append_file', path: 'README.md', content: '\nMore' } as any);

    expect(files.appendFile).toHaveBeenCalledWith('README.md', '\nMore');
  });

  it('accepts diff alias for apply_patch', async () => {
    const readFile = vi.fn().mockResolvedValue('old');
    readFile.mockResolvedValueOnce('old');
    readFile.mockResolvedValueOnce('new');
    const applyPatch = vi.fn().mockResolvedValue(undefined);
    const files = createFiles({ readFile, applyPatch });
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
    });

    await executor.execute({ type: 'apply_patch', path: 'src/index.ts', diff: '@@ diff @@' } as any);

    expect(applyPatch).toHaveBeenCalledWith('src/index.ts', '@@ diff @@');
  });

  it('accepts diff alias for git_apply_patch', async () => {
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: createFiles() as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true)
    });
    const patchSpy = vi.spyOn(gitActions, 'applyGitPatch').mockImplementation(() => 'ok');

    await executor.execute({ type: 'git_apply_patch', diff: 'diff --git a b' } as any);

    expect(patchSpy).toHaveBeenCalledWith('/repo', 'diff --git a b');
    patchSpy.mockRestore();
  });

  it('emits exploration events for read actions', async () => {
    const files = createFiles({
      readFile: vi.fn().mockResolvedValue('console.log("ok")')
    });
    const onExploration = vi.fn();
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: files as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      onExploration
    });

    await executor.execute({ type: 'read_file', path: 'src/index.ts' });

    expect(onExploration).toHaveBeenCalledWith({ kind: 'read', target: 'src/index.ts' });
  });

  it('returns the tools registry as JSON', async () => {
    const tools: ToolDefinition[] = [{ name: 'read_file', description: 'Read files' } as ToolDefinition];
    const registry = { listTools: vi.fn().mockResolvedValue([{ name: 'read_file', description: 'Read files', source: 'builtin' }]) };
    const executor = new ActionExecutor({
      runtime: createRuntime(),
      files: createFiles() as FileActionManager,
      resolveWorkspacePath: (rel) => `/repo/${rel}`,
      confirmDangerousAction: vi.fn().mockResolvedValue(true),
      toolsRegistry: registry as any,
      getRegisteredTools: () => tools
    });

    const result = await executor.execute({ type: 'tools_registry' } as any);
    const parsed = JSON.parse(result ?? '[]');

    expect(registry.listTools).toHaveBeenCalled();
    expect(parsed[0]).toMatchObject({ name: 'read_file', source: 'builtin' });
  });
});
