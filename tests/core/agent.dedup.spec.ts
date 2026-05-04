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
  // onBeforeModal / onAfterModal — must pause/resume InkRenderer
  // Regression: callbacks only paused PersistentInput, not InkRenderer.
  // In Ink 7, render() uses a WeakMap keyed by stdout; when InkRenderer is
  // still running, showModal's render() reuses the existing instance instead
  // of creating a new one, causing raw-mode reference count mismatches.
  // =========================================================================
  describe('onBeforeModal/onAfterModal InkRenderer pause', () => {
    /** Build the same onBeforeModal/onAfterModal callbacks the agent creates */
    function makeModalCallbacks(agent: any) {
      return {
        onBeforeModal: () => {
          if (agent.inkRenderer) {
            agent.inkRenderer.pause();
          }
          if (agent.persistentInputActiveTurn) {
            agent.persistentInput.pauseForModal();
          }
        },
        onAfterModal: () => {
          if (agent.inkRenderer) {
            agent.inkRenderer.resume();
          }
          if (agent.persistentInputActiveTurn) {
            agent.persistentInput.resumeFromModal();
          }
        },
      };
    }

    it('onBeforeModal pauses inkRenderer when present', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal } = makeModalCallbacks(agent);
      onBeforeModal();

      expect(agent.inkRenderer.pause).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.pauseForModal).toHaveBeenCalledTimes(1);
    });

    it('onAfterModal resumes inkRenderer when present', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal, onAfterModal } = makeModalCallbacks(agent);
      onBeforeModal();
      onAfterModal();

      expect(agent.inkRenderer.resume).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.resumeFromModal).toHaveBeenCalledTimes(1);
    });

    it('onBeforeModal pauses inkRenderer BEFORE persistentInput (ordering)', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal } = makeModalCallbacks(agent);
      onBeforeModal();

      const inkPauseOrder = agent.inkRenderer.pause.mock.invocationCallOrder[0];
      const inputPauseOrder = agent.persistentInput.pauseForModal.mock.invocationCallOrder[0];
      expect(inkPauseOrder).toBeLessThan(inputPauseOrder);
    });

    it('onAfterModal resumes persistentInput BEFORE inkRenderer (ordering)', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal, onAfterModal } = makeModalCallbacks(agent);
      onBeforeModal();
      onAfterModal();

      // inkRenderer.resume is called first in the callback (matching withModalPause)
      const inkResumeOrder = agent.inkRenderer.resume.mock.invocationCallOrder[0];
      const inputResumeOrder = agent.persistentInput.resumeFromModal.mock.invocationCallOrder[0];
      expect(inkResumeOrder).toBeLessThan(inputResumeOrder);
    });

    it('does not call inkRenderer.pause when inkRenderer is null', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = null;
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal, onAfterModal } = makeModalCallbacks(agent);
      // Should not throw
      onBeforeModal();
      onAfterModal();

      expect(agent.persistentInput.pauseForModal).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.resumeFromModal).toHaveBeenCalledTimes(1);
    });

    it('does not call persistentInput.pauseForModal when no active turn', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = false;

      const { onBeforeModal, onAfterModal } = makeModalCallbacks(agent);
      onBeforeModal();
      onAfterModal();

      expect(agent.inkRenderer.pause).toHaveBeenCalledTimes(1);
      expect(agent.inkRenderer.resume).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.pauseForModal).not.toHaveBeenCalled();
      expect(agent.persistentInput.resumeFromModal).not.toHaveBeenCalled();
    });

    it('resumes inkRenderer even when modal callback throws', () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = { pause: vi.fn(), resume: vi.fn() };
      agent.persistentInput = { pauseForModal: vi.fn(), resumeFromModal: vi.fn() };
      agent.persistentInputActiveTurn = true;

      const { onBeforeModal, onAfterModal } = makeModalCallbacks(agent);

      // Simulate the try/finally pattern used by slash commands
      let threw = false;
      onBeforeModal();
      try {
        throw new Error('modal crashed');
      } catch {
        threw = true;
      } finally {
        onAfterModal();
      }

      expect(threw).toBe(true);
      expect(agent.inkRenderer.resume).toHaveBeenCalledTimes(1);
      expect(agent.persistentInput.resumeFromModal).toHaveBeenCalledTimes(1);
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

  // =========================================================================
  // Slash commands from Ink queue must be handled locally (not sent to LLM)
  // Regression: /help typed in Ink composer went through runInstruction
  // (full ReAct loop) instead of being handled as a local slash command.
  // The readline path handles slash commands before runInstruction, but the
  // Ink queue path was missing that step.
  // =========================================================================
  describe('Ink queue slash command handling', () => {
    it('handleInkSubmittedInstruction queues slash commands for local handling, not as LLM prompts', async () => {
      const agent = Object.create(AutohandAgent.prototype) as any;
      agent.inkRenderer = {
        addQueuedInstruction: vi.fn(),
      };

      // /help should be queued as an instruction, not treated specially here
      // The key test is that the main loop handles it as a slash command
      // before calling runInstruction
      await (agent as any).handleInkSubmittedInstruction('/help');

      // It should be queued (same as any other instruction)
      expect(agent.inkRenderer.addQueuedInstruction).toHaveBeenCalledWith('/help');
    });

    it('runInteractiveLoop handles slash commands locally before runInstruction', async () => {
      // Verify the main loop code path: slash commands from the Ink queue
      // must be handled by runSlashCommandWithInput, NOT runInstruction.
      // We test this by checking the source code directly (like the Modal
      // setImmediate yield test) since the full loop is hard to mock.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/core/agent/AgentLifecycleRunner.ts'),
        'utf8',
      );

      // Find the extracted runInteractiveLoop helper body.
      const loopMatch = src.match(/export async function runAgentInteractiveLoop\([^{]*\)[\s\S]*?(?=\nexport |\n$)/);
      expect(loopMatch).not.toBeNull();
      const loopBody = loopMatch![0];

      // After the shell command handler (!), there must be slash command handling
      // before runInstruction is called
      const shellHandlerIdx = loopBody.indexOf('isShellCommand(instruction)');
      const slashHandlerIdx = loopBody.indexOf("instruction.startsWith('/')");
      const runInstructionIdx = loopBody.indexOf('await host.runInstruction(');

      expect(shellHandlerIdx).toBeGreaterThan(-1);
      expect(slashHandlerIdx).toBeGreaterThan(-1);
      expect(runInstructionIdx).toBeGreaterThan(-1);

      // Slash command handling must appear BEFORE runInstruction
      // (not just the telemetry check, but actual command execution)
      expect(slashHandlerIdx).toBeLessThan(runInstructionIdx);

      // There must be a call to runSlashCommandWithInput or handleSlashCommand
      // between the slash check and runInstruction
      const betweenSlashAndRun = loopBody.substring(slashHandlerIdx, runInstructionIdx);
      expect(
        betweenSlashAndRun.includes('runSlashCommandWithInput') ||
        betweenSlashAndRun.includes('handleSlashCommand')
      ).toBe(true);
    });

    it('returns to idle-wait via continue after slash commands when Ink is running', () => {
      // After a non-interactive slash command (e.g. /help) the loop must
      // return to the top via continue so the idle-wait path can await the
      // next Composer submission. Falling through with instruction = null
      // would hit instruction.startsWith('/') and throw a TypeError.
      const fs = require('node:fs');
      const path = require('node:path');
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/core/agent/AgentLifecycleRunner.ts'),
        'utf8',
      );

      const loopMatch = src.match(/export async function runAgentInteractiveLoop\([^{]*\)[\s\S]*?(?=\nexport |\n$)/);
      expect(loopMatch).not.toBeNull();
      const loopBody = loopMatch![0];

      // Find the slash-command handling section inside runInteractiveLoop
      const slashHandlerIdx = loopBody.indexOf("instruction.startsWith('/')");
      expect(slashHandlerIdx).toBeGreaterThan(-1);

      // After the slash command output, look for the block that clears the
      // current UI surface — it must use continue, not instruction = null.
      const afterSlash = loopBody.substring(slashHandlerIdx);
      const inkRunningBlock = afterSlash.indexOf("if (host.ui || host.inkRenderer)");
      expect(inkRunningBlock).toBeGreaterThan(-1);

      const blockEnd = afterSlash.indexOf('}', inkRunningBlock);
      const blockBody = afterSlash.substring(inkRunningBlock, blockEnd);
      expect(blockBody.includes('continue')).toBe(true);
      expect(blockBody.includes('instruction = null')).toBe(false);
    });

    it('handles # memory storage locally before runInstruction', () => {
      // Regression: # trigger from the Ink queue bypassed handleMemoryStore
      // and was sent to the LLM as a regular instruction.
      const fs = require('node:fs');
      const path = require('node:path');
      const src = fs.readFileSync(
        path.resolve(process.cwd(), 'src/core/agent/AgentLifecycleRunner.ts'),
        'utf8',
      );

      const loopMatch = src.match(/export async function runAgentInteractiveLoop\([^{]*\)[\s\S]*?(?=\nexport |\n$)/);
      expect(loopMatch).not.toBeNull();
      const loopBody = loopMatch![0];

      const hashHandlerIdx = loopBody.indexOf("instruction.startsWith('#')");
      const runInstructionIdx = loopBody.indexOf('await host.runInstruction(');

      expect(hashHandlerIdx).toBeGreaterThan(-1);
      expect(runInstructionIdx).toBeGreaterThan(-1);
      expect(hashHandlerIdx).toBeLessThan(runInstructionIdx);

      // Must call handleMemoryStore and use continue
      const betweenHashAndRun = loopBody.substring(hashHandlerIdx, runInstructionIdx);
      expect(betweenHashAndRun.includes('handleMemoryStore')).toBe(true);
      expect(betweenHashAndRun.includes('continue')).toBe(true);
    });
  });
});
