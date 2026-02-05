/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type {
  AutomodeSessionState,
  AutomodeIterationLog,
  LoadedConfig,
} from '../src/types.js';

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
    return '';
  }),
  spawn: vi.fn(() => {
    const mockProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = vi.fn();

    setTimeout(() => {
      mockProcess.emit('close', 0);
    }, 10);

    return mockProcess;
  }),
}));

// Import after mocks
import { AutomodeState, hashError } from '../src/core/AutomodeState.js';
import { generateChangelog, getChangelogPath } from '../src/core/AutomodeChangelog.js';
import { AutomodeManager, getAutomodeOptions } from '../src/core/AutomodeManager.js';

describe('AutomodeState', () => {
  let state: AutomodeState;

  beforeEach(() => {
    state = new AutomodeState('/test/workspace');
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('initializes with empty state', () => {
      expect(state.getState()).toBeNull();
      expect(state.getIterations()).toEqual([]);
    });

    it('initializes state with correct properties', async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Build a REST API',
        maxIterations: 50,
        completionPromise: 'DONE',
      });

      const currentState = state.getState();
      expect(currentState).not.toBeNull();
      expect(currentState?.sessionId).toBe('test-session');
      expect(currentState?.prompt).toBe('Build a REST API');
      expect(currentState?.maxIterations).toBe(50);
      expect(currentState?.status).toBe('running');
      expect(currentState?.currentIteration).toBe(0);
      expect(currentState?.filesCreated).toBe(0);
      expect(currentState?.filesModified).toBe(0);
    });

    it('initializes with branch and worktree path', async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Build a REST API',
        maxIterations: 50,
        completionPromise: 'DONE',
        branch: 'autohand-automode-123',
        worktreePath: '/tmp/worktree-abc',
      });

      const currentState = state.getState();
      expect(currentState?.branch).toBe('autohand-automode-123');
      expect(currentState?.worktreePath).toBe('/tmp/worktree-abc');
    });
  });

  describe('recordIteration', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('increments iteration count', async () => {
      await state.recordIteration({
        timestamp: new Date().toISOString(),
        actions: ['action1', 'action2'],
      });

      expect(state.getState()?.currentIteration).toBe(1);
      expect(state.getIterations()).toHaveLength(1);
    });

    it('records actions in iteration log', async () => {
      const timestamp = new Date().toISOString();
      await state.recordIteration({
        timestamp,
        actions: ['created file.ts', 'ran tests'],
        tokensUsed: 1000,
        cost: 0.05,
      });

      const iterations = state.getIterations();
      expect(iterations[0]).toEqual({
        iteration: 1,
        timestamp,
        actions: ['created file.ts', 'ran tests'],
        tokensUsed: 1000,
        cost: 0.05,
      });
    });
  });

  describe('updateFileCounts', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('adds to file counts', async () => {
      await state.updateFileCounts(3, 5);

      expect(state.getState()?.filesCreated).toBe(3);
      expect(state.getState()?.filesModified).toBe(5);
    });

    it('accumulates file counts', async () => {
      await state.updateFileCounts(2, 3);
      await state.updateFileCounts(1, 2);

      expect(state.getState()?.filesCreated).toBe(3);
      expect(state.getState()?.filesModified).toBe(5);
    });
  });

  describe('setStatus', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('updates status to completed', async () => {
      await state.setStatus('completed', 'completion');

      const currentState = state.getState();
      expect(currentState?.status).toBe('completed');
      expect(currentState?.cancelReason).toBe('completion');
    });

    it('updates status with error message', async () => {
      await state.setStatus('failed', 'error', 'Something went wrong');

      const currentState = state.getState();
      expect(currentState?.status).toBe('failed');
      expect(currentState?.cancelReason).toBe('error');
      expect(currentState?.errorMessage).toBe('Something went wrong');
    });
  });

  describe('recordCheckpoint', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('records checkpoint in state', async () => {
      await state.recordCheckpoint('abc1234', 'automode: checkpoint at iteration 5');

      const currentState = state.getState();
      expect(currentState?.lastCheckpoint).toEqual({
        commit: 'abc1234',
        message: 'automode: checkpoint at iteration 5',
        timestamp: expect.any(String),
      });
    });
  });

  describe('checkCompletionPromise', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('detects completion promise in output', () => {
      const output = 'Task completed! <promise>DONE</promise>';
      expect(state.checkCompletionPromise(output)).toBe(true);
    });

    it('returns false when no promise found', () => {
      const output = 'Still working on it...';
      expect(state.checkCompletionPromise(output)).toBe(false);
    });

    it('handles custom completion promise', async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'TASK_COMPLETE',
      });

      expect(state.checkCompletionPromise('<promise>TASK_COMPLETE</promise>')).toBe(true);
      expect(state.checkCompletionPromise('<promise>DONE</promise>')).toBe(false);
    });
  });

  describe('checkCircuitBreaker', () => {
    beforeEach(async () => {
      await state.initialize({
        sessionId: 'test-session',
        prompt: 'Test task',
        maxIterations: 10,
        completionPromise: 'DONE',
      });
    });

    it('triggers after no progress threshold', () => {
      const thresholds = { noProgress: 3, sameError: 5, testOnly: 3 };

      // First two iterations without progress
      expect(state.checkCircuitBreaker(false, null, false, thresholds).triggered).toBe(false);
      expect(state.checkCircuitBreaker(false, null, false, thresholds).triggered).toBe(false);

      // Third iteration triggers
      const result = state.checkCircuitBreaker(false, null, false, thresholds);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('No file changes');
    });

    it('resets no progress counter when changes made', () => {
      const thresholds = { noProgress: 3, sameError: 5, testOnly: 3 };

      // Two iterations without progress
      state.checkCircuitBreaker(false, null, false, thresholds);
      state.checkCircuitBreaker(false, null, false, thresholds);

      // One iteration with changes resets counter
      state.checkCircuitBreaker(true, null, false, thresholds);

      // Two more without progress shouldn't trigger
      expect(state.checkCircuitBreaker(false, null, false, thresholds).triggered).toBe(false);
      expect(state.checkCircuitBreaker(false, null, false, thresholds).triggered).toBe(false);
    });

    it('triggers after same error threshold', () => {
      const thresholds = { noProgress: 3, sameError: 3, testOnly: 3 };
      const errorHash = 'same-error-hash';

      // Progress but same error repeatedly
      expect(state.checkCircuitBreaker(true, errorHash, false, thresholds).triggered).toBe(false);
      expect(state.checkCircuitBreaker(true, errorHash, false, thresholds).triggered).toBe(false);

      // Third time triggers
      const result = state.checkCircuitBreaker(true, errorHash, false, thresholds);
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('Same error');
    });

    it('resets error counter on different error', () => {
      const thresholds = { noProgress: 3, sameError: 3, testOnly: 3 };

      state.checkCircuitBreaker(true, 'error1', false, thresholds);
      state.checkCircuitBreaker(true, 'error1', false, thresholds);

      // Different error resets
      state.checkCircuitBreaker(true, 'error2', false, thresholds);
      state.checkCircuitBreaker(true, 'error2', false, thresholds);

      // Third of new error shouldn't trigger if we reset
      expect(state.checkCircuitBreaker(true, 'error2', false, thresholds).triggered).toBe(true);
    });
  });

  describe('hashError', () => {
    it('creates consistent hash for same error', () => {
      const error = 'TypeError: Cannot read property x of undefined';
      expect(hashError(error)).toBe(hashError(error));
    });

    it('creates different hash for different errors', () => {
      const error1 = 'Error 1';
      const error2 = 'Error 2';
      expect(hashError(error1)).not.toBe(hashError(error2));
    });

    it('returns short hash', () => {
      const hash = hashError('Some error message');
      // Hash is a substring of the full sha256 hash
      expect(hash.length).toBeLessThanOrEqual(20);
      expect(hash.length).toBeGreaterThan(0);
    });
  });
});

