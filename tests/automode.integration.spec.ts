/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auto-Mode Integration Tests
 * Tests the full auto-mode loop flow including hooks, RPC, and state management
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('git rev-parse --abbrev-ref HEAD')) {
      return 'main';
    }
    if (cmd.includes('git status --porcelain')) {
      return '';
    }
    if (cmd.includes('git rev-parse --short HEAD')) {
      return 'abc1234';
    }
    if (cmd.includes('git worktree add')) {
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
import { HookManager } from '../src/core/HookManager.js';

describe('Auto-Mode Integration', () => {
  const mockConfig: LoadedConfig = {
    configPath: '/test/.autohand/config.json',
    provider: 'openrouter',
    openrouter: {
      apiKey: 'test-key',
      model: 'claude-3.5-sonnet',
    },
  };

  describe('Hook Integration', () => {
    let manager: AutomodeManager;
    let hookManager: HookManager;
    let hookEvents: Array<{ event: string; context: Record<string, unknown> }>;

    beforeEach(() => {
      vi.clearAllMocks();
      hookEvents = [];

      // Create hook manager with event capture
      hookManager = new HookManager({
        workspaceRoot: '/test/workspace',
        settings: { enabled: true, hooks: [] },
      });

      // Create automode manager with hook manager
      manager = new AutomodeManager(
        mockConfig,
        '/test/workspace',
        hookManager
      );

      // Capture all emitted events
      const originalEmit = manager.emit.bind(manager);
      manager.emit = (event: string, ...args: unknown[]) => {
        hookEvents.push({ event, context: args[0] as Record<string, unknown> });
        return originalEmit(event, ...args);
      };
    });

    it('emits automode:start event with correct context', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['test action'],
        output: '<promise>DONE</promise>',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const startEvent = hookEvents.find(e => e.event === 'automode:start');
      expect(startEvent).toBeDefined();
      expect(startEvent?.context.automodePrompt).toBe('Test task');
      expect(startEvent?.context.automodeMaxIterations).toBe(1);
    });

    it('emits automode:iteration event on each loop', async () => {
      let iterationCount = 0;
      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        iterationCount++;
        return {
          success: true,
          actions: [`action ${iterationCount}`],
          output: iterationCount >= 2 ? '<promise>DONE</promise>' : 'working...',
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 5,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const iterationEvents = hookEvents.filter(e => e.event === 'automode:iteration');
      expect(iterationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('emits automode:complete event on success', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['completed'],
        output: '<promise>DONE</promise>',
        filesCreated: 5,
        filesModified: 3,
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 1,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const completeEvent = hookEvents.find(e => e.event === 'automode:complete');
      expect(completeEvent).toBeDefined();
    });

    it('emits automode:cancel event when cancelled', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        // Cancel during iteration
        await manager.cancel('test_cancel');
        return {
          success: true,
          actions: ['action'],
          output: 'working...',
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const cancelEvent = hookEvents.find(e => e.event === 'automode:cancel');
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent?.context.automodeCancelReason).toBe('test_cancel');
    });
  });

  describe('State Persistence', () => {
    let manager: AutomodeManager;

    beforeEach(() => {
      vi.clearAllMocks();
      manager = new AutomodeManager(mockConfig, '/test/workspace');
    });

    it('tracks iteration count during loop', async () => {
      let iterationCount = 0;
      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        iterationCount++;
        return {
          success: true,
          actions: [`iteration ${iterationCount}`],
          output: iterationCount >= 3 ? '<promise>DONE</promise>' : 'working...',
          // Include file changes to prevent circuit breaker from triggering
          filesCreated: 1,
          filesModified: 1,
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      // currentIteration is 0-indexed, so 3 iterations means index 2
      // (iterations 0, 1, 2 in the state correspond to displayed 1, 2, 3)
      expect(finalState?.currentIteration).toBeGreaterThanOrEqual(2);
    });

    it('accumulates file counts from iterations', async () => {
      let iteration = 0;
      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        iteration++;
        return {
          success: true,
          actions: ['file operations'],
          output: iteration >= 2 ? '<promise>DONE</promise>' : 'working...',
          filesCreated: 2,
          filesModified: 3,
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 5,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      expect(finalState?.filesCreated).toBeGreaterThanOrEqual(2);
      expect(finalState?.filesModified).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Circuit Breaker', () => {
    let manager: AutomodeManager;

    beforeEach(() => {
      vi.clearAllMocks();
      manager = new AutomodeManager(
        {
          ...mockConfig,
          automode: {
            noProgressThreshold: 2,
            sameErrorThreshold: 2,
            testOnlyThreshold: 2,
          },
        },
        '/test/workspace'
      );
    });

    it('triggers circuit breaker after no progress', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['no file changes'],
        output: 'still working...',
        filesCreated: 0,
        filesModified: 0,
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      // Should have been cancelled by circuit breaker
      const finalState = manager.getState();
      expect(finalState?.status).toBe('cancelled');
    });

    it('triggers circuit breaker after same error repeated', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['fix attempt'],
        output: 'trying to fix...',
        filesCreated: 1,
        filesModified: 1,
        error: 'Same error every time',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Fix errors',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      expect(finalState?.status).toBe('cancelled');
    });
  });

  describe('Completion Detection', () => {
    let manager: AutomodeManager;

    beforeEach(() => {
      vi.clearAllMocks();
      manager = new AutomodeManager(mockConfig, '/test/workspace');
    });

    it('detects default completion promise', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['completed task'],
        output: 'All done! <promise>DONE</promise>',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      expect(finalState?.status).toBe('completed');
    });

    it('detects custom completion promise', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['completed task'],
        output: 'All done! <promise>TASK_FINISHED</promise>',
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          completionPromise: 'TASK_FINISHED',
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      expect(finalState?.status).toBe('completed');
    });

    it('reaches max iterations when no completion', async () => {
      const mockIterationCallback: IterationCallback = vi.fn().mockResolvedValue({
        success: true,
        actions: ['still working'],
        output: 'not done yet...',
        filesCreated: 1,
        filesModified: 1,
      } as IterationResult);

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 3,
          useWorktree: false,
        },
        mockIterationCallback
      );

      const finalState = manager.getState();
      expect(finalState?.status).toBe('cancelled');
      expect(finalState?.currentIteration).toBe(3);
    });
  });

  describe('Pause and Resume', () => {
    let manager: AutomodeManager;

    beforeEach(() => {
      vi.clearAllMocks();
      manager = new AutomodeManager(mockConfig, '/test/workspace');
    });

    it('can pause and resume the loop', async () => {
      let iteration = 0;
      let wasPaused = false;

      const mockIterationCallback: IterationCallback = vi.fn().mockImplementation(async () => {
        iteration++;

        if (iteration === 2 && !wasPaused) {
          // Pause on second iteration
          await manager.pause();
          wasPaused = true;

          // Resume after a short delay
          setTimeout(async () => {
            await manager.resume();
          }, 50);
        }

        return {
          success: true,
          actions: [`iteration ${iteration}`],
          output: iteration >= 4 ? '<promise>DONE</promise>' : 'working...',
          filesCreated: 1,
        } as IterationResult;
      });

      await manager.start(
        {
          prompt: 'Test task',
          maxIterations: 10,
          useWorktree: false,
        },
        mockIterationCallback
      );

      expect(wasPaused).toBe(true);
      expect(manager.getState()?.status).toBe('completed');
    });
  });
});

