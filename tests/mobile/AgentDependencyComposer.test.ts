/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  enqueueClaimedMobileInstruction,
  enqueueInteractiveInstruction,
} from '../../src/core/agent/AgentDependencyComposer.js';

describe('enqueueInteractiveInstruction', () => {
  it('wakes the idle Ink loop after queueing a mobile instruction', () => {
    const addQueuedInstruction = vi.fn();
    const resolver = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: resolver,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'mobile prompt');

    expect(addQueuedInstruction).toHaveBeenCalledWith('mobile prompt');
    expect(resolver).toHaveBeenCalledOnce();
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('keeps a claimed mobile turn in the typed pending queue while Ink is active', () => {
    const addQueuedInstruction = vi.fn();
    const resolver = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: resolver,
      pendingInkInstructions: [] as unknown[],
    };
    const mobileTurn = {
      turn: {
        workId: 'work-1',
        prompt: 'mobile prompt',
        startedAt: '2026-07-21T02:35:00.000Z',
      },
      relay: {} as never,
    };

    enqueueClaimedMobileInstruction(host, 'mobile prompt', mobileTurn);

    expect(addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.pendingInkInstructions).toEqual([{
      text: 'mobile prompt',
      mobileTurn,
    }]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('leaves work queued when the Ink loop is already active', () => {
    const addQueuedInstruction = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: null,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'follow-up prompt');

    expect(addQueuedInstruction).toHaveBeenCalledWith('follow-up prompt');
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('falls back to the pending queue when Ink is unavailable', () => {
    const host = {
      inkRenderer: null,
      inkInstructionResolver: null,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'pending prompt');

    expect(host.pendingInkInstructions).toEqual(['pending prompt']);
  });
});
