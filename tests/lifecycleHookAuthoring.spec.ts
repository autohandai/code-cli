import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HookManager } from '../src/core/HookManager.js';
import { HookAuthoringService } from '../src/core/HookAuthoringService.js';
import { getLifecycleHookInventory } from '../src/core/hookEvents.js';
import { ToolManager } from '../src/core/toolManager.js';
import { executeHookTool, HOOK_TOOL_DEFINITIONS } from '../src/core/hookTools.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.remove(dir))); });

async function fixture(content?: string, persist = vi.fn().mockResolvedValue(undefined)) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hook-authoring-'));
  directories.push(root);
  const manager = new HookManager({ workspaceRoot: root, onPersist: persist });
  const complete = vi.fn().mockResolvedValue({ content: content ?? JSON.stringify({
    event: 'pre-tool', description: 'Record tool names', script: "require('node:fs').appendFileSync('events.log', process.env.HOOK_TOOL + '\\n');",
    timeout: 5000, async: false,
  }) });
  const confirm = vi.fn().mockResolvedValue(true);
  const service = new HookAuthoringService({
    manager, workspaceRoot: root, scriptsRoot: path.join(root, 'hooks'),
    getProvider: () => ({ getName: () => 'autohandai', complete }), confirm,
  });
  return { root, manager, service, complete, confirm, persist };
}

describe('lifecycle hook inventory', () => {
  it('includes empty events, config hooks, extension ownership and stop aliases without double counting', () => {
    const manager = new HookManager({ workspaceRoot: '/test', settings: { hooks: [
      { event: 'post-response', command: 'echo alias' },
      { event: 'stop', command: 'echo disabled', enabled: false },
    ] } });
    manager.setExtensionHooks([{ event: 'stop', extensionId: 'example.plugin', handler: () => {} }]);
    const rows = getLifecycleHookInventory(manager);
    expect(rows.find(row => row.event === 'stop')).toMatchObject({ installed: 3, active: 2 });
    expect(rows.find(row => row.event === 'stop')?.hooks).toContainEqual(expect.objectContaining({ source: 'example.plugin' }));
    expect(rows.find(row => row.event === 'pre-tool')).toMatchObject({ installed: 0, active: 0 });
    expect(rows.some(row => row.event === 'post-response')).toBe(false);
  });
  it('reports zero active hooks when globally disabled, including plugins', () => {
    const manager = new HookManager({ workspaceRoot: '/test', settings: { enabled: false, hooks: [{ event: 'stop', command: 'true' }] } });
    manager.setExtensionHooks([{ event: 'stop', extensionId: 'plugin', handler: () => {} }]);
    expect(getLifecycleHookInventory(manager).find(row => row.event === 'stop')).toMatchObject({ installed: 2, active: 0 });
  });
});

