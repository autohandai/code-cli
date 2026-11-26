/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { AgentRunStore } from '../../../src/core/agents/AgentRunStore.js';
import { LANE_LIFECYCLE, LaneManager, type Lane, type LaneStatus } from '../../../src/core/lanes/LaneManager.js';
import type { ToolActionOutcome } from '../../../src/types.js';
import { reachableStates, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

const STATUSES: readonly LaneStatus[] = ['running', 'completed', 'partial', 'failed', 'cancelled'];

describe('LANE_LIFECYCLE transition table', () => {
  it('lets a running lane settle into exactly one terminal status', () => {
    expect(LANE_LIFECYCLE.initial).toBe('running');
    expect(LANE_LIFECYCLE.transitions).toEqual({
      running: { completed: 'completed', partial: 'partial', failed: 'failed', cancelled: 'cancelled' },
      completed: {}, partial: {}, failed: {}, cancelled: {},
    });
  });

  it('has every settled status as a terminal and reaches all of them', () => {
    expect(terminalStates(LANE_LIFECYCLE)).toEqual(['completed', 'partial', 'failed', 'cancelled']);
    expect(reachableStates(LANE_LIFECYCLE)).toEqual(new Set(STATUSES));
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(LANE_LIFECYCLE, STATUSES, { seeds: 50, steps: 20 });
  });
});

describe('LaneManager settlement guard', () => {
  function harness() {
    const settled: Array<{ lane: Lane; outcome: ToolActionOutcome }> = [];
    const published: Lane[][] = [];
    const manager = new LaneManager({
      isEnabled: () => true,
      runTask: () => new Promise<ToolActionOutcome>(() => {}),
      runs: new AgentRunStore({ now: () => 1_000 }),
      onChange: lanes => { published.push(lanes); },
      onSettled: (lane, outcome) => { settled.push({ lane, outcome }); },
      now: () => 1_000,
      createId: () => 'lane-run-1',
    });
    manager.open({ agent_name: 'implementer', task: 'Fix it', lane_name: 'fix' });
    const settle = (outcome: ToolActionOutcome): void =>
      (manager as unknown as { settle(id: string, outcome: ToolActionOutcome): void }).settle('lane-run-1', outcome);
    return { manager, settled, published, settle };
  }

  it('ignores a late outcome after the lane was cancelled: status stays and onSettled fires once', () => {
    const h = harness();
    h.settle({ success: false, kind: 'aborted', error: 'cancelled' });
    const publishedAfterCancel = h.published.length;
    h.settle({ success: true, output: 'late result' });
    expect(h.manager.list()[0]).toMatchObject({ status: 'cancelled' });
    expect(h.settled).toHaveLength(1);
    expect(h.published).toHaveLength(publishedAfterCancel);
  });

  it('keeps the first terminal status for every pair of outcomes', () => {
    const outcomes: Record<Exclude<LaneStatus, 'running'>, ToolActionOutcome> = {
      completed: { success: true, output: 'ok' },
      partial: { success: true, output: 'half', status: 'partial' },
      failed: { success: false, kind: 'operational', error: 'boom' },
      cancelled: { success: false, kind: 'aborted', error: 'stop' },
    };
    for (const [first, firstOutcome] of Object.entries(outcomes)) {
      for (const secondOutcome of Object.values(outcomes)) {
        const h = harness();
        h.settle(firstOutcome);
        h.settle(secondOutcome);
        expect(h.manager.list()[0]?.status, `${first} then another outcome`).toBe(first);
        expect(h.settled).toHaveLength(1);
      }
    }
  });
});
