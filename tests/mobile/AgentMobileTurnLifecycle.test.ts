/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../src/core/agent.js';

describe('mobile instruction lifecycle', () => {
  it('does not let a local instruction consume the following claimed mobile turn', async () => {
    const agent = Object.create(AutohandAgent.prototype) as any;
    const turn = {
      workId: 'work-1',
      prompt: 'Run a harmless check',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relay = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
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
    const turn = {
      workId: 'work-from-relay-a',
      prompt: 'mobile prompt from A',
      startedAt: '2026-07-21T02:35:00.000Z',
    };
    const relayA = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
      requestChangesDecision: vi.fn(),
      refreshDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      publishArtifactsFromText: vi.fn().mockResolvedValue(undefined),
    };
    const relayB = {
      finishClaimedTurn: vi.fn().mockResolvedValue(undefined),
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
});