describe('plain-English hook authoring', () => {
  it('previews, saves, reloads and executes a generated script for the selected event', async () => {
    const { service, manager, root, confirm, persist } = await fixture();
    const result = await service.create({ event: 'pre-tool', prompt: 'Record every tool name in events.log' });
    expect(result.status).toBe('created');
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('appendFileSync'));
    expect(persist).toHaveBeenCalledOnce();
    expect(await fs.pathExists(path.join(root, 'events.log'))).toBe(false);
    const reloaded = new HookManager({ workspaceRoot: root, settings: manager.getSettings() });
    const results = await reloaded.executeHooks('pre-tool', { workspace: root, tool: 'read_file' });
    expect(results[0]).toMatchObject({ success: true });
    expect(await fs.readFile(path.join(root, 'events.log'), 'utf8')).toBe('read_file\n');
  });
  it('does not write or register a rejected draft', async () => {
    const { service, manager, root, confirm } = await fixture();
    confirm.mockResolvedValue(false);
    expect(await service.create({ event: 'pre-tool', prompt: 'Record tool names' })).toMatchObject({ status: 'cancelled' });
    expect(manager.getHooks()).toEqual([]);
    expect(await fs.pathExists(path.join(root, 'hooks'))).toBe(false);
  });
  it.each([
    ['invalid JSON', '{bad'],
    ['unknown event', JSON.stringify({ event: 'imaginary', description: 'bad', script: '1;' })],
    ['wrong selected event', JSON.stringify({ event: 'stop', description: 'bad', script: '1;' })],
    ['invalid syntax', JSON.stringify({ event: 'pre-tool', description: 'bad', script: 'const =' })],
    ['invalid timeout', JSON.stringify({ event: 'pre-tool', description: 'bad', script: '1;', timeout: -1 })],
  ])('rejects %s before approval or persistence', async (_label, content) => {
    const { service, manager, confirm } = await fixture(content);
    await expect(service.create({ event: 'pre-tool', prompt: 'Record tool names' })).rejects.toThrow();
    expect(confirm).not.toHaveBeenCalled();
    expect(manager.getHooks()).toEqual([]);
  });
  it('does not activate a hook when saving config fails', async () => {
    const { service, manager } = await fixture(undefined, vi.fn().mockRejectedValue(new Error('disk full')));
    await expect(service.create({ event: 'pre-tool', prompt: 'Record tool names' })).rejects.toThrow('disk full');
    expect(manager.getHooks()).toEqual([]);
  });
  it('infers the event and confines execution to the authoring workspace', async () => {
    const { service, manager, root, complete } = await fixture();
    expect(await service.create({ prompt: 'Log each tool before execution' })).toMatchObject({ status: 'created', hook: { event: 'pre-tool' } });
    const otherWorkspace = path.join(root, 'other');
    expect(complete.mock.calls[0][0].messages[0].content).toContain('team_task_result');
    expect(complete.mock.calls[0][0].messages[0].content).toContain('autoresearch_attempt_id');
    await fs.ensureDir(otherWorkspace);
    const other = new HookManager({ workspaceRoot: otherWorkspace, settings: manager.getSettings() });
    expect((await other.executeHooks('pre-tool', { workspace: otherWorkspace, tool: 'write_file' }))[0].success).toBe(true);
    expect(await fs.pathExists(path.join(otherWorkspace, 'events.log'))).toBe(false);
  });
  it('retains prior hooks and creates unique scripts for repeated requests', async () => {
    const { service, manager } = await fixture();
    await manager.addHook({ event: 'stop', command: 'echo existing', enabled: false });
    const first = await service.create({ prompt: 'Log tool names' });
    const second = await service.create({ prompt: 'Log tool names' });
    expect(first.status === 'created' && second.status === 'created' && first.scriptPath !== second.scriptPath).toBe(true);
    expect(manager.getHooks()).toHaveLength(3);
    expect(manager.getHooks()[0]).toMatchObject({ command: 'echo existing', enabled: false });
  });
  it('honors tool and path filters at runtime', async () => {
    const { service, complete, manager, root } = await fixture();
    complete.mockResolvedValue({ content: JSON.stringify({ event: 'pre-tool', description: 'Filtered logging',
      script: "require('node:fs').appendFileSync('filtered.log', 'matched');", filter: { tool: ['write_file'], path: ['src/*.ts'] } }) });
    await service.create({ prompt: 'Log writes to TypeScript sources' });
    expect(await manager.executeHooks('pre-tool', { workspace: root, tool: 'read_file', path: 'src/main.ts' })).toEqual([]);
    expect(await manager.executeHooks('pre-tool', { workspace: root, tool: 'write_file', path: 'README.md' })).toEqual([]);
    expect((await manager.executeHooks('pre-tool', { workspace: root, tool: 'write_file', path: 'src/main.ts' }))[0].success).toBe(true);
    expect(await fs.readFile(path.join(root, 'filtered.log'), 'utf8')).toBe('matched');
  });
  it('provides parsed lifecycle context to generated scripts and drains large stdin payloads', async () => {
    const { service, complete, manager, root } = await fixture();
    complete.mockResolvedValue({ content: JSON.stringify({ event: 'pre-tool', description: 'Structured context',
      script: "require('node:fs').writeFileSync('context.log', hookContext.tool_name);" }) });
    await service.create({ prompt: 'Record the tool from the lifecycle payload' });
    const results = await manager.executeHooks('pre-tool', { workspace: root, tool: 'write_file', args: { content: 'x'.repeat(60_000) } });
    expect(results[0]).toMatchObject({ success: true });
    expect(await fs.readFile(path.join(root, 'context.log'), 'utf8')).toBe('write_file');
  });
  it('rejects other providers and provider switches during approval for tool-driven authoring', async () => {
    const { root, manager, complete, confirm } = await fixture();
    let provider = 'anthropic';
    const service = new HookAuthoringService({ manager, workspaceRoot: root, requireAutohand: true,
      scriptsRoot: path.join(root, 'scripts'), getProvider: () => ({ getName: () => provider, complete }), confirm });
    await expect(service.create({ prompt: 'Log each tool' })).rejects.toThrow('Autohand AI');
    expect(complete).not.toHaveBeenCalled();
    provider = 'autohandai';
    confirm.mockImplementation(async () => { provider = 'openrouter'; return true; });
    await expect(service.create({ prompt: 'Log each tool' })).rejects.toThrow('Autohand AI');
    expect(manager.getHooks()).toEqual([]);
    expect(await fs.pathExists(path.join(root, 'scripts'))).toBe(false);
  });
  it('does not save after cancellation while the approval is pending', async () => {
    const { service, manager, confirm } = await fixture();
    const controller = new AbortController();
    confirm.mockImplementation(async () => { controller.abort(); return true; });
    await expect(service.create({ prompt: 'Log tools' }, controller.signal)).rejects.toThrow();
    expect(manager.getHooks()).toEqual([]);
  });
});

