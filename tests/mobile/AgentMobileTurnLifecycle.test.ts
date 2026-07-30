/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';

function installMobileSessionBoundaryFixtures(agent: any): void {
  agent.runtime ??= {
    workspaceRoot: '/workspace',
    options: {},
    config: { configPath: '/tmp/autohand-test-config.json' },
  };
  agent.activeProvider ??= 'openrouter';
  agent.sessionStartedAt ??= Date.now();
  agent.hookManager ??= { executeHooks: vi.fn().mockResolvedValue([]) };
  agent.telemetryManager ??= {
    endSession: vi.fn().mockResolvedValue(undefined),
    startSession: vi.fn().mockResolvedValue(undefined),
  };
  agent.feedbackManager ??= { startSession: vi.fn() };
  agent.imageManager ??= {
    add: vi.fn(),
    formatPlaceholder: vi.fn(),
  };
}

describe('mobile instruction lifecycle', () => {
  it('does not let a local instruction consume the following claimed mobile turn', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    installMobileSessionBoundaryFixtures(agent);
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    const turn = {
      workId: 'work-1',
      prompt: 'Run a harmless check',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relay = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };

    agent.mobileRelayController = relay;
    agent.mobileTurnFailureMessage = null;
    agent.lastAssistantResponseForNotification = '';
    agent.instructionRunner = {
      run: vi.fn(async (instruction: string) => {
        if (instruction === 'local prompt') return true;
        agent.mobileTurnFailureMessage = 'The configured model is unavailable.';
        return false;
      }),
    };
    agent.files = {
      enterPreviewMode: vi.fn(),
      getPendingChanges: vi.fn(() => []),
      clearPendingChanges: vi.fn(),
      exitPreviewMode: vi.fn(),
    };
    agent.conversation = { history: vi.fn(() => []) };

    await expect(agent.runInstruction('local prompt')).resolves.toBe(true);
    expect(relay.finishClaimedTurn).not.toHaveBeenCalled();

    await expect(agent.runInstruction('Run a harmless check', {
      mobileTurn: { turn, relay },
    })).resolves.toBe(false);

    expect(relay.finishClaimedTurn).toHaveBeenCalledWith(turn, {
      status: 'failed',
      error: 'The configured model is unavailable.',
    });
  });

  it('finishes a queued turn through its origin relay after a new relay is installed', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    installMobileSessionBoundaryFixtures(agent);
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    const turn = {
      workId: 'work-from-relay-a',
      prompt: 'mobile prompt from A',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relayA = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };
    const relayB = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };

    agent.mobileRelayController = relayB;
    agent.mobileTurnFailureMessage = null;
    agent.lastAssistantResponseForNotification = '';
    agent.instructionRunner = { run: vi.fn(async () => true) };
    agent.files = {
      enterPreviewMode: vi.fn(),
      getPendingChanges: vi.fn(() => []),
      clearPendingChanges: vi.fn(),
      exitPreviewMode: vi.fn(),
    };
    agent.conversation = { history: vi.fn(() => []) };

    await agent.runInstruction('mobile prompt from A', {
      mobileTurn: { turn, relay: relayA },
    });

    expect(relayA.finishClaimedTurn).toHaveBeenCalledWith(turn, { status: 'completed' });
    expect(relayB.finishClaimedTurn).not.toHaveBeenCalled();
  });

  it('routes follow-up questions through the claimed turn origin relay only', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    installMobileSessionBoundaryFixtures(agent);
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    const turn = {
      workId: 'work-from-relay-a',
      prompt: 'mobile prompt from A',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relayA = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      requestFollowupQuestion: vi.fn().mockResolvedValue('Answer from A'),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };
    const relayB = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      requestFollowupQuestion: vi.fn().mockResolvedValue('Answer from B'),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };

    agent.mobileRelayController = relayB;
    agent.mobileTurnFailureMessage = null;
    agent.lastAssistantResponseForNotification = '';
    agent.runtime = { options: {} };
    agent.peerAwaitingInputCount = 0;
    agent.consecutiveCancellations = 0;
    agent.instructionRunner = {
      run: vi.fn(async () => {
        await expect(agent.executeAskFollowupQuestion(
          'Which environment?',
          ['Staging', 'Production'],
        )).resolves.toBe('<answer>Answer from A</answer>');
        return true;
      }),
    };
    agent.files = {
      enterPreviewMode: vi.fn(),
      getPendingChanges: vi.fn(() => []),
      clearPendingChanges: vi.fn(),
      exitPreviewMode: vi.fn(),
    };
    agent.conversation = { history: vi.fn(() => []) };

    await agent.runInstruction('mobile prompt from A', {
      mobileTurn: { turn, relay: relayA },
    });

    expect(relayA.requestFollowupQuestion).toHaveBeenCalledWith(
      'Which environment?',
      ['Staging', 'Production'],
    );
    expect(relayB.requestFollowupQuestion).not.toHaveBeenCalled();
    expect(agent.followupQuestionCallback).toBeUndefined();
  });

  it('terminalizes the claimed turn when preview setup fails before execution', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    installMobileSessionBoundaryFixtures(agent);
    agent.sessionManager = {
      getCurrentSession: vi.fn(() => ({ metadata: { sessionId: 'session-1' } })),
    };
    const turn = {
      workId: 'work-preview-failure',
      prompt: 'mobile prompt',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relay = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      publishClaimedTurnSession: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      requestFollowupQuestion: vi.fn(),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };
    agent.mobileTurnFailureMessage = null;
    agent.lastAssistantResponseForNotification = '';
    agent.instructionRunner = { run: vi.fn() };
    agent.files = {
      enterPreviewMode: vi.fn(() => {
        throw new Error('preview unavailable');
      }),
      getPendingChanges: vi.fn(() => []),
      clearPendingChanges: vi.fn(),
      exitPreviewMode: vi.fn(),
    };
    agent.conversation = { history: vi.fn(() => []) };

    await expect(agent.runInstruction(turn.prompt, {
      mobileTurn: { turn, relay },
    })).rejects.toThrow('preview unavailable');

    expect(agent.instructionRunner.run).not.toHaveBeenCalled();
    expect(relay.publishClaimedTurnSession).not.toHaveBeenCalled();
    expect(relay.finishClaimedTurn).toHaveBeenCalledWith(turn, {
      status: 'failed',
      error: 'preview unavailable',
    });
    expect(agent.followupQuestionCallback).toBeUndefined();
  });
});
