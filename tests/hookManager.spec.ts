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
        stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (signal?: NodeJS.Signals) => boolean;
      };
      mockProcess.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() });
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
    it('exports documented subagent result scalars including false and zero', async () => {
      await manager.addHook({ event: 'subagent-stop', command: 'true' });
      await manager.executeHooks('subagent-stop', {
        subagentSuccess: false, subagentDuration: 0, subagentError: 'e'.repeat(5_000),
      });
      const env = vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env;
      expect(env?.HOOK_SUBAGENT_SUCCESS).toBe('false');
      expect(env?.HOOK_SUBAGENT_DURATION).toBe('0');
      expect(env?.HOOK_SUBAGENT_ERROR).toHaveLength(4_000);
    });

    it('exposes subagent controls in summaries and passes run context through filtered shell hooks', async () => {
      const events = ['subagent-start', 'subagent-progress', 'subagent-message', 'subagent-cancel-requested'] as const;
      for (const event of events) await manager.addHook({ event, command: 'true', matcher: '^reviewer$' });
      expect(manager.getSummary()).toMatchObject(Object.fromEntries(events.map(event => [event, { total: 1, enabled: 1 }])));
      await manager.executeHooks('subagent-progress', { subagentType: 'different' });
      expect(spawn).not.toHaveBeenCalled();
      await manager.executeHooks('subagent-progress', {
        subagentId: 'run-1', subagentName: 'reader', subagentType: 'reviewer', subagentParentId: 'lead',
        subagentSource: 'delegate', subagentStatus: 'running', subagentActivity: 'Reading files',
        subagentWorkspace: '/test/workspace', subagentTask: 'Inspect code', subagentMessage: 'Check tests',
      });
      expect(spawn).toHaveBeenCalledWith('true', [], expect.objectContaining({ env: expect.objectContaining({
        HOOK_SUBAGENT_ID: 'run-1', HOOK_SUBAGENT_NAME: 'reader', HOOK_SUBAGENT_TYPE: 'reviewer',
        HOOK_SUBAGENT_PARENT_ID: 'lead', HOOK_SUBAGENT_SOURCE: 'delegate', HOOK_SUBAGENT_STATUS: 'running',
        HOOK_SUBAGENT_ACTIVITY: 'Reading files', HOOK_SUBAGENT_WORKSPACE: '/test/workspace',
      }) }));
      const child = vi.mocked(spawn).mock.results.at(-1)?.value;
      expect(child?.stdin?.write).toHaveBeenCalledWith(expect.stringContaining('"subagent_message":"Check tests"'));
      expect(child?.stdin?.write).toHaveBeenCalledWith(expect.stringContaining('"subagent_task":"Inspect code"'));
    });

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
      expect(summary['rate-limit']).toEqual({ total: 0, enabled: 0 });
    });

    it('counts registered rate-limit hooks', async () => {
      await manager.addHook({ event: 'rate-limit', command: 'notify-send quota', enabled: true });

      expect(manager.getSummary()['rate-limit']).toEqual({ total: 1, enabled: 1 });
      expect(manager.getHooksForEvent('rate-limit')).toHaveLength(1);
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

    it('publishes the complete review execution context to lifecycle observers', async () => {
      const listener = vi.fn();
      manager.subscribeLifecycle(listener);

      await manager.executeHooks('review:start', {
        sessionId: 'session-review',
        reviewAudience: 'forensic',
        reviewBase: 'origin/main',
        reviewFormat: 'markdown',
        reviewHead: 'HEAD',
        reviewKind: 'security',
        reviewPath: 'src/auth',
        reviewScope: 'security',
        reviewStatus: 'running',
        reviewSurface: 'acp',
      });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        event: 'review:start',
        workspace: '/test/workspace',
        reviewAudience: 'forensic',
        reviewBase: 'origin/main',
        reviewFormat: 'markdown',
        reviewHead: 'HEAD',
        reviewKind: 'security',
        reviewStatus: 'running',
        reviewSurface: 'acp',
      }));
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

    it.each(['true', 'block request'])('preserves the exit result when %s closes stdin early', async (command) => {
      await manager.addHook({ event: 'pre-prompt', command });
      const resultsPromise = manager.executeHooks('pre-prompt', { instruction: 'Review changes' });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      const child = vi.mocked(spawn).mock.results[0]?.value;

      expect(() => child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow();
      const [result] = await resultsPromise;

      expect(result).toMatchObject(command === 'true'
        ? { success: true, exitCode: 0 }
        : { success: false, exitCode: 2, blockingError: true });
    });

    it.skipIf(process.platform === 'win32')('signals the hook process group when cancelling a shell hook', async () => {
      await manager.addHook({ event: 'pre-prompt', command: 'slow hook' });
      const controller = new AbortController();
      const resultsPromise = manager.executeHooks('pre-prompt', {}, { signal: controller.signal });
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      const child = vi.mocked(spawn).mock.results[0]?.value;
      Object.defineProperty(child, 'pid', { value: 4321 });
      const signal = vi.spyOn(process, 'kill').mockImplementation(() => {
        child.emit('close', null, 'SIGTERM');
        return true;
      });
      try {
        controller.abort();
        const [result] = await resultsPromise;
        expect(signal).toHaveBeenCalledWith(-4321, 'SIGTERM');
        expect(spawn).toHaveBeenCalledWith('slow hook', [], expect.objectContaining({ detached: true }));
        expect(result).toMatchObject({ success: false, aborted: true });
      } finally {
        signal.mockRestore();
      }
    });

    it('reports unexpected stdin errors as hook failures', async () => {
      await manager.addHook({ event: 'pre-prompt', command: 'slow hook' });
      const resultsPromise = manager.executeHooks('pre-prompt', {});
      await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
      const child = vi.mocked(spawn).mock.results[0]?.value;

      expect(() => child.stdin.emit('error', Object.assign(new Error('write EIO'), { code: 'EIO' }))).not.toThrow();
      expect((await resultsPromise)[0]).toMatchObject({ success: false, error: 'write EIO' });
    });

    it('still publishes an already-aborted post-tool lifecycle event without spawning user hooks', async () => {
      await manager.addHook({ event: 'post-tool', command: 'slow hook' });
      const listener = vi.fn();
      manager.subscribeLifecycle(listener);
      const controller = new AbortController();
      controller.abort();

      const results = await manager.executeHooks('post-tool', {
        tool: 'read_file',
        toolCallId: 'aborted-tool',
        success: false,
      }, { signal: controller.signal });

      expect(results).toEqual([]);
      expect(spawn).not.toHaveBeenCalled();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith({
        event: 'post-tool',
        workspace: '/test/workspace',
        tool: 'read_file',
        toolCallId: 'aborted-tool',
        success: false,
      });
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


describe('complete lifecycle catalogue', () => {
  it.each(['decision', 'replay', 'rescore', 'prune'] as const)('summarizes and filters autoresearch:%s', async name => {
    const event = `autoresearch:${name}` as const;
    const manager = new HookManager({ workspaceRoot: process.cwd(), settings: { hooks: [{ event, matcher: 'matched-goal', command: 'echo invoked' }] } });
    expect(manager.getSummary()[event]).toEqual({ total: 1, enabled: 1 });
    expect(await manager.executeHooks(event, { autoresearchGoal: 'different' })).toEqual([]);
    expect(await manager.executeHooks(event, { autoresearchGoal: 'matched-goal' })).toHaveLength(1);
  });
});

describe('autoresearch decision matching', () => {
  it('matches the decision and attempt id carried by the event', async () => {
    const manager = new HookManager({ workspaceRoot: process.cwd(), settings: { hooks: [{ event: 'autoresearch:decision', matcher: 'attempt-42.*keep', command: 'echo matched' }] } });
    expect(await manager.executeHooks('autoresearch:decision', { autoresearchAttemptId: 'attempt-42', autoresearchDecision: 'keep' })).toHaveLength(1);
    expect(await manager.executeHooks('autoresearch:decision', { autoresearchAttemptId: 'attempt-42', autoresearchDecision: 'discard' })).toEqual([]);
  });
});

describe('legacy hook names and templates', () => {
  it('fires legacy-named hooks on their real events with the documented conditions', async () => {
    const manager = new HookManager({ workspaceRoot: '/ws', settings: { enabled: true, hooks: [
      { event: 'on_file_create', command: 'echo created {{file}}' },
      { event: 'before_command', command: 'echo cmd {{command}}' },
    ] } });
    vi.mocked(spawn).mockClear();

    await manager.executeHooks('file-modified', { path: 'src/new.ts', changeType: 'modify' });
    expect(spawn).not.toHaveBeenCalled();

    await manager.executeHooks('file-modified', { path: 'src/new.ts', changeType: 'create' });
    expect(spawn).toHaveBeenCalledWith('echo created src/new.ts', [], expect.anything());

    await manager.executeHooks('pre-tool', { tool: 'read_file', args: { path: 'x' } });
    expect(spawn).toHaveBeenCalledTimes(1);

    await manager.executeHooks('pre-tool', { tool: 'shell', args: { command: 'npm test' } });
    expect(spawn).toHaveBeenLastCalledWith(`echo cmd 'npm test'`, [], expect.anything());
  });

  it('accepts the event-keyed settings shape and counts those hooks under their real events', async () => {
    const manager = new HookManager({ workspaceRoot: '/ws', settings: {
      on_file_change: ['eslint {{file}} --fix'],
      on_session_end: ['notify-send done'],
    } as unknown as HooksSettings });

    expect(manager.getHooks()).toEqual([
      { event: 'on_file_change', command: 'eslint {{file}} --fix' },
      { event: 'on_session_end', command: 'notify-send done' },
    ]);
    expect(manager.getSummary()['file-modified']).toEqual({ total: 1, enabled: 1 });
    expect(manager.getSummary()['session-end']).toEqual({ total: 1, enabled: 1 });
    expect(manager.getHooksForEvent('session-end')).toHaveLength(1);
  });
});
