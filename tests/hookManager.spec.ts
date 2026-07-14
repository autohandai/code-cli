/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import { HookManager } from '../src/core/HookManager.js';
import type { HooksSettings, HookDefinition } from '../src/types.js';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

// Mock child_process.spawn
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn((command: string) => {
      const mockProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      let closed = false;
      mockProcess.kill = vi.fn((signal: NodeJS.Signals = 'SIGTERM') => {
        if (command.includes('ignore-term') && signal === 'SIGTERM') {
          return true;
        }
        setTimeout(() => {
          if (closed) return;
          closed = true;
          mockProcess.emit('close', null, signal);
        }, 0);
        return true;
      });

      // Simulate async behavior
      if (!command.includes('ignore-term')) setTimeout(() => {
        if (closed) return;
        closed = true;
        // Simulate success for 'true' or commands not containing 'false' or 'nonexistent'
        if (command.includes('false')) {
          mockProcess.emit('close', 1);
        } else if (command.includes('block')) {
          mockProcess.stderr.emit('data', Buffer.from('blocked by hook'));
          mockProcess.emit('close', 2);
        } else if (command.includes('nonexistent')) {
          mockProcess.emit('error', new Error('Command not found'));
        } else {
          // Success case
          mockProcess.stdout.emit('data', Buffer.from('mock output'));
          mockProcess.emit('close', 0);
        }
      }, command.includes('slow') ? 200 : 10);

      return mockProcess;
    }),
  };
});

