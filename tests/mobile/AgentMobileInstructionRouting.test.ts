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
import {
  enqueueInteractiveInstruction,
  enqueueMobileComposerCommand,
} from '../../src/core/agent/AgentDependencyComposer.js';
import { InkRenderer } from '../../src/ui/ink/InkRenderer.js';
import { PersistentInput } from '../../src/ui/persistentInput.js';

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
    setComposerIdle: vi.fn(),
    lastErrorMessage: null,
    consecutiveErrorCount: 0,
  } as unknown as AgentLifecycleHost;

  return host;
}

describe('mobile instruction routing', () => {
  it('executes a typed mobile command through the canonical slash handler only', async () => {
    const completion = vi.fn();
    const host = createInteractiveHost([{
      mobileCommand: {
        command: '/plan',
        args: ['status'],
        completion: (outcome: unknown) => {
          completion(outcome);
          host.shouldExit = true;
        },
      },
    }]);
    host.handleSlashCommand = vi.fn(async () => 'Plan mode is enabled.');
    host.runSlashCommandWithInput = vi.fn(async () => null);

    await runAgentInteractiveLoop(host);

    expect(host.ensureInitComplete).toHaveBeenCalledOnce();
    expect(host.handleSlashCommand).toHaveBeenCalledWith('/plan', ['status']);
    expect(host.runSlashCommandWithInput).not.toHaveBeenCalled();
    expect(host.runInstruction).not.toHaveBeenCalled();
    expect(completion).toHaveBeenCalledWith({
      status: 'completed',
      message: 'Plan mode is enabled.',
    });
  });

  it('keeps a typed command FIFO and runs its hidden follow-up instruction next', async () => {
    const order: string[] = [];
    const completion = vi.fn(() => order.push('command:completed'));
    const host = createInteractiveHost([
      'busy turn',
      {
        mobileCommand: {
          command: '/deep-research',
          args: ['status'],
          completion,
        },
      },
    ]);
    host.runSlashCommandWithInput = vi.fn(async () => null);
    host.runInstruction = vi.fn(async (instruction: string) => {
      order.push(`instruction:${instruction}`);
      if (instruction === 'hidden research follow-up') host.shouldExit = true;
      return true;
    });
    host.handleSlashCommand = vi.fn(async (command: string) => {
      order.push(`command:${command}`);
      enqueueInteractiveInstruction(host, 'hidden research follow-up');
      return null;
    });

    await runAgentInteractiveLoop(host);

    expect(order).toEqual([
      'instruction:busy turn',
      'command:/deep-research',
      'command:completed',
      'instruction:hidden research follow-up',
    ]);
    expect(host.handleSlashCommand).toHaveBeenCalledWith('/deep-research', ['status']);
    expect(host.runSlashCommandWithInput).not.toHaveBeenCalled();
  });

  it('runs an older real Ink prompt before a later mobile command', async () => {
    const order: string[] = [];
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });
    renderer.addQueuedInstruction('older Ink prompt');
    const host = createInteractiveHost([]);
    host.inkRenderer = renderer;
    host.runInstruction = vi.fn(async (instruction: string) => {
      order.push(`instruction:${instruction}`);
      return true;
    });
    host.handleSlashCommand = vi.fn(async (command: string) => {
      order.push(`command:${command}`);
      return 'Plan mode is disabled.';
    });
    enqueueMobileComposerCommand(host, '/plan', ['status'], () => {
      order.push('command:completed');
      host.shouldExit = true;
    });

    await runAgentInteractiveLoop(host);

    expect(order).toEqual([
      'instruction:older Ink prompt',
      'command:/plan',
      'command:completed',
    ]);
  });

  it('does not let a later Ink prompt overtake the mobile command that woke the idle loop', async () => {
    const order: string[] = [];
    const renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });
    vi.spyOn(renderer, 'isRunning').mockReturnValue(true);
    const host = createInteractiveHost([]);
    host.inkRenderer = renderer;
    host.handleSlashCommand = vi.fn(async (command: string) => {
      order.push(`command:${command}`);
      return 'Plan mode is disabled.';
    });
    host.runInstruction = vi.fn(async (instruction: string) => {
      order.push(`instruction:${instruction}`);
      host.shouldExit = true;
      return true;
    });

    const loop = runAgentInteractiveLoop(host);
    await vi.waitFor(() => expect(host.inkInstructionResolver).toEqual(expect.any(Function)));

    enqueueMobileComposerCommand(host, '/plan', ['status'], () => {
      order.push('command:completed');
    });
    renderer.addQueuedInstruction('later Ink prompt');

    await loop;

    expect(order).toEqual([
      'command:/plan',
      'command:completed',
      'instruction:later Ink prompt',
    ]);
  });

  it('runs an older real persistent-input prompt before a later mobile command', async () => {
    const order: string[] = [];
    const persistentInput = new PersistentInput({ silentMode: true });
    persistentInput.enqueue('older persistent prompt');
    const host = createInteractiveHost([]);
    host.persistentInput = persistentInput;
    host.runInstruction = vi.fn(async (instruction: string) => {
      order.push(`instruction:${instruction}`);
      return true;
    });
    host.handleSlashCommand = vi.fn(async (command: string) => {
      order.push(`command:${command}`);
      return 'Plan mode is disabled.';
    });
    enqueueMobileComposerCommand(host, '/plan', ['status'], () => {
      order.push('command:completed');
      host.shouldExit = true;
    });

    await runAgentInteractiveLoop(host);

    expect(order).toEqual([
      'instruction:older persistent prompt',
      'command:/plan',
      'command:completed',
    ]);
  });

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
