import { expect } from 'vitest';
import {
  InvalidTransitionError,
  StateMachine,
  type StateMachineDefinition,
} from '../../src/utils/stateMachine.js';

/** Deterministic PRNG so property failures reproduce from the reported seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

interface WalkOptions {
  seeds: number;
  steps: number;
}

/**
 * Property: for any sequence of events, a machine accepts exactly the edges in
 * its table, rejects everything else without moving, and never reaches a
 * state outside the table.
 */
export function randomEventWalk<S extends string, E extends string>(
  definition: StateMachineDefinition<S, E>,
  events: readonly E[],
  { seeds, steps }: WalkOptions,
): void {
  const declared = new Set(Object.keys(definition.transitions));
  for (let seed = 1; seed <= seeds; seed += 1) {
    const random = mulberry32(seed);
    const machine = new StateMachine(definition);
    for (let step = 0; step < steps; step += 1) {
      const event = pick(random, events);
      const from = machine.state;
      const expected = (definition.transitions[from] as Partial<Record<E, S>>)[event];
      if (expected === undefined) {
        expect(() => machine.send(event), `seed=${seed} step=${step} ${from}--${event}`).toThrow(
          InvalidTransitionError,
        );
        expect(machine.state).toBe(from);
      } else {
        expect(machine.send(event), `seed=${seed} step=${step} ${from}--${event}`).toBe(expected);
      }
      expect(declared.has(machine.state)).toBe(true);
    }
  }
}
