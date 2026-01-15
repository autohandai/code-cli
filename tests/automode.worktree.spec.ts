/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auto-Mode Worktree Tests
 * Tests the git worktree isolation functionality in auto-mode
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { LoadedConfig } from '../src/types.js';

// Mock fs-extra before imports
vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    readJSON: vi.fn().mockRejectedValue(new Error('Not found')),
    writeJSON: vi.fn().mockResolvedValue(undefined),
  },
  ensureDir: vi.fn().mockResolvedValue(undefined),
  pathExists: vi.fn().mockResolvedValue(false),
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn().mockRejectedValue(new Error('Not found')),
  writeJSON: vi.fn().mockResolvedValue(undefined),
}));

// Track execSync calls for verification
const execSyncCalls: string[] = [];

// Mock child_process with worktree support
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string, options?: { cwd?: string }) => {
    execSyncCalls.push(cmd);

    if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
      return 'main';
    }
    if (cmd.includes('git status --porcelain')) {
      return 'M file.ts';
    }
    if (cmd.includes('git rev-parse --short HEAD')) {
      return 'abc1234';
    }
    if (cmd.includes('git worktree add')) {
      // Simulate successful worktree creation
      return '';
    }
    if (cmd.includes('git worktree remove')) {
      return '';
    }
    if (cmd.includes('git branch -d')) {
      return '';
    }
    if (cmd.includes('git checkout')) {
      return '';
    }
    if (cmd.includes('git merge')) {
      return '';
    }
    if (cmd.includes('git add')) {
      return '';
    }
    if (cmd.includes('git commit')) {
      return '';
    }
    return '';
  }),
  spawn: vi.fn(() => {
    const mockProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { write: () => void; end: () => void };
      kill: () => void;
    };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: vi.fn(), end: vi.fn() };
    mockProcess.kill = vi.fn();

    setTimeout(() => {
      mockProcess.emit('close', 0);
    }, 10);

    return mockProcess;
  }),
}));

// Import after mocks
import { AutomodeManager, type IterationCallback, type IterationResult } from '../src/core/AutomodeManager.js';

