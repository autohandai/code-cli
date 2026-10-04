/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runAgentInteractiveLoop,
  type AgentLifecycleHost,
} from '../../../src/core/agent/AgentLifecycleRunner.js';
import type { InteractionMode } from '../../../src/core/agent/InteractionModeController.js';
import { getPlanModeManager } from '../../../src/commands/plan.js';

function createInkHost(instructions: string[], startingMode: InteractionMode) {
  let mode = startingMode;
  const userMessages: string[] = [];
  const host = {
    useInkRenderer: true,
    inkRenderer: {
      isRunning: () => true,
      addUserMessage: (message: string) => { userMessages.push(message); },
      hasQueuedInstructions: () => false,
      getQueueCount: () => 0,
    },
    pendingInkInstructions: instructions.map((text) => ({ text, echoInTranscript: false })),
    shouldExit: false,
    persistentInputActiveTurn: false,
    persistentInput: { hasQueued: () => false, getCurrentInput: () => '', stop: vi.fn() },
    runtime: { workspaceRoot: '/workspace', options: {}, config: { ui: {} } },
    logQueuedProcessingMessage: vi.fn(),
    ensureInitComplete: vi.fn(async () => {}),
    flushMcpStartupSummaryIfPending: vi.fn(),
    runInstruction: vi.fn(async () => true),
    telemetryManager: { trackCommand: vi.fn(async () => {}), recordInteraction: vi.fn() },
    feedbackManager: { shouldPrompt: vi.fn(() => null), recordInteraction: vi.fn() },
    sessionManager: { getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })) },
    parseSlashCommand: (instruction: string) => {
      const [command, ...args] = instruction.split(' ');
      return { command, args };
    },
    isSlashCommandSupported: () => true,
    getInteractionMode: vi.fn(() => mode),
    setInteractionMode: vi.fn((next: InteractionMode) => {
      mode = next;
      return mode;
    }),
    setComposerIdle: vi.fn(),
    clearComposerInput: vi.fn(),
    closeSession: vi.fn(async () => {}),
    lastErrorMessage: null,
    consecutiveErrorCount: 0,
    // A gap in this partial host must fail the test, not be swallowed by the loop's error path.
    getDisplayErrorMessage: (error: unknown) => { throw error; },
  };
  return { host: host as unknown as AgentLifecycleHost & typeof host, userMessages, currentMode: () => mode };
}

describe('/plan from the Ink composer', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getPlanModeManager().disable();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    getPlanModeManager().disable();
  });

  it('switches the session out of auto mode into plan mode through the mode controller', async () => {
    const { host, currentMode, userMessages } = createInkHost(['/plan on', '/quit'], 'automode');

    await runAgentInteractiveLoop(host);

    expect(host.setInteractionMode).toHaveBeenCalledExactlyOnceWith('plan');
    expect(currentMode()).toBe('plan');
    expect(userMessages.join('\n')).toContain('Plan mode active');
  });

  it('returns to the default mode on /plan off', async () => {
    const { host, currentMode } = createInkHost(['/plan off', '/quit'], 'plan');

    await runAgentInteractiveLoop(host);

    expect(host.setInteractionMode).toHaveBeenCalledExactlyOnceWith('default');
    expect(currentMode()).toBe('default');
  });

  it('reports plan mode as already on from the controller, not from a stale manager flag', async () => {
    const { host, userMessages } = createInkHost(['/plan on', '/quit'], 'plan');

    await runAgentInteractiveLoop(host);

    expect(host.setInteractionMode).not.toHaveBeenCalled();
    expect(userMessages.join('\n')).toContain('already enabled');
  });

  it('still toggles the plan manager directly on a host without a mode controller', async () => {
    const { host } = createInkHost(['/plan on', '/quit'], 'default');
    Object.assign(host, { getInteractionMode: undefined, setInteractionMode: undefined });

    await runAgentInteractiveLoop(host);

    expect(getPlanModeManager().isEnabled()).toBe(true);
  });
});