describe('HookManager', () => {
  let manager: HookManager;
  let mockOnPersist: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnPersist = vi.fn().mockResolvedValue(undefined);
    manager = new HookManager({
      settings: { enabled: true, hooks: [] },
      workspaceRoot: '/test/workspace',
      onPersist: mockOnPersist,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('initializes with default settings', () => {
      const m = new HookManager({
        workspaceRoot: '/test',
      });
      expect(m.isEnabled()).toBe(true);
      expect(m.getHooks()).toEqual([]);
    });

    it('initializes with provided settings', () => {
      const settings: HooksSettings = {
        enabled: false,
        hooks: [
          { event: 'pre-tool', command: 'echo test', enabled: true }
        ]
      };
      const m = new HookManager({
        settings,
        workspaceRoot: '/test',
      });
      expect(m.isEnabled()).toBe(false);
      expect(m.getHooks()).toHaveLength(1);
    });
  });

  describe('isEnabled', () => {
    it('returns true when enabled is true', () => {
      expect(manager.isEnabled()).toBe(true);
    });

    it('returns true when enabled is undefined (default)', () => {
      const m = new HookManager({
        settings: {},
        workspaceRoot: '/test',
      });
      expect(m.isEnabled()).toBe(true);
    });

    it('returns false when enabled is false', () => {
      const m = new HookManager({
        settings: { enabled: false },
        workspaceRoot: '/test',
      });
      expect(m.isEnabled()).toBe(false);
    });
  });

  describe('getHooks', () => {
    it('returns empty array when no hooks', () => {
      expect(manager.getHooks()).toEqual([]);
    });

    it('returns all hooks', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1' });
      await manager.addHook({ event: 'post-tool', command: 'echo 2' });
      expect(manager.getHooks()).toHaveLength(2);
    });
  });

  describe('getHooksForEvent', () => {
    it('returns only enabled hooks for specific event', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1', enabled: true });
      await manager.addHook({ event: 'pre-tool', command: 'echo 2', enabled: false });
      await manager.addHook({ event: 'post-tool', command: 'echo 3', enabled: true });

      const preToolHooks = manager.getHooksForEvent('pre-tool');
      expect(preToolHooks).toHaveLength(1);
      expect(preToolHooks[0].command).toBe('echo 1');
    });

    it('returns empty array when no hooks for event', () => {
      expect(manager.getHooksForEvent('pre-tool')).toEqual([]);
    });
  });

  describe('addHook', () => {
    it('adds a hook and calls onPersist', async () => {
      await manager.addHook({
        event: 'pre-tool',
        command: 'echo test',
        description: 'Test hook'
      });

      expect(manager.getHooks()).toHaveLength(1);
      expect(mockOnPersist).toHaveBeenCalledTimes(1);
    });

    it('sets enabled to true by default', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });
      expect(manager.getHooks()[0].enabled).toBe(true);
    });
  });

  describe('removeHook', () => {
    it('removes hook by event and index', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1' });
      await manager.addHook({ event: 'pre-tool', command: 'echo 2' });

      const success = await manager.removeHook('pre-tool', 0);
      expect(success).toBe(true);
      expect(manager.getHooks()).toHaveLength(1);
      expect(manager.getHooks()[0].command).toBe('echo 2');
    });

    it('returns false for invalid index', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1' });
      const success = await manager.removeHook('pre-tool', 5);
      expect(success).toBe(false);
    });

    it('returns false for wrong event', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1' });
      const success = await manager.removeHook('post-tool', 0);
      expect(success).toBe(false);
    });
  });

  describe('toggleHook', () => {
    it('toggles hook enabled status', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test', enabled: true });

      let success = await manager.toggleHook('pre-tool', 0);
      expect(success).toBe(true);
      expect(manager.getHooks()[0].enabled).toBe(false);

      success = await manager.toggleHook('pre-tool', 0);
      expect(success).toBe(true);
      expect(manager.getHooks()[0].enabled).toBe(true);
    });

    it('returns false for invalid index', async () => {
      const success = await manager.toggleHook('pre-tool', 0);
      expect(success).toBe(false);
    });
  });

  describe('updateSettings', () => {
    it('updates settings and calls onPersist', async () => {
      await manager.updateSettings({ enabled: false });
      expect(manager.isEnabled()).toBe(false);
      expect(mockOnPersist).toHaveBeenCalled();
    });
  });

  describe('getSettings', () => {
    it('returns a copy of settings', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });
      const settings = manager.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.hooks).toHaveLength(1);
    });
  });

  describe('getSummary', () => {
    it('returns summary for all events', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo 1', enabled: true });
      await manager.addHook({ event: 'pre-tool', command: 'echo 2', enabled: false });
      await manager.addHook({ event: 'post-tool', command: 'echo 3', enabled: true });

      const summary = manager.getSummary();

      expect(summary['pre-tool']).toEqual({ total: 2, enabled: 1 });
      expect(summary['post-tool']).toEqual({ total: 1, enabled: 1 });
      expect(summary['file-modified']).toEqual({ total: 0, enabled: 0 });
      expect(summary['post-learn']).toEqual({ total: 0, enabled: 0 });
      expect(summary['mode-change']).toEqual({ total: 0, enabled: 0 });
      expect(summary['context:critical']).toEqual({ total: 0, enabled: 0 });
    });
  });

  describe('executeHooks', () => {
    it('returns empty array when hooks disabled', async () => {
      await manager.updateSettings({ enabled: false });
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });

      const results = await manager.executeHooks('pre-tool', {});
      expect(results).toEqual([]);
    });

    it('returns empty array when no hooks for event', async () => {
      const results = await manager.executeHooks('pre-tool', {});
      expect(results).toEqual([]);
    });

    it('executes hooks and returns results', async () => {
      // Use 'true' command which is more portable than echo
      await manager.addHook({ event: 'pre-tool', command: 'true' });

      const results = await manager.executeHooks('pre-tool', { tool: 'read_file' });
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });

    it('handles hook failures gracefully', async () => {
      // Use 'false' command which exits with code 1
      await manager.addHook({ event: 'pre-tool', command: 'false' });

      const results = await manager.executeHooks('pre-tool', { tool: 'read_file' });
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
    });

    it('respects filter.tool', async () => {
      await manager.addHook({
        event: 'pre-tool',
        command: 'true',
        filter: { tool: ['write_file'] }
      });

      // Should not execute for read_file
      let results = await manager.executeHooks('pre-tool', { tool: 'read_file' });
      expect(results).toHaveLength(0);

      // Should execute for write_file
      results = await manager.executeHooks('pre-tool', { tool: 'write_file' });
      expect(results).toHaveLength(1);
    });

    it('respects filter.path', async () => {
      await manager.addHook({
        event: 'file-modified',
        command: 'true',
        filter: { path: ['src/**/*.ts'] }
      });

      // Should not execute for .js files
      let results = await manager.executeHooks('file-modified', { path: 'src/test.js' });
      expect(results).toHaveLength(0);

      // Should execute for .ts files in src/
      results = await manager.executeHooks('file-modified', { path: 'src/test.ts' });
      expect(results).toHaveLength(1);
    });

    it('applies matchers to automode, review, and team event context', async () => {
      await manager.addHook({ event: 'automode:checkpoint', command: 'true', matcher: 'abc123' });
      await manager.addHook({ event: 'review:failed', command: 'true', matcher: 'src/index.ts' });
      await manager.addHook({ event: 'teammate-spawned', command: 'true', matcher: 'planner' });

      let results = await manager.executeHooks('automode:checkpoint', { automodeCheckpointCommit: 'abc123' });
      expect(results).toHaveLength(1);

      results = await manager.executeHooks('review:failed', { reviewPath: 'src/index.ts' });
      expect(results).toHaveLength(1);

      results = await manager.executeHooks('teammate-spawned', { teammateName: 'planner' });
      expect(results).toHaveLength(1);

      results = await manager.executeHooks('teammate-spawned', { teammateName: 'builder' });
      expect(results).toHaveLength(0);
    });

    it('executes async hooks in parallel', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'true', async: true });
      await manager.addHook({ event: 'pre-tool', command: 'true', async: true });

      const start = Date.now();
      const results = await manager.executeHooks('pre-tool', { tool: 'test' });
      const duration = Date.now() - start;

      expect(results).toHaveLength(2);
      // Both should complete quickly since they run in parallel
      expect(duration).toBeLessThan(2000);
    });

    it('does not spawn synchronous hooks when already aborted', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'slow hook' });
      const controller = new AbortController();
      controller.abort();

      const results = await manager.executeHooks('pre-tool', { tool: 'test' }, {
        signal: controller.signal,
      });

      expect(results).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('terminates an active synchronous hook and removes its abort listener', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'slow hook' });
      const controller = new AbortController();
      const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
      const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
      const resultsPromise = manager.executeHooks('pre-tool', { tool: 'test' }, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));

      controller.abort();
      const results = await resultsPromise;

      expect(vi.mocked(spawn).mock.results[0]?.value.kill).toHaveBeenCalledWith('SIGTERM');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ success: false, aborted: true, error: 'Hook execution aborted' });
      expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
      expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
    });

    it('suppresses hook output callbacks after lifecycle cancellation', async () => {
      const onHookOutput = vi.fn();
      const lifecycleManager = new HookManager({
        settings: { enabled: true, hooks: [] },
        workspaceRoot: '/test/workspace',
        onHookOutput,
      });
      await lifecycleManager.addHook({ event: 'stop', command: 'slow hook' });
      const controller = new AbortController();

      const resultsPromise = lifecycleManager.executeHooks('stop', {}, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
      controller.abort();
      await resultsPromise;

      expect(onHookOutput).not.toHaveBeenCalled();
    });

    it('aborts parallel hooks without leaving observational work running', async () => {
      await manager.addHook({ event: 'post-tool', command: 'slow one', async: true });
      await manager.addHook({ event: 'post-tool', command: 'slow two', async: true });
      const controller = new AbortController();
      const resultsPromise = manager.executeHooks('post-tool', { tool: 'test' }, {
        signal: controller.signal,
      });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));

      controller.abort();
      const results = await resultsPromise;

      expect(results).toHaveLength(2);
      expect(results.every((result) => result.aborted === true)).toBe(true);
      for (const spawned of vi.mocked(spawn).mock.results) {
        expect(spawned.value.kill).toHaveBeenCalledWith('SIGTERM');
      }
    });

    it('forces a timed-out hook to exit and cleans all timers', async () => {
      vi.useFakeTimers();
      await manager.addHook({
        event: 'pre-tool',
        command: 'slow ignore-term',
        timeout: 10,
      });

      const resultsPromise = manager.executeHooks('pre-tool', { tool: 'test' });
      await vi.advanceTimersByTimeAsync(1_010);
      await vi.runAllTimersAsync();
      const results = await resultsPromise;

      const child = vi.mocked(spawn).mock.results[0]?.value;
      expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      expect(results[0]).toMatchObject({
        success: false,
        aborted: false,
        error: 'Hook timed out after 10ms',
      });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves exit-code-2 blocking semantics', async () => {
      await manager.addHook({ event: 'permission-request', command: 'block request' });

      const results = await manager.executeHooks('permission-request', { tool: 'write_file' });

      expect(results[0]).toMatchObject({
        success: false,
        exitCode: 2,
        blockingError: true,
        error: 'blocked by hook',
      });
    });
  });

  describe('testHook', () => {
    it('tests hook execution', async () => {
      const hook: HookDefinition = {
        event: 'pre-tool',
        command: 'true'
      };

      const result = await manager.testHook(hook);
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('returns failure for invalid command', async () => {
      const hook: HookDefinition = {
        event: 'pre-tool',
        command: 'nonexistent_command_12345'
      };

      const result = await manager.testHook(hook);
      expect(result.success).toBe(false);
    });
  });
});
