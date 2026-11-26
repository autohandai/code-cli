/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import { PERSISTENT_INPUT_LIFECYCLE, PersistentInput } from '../../src/ui/persistentInput.js';
import { StateMachine, reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { mulberry32, pick, randomEventWalk } from '../helpers/stateMachineProperties.js';

type MockStdin = NodeJS.ReadStream & { isTTY: boolean; isRaw: boolean; setRawMode: (mode: boolean) => void };
type MockStdout = NodeJS.WriteStream & { writes: string[] };

function createMockStdin(): MockStdin {
  const stdin = new EventEmitter() as MockStdin;
  stdin.isTTY = true;
  stdin.isRaw = false;
  stdin.setRawMode = vi.fn((mode: boolean) => {
    stdin.isRaw = mode;
  }) as MockStdin['setRawMode'];
  stdin.resume = vi.fn() as unknown as MockStdin['resume'];
  stdin.pause = vi.fn() as unknown as MockStdin['pause'];
  return stdin;
}

function createMockStdout(): MockStdout {
  const stdout = new EventEmitter() as MockStdout;
  Object.assign(stdout, { isTTY: true, rows: 24, columns: 80 });
  stdout.writes = [];
  stdout.write = ((chunk: string) => {
    stdout.writes.push(chunk);
    return true;
  }) as MockStdout['write'];
  return stdout;
}

function createInput(options: { silentMode?: boolean } = {}) {
  const stdin = createMockStdin();
  const stdout = createMockStdout();
  const input = new PersistentInput(options);
  input.rebindStreams(stdin, stdout);
  return { input, stdin, stdout };
}

function key(stdin: EventEmitter, str: string, k: Partial<readline.Key> = { name: str, sequence: str }) {
  stdin.emit('keypress', str, k as readline.Key);
}

const EVENTS = ['start', 'stop', 'pause', 'resume'] as const;

describe('PERSISTENT_INPUT_LIFECYCLE transition table', () => {
  it('declares the allowed edges', () => {
    expect(PERSISTENT_INPUT_LIFECYCLE.initial).toBe('inactive');
    expect(PERSISTENT_INPUT_LIFECYCLE.transitions).toEqual({
      inactive: { start: 'active' },
      active: { pause: 'paused', stop: 'inactive' },
      paused: { resume: 'active', stop: 'inactive' },
    });
  });

  it('rejects invalid edges', () => {
    const machine = new StateMachine(PERSISTENT_INPUT_LIFECYCLE);
    expect(machine.can('pause')).toBe(false);
    expect(machine.can('resume')).toBe(false);
    expect(machine.can('stop')).toBe(false);
    machine.send('start');
    expect(machine.can('start')).toBe(false);
    expect(machine.can('resume')).toBe(false);
    machine.send('pause');
    expect(machine.can('pause')).toBe(false);
    expect(machine.can('start')).toBe(false);
  });

  it('every state is reachable and none is a dead end', () => {
    expect(reachableStates(PERSISTENT_INPUT_LIFECYCLE)).toEqual(new Set(['inactive', 'active', 'paused']));
    expect(terminalStates(PERSISTENT_INPUT_LIFECYCLE)).toEqual([]);
  });

  it('accepts exactly the declared edges under random walks', () => {
    randomEventWalk(PERSISTENT_INPUT_LIFECYCLE, EVENTS, { seeds: 50, steps: 60 });
  });
});

describe('PersistentInput pause ownership', () => {
  it('nested pause inside a modal pause does not reclaim stdin while the modal owns it', () => {
    const { input, stdin } = createInput();
    input.start();
    input.pauseForModal();
    stdin.isRaw = true; // the Ink modal owns stdin in raw mode

    input.pause();
    input.resume();

    expect(input.lifecycleState).toBe('paused');
    expect(stdin.listenerCount('keypress')).toBe(0);
    expect(stdin.isRaw).toBe(true);

    input.resumeFromModal();
    expect(input.lifecycleState).toBe('active');
    expect(stdin.listenerCount('keypress')).toBe(1);
    input.stop();
  });

  it('pause → pauseForModal → resumeFromModal → resume attaches a single keypress listener', () => {
    const { input, stdin } = createInput();
    input.start();
    input.pause();
    input.pauseForModal();
    input.resumeFromModal();
    expect(stdin.listenerCount('keypress')).toBe(0);
    input.resume();
    expect(stdin.listenerCount('keypress')).toBe(1);

    key(stdin, 'a');
    expect(input.getCurrentInput()).toBe('a');
    input.stop();
  });

  it('resume without a matching pause does not attach a second keypress listener', () => {
    const { input, stdin } = createInput();
    input.start();
    input.resume();
    input.resumeFromModal();
    expect(stdin.listenerCount('keypress')).toBe(1);
    key(stdin, 'x');
    expect(input.getCurrentInput()).toBe('x');
    input.stop();
  });

  it('stop() while paused discards outstanding pauses so the next session starts clean', () => {
    const { input, stdin } = createInput();
    input.start();
    input.pause();
    input.pause();
    input.stop();
    expect(input.lifecycleState).toBe('inactive');

    input.start();
    expect(input.lifecycleState).toBe('active');
    expect(stdin.listenerCount('keypress')).toBe(1);
    input.resume(); // stale resume from the previous session is ignored
    expect(stdin.listenerCount('keypress')).toBe(1);
    input.stop();
  });

  it('property: keypress listener is attached at most once under random pause/resume/modal sequences', () => {
    const ops = ['start', 'stop', 'pause', 'resume', 'pauseForModal', 'resumeFromModal'] as const;
    for (const silentMode of [false, true]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const random = mulberry32(seed);
        const { input, stdin } = createInput({ silentMode });
        for (let step = 0; step < 80; step += 1) {
          const op = pick(random, ops);
          input[op]();
          const label = `silent=${silentMode} seed=${seed} step=${step} op=${op}`;
          const listeners = stdin.listenerCount('keypress');
          expect(listeners, label).toBeLessThanOrEqual(1);
          expect(listeners, label).toBe(input.lifecycleState === 'active' ? 1 : 0);
        }
        input.stop();
        expect(stdin.listenerCount('keypress')).toBe(0);
      }
    }
  });
});

describe('PersistentInput paste state across lifecycle boundaries', () => {
  it('stop() mid-paste does not leak the paste into the next session', () => {
    const { input, stdin } = createInput({ silentMode: true });
    input.start();
    key(stdin, '\x1b[200~', { sequence: '\x1b[200~' });
    key(stdin, 'o');
    key(stdin, 'l');
    key(stdin, 'd');
    input.stop();

    input.start();
    key(stdin, 'n');
    expect(input.getCurrentInput()).toBe('n');
    input.stop();
  });

  it('pausing mid-paste hands the rest of the paste to the modal and resumes with normal typing', () => {
    const { input, stdin } = createInput({ silentMode: true });
    input.start();
    key(stdin, '\x1b[200~', { sequence: '\x1b[200~' });
    key(stdin, 'o');
    input.pauseForModal();
    input.resumeFromModal();

    key(stdin, 'n');
    expect(input.getCurrentInput()).toBe('n');
    input.stop();
  });
});
