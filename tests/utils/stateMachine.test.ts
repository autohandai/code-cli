import { describe, expect, it, vi } from 'vitest';
import {
  InvalidTransitionError,
  StateMachine,
  defineStateMachine,
  reachableStates,
  terminalStates,
} from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

const door = defineStateMachine({
  name: 'door',
  initial: 'closed',
  transitions: {
    closed: { open: 'open', lock: 'locked' },
    open: { close: 'closed' },
    locked: { unlock: 'closed' },
  },
});

type DoorEvent = 'open' | 'close' | 'lock' | 'unlock';
const DOOR_EVENTS: readonly DoorEvent[] = ['open', 'close', 'lock', 'unlock'];

describe('StateMachine', () => {
  it('starts in the declared initial state', () => {
    expect(new StateMachine(door).state).toBe('closed');
  });

  it('follows declared transitions', () => {
    const machine = new StateMachine(door);
    expect(machine.send('open')).toBe('open');
    expect(machine.send('close')).toBe('closed');
    expect(machine.send('lock')).toBe('locked');
    expect(machine.state).toBe('locked');
  });

  it('rejects undeclared transitions with a descriptive error and keeps state', () => {
    const machine = new StateMachine(door);
    machine.send('lock');
    expect(() => machine.send('open')).toThrow(InvalidTransitionError);
    expect(() => machine.send('open')).toThrow(/door: cannot "open" from "locked"/);
    expect(machine.state).toBe('locked');
  });

  it('exposes the rejected transition on the error', () => {
    const machine = new StateMachine(door);
    try {
      machine.send('close');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const invalid = error as InvalidTransitionError;
      expect([invalid.machine, invalid.from, invalid.event]).toEqual(['door', 'closed', 'close']);
    }
  });

  it('trySend reports rejection without throwing', () => {
    const machine = new StateMachine(door);
    expect(machine.trySend('unlock')).toBe(false);
    expect(machine.state).toBe('closed');
    expect(machine.trySend('open')).toBe(true);
    expect(machine.state).toBe('open');
  });

  it('can() and is() answer without mutating', () => {
    const machine = new StateMachine(door);
    expect(machine.can('open')).toBe(true);
    expect(machine.can('unlock')).toBe(false);
    expect(machine.is('closed')).toBe(true);
    expect(machine.is('open', 'locked')).toBe(false);
    expect(machine.state).toBe('closed');
  });

  it('notifies observers after each accepted transition only', () => {
    const onTransition = vi.fn();
    const machine = new StateMachine(door, { onTransition });
    machine.send('open');
    machine.trySend('lock');
    machine.send('close');
    expect(onTransition.mock.calls).toEqual([
      [{ from: 'closed', event: 'open', to: 'open' }],
      [{ from: 'open', event: 'close', to: 'closed' }],
    ]);
  });

  it('does not inherit transitions from Object.prototype', () => {
    const machine = new StateMachine(door);
    expect(machine.can('toString' as DoorEvent)).toBe(false);
    expect(() => machine.send('constructor' as DoorEvent)).toThrow(InvalidTransitionError);
  });

  it('can start from an explicit state for restore scenarios', () => {
    expect(new StateMachine(door, { initial: 'locked' }).state).toBe('locked');
  });

  it('rejects definitions whose transitions target undeclared states', () => {
    expect(() =>
      defineStateMachine({
        name: 'broken',
        initial: 'a',
        transitions: { a: { go: 'b' } } as never,
      }),
    ).toThrow(/broken: transition "a --go--> b" targets an undeclared state/);
  });

  it('rejects definitions whose initial state is undeclared', () => {
    expect(() =>
      defineStateMachine({ name: 'broken', initial: 'z', transitions: { a: {} } } as never),
    ).toThrow(/initial state "z" is not declared/);
  });

  describe('graph helpers', () => {
    it('lists terminal states (no outgoing transitions)', () => {
      const lifecycle = defineStateMachine({
        name: 'lifecycle',
        initial: 'idle',
        transitions: { idle: { start: 'running' }, running: { stop: 'stopped' }, stopped: {} },
      });
      expect(terminalStates(lifecycle)).toEqual(['stopped']);
    });

    it('computes reachable states from the initial state', () => {
      const withOrphan = defineStateMachine({
        name: 'orphan',
        initial: 'a',
        transitions: { a: { next: 'b' }, b: {}, orphan: { next: 'a' } },
      });
      expect([...reachableStates(withOrphan)].sort()).toEqual(['a', 'b']);
    });
  });

  describe('properties', () => {
    it('never leaves the declared state set and only moves along declared edges', () => {
      randomEventWalk(door, DOOR_EVENTS, { seeds: 50, steps: 200 });
    });
  });
});
