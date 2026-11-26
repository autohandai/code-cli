/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { InvalidTransitionError, reachableStates, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';
import {
  ModalDepth,
  TURN_PHASE,
  TurnActivity,
  resolveTurnActivity,
  type TurnPhaseEvent,
} from '../../../src/core/agent/TurnActivity.js';
import { AutohandAgent } from '../../../src/core/agent.js';

const TURN_EVENTS: readonly TurnPhaseEvent[] = ['admit', 'prepare', 'start', 'finish', 'settle'];

describe('TURN_PHASE transition table', () => {
  it('declares the turn lifecycle idle → admitted → preparing → running → finishing → idle', () => {
    expect(TURN_PHASE.initial).toBe('idle');
    expect(TURN_PHASE.transitions).toEqual({
      idle: { admit: 'admitted' },
      admitted: { prepare: 'preparing', settle: 'idle' },
      preparing: { start: 'running', settle: 'idle' },
      running: { finish: 'finishing', settle: 'idle' },
      finishing: { settle: 'idle' },
    });
  });

  it('reaches every phase, has no terminal phase, and every active phase can settle back to idle', () => {
    expect(reachableStates(TURN_PHASE)).toEqual(new Set(['idle', 'admitted', 'preparing', 'running', 'finishing']));
    expect(terminalStates(TURN_PHASE)).toEqual([]);
    for (const phase of ['admitted', 'preparing', 'running', 'finishing'] as const) {
      expect(TURN_PHASE.transitions[phase]).toHaveProperty('settle', 'idle');
    }
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(TURN_PHASE, TURN_EVENTS, { seeds: 50, steps: 60 });
  });
});

describe('TurnActivity', () => {
  it('is active in every phase but idle and reports only idle↔active edges', () => {
    const onActiveChange = vi.fn();
    const turn = new TurnActivity(onActiveChange);
    expect(turn.active).toBe(false);
    turn.admit();
    turn.prepare();
    turn.start();
    turn.finish();
    expect(turn.phase).toBe('finishing');
    expect(turn.active).toBe(true);
    turn.settle();
    expect(turn.phase).toBe('idle');
    expect(onActiveChange.mock.calls).toEqual([[true], [false]]);
  });

  it('rejects a second admission while a turn is in flight', () => {
    const turn = new TurnActivity();
    turn.admit();
    expect(() => turn.admit()).toThrow(InvalidTransitionError);
    expect(turn.phase).toBe('admitted');
  });

  it('settles idempotently and ignores a finish outside the running phase', () => {
    const turn = new TurnActivity();
    turn.settle();
    turn.finish();
    expect(turn.phase).toBe('idle');
    turn.admit();
    turn.settle();
    turn.settle();
    expect(turn.phase).toBe('idle');
  });

  it('maps legacy boolean writes onto admit and settle', () => {
    const turn = new TurnActivity();
    turn.setActive(true);
    turn.setActive(true);
    expect(turn.phase).toBe('admitted');
    turn.setActive(false);
    expect(turn.phase).toBe('idle');
  });

  it('mirrors a host without its own activity onto the host boolean', () => {
    const host: { isInstructionActive: boolean; turnActivity?: TurnActivity } = { isInstructionActive: false };
    const turn = resolveTurnActivity(host);
    expect(resolveTurnActivity(host)).toBe(turn);
    turn.admit();
    expect(host.isInstructionActive).toBe(true);
    turn.settle();
    expect(host.isInstructionActive).toBe(false);
  });
});

describe('ModalDepth', () => {
  it('stays visible until the outermost modal closes', () => {
    const onVisibleChange = vi.fn();
    const modals = new ModalDepth(onVisibleChange);
    const leaveOuter = modals.enter();
    const leaveInner = modals.enter();
    leaveInner();
    expect(modals.visible).toBe(true);
    leaveOuter();
    expect(modals.visible).toBe(false);
    expect(onVisibleChange.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores a repeated leave from the same token', () => {
    const modals = new ModalDepth();
    const leaveOuter = modals.enter();
    const leaveInner = modals.enter();
    leaveInner();
    leaveInner();
    expect(modals.visible).toBe(true);
    leaveOuter();
    expect(modals.visible).toBe(false);
  });
});

describe('AutohandAgent turn and modal accessors', () => {
  type AgentInternals = {
    isInstructionActive: boolean;
    modalActive: boolean;
    enterModal(): () => void;
    turnActivity: TurnActivity;
    peerRuntime?: unknown;
  };

  it('derives isInstructionActive from the turn phase on a partially constructed agent', () => {
    const agent = Object.create(AutohandAgent.prototype) as AgentInternals;
    expect(agent.isInstructionActive).toBe(false);
    agent.isInstructionActive = true;
    expect(agent.turnActivity.phase).toBe('admitted');
    agent.isInstructionActive = false;
    expect(agent.turnActivity.phase).toBe('idle');
  });

  it('keeps peers paused while a nested modal outlives the legacy modal flag writer', () => {
    const setPaused = vi.fn();
    const agent = Object.assign(Object.create(AutohandAgent.prototype), {
      peerRuntime: { scheduler: { setPaused } },
    }) as AgentInternals;
    agent.modalActive = true;
    const leaveNested = agent.enterModal();
    agent.modalActive = false;
    expect(agent.modalActive).toBe(true);
    expect(setPaused).not.toHaveBeenCalledWith('permission', false);
    leaveNested();
    expect(agent.modalActive).toBe(false);
    expect(setPaused.mock.calls).toEqual([['permission', true], ['permission', false]]);
  });
});
