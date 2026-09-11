/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

function makeRenderer(): InkRenderer {
  return new InkRenderer({ onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
}

describe('InkRenderer tip state', () => {
  it('clears a rotating tip when work stops', () => {
    const renderer = makeRenderer();
    renderer.setWorking(true, 'Grokking...');
    renderer.setTip({ kind: 'tip', text: 'rotating' });
    expect(renderer.getState().tip).toEqual({ kind: 'tip', text: 'rotating' });
    renderer.setWorking(false);
    expect(renderer.getState().tip).toBeUndefined();
  });

  it('keeps an upgrade hint after work stops and clears it when work starts', () => {
    const renderer = makeRenderer();
    renderer.setWorking(true, 'Grokking...');
    renderer.setTip({ kind: 'upgrade', text: 'Run /upgrade' });
    renderer.setWorking(false);
    expect(renderer.getState().tip).toEqual({ kind: 'upgrade', text: 'Run /upgrade' });
    renderer.setWorking(true, 'Grokking...');
    expect(renderer.getState().tip).toBeUndefined();
  });
});
