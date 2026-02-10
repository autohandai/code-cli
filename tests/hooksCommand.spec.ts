/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hooks, metadata } from '../src/commands/hooks.js';
import { HookManager } from '../src/core/HookManager.js';
import { EventEmitter } from 'node:events';

// Mock child_process.spawn for HookManager
vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn((command: string) => {
      const mockProcess = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();

      setTimeout(() => {
        if (command.includes('fail')) {
          mockProcess.emit('close', 1);
        } else {
          mockProcess.stdout.emit('data', Buffer.from('success'));
          mockProcess.emit('close', 0);
        }
      }, 10);

      return mockProcess;
    }),
  };
});

// Mock safePrompt
vi.mock('../src/utils/prompt.js', () => ({
  safePrompt: vi.fn(),
}));

import { safePrompt } from '../src/utils/prompt.js';

describe('/hooks command', () => {
  let manager: HookManager;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const mockSafePrompt = safePrompt as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new HookManager({
      settings: { enabled: true, hooks: [] },
      workspaceRoot: '/test/workspace',
    });

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSafePrompt.mockReset();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('metadata', () => {
    it('has correct command metadata', () => {
      expect(metadata.command).toBe('/hooks');
      expect(metadata.description).toBe('manage git hooks');
      expect(metadata.implemented).toBe(true);
    });
  });

  describe('display', () => {
    it('shows empty state when no hooks configured', async () => {
      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await hooks({ hookManager: manager });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Hooks'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('No hooks configured'));
    });

    it('shows hooks grouped by event', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test1', description: 'Test hook 1' });
      await manager.addHook({ event: 'post-tool', command: 'echo test2', description: 'Test hook 2' });

      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await hooks({ hookManager: manager });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('pre-tool'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('post-tool'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2 of 2 hooks active'));
    });

    it('shows enabled/disabled count', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'cmd1', enabled: true, description: 'Hook 1' });
      await manager.addHook({ event: 'pre-tool', command: 'cmd2', enabled: false, description: 'Hook 2' });

      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await hooks({ hookManager: manager });

      // New UI shows "1 of 2 hooks active" in summary
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1 of 2 hooks active'));
    });

    it('shows disabled mode when hooks are globally disabled', async () => {
      await manager.updateSettings({ enabled: false });
      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      await hooks({ hookManager: manager });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    });
  });

  describe('actions', () => {
    it('returns null when user selects done', async () => {
      mockSafePrompt.mockResolvedValueOnce({ action: 'done' });

      const result = await hooks({ hookManager: manager });

      expect(result).toBeNull();
    });

    it('returns null when user cancels prompt', async () => {
      mockSafePrompt.mockResolvedValueOnce(null);

      const result = await hooks({ hookManager: manager });

      expect(result).toBeNull();
    });
  });

  describe('add hook', () => {
    it('adds a new hook when user completes flow', async () => {
      mockSafePrompt
        .mockResolvedValueOnce({ action: 'add' })
        .mockResolvedValueOnce({ event: 'pre-tool' })
        .mockResolvedValueOnce({ command: 'echo new hook' })
        .mockResolvedValueOnce({ description: 'My new hook' })
        .mockResolvedValueOnce({ async: false });

      await hooks({ hookManager: manager });

      const allHooks = manager.getHooks();
      expect(allHooks).toHaveLength(1);
      expect(allHooks[0].event).toBe('pre-tool');
      expect(allHooks[0].command).toBe('echo new hook');
      expect(allHooks[0].description).toBe('My new hook');
    });

    it('handles cancelled add flow', async () => {
      mockSafePrompt
        .mockResolvedValueOnce({ action: 'add' })
        .mockResolvedValueOnce(null); // User cancels event selection

      await hooks({ hookManager: manager });

      expect(manager.getHooks()).toHaveLength(0);
    });
  });

  describe('toggle hook', () => {
    it('toggles hook enabled status via multiselect', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test', enabled: true, description: 'Test hook' });

      // Toggle action now uses multiselect - deselect hook 0 to disable it
      mockSafePrompt
        .mockResolvedValueOnce({ action: 'toggle' })
        .mockResolvedValueOnce({ selected: [] }); // Empty selection disables all

      await hooks({ hookManager: manager });

      expect(manager.getHooks()[0].enabled).toBe(false);
    });

    it('enables a hook via select', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test1', enabled: false, description: 'Hook 1' });
      await manager.addHook({ event: 'pre-tool', command: 'echo test2', enabled: false, description: 'Hook 2' });

      // Select first hook to toggle it
      mockSafePrompt
        .mockResolvedValueOnce({ action: 'toggle' })
        .mockResolvedValueOnce({ selected: 0 });

      await hooks({ hookManager: manager });

      expect(manager.getHooks()[0].enabled).toBe(true);
      expect(manager.getHooks()[1].enabled).toBe(false);
    });
  });

  describe('remove hook', () => {
    it('removes hook when confirmed', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'remove' })
        .mockResolvedValueOnce({ hookIndex: '0' })
        .mockResolvedValueOnce({ confirm: true });

      await hooks({ hookManager: manager });

      expect(manager.getHooks()).toHaveLength(0);
    });

    it('does not remove hook when not confirmed', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'remove' })
        .mockResolvedValueOnce({ hookIndex: '0' })
        .mockResolvedValueOnce({ confirm: false });

      await hooks({ hookManager: manager });

      expect(manager.getHooks()).toHaveLength(1);
    });
  });

  describe('test hook', () => {
    it('tests hook execution and shows success', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo success', description: 'Test hook' });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'test' })
        .mockResolvedValueOnce({ hookIndex: '0' });

      await hooks({ hookManager: manager });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Completed'));
    });

    it('tests hook execution and shows failure', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'fail-command', description: 'Failing hook' });

      mockSafePrompt
        .mockResolvedValueOnce({ action: 'test' })
        .mockResolvedValueOnce({ hookIndex: '0' });

      await hooks({ hookManager: manager });

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Failed'));
    });
  });

  describe('toggle global', () => {
    it('disables hooks globally', async () => {
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });

      mockSafePrompt.mockResolvedValueOnce({ action: 'toggle_global' });

      await hooks({ hookManager: manager });

      expect(manager.isEnabled()).toBe(false);
    });

    it('enables hooks globally when disabled', async () => {
      await manager.updateSettings({ enabled: false });
      await manager.addHook({ event: 'pre-tool', command: 'echo test' });

      mockSafePrompt.mockResolvedValueOnce({ action: 'toggle_global' });

      await hooks({ hookManager: manager });

      expect(manager.isEnabled()).toBe(true);
    });
  });
});
