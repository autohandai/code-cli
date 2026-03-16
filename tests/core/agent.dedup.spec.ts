/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for agent.ts deduplication refactoring:
 * - initializeManagers() shared helper
 * - resumeSession initializing all managers (bug fix)
 * - withModalPause() extracted helper
 * - inline terminal-regions checks replaced with method
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';

/* ── Helpers ──────────────────────────────────────────────── */

function makeStubAgent(): any {
  const agent = Object.create(AutohandAgent.prototype) as any;

  agent.sessionManager = { initialize: vi.fn().mockResolvedValue(undefined) };
  agent.projectManager = { initialize: vi.fn().mockResolvedValue(undefined) };
  agent.memoryManager = { initialize: vi.fn().mockResolvedValue(undefined) };
  agent.skillsRegistry = { initialize: vi.fn().mockResolvedValue(undefined) };
  agent.hookManager = { initialize: vi.fn().mockResolvedValue(undefined) };
  agent.workspaceFileCollector = {
    collectWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
  };

  return agent;
}

function makeModalAgent(): any {
  const agent = Object.create(AutohandAgent.prototype) as any;

  const spinner = {
    isSpinning: true,
    stop: vi.fn(),
    start: vi.fn(),
  };

  agent.runtime = { spinner };
  agent.persistentInput = {
    pause: vi.fn(),
    resume: vi.fn(),
  };
  agent.inkRenderer = null;
  agent.statusInterval = null;
  agent.stopStatusUpdates = vi.fn();
  agent.startStatusUpdates = vi.fn();
  agent.resumeSpinnerAfterModalPause = vi.fn();

  return agent;
}

/* ── Tests ────────────────────────────────────────────────── */