describe('Autohand-only hook tools', () => {
  it('sets hook state idempotently and restores state on persistence failure', async () => {
    const { manager, persist, service } = await fixture();
    await manager.addHook({ event: 'pre-tool', command: 'echo existing', enabled: false });
    const context = { manager, authoring: service, getActiveProvider: () => 'autohandai' };
    await executeHookTool({ type: 'set_hook_enabled', event: 'pre-tool', index: 0, enabled: false }, context);
    expect(persist).toHaveBeenCalledTimes(1);
    persist.mockRejectedValue(new Error('disk full'));
    await expect(executeHookTool({ type: 'set_hook_enabled', event: 'pre-tool', index: 0, enabled: true }, context)).rejects.toThrow('disk full');
    expect(manager.getHooks()[0].enabled).toBe(false);
  });
  it('enforces the provider restriction at dispatch and validates config indexes', async () => {
    const { manager, service } = await fixture();
    const context = { manager, authoring: service, getActiveProvider: () => 'openai' };
    await expect(executeHookTool({ type: 'list_hooks' }, context)).rejects.toThrow('Autohand AI');
    context.getActiveProvider = () => 'autohandai';
    await expect(executeHookTool({ type: 'set_hook_enabled', event: 'pre-tool', index: -1, enabled: true }, context)).rejects.toThrow('index');
    await expect(executeHookTool({ type: 'set_hook_enabled', event: 'pre-tool', index: 0, enabled: true }, context)).rejects.toThrow('not found');
  });
  it('updates discovery on provider changes and rejects forged calls before execution', async () => {
    let provider = 'openrouter';
    const executor = vi.fn().mockResolvedValue({ success: true, output: 'ok' });
    const manager = new ToolManager({ definitions: HOOK_TOOL_DEFINITIONS, getActiveProvider: () => provider,
      executor, confirmApproval: async () => true });
    expect(manager.listDefinitions()).toEqual([]);
    expect((await manager.execute([{ tool: 'list_hooks' }]))[0]).toMatchObject({ success: false, kind: 'authorization' });
    expect(executor).not.toHaveBeenCalled();
    provider = 'autohandai';
    expect(manager.listDefinitions().map(tool => tool.name)).toContain('create_hook');
    expect((await manager.execute([{ tool: 'list_hooks' }]))[0].success).toBe(true);
    provider = 'anthropic';
    expect(manager.toFunctionDefinitions()).toEqual([]);
  });
});