describe('AutomodeChangelog', () => {
  describe('generateChangelog', () => {
    const mockState: AutomodeSessionState = {
      sessionId: 'test-session-123',
      prompt: 'Build a REST API for todos',
      startedAt: '2026-01-06T14:30:00Z',
      currentIteration: 5,
      maxIterations: 50,
      completionPromise: 'DONE',
      status: 'completed',
      filesCreated: 8,
      filesModified: 15,
    };

    const mockIterations: AutomodeIterationLog[] = [
      {
        iteration: 1,
        timestamp: '2026-01-06T14:30:00Z',
        actions: ['Created project structure', 'Added Express server'],
      },
      {
        iteration: 2,
        timestamp: '2026-01-06T14:32:00Z',
        actions: ['Implemented GET endpoint'],
        tokensUsed: 1500,
      },
    ];

    const mockCommits = [
      { hash: 'abc1234', message: 'feat: initialize project' },
      { hash: 'def5678', message: 'feat: add GET endpoint' },
    ];

    it('generates changelog path', () => {
      const path = getChangelogPath('/test/workspace');
      expect(path).toBe('/test/workspace/AUTOMODE_CHANGELOG.md');
    });

    it('generates changelog with correct structure', async () => {
      const fs = await import('fs-extra');

      await generateChangelog('/test/workspace', mockState, mockIterations, mockCommits);

      expect(fs.default.writeFile).toHaveBeenCalled();
      const [, content] = (fs.default.writeFile as any).mock.calls[0];

      // Check key sections
      expect(content).toContain('# Auto-Mode Session Report');
      expect(content).toContain('## Summary');
      expect(content).toContain('Build a REST API for todos');
      expect(content).toContain('Completed successfully');
      expect(content).toContain('## Iterations');
      expect(content).toContain('Iteration 1');
      expect(content).toContain('Created project structure');
      expect(content).toContain('## Final State');
      expect(content).toContain('Files Created:** 8');
      expect(content).toContain('## Commits Made');
      expect(content).toContain('abc1234');
    });
  });
});