describe('agent.ts deduplication', () => {
  // =========================================================================
  // initializeManagers — shared helper
  // =========================================================================
  describe('initializeManagers()', () => {
    it('initializes all 6 managers in parallel', async () => {
      const agent = makeStubAgent();

      await (agent as any).initializeManagers();

      expect(agent.sessionManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.projectManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.memoryManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.skillsRegistry.initialize).toHaveBeenCalledTimes(1);
      expect(agent.hookManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.workspaceFileCollector.collectWorkspaceFiles).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from any manager', async () => {
      const agent = makeStubAgent();
      agent.skillsRegistry.initialize.mockRejectedValue(new Error('init failed'));

      await expect((agent as any).initializeManagers()).rejects.toThrow('init failed');
    });
  });

  // =========================================================================
  // resumeSession — must initialize ALL managers (bug fix regression)
  // =========================================================================
  describe('resumeSession manager initialization', () => {
    it('initializes skillsRegistry and hookManager (previously missing)', async () => {
      const agent = makeStubAgent();
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Stub just enough for resumeSession to run past the init phase
      agent.sessionManager.loadSession = vi.fn().mockResolvedValue({
        getMessages: () => [],
        metadata: { model: 'test', sessionId: 'sess-1' },
      });
      agent.resetConversationContext = vi.fn().mockResolvedValue(undefined);
      agent.conversation = {
        history: () => [],
        addMessage: vi.fn(),
        addSystemNote: vi.fn(),
      };
      agent.injectProjectKnowledge = vi.fn().mockResolvedValue(undefined);
      agent.updateContextUsage = vi.fn();
      agent.telemetryManager = {
        startSession: vi.fn().mockResolvedValue(undefined),
        trackError: vi.fn().mockResolvedValue(undefined),
      };
      agent.activeProvider = 'openrouter';
      agent.runInteractiveLoop = vi.fn().mockResolvedValue(undefined);

      await agent.resumeSession('sess-1');

      consoleSpy.mockRestore();

      // The critical assertions: these two were missing before the fix
      expect(agent.skillsRegistry.initialize).toHaveBeenCalledTimes(1);
      expect(agent.hookManager.initialize).toHaveBeenCalledTimes(1);

      // All other managers should also be initialized
      expect(agent.sessionManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.projectManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.memoryManager.initialize).toHaveBeenCalledTimes(1);
      expect(agent.workspaceFileCollector.collectWorkspaceFiles).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // withModalPause — extracted helper
  // =========================================================================
  describe('withModalPause()', () => {
    it('pauses and resumes persistentInput around the callback', async () => {
      const agent = makeModalAgent();

      const result = await (agent as any).withModalPause(async () => 'ok');

      expect(result).toBe('ok');
      expect(agent.persistentInput.pause).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.resume).toHaveBeenCalledTimes(1);

      // pause before resume
      const pauseOrder = agent.persistentInput.pause.mock.invocationCallOrder[0];
      const resumeOrder = agent.persistentInput.resume.mock.invocationCallOrder[0];
      expect(pauseOrder).toBeLessThan(resumeOrder);
    });

    it('stops and restarts spinner', async () => {
      const agent = makeModalAgent();

      await (agent as any).withModalPause(async () => {});

      expect(agent.runtime.spinner.stop).toHaveBeenCalledTimes(1);
      expect(agent.resumeSpinnerAfterModalPause).toHaveBeenCalledTimes(1);
    });

    it('does not restart spinner when it was not spinning', async () => {
      const agent = makeModalAgent();
      agent.runtime.spinner.isSpinning = false;

      await (agent as any).withModalPause(async () => {});

      expect(agent.runtime.spinner.stop).not.toHaveBeenCalled();
      expect(agent.resumeSpinnerAfterModalPause).not.toHaveBeenCalled();
    });

    it('pauses and resumes inkRenderer when present', async () => {
      const agent = makeModalAgent();
      agent.inkRenderer = {
        pause: vi.fn(),
        resume: vi.fn(),
      };

      await (agent as any).withModalPause(async () => {});

      expect(agent.inkRenderer.pause).toHaveBeenCalledTimes(1);
      expect(agent.inkRenderer.resume).toHaveBeenCalledTimes(1);
    });

    it('resumes even when callback throws', async () => {
      const agent = makeModalAgent();

      await expect(
        (agent as any).withModalPause(async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      // Spinner was stopped before the callback ran
      expect(agent.runtime.spinner.stop).toHaveBeenCalledTimes(1);

      // Everything still restored in finally block
      expect(agent.persistentInput.resume).toHaveBeenCalledTimes(1);
      expect(agent.resumeSpinnerAfterModalPause).toHaveBeenCalledTimes(1);
      expect(agent.startStatusUpdates).toHaveBeenCalledTimes(1);
    });

    it('stops and starts status updates', async () => {
      const agent = makeModalAgent();

      await (agent as any).withModalPause(async () => {});

      expect(agent.stopStatusUpdates).toHaveBeenCalledTimes(1);
      expect(agent.startStatusUpdates).toHaveBeenCalledTimes(1);

      const stopOrder = agent.stopStatusUpdates.mock.invocationCallOrder[0];
      const startOrder = agent.startStatusUpdates.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(startOrder);
    });

    it('works with no spinner at all', async () => {
      const agent = makeModalAgent();
      agent.runtime = { spinner: null };

      const result = await (agent as any).withModalPause(async () => 42);

      expect(result).toBe(42);
      expect(agent.persistentInput.pause).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.resume).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // isUsingTerminalRegionsForActiveTurn — inline checks replaced
  // =========================================================================
  describe('isUsingTerminalRegionsForActiveTurn()', () => {
    let originalEnv: string | undefined;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalEnv;
      }
    });

    it('returns true when persistentInputActiveTurn + regions enabled + no ink', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = false;

      expect((agent as any).isUsingTerminalRegionsForActiveTurn()).toBe(true);
    });

    it('returns false when regions are disabled via env', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '0';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = false;

      expect((agent as any).isUsingTerminalRegionsForActiveTurn()).toBe(false);
    });

    it('returns false when using ink renderer', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = true;

      expect((agent as any).isUsingTerminalRegionsForActiveTurn()).toBe(false);
    });

    it('returns false when not in active turn', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = false;
      agent.useInkRenderer = false;

      expect((agent as any).isUsingTerminalRegionsForActiveTurn()).toBe(false);
    });
  });

  // =========================================================================
  // setUIStatus — routes to persistent input when terminal regions active
  // =========================================================================
  describe('setUIStatus() terminal regions routing', () => {
    let originalEnv: string | undefined;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AUTOHAND_TERMINAL_REGIONS;
      } else {
        process.env.AUTOHAND_TERMINAL_REGIONS = originalEnv;
      }
    });

    it('routes status to persistent input activity line when regions active', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = false;
      agent.inkRenderer = null;
      agent.runtime = { spinner: null };
      agent.persistentInput = {
        setActivityLine: vi.fn(),
      };

      (agent as any).setUIStatus('Reasoning with the AI...');

      expect(agent.persistentInput.setActivityLine).toHaveBeenCalledWith(
        'Reasoning with the AI...'
      );
    });

    it('does NOT route to persistent input when regions are disabled', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '0';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = false;
      agent.inkRenderer = null;
      agent.runtime = { spinner: null };
      agent.persistentInput = {
        setActivityLine: vi.fn(),
      };

      (agent as any).setUIStatus('Reasoning...');

      expect(agent.persistentInput.setActivityLine).not.toHaveBeenCalled();
    });

    it('prefers ink renderer over persistent input', () => {
      originalEnv = process.env.AUTOHAND_TERMINAL_REGIONS;
      process.env.AUTOHAND_TERMINAL_REGIONS = '1';

      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.persistentInputActiveTurn = true;
      agent.useInkRenderer = false;
      agent.inkRenderer = {
        setStatus: vi.fn(),
      };
      agent.runtime = { spinner: null };
      agent.persistentInput = {
        setActivityLine: vi.fn(),
      };

      (agent as any).setUIStatus('Working...');

      expect(agent.inkRenderer.setStatus).toHaveBeenCalledWith('Working...');
      expect(agent.persistentInput.setActivityLine).not.toHaveBeenCalled();
    });
  });
});
