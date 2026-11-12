/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileActionManager } from '../../src/actions/filesystem.js';
import { ActionExecutor } from '../../src/core/actionExecutor.js';
import { DEFAULT_TOOL_DEFINITIONS, ToolManager } from '../../src/core/toolManager.js';
import { PermissionManager } from '../../src/permissions/PermissionManager.js';
import type { HookExecutionResult } from '../../src/core/HookManager.js';
import type { AgentAction, ToolExecutionContext } from '../../src/types.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

function envelope(target: string): string {
  return `*** Begin Patch\n*** Update File: ${target}\n@@\n-ORIGINAL\n+CHANGED\n*** End Patch`;
}

async function pipeline(stage: 'pre-tool' | 'permission-request' | 'alternative' | 'plain', target: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-patch-authorization-'));
  directories.push(directory);
  await fs.writeFile(path.join(directory, 'safe.txt'), 'ORIGINAL\n');
  await fs.writeFile(path.join(directory, '.env'), 'ORIGINAL\n');
  const permissionManager = new PermissionManager({ mode: stage === 'pre-tool' || stage === 'plain' ? 'unrestricted' : 'interactive' });
  const executor = new ActionExecutor({
    runtime: { workspaceRoot: directory, config: { configPath: '' }, options: {} },
    files: new FileActionManager(directory),
    permissionManager,
    resolveWorkspacePath: value => path.resolve(directory, value),
    confirmDangerousAction: async () => true,
  });
  await executor.executeForTool({ type: 'read_file', path: 'safe.txt' });
  const dispatch = vi.fn((action: AgentAction, context?: ToolExecutionContext) => executor.executeForTool(action, context));
  const confirmApproval = vi.fn().mockResolvedValue(stage === 'alternative'
    ? { decision: 'alternative', alternative: target }
    : { decision: 'allow_once' });
  const rewritten = async (): Promise<HookExecutionResult[]> => [{
    hook: { event: stage === 'pre-tool' ? 'pre-tool' : 'permission-request', command: 'fixture' },
    success: true,
    duration: 0,
    response: { updatedInput: { path: '', patch: envelope(target) } },
  }];
  const definition = DEFAULT_TOOL_DEFINITIONS.find(tool => tool.name === 'apply_patch');
  if (!definition) throw new Error('Missing apply_patch definition');
  const manager = new ToolManager({
    definitions: [definition],
    executor: dispatch,
    confirmApproval,
    authorization: {
      permissionManager,
      resolvePermissionContext: action => executor.getPermissionContext(action),
      ...(stage === 'pre-tool' ? { runPreToolHooks: rewritten } : {}),
      ...(stage === 'permission-request' ? { runPermissionRequestHooks: rewritten } : {}),
    },
  });
  return { directory, manager, executor, dispatch, confirmApproval };
}

describe('patch envelope authorization through the real tool pipeline', () => {
  it.each(['managed', 'direct'] as const)('blocks a protected envelope target behind an explicit file alias in the %s pipeline', async (route) => {
    const { directory, manager, executor, dispatch } = await pipeline('plain', 'safe.txt');
    const alias = path.join(directory, 'safe-alias');
    if (process.platform === 'win32') {
      await fs.link(path.join(directory, '.env'), alias);
    } else {
      await fs.symlink(path.join(directory, '.env'), alias, 'file');
    }
    await executor.executeForTool({ type: 'read_file', path: 'safe-alias' });
    const patch = envelope('.env');

    const result = route === 'managed'
      ? (await manager.execute([{ tool: 'apply_patch', args: { path: 'safe-alias', patch } }]))[0]
      : await executor.executeForTool({ type: 'apply_patch', path: 'safe-alias', patch });

    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    expect(dispatch).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(directory, '.env'), 'utf8')).resolves.toBe('ORIGINAL\n');
    await expect(fs.readFile(alias, 'utf8')).resolves.toBe('ORIGINAL\n');
  });

  it.each(['pre-tool', 'permission-request', 'alternative'] as const)('blocks a protected target introduced by %s input rewriting', async (stage) => {
    const { directory, manager, dispatch, confirmApproval } = await pipeline(stage, '.env');

    const [result] = await manager.execute([{ tool: 'apply_patch', args: {
      path: 'safe.txt', patch: stage === 'alternative' ? envelope('safe.txt') : '@@\n-ORIGINAL\n+SAFE CHANGE\n',
    } }]);

    expect(result).toMatchObject({ success: false, kind: 'authorization' });
    if (stage === 'alternative') expect(confirmApproval).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    await expect(fs.readFile(path.join(directory, '.env'), 'utf8')).resolves.toBe('ORIGINAL\n');
    await expect(fs.readFile(path.join(directory, 'safe.txt'), 'utf8')).resolves.toBe('ORIGINAL\n');
  });

  it.each(['pre-tool', 'permission-request', 'alternative'] as const)('authorizes the final target before executing %s rewritten input', async (stage) => {
    const { directory, manager, dispatch, confirmApproval } = await pipeline(stage, 'safe.txt');

    const [result] = await manager.execute([{ tool: 'apply_patch', args: {
      path: 'safe.txt', patch: stage === 'alternative' ? envelope('safe.txt') : '@@\n-ORIGINAL\n+SAFE CHANGE\n',
    } }]);

    expect(result).toMatchObject({ success: true });
    if (stage === 'alternative') expect(confirmApproval).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ path: 'safe.txt' }), expect.objectContaining({ approvalHandled: true }));
    await expect(fs.readFile(path.join(directory, 'safe.txt'), 'utf8')).resolves.toBe('CHANGED\n');
    await expect(fs.readFile(path.join(directory, '.env'), 'utf8')).resolves.toBe('ORIGINAL\n');
  });
});
