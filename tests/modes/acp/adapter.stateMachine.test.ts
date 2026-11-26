/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { ACP_SESSION_LIFECYCLE, AcpSessionLifecycle } from '../../../src/modes/acp/adapter.js';
import {
  InvalidTransitionError,
  StateMachine,
  reachableStates,
  terminalStates,
} from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

const EVENTS = ['prompt', 'cancel', 'drain', 'settle', 'close'] as const;

describe('ACP_SESSION_LIFECYCLE', () => {
  it('starts idle and walks prompting -> cancelling -> idle -> closed', () => {
    const machine = new StateMachine(ACP_SESSION_LIFECYCLE);
    expect(machine.state).toBe('idle');
    expect(machine.send('prompt')).toBe('prompting');
    expect(machine.send('prompt')).toBe('prompting');
    expect(machine.send('cancel')).toBe('cancelling');
    expect(machine.send('prompt')).toBe('prompting');
    expect(machine.send('drain')).toBe('cancelling');
    expect(machine.send('settle')).toBe('idle');
    expect(machine.send('cancel')).toBe('idle');
    expect(machine.send('close')).toBe('closed');
  });

  it('rejects settling or draining with no prompt, and anything after close', () => {
    const machine = new StateMachine(ACP_SESSION_LIFECYCLE);
    expect(() => machine.send('settle')).toThrow(InvalidTransitionError);
    expect(() => machine.send('drain')).toThrow(InvalidTransitionError);
    machine.send('prompt');
    machine.send('cancel');
    expect(machine.can('drain')).toBe(false);
    machine.send('close');
    for (const event of EVENTS) expect(machine.can(event)).toBe(false);
  });

  it('has closed as its only terminal state and reaches every state', () => {
    expect(terminalStates(ACP_SESSION_LIFECYCLE)).toEqual(['closed']);
    expect(reachableStates(ACP_SESSION_LIFECYCLE)).toEqual(new Set(['idle', 'prompting', 'cancelling', 'closed']));
  });

  it('accepts exactly the declared edges under random event sequences', () => {
    randomEventWalk(ACP_SESSION_LIFECYCLE, EVENTS, { seeds: 50, steps: 30 });
  });
});

describe('AcpSessionLifecycle', () => {
  it('gives each turn its own scope and returns to idle when the last one ends', () => {
    const lifecycle = new AcpSessionLifecycle();
    const first = lifecycle.beginTurn();
    const second = lifecycle.beginTurn();
    expect(lifecycle.state).toBe('prompting');
    expect(lifecycle.activeSignal).toBe(first.signal);
    expect(first.signal).not.toBe(second.signal);

    lifecycle.endTurn(first);
    expect(lifecycle.activeSignal).toBe(second.signal);
    lifecycle.endTurn(second);
    expect(lifecycle.state).toBe('idle');
    lifecycle.endTurn(second);
    expect(lifecycle.state).toBe('idle');
  });

  it('cancels every turn in flight but not one admitted afterwards', () => {
    const lifecycle = new AcpSessionLifecycle();
    const first = lifecycle.beginTurn();
    const second = lifecycle.beginTurn();
    lifecycle.cancel();
    expect(lifecycle.state).toBe('cancelling');
    expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true]);

    const third = lifecycle.beginTurn();
    expect(lifecycle.state).toBe('prompting');
    expect(third.signal.aborted).toBe(false);
    expect(first.signal.aborted).toBe(true);
  });

  it('drains to cancelling when the live turn ends before a cancelled one', () => {
    const lifecycle = new AcpSessionLifecycle();
    const cancelled = lifecycle.beginTurn();
    lifecycle.cancel();
    const live = lifecycle.beginTurn();
    lifecycle.endTurn(live);
    expect(lifecycle.state).toBe('cancelling');
    lifecycle.endTurn(cancelled);
    expect(lifecycle.state).toBe('idle');
  });

  it('cancels out-of-turn work without silencing the next out-of-turn request', () => {
    const lifecycle = new AcpSessionLifecycle();
    const before = lifecycle.activeSignal;
    lifecycle.cancel();
    expect(lifecycle.state).toBe('idle');
    expect(before.aborted).toBe(true);
    expect(lifecycle.activeSignal.aborted).toBe(false);
  });

  it('closes for good: aborts the session, its turns and out-of-turn work, and refuses new turns', () => {
    const session = new AbortController();
    const lifecycle = new AcpSessionLifecycle(session);
    const turn = lifecycle.beginTurn();
    lifecycle.close();
    expect(lifecycle.state).toBe('closed');
    expect(session.signal.aborted).toBe(true);
    expect(turn.signal.aborted).toBe(true);
    expect(lifecycle.activeSignal.aborted).toBe(true);

    lifecycle.endTurn(turn);
    lifecycle.cancel();
    lifecycle.close();
    expect(lifecycle.state).toBe('closed');
    expect(lifecycle.activeSignal.aborted).toBe(true);
    expect(() => lifecycle.beginTurn()).toThrow(InvalidTransitionError);
  });
});
