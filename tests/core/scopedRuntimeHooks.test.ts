import { describe, expect, it, vi } from 'vitest';
import { HookManager } from '../../src/core/HookManager.js';

describe('scoped runtime hooks', () => {
  it('keeps existing runtime hooks and removes only the temporary scope', async () => {
    const persisted = vi.fn();
    const observed = vi.fn();
    const manager = new HookManager({ workspaceRoot: '/tmp', settings: { enabled: true, hooks: [] }, onPersist: persisted, onHookOutput: observed });
    manager.setExtensionHooks([{ event: 'file-modified', extensionId: 'existing', handler: () => ({ additionalContext: 'existing guidance' }) }]);
    const release = manager.addScopedRuntimeHooks([{ event: 'file-modified', extensionId: 'workflow', handler: () => ({ additionalContext: 'workflow guidance' }) }]);
    expect((await manager.executeHooks('file-modified', {})).map(result => result.response?.additionalContext)).toEqual(['existing guidance', 'workflow guidance']);
    release();
    release();
    expect((await manager.executeHooks('file-modified', {})).map(result => result.response?.additionalContext)).toEqual(['existing guidance']);
    expect(persisted).not.toHaveBeenCalled();
    expect(manager.getSettings().hooks).toEqual([]);
    expect(observed).toHaveBeenCalledTimes(3);
  });

  it('rejects overlapping scopes and permits a new scope after release', () => {
    const manager = new HookManager({ workspaceRoot: '/tmp' });
    const hook = { event: 'pre-prompt' as const, extensionId: 'workflow', handler: () => undefined };
    const release = manager.addScopedRuntimeHooks([hook]);
    expect(() => manager.addScopedRuntimeHooks([hook])).toThrow('already active');
    release();
    const next = manager.addScopedRuntimeHooks([hook]);
    release();
    expect(() => manager.addScopedRuntimeHooks([hook])).toThrow('already active');
    next();
    expect(() => manager.addScopedRuntimeHooks(Array.from({ length: 101 }, () => hook))).toThrow('100');
  });
  it('does not deliver released workflow guidance from an in-flight event', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    const observed = vi.fn();
    const workflow = vi.fn(() => ({ additionalContext: 'stale workflow guidance' }));
    const manager = new HookManager({ workspaceRoot: '/tmp', onHookOutput: observed });
    manager.setExtensionHooks([{ event: 'file-modified', extensionId: 'existing', handler: async () => { await waiting; return { additionalContext: 'existing guidance' }; } }]);
    const release = manager.addScopedRuntimeHooks([{ event: 'file-modified', extensionId: 'workflow', handler: workflow }]);
    const event = manager.executeHooks('file-modified', {});
    release();
    resume();
    const results = await event;
    expect(workflow).not.toHaveBeenCalled();
    expect(results.map(result => result.response?.additionalContext)).toEqual(['existing guidance']);
    expect(observed).toHaveBeenCalledTimes(1);
  });

  it('discards a scoped response that finishes after release', async () => {
    let resume!: () => void;
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    const observed = vi.fn();
    const manager = new HookManager({ workspaceRoot: '/tmp', onHookOutput: observed });
    const release = manager.addScopedRuntimeHooks([{ event: 'file-modified', extensionId: 'workflow', handler: async () => { await waiting; return { additionalContext: 'late guidance' }; } }]);
    const event = manager.executeHooks('file-modified', {});
    release();
    resume();
    expect(await event).toEqual([]);
    expect(observed).not.toHaveBeenCalled();
  });

});