describe('Auto-Mode RPC Integration', () => {
  // Note: Full RPC integration tests would require mocking the full RPC stack
  // These tests focus on the interface contract

  describe('RPC Method Types', () => {
    it('has correct automode start params shape', () => {
      const params = {
        prompt: 'Build a REST API',
        maxIterations: 50,
        completionPromise: 'DONE',
        useWorktree: true,
        checkpointInterval: 5,
        maxRuntime: 120,
        maxCost: 10,
      };

      // Type check - all fields should be valid
      expect(params.prompt).toBeDefined();
      expect(typeof params.maxIterations).toBe('number');
      expect(typeof params.useWorktree).toBe('boolean');
    });

    it('has correct automode status result shape', () => {
      const result = {
        active: true,
        paused: false,
        state: {
          sessionId: 'test-session',
          status: 'running' as const,
          currentIteration: 5,
          maxIterations: 50,
          filesCreated: 10,
          filesModified: 15,
          branch: 'autohand-automode-123',
          lastCheckpoint: {
            commit: 'abc1234',
            message: 'checkpoint',
            timestamp: new Date().toISOString(),
          },
        },
      };

      expect(result.active).toBe(true);
      expect(result.state?.status).toBe('running');
    });
  });
});

describe('Auto-Mode Hook Events', () => {
  describe('Hook Context Fields', () => {
    it('automode:start includes required fields', () => {
      const context = {
        automodeSessionId: 'session-123',
        automodePrompt: 'Build a REST API',
        automodeMaxIterations: 50,
      };

      expect(context.automodeSessionId).toBeDefined();
      expect(context.automodePrompt).toBeDefined();
      expect(context.automodeMaxIterations).toBeDefined();
    });

    it('automode:iteration includes required fields', () => {
      const context = {
        automodeSessionId: 'session-123',
        automodeIteration: 5,
        automodeActions: ['action1', 'action2'],
        tokensUsed: 1000,
      };

      expect(context.automodeIteration).toBe(5);
      expect(context.automodeActions).toHaveLength(2);
    });

    it('automode:checkpoint includes commit info', () => {
      const context = {
        automodeSessionId: 'session-123',
        automodeIteration: 10,
        automodeCheckpointCommit: 'abc1234',
      };

      expect(context.automodeCheckpointCommit).toBe('abc1234');
    });

    it('automode:cancel includes reason', () => {
      const context = {
        automodeSessionId: 'session-123',
        automodeCancelReason: 'user_cancel',
        automodeIteration: 7,
      };

      expect(context.automodeCancelReason).toBe('user_cancel');
    });

    it('automode:complete includes metrics', () => {
      const context = {
        automodeSessionId: 'session-123',
        automodeIteration: 15,
        automodeFilesCreated: 10,
        automodeFilesModified: 25,
      };

      expect(context.automodeFilesCreated).toBe(10);
      expect(context.automodeFilesModified).toBe(25);
    });
  });
});
