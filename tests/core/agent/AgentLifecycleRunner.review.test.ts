/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { executeAgentInstructionTurn } from '../../../src/core/agent/AgentLifecycleRunner.js';

describe('interactive review execution', () => {
  it('executes a queued /review instruction inside its lifecycle', async () => {
    const events: string[] = [];
    const runInstruction = vi.fn(async () => {
      events.push('instruction');
      return true;
    });
    const executeHooks = vi.fn(async (event: string) => {
      events.push(event);
      return [];
    });

    const result = await executeAgentInstructionTurn(
      {
        hookManager: { executeHooks },
        sessionManager: {
          getCurrentSession: () => ({ metadata: { sessionId: 'interactive-session' } }),
        },
        runInstruction,
      },
      'review instruction',
      {
        echoInTranscript: false,
        postTurnAction: {
          kind: 'review-lifecycle',
          surface: 'interactive',
          request: {
            kind: 'architecture',
            audience: 'technical',
            format: 'markdown',
            target: 'packages/api',
          },
        },
      },
    );

    expect(result).toBe(true);
    expect(events).toEqual([
      'review:start',
      'instruction',
      'review:completed',
      'review:end',
    ]);
    expect(runInstruction).toHaveBeenCalledWith('review instruction', {
      echoInTranscript: false,
    });
    expect(executeHooks).toHaveBeenCalledWith('review:start', expect.objectContaining({
      sessionId: 'interactive-session',
      reviewSurface: 'interactive',
    }));
  });

  it('preserves ordinary and mobile instruction options', async () => {
    const runInstruction = vi.fn().mockResolvedValue(true);
    const mobileTurn = { workId: 'work-1', turnId: 'turn-1' };

    await executeAgentInstructionTurn(
      { runInstruction },
      'ordinary instruction',
      { echoInTranscript: false, mobileTurn } as never,
    );

    expect(runInstruction).toHaveBeenCalledWith('ordinary instruction', {
      mobileTurn,
      echoInTranscript: false,
    });
  });
});
