/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { TERMINAL_REGIONS_LIFECYCLE, TerminalRegions } from '../../src/ui/terminalRegions.js';
import { StateMachine, reachableStates, terminalStates } from '../../src/utils/stateMachine.js';
import { mulberry32, pick, randomEventWalk } from '../helpers/stateMachineProperties.js';

type MockOutput = NodeJS.WriteStream & { writes: string[] };

function createMockOutput(): MockOutput {
  const output = new EventEmitter() as MockOutput;
  Object.assign(output, { isTTY: true, rows: 24, columns: 80 });
  output.writes = [];
  output.write = ((chunk: string) => {
    output.writes.push(chunk);
    return true;
  }) as MockOutput['write'];
  return output;
}

const SCROLL_REGION = /^\x1B\[1;(\d+)r$/;

describe('TERMINAL_REGIONS_LIFECYCLE transition table', () => {
  it('declares the allowed edges', () => {
    expect(TERMINAL_REGIONS_LIFECYCLE.initial).toBe('inactive');
    expect(TERMINAL_REGIONS_LIFECYCLE.transitions).toEqual({
      inactive: { enable: 'active' },
      active: { disable: 'inactive', deactivate: 'inactive' },
    });
  });

  it('rejects invalid edges and has no dead ends', () => {
    const machine = new StateMachine(TERMINAL_REGIONS_LIFECYCLE);
    expect(machine.can('disable')).toBe(false);
    expect(machine.can('deactivate')).toBe(false);
    machine.send('enable');
    expect(machine.can('enable')).toBe(false);
    expect(reachableStates(TERMINAL_REGIONS_LIFECYCLE)).toEqual(new Set(['inactive', 'active']));
    expect(terminalStates(TERMINAL_REGIONS_LIFECYCLE)).toEqual([]);
  });

  it('accepts exactly the declared edges under random walks', () => {
    randomEventWalk(TERMINAL_REGIONS_LIFECYCLE, ['enable', 'disable', 'deactivate'], { seeds: 50, steps: 40 });
  });
});

describe('TerminalRegions lifecycle behaviour', () => {
  it('re-enabling after a multi-line composer reserves the default height, not the stale one', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    regions.renderFixedRegion('one\ntwo\nthree\nfour');
    expect(regions.getFixedLines()).toBe(8);
    regions.disable();

    output.writes = [];
    regions.enable();
    const scrollRegions = output.writes.filter((w) => SCROLL_REGION.test(w));
    expect(scrollRegions).toEqual(['\x1B[1;19r']);
    expect(regions.getFixedLines()).toBe(5);
  });

  it('modal clear after a multi-line composer erases every fixed row, then the next enable starts at the default height', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    regions.renderFixedRegion('one\ntwo\nthree');
    output.writes = [];
    regions.clearFixedRegionForModal();
    expect(output.writes.filter((w) => w === '\x1B[K')).toHaveLength(7);
    expect(output.writes).toContain('\x1B[17;1H');

    output.writes = [];
    regions.enable();
    expect(output.writes.filter((w) => SCROLL_REGION.test(w))).toEqual(['\x1B[1;19r']);
  });

  it('property: at most one resize handler is registered and it matches isEnabled()', () => {
    const ops = ['enable', 'disable', 'deactivate', 'clearFixedRegionForModal'] as const;
    for (let seed = 1; seed <= 30; seed += 1) {
      const random = mulberry32(seed);
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      for (let step = 0; step < 50; step += 1) {
        regions[pick(random, ops)]();
        expect(output.listenerCount('resize')).toBe(regions.isEnabled() ? 1 : 0);
      }
    }
  });
});