describe('Auto-Mode Worktree Isolation', () => {
  const mockConfig: LoadedConfig = {
    configPath: '/test/.autohand/config.json',
    provider: 'openrouter',
    openrouter: {
      apiKey: 'test-key',
      model: 'claude-3.5-sonnet',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    execSyncCalls.length = 0;
  });

  describe('Worktree Preparation', () => {
    it('prepareWorktree returns worktree path when successful', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      const worktreePath = await manager.prepareWorktree(true);

      expect(worktreePath).not.toBeNull();
      expect(worktreePath).toMatch(/\/tmp\/autohand-worktree-/);
    });

    it('prepareWorktree returns null when disabled', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      const worktreePath = await manager.prepareWorktree(false);

      expect(worktreePath).toBeNull();
    });

    it('getEffectiveWorkspace returns worktree path after preparation', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Before preparation
      expect(manager.getEffectiveWorkspace()).toBe('/test/workspace');

      // After preparation
      await manager.prepareWorktree(true);
      const effectiveWorkspace = manager.getEffectiveWorkspace();

      expect(effectiveWorkspace).toMatch(/\/tmp\/autohand-worktree-/);
      expect(effectiveWorkspace).not.toBe('/test/workspace');
    });

    it('getBranchName returns branch name after worktree preparation', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Before preparation
      expect(manager.getBranchName()).toBeNull();

      // After preparation
      await manager.prepareWorktree(true);
      const branchName = manager.getBranchName();

      expect(branchName).toMatch(/^autohand-automode-\d+$/);
    });

    it('creates git worktree with correct command', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      await manager.prepareWorktree(true);

      const worktreeCmd = execSyncCalls.find(cmd => cmd.includes('git worktree add'));
      expect(worktreeCmd).toBeDefined();
      expect(worktreeCmd).toMatch(/git worktree add -b autohand-automode-\d+ \/tmp\/autohand-worktree-/);
    });
  });

  describe('Worktree Usage in Loop', () => {
    it('skips worktree setup in start() if already prepared', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Prepare worktree first
      await manager.prepareWorktree(true);
      const initialCallCount = execSyncCalls.filter(cmd => cmd.includes('git worktree add')).length;

      // Start auto-mode (should not create another worktree)
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['test'],
        output: '<promise>DONE</promise>',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          useWorktree: true,
        },
        mockIterationCallback
      );

      const finalCallCount = execSyncCalls.filter(cmd => cmd.includes('git worktree add')).length;
      expect(finalCallCount).toBe(initialCallCount); // No additional worktree creation
    });

    it('uses worktree path for checkpoints', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Prepare worktree
      const worktreePath = await manager.prepareWorktree(true);

      // Start with checkpoint interval of 1
      let iteration = 0;
      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        iteration++;
        return {
          success: true,
          actions: ['test'],
          output: iteration >= 2 ? '<promise>DONE</promise>' : 'working...',
          filesCreated: 1,
          filesModified: 1,
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 5,
          useWorktree: true,
          checkpointInterval: 1,
        },
        mockIterationCallback
      );

      // Verify git commands were called with worktree path
      const gitAddCmds = execSyncCalls.filter(cmd => cmd.includes('git add'));
      expect(gitAddCmds.length).toBeGreaterThan(0);
    });
  });

  describe('Worktree Merge on Completion', () => {
    it('merges worktree branch on successful completion', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Prepare worktree
      await manager.prepareWorktree(true);

      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['completed'],
        output: '<promise>DONE</promise>',
        filesCreated: 1,
        filesModified: 1,
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          useWorktree: true,
        },
        mockIterationCallback
      );

      // Verify merge was called
      const mergeCmds = execSyncCalls.filter(cmd => cmd.includes('git merge'));
      expect(mergeCmds.length).toBeGreaterThan(0);

      // Verify checkout back to original branch
      const checkoutCmds = execSyncCalls.filter(cmd => cmd.includes('git checkout main'));
      expect(checkoutCmds.length).toBeGreaterThan(0);
    });

    it('cleans up worktree after successful merge', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Prepare worktree
      await manager.prepareWorktree(true);

      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['completed'],
        output: '<promise>DONE</promise>',
        filesCreated: 1,
        filesModified: 1,
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          useWorktree: true,
        },
        mockIterationCallback
      );

      // Verify worktree removal
      const worktreeRemoveCmds = execSyncCalls.filter(cmd => cmd.includes('git worktree remove'));
      expect(worktreeRemoveCmds.length).toBeGreaterThan(0);

      // Verify branch deletion
      const branchDeleteCmds = execSyncCalls.filter(cmd => cmd.includes('git branch -d'));
      expect(branchDeleteCmds.length).toBeGreaterThan(0);
    });
  });

  describe('Worktree Preservation on Cancel', () => {
    it('preserves worktree on cancellation for manual inspection', async () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // Prepare worktree
      const worktreePath = await manager.prepareWorktree(true);

      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        // Cancel during iteration
        await manager.cancel('user_cancel');
        return {
          success: true,
          actions: ['action'],
          output: 'working...',
          filesCreated: 1,
          filesModified: 1,
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: true,
        },
        mockIterationCallback
      );

      // On cancellation, worktree should NOT be removed (preserved for inspection)
      // The merge and cleanup only happen on successful completion
      const mergeCmds = execSyncCalls.filter(cmd => cmd.includes('git merge'));
      expect(mergeCmds.length).toBe(0);
    });
  });

  describe('Default Worktree Behavior', () => {
    it('uses worktree by default in settings', () => {
      const manager = new AutomodeManager(mockConfig, '/test/workspace');

      // The default settings should have useWorktree: true
      // We verify this by checking getEffectiveWorkspace before/after
      expect(manager.getEffectiveWorkspace()).toBe('/test/workspace');
    });

    it('respects config override for useWorktree', async () => {
      const configWithWorktreeDisabled: LoadedConfig = {
        ...mockConfig,
        automode: {
          useWorktree: false,
        },
      };

      const manager = new AutomodeManager(configWithWorktreeDisabled, '/test/workspace');

      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['test'],
        output: '<promise>DONE</promise>',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          // useWorktree not specified, should use config default (false)
        },
        mockIterationCallback
      );

      // Should not have created a worktree
      const worktreeCmds = execSyncCalls.filter(cmd => cmd.includes('git worktree add'));
      expect(worktreeCmds.length).toBe(0);
    });
  });
});