describe('getAutomodeOptions', () => {
  const baseConfig: LoadedConfig = {
    configPath: '/test/.autohand/config.json',
    provider: 'openrouter',
    openrouter: {
      apiKey: 'test-key',
      model: 'claude-3.5-sonnet',
    },
  };

  it('returns null when autoMode is not set', () => {
    const result = getAutomodeOptions({}, baseConfig);
    expect(result).toBeNull();
  });

  it('returns options with prompt', () => {
    const result = getAutomodeOptions({ autoMode: 'Build a REST API' }, baseConfig);
    expect(result).not.toBeNull();
    expect(result?.prompt).toBe('Build a REST API');
  });

  it('uses CLI options over config', () => {
    const configWithAutomode: LoadedConfig = {
      ...baseConfig,
      automode: {
        maxIterations: 100,
        completionPromise: 'CONFIG_DONE',
      },
    };

    const result = getAutomodeOptions(
      {
        autoMode: 'Test task',
        maxIterations: 25,
        completionPromise: 'CLI_DONE',
      },
      configWithAutomode
    );

    expect(result?.maxIterations).toBe(25);
    expect(result?.completionPromise).toBe('CLI_DONE');
  });

  it('falls back to config when CLI options not provided', () => {
    const configWithAutomode: LoadedConfig = {
      ...baseConfig,
      automode: {
        maxIterations: 100,
        completionPromise: 'CONFIG_DONE',
        checkpointInterval: 10,
      },
    };

    const result = getAutomodeOptions({ autoMode: 'Test task' }, configWithAutomode);

    expect(result?.maxIterations).toBe(100);
    expect(result?.completionPromise).toBe('CONFIG_DONE');
    expect(result?.checkpointInterval).toBe(10);
  });

  it('uses defaults when neither CLI nor config provided', () => {
    const result = getAutomodeOptions({ autoMode: 'Test task' }, baseConfig);

    expect(result?.maxIterations).toBe(50);
    expect(result?.completionPromise).toBe('DONE');
    expect(result?.useWorktree).toBe(true);
    expect(result?.checkpointInterval).toBe(5);
    expect(result?.maxRuntime).toBe(120);
    expect(result?.maxCost).toBe(10);
  });

  it('respects noWorktree flag', () => {
    const result = getAutomodeOptions(
      { autoMode: 'Test task', noWorktree: true },
      baseConfig
    );

    expect(result?.useWorktree).toBe(false);
  });
});

describe('AutomodeManager', () => {
  let manager: AutomodeManager;
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
    manager = new AutomodeManager(mockConfig, '/test/workspace');
  });

  describe('isActive', () => {
    it('returns false initially', () => {
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('isPausedState', () => {
    it('returns false initially', () => {
      expect(manager.isPausedState()).toBe(false);
    });
  });

  describe('getState', () => {
    it('returns null initially', () => {
      expect(manager.getState()).toBeNull();
    });
  });

  describe('events', () => {
    it('emits events on EventEmitter', () => {
      const listener = vi.fn();
      manager.on('automode:start', listener);

      // Trigger event internally (would happen during start)
      manager.emit('automode:start', { sessionId: 'test' });

      expect(listener).toHaveBeenCalledWith({ sessionId: 'test' });
    });
  });

  describe('cancel', () => {
    it('does nothing when not running', async () => {
      await manager.cancel('user_cancel');
      // Should not throw
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('pause/resume', () => {
    it('does nothing when not running', async () => {
      await manager.pause();
      await manager.resume();
      // Should not throw
      expect(manager.isPausedState()).toBe(false);
    });
  });
});
