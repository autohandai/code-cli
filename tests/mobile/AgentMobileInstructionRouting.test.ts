/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  runAgentInteractiveLoop,
  type AgentLifecycleHost,
} from '../../src/core/agent/AgentLifecycleRunner.js';

const mobileTurn = {
  turn: {
    workId: 'mobile-work-1',
    prompt: 'mobile prompt',
    startedAt: '2026-07-21T02:35:00.000Z',
  },
  relay: {} as never,
};

function createInteractiveHost(pendingInkInstructions: unknown[]): AgentLifecycleHost {
  const host = {
    useInkRenderer: false,
    inkRenderer: null,
    pendingInkInstructions,
    shouldExit: false,
    persistentInputActiveTurn: false,
    persistentInput: {
      hasQueued: () => false,
      getCurrentInput: () => '',
      stop: vi.fn(),
    },
    runtime: {
      workspaceRoot: '/workspace',
      options: {},
      config: {
        ui: {
          terminalBell: false,
          showCompletionNotification: false,
        },
      },
    },
    logQueuedProcessingMessage: vi.fn(),
    ensureInitComplete: vi.fn(async () => {}),
    flushMcpStartupSummaryIfPending: vi.fn(),
    runInstruction: vi.fn(async () => true),
    runPostTurnAction: vi.fn(async () => null),
    suggestionEngine: null,
    telemetryManager: {
      trackCommand: vi.fn(async () => {}),
      recordInteraction: vi.fn(),
    },
    feedbackManager: {
      shouldPrompt: vi.fn(() => null),
      recordInteraction: vi.fn(),
    },
    hookManager: {
      executeHooks: vi.fn(async () => {}),
    },
    sessionManager: {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    },
    getStatusSnapshot: vi.fn(() => ({
      tokensUsed: 0,
      tokensUsageStatus: 'actual',
    })),
    ensureStdinReady: vi.fn(),
    notificationService: {
      notify: vi.fn(async () => {}),
    },
    closeSession: vi.fn(async () => {}),
    lastErrorMessage: null,
    consecutiveErrorCount: 0,
  } as unknown as AgentLifecycleHost;

  return host;
}

describe('mobile instruction routing', () => {
  it('preserves the claimed turn when a local prompt runs first', async () => {
    const host = createInteractiveHost([
      'local prompt',
      { text: 'mobile prompt', mobileTurn },
    ]);
    host.runInstruction = vi.fn(async () => {
      if (host.runInstruction.mock.calls.length === 2) host.shouldExit = true;
      return true;
    });

    await runAgentInteractiveLoop(host);

    expect(host.runInstruction).toHaveBeenNthCalledWith(1, 'local prompt');
    expect(host.runInstruction).toHaveBeenNthCalledWith(2, 'mobile prompt', { mobileTurn });
  });

  it('preserves the claimed turn after a queued shell command', async () => {
    const host = createInteractiveHost([
      '!pwd',
      { text: 'mobile prompt', mobileTurn },
    ]);
    host.executeImmediateShellCommand = vi.fn(async () => {});
    host.runInstruction = vi.fn(async () => {
      host.shouldExit = true;
      return true;
    });

    await runAgentInteractiveLoop(host);

    expect(host.executeImmediateShellCommand).toHaveBeenCalledOnce();
    expect(host.runInstruction).toHaveBeenCalledOnce();
    expect(host.runInstruction).toHaveBeenCalledWith('mobile prompt', { mobileTurn });
  });

  it('routes a mobile shell-shaped prompt through the agent with its claimed turn', async () => {
    const shellPrompt = '!echo from-phone';
    const shellTurn = {
      ...mobileTurn,
      turn: { ...mobileTurn.turn, prompt: shellPrompt },
    };
    const host = createInteractiveHost([{
      text: shellPrompt,
      mobileTurn: shellTurn,
    }]);
    host.executeImmediateShellCommand = vi.fn(async () => {
      host.shouldExit = true;
    });
    host.runInstruction = vi.fn(async () => {
      host.shouldExit = true;
      return true;
    });

    await runAgentInteractiveLoop(host);

    expect(host.executeImmediateShellCommand).not.toHaveBeenCalled();
    expect(host.runInstruction).toHaveBeenCalledWith(shellPrompt, { mobileTurn: shellTurn });
  });

  it('routes a mobile slash-shaped prompt through the agent with its claimed turn', async () => {
    const slashPrompt = '/model';
    const slashTurn = {
      ...mobileTurn,
      turn: { ...mobileTurn.turn, prompt: slashPrompt },
    };
    const host = createInteractiveHost([{
      text: slashPrompt,
      mobileTurn: slashTurn,
    }]);
    host.parseSlashCommand = vi.fn(() => ({ command: '/model', args: [] }));
    host.isSlashCommandSupported = vi.fn(() => true);
    host.runSlashCommandWithInput = vi.fn(async () => {
      host.shouldExit = true;
      return null;
    });
    host.runInstruction = vi.fn(async () => {
      host.shouldExit = true;
      return true;
    });

    await runAgentInteractiveLoop(host);

    expect(host.runSlashCommandWithInput).not.toHaveBeenCalled();
    expect(host.runInstruction).toHaveBeenCalledWith(slashPrompt, { mobileTurn: slashTurn });
  });
});
