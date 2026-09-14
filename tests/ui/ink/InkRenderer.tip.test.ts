/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
import { TIP_ROTATION_MS } from '../../../src/ui/tips.js';

type Accept = (tip: string) => boolean;

function cyclingProvider(tips: string[]) {
  let cursor = 0;
  return vi.fn((accept: Accept): string | undefined => {
    for (let attempt = 0; attempt < tips.length; attempt++) {
      const tip = tips[cursor++ % tips.length];
      if (accept(tip)) return tip;
    }
    return undefined;
  });
}

function makeRenderer(tipProvider?: (accept: Accept) => string | undefined): InkRenderer {
  return new InkRenderer({ onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {}, tipProvider });
}

function setColumns(columns: number): void {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
}

const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

describe('InkRenderer tips', () => {
  const renderers: InkRenderer[] = [];
  const track = (renderer: InkRenderer) => {
    renderers.push(renderer);
    return renderer;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    setColumns(120);
  });

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.stop();
    vi.useRealTimers();
    if (originalColumns) {
      Object.defineProperty(process.stdout, 'columns', originalColumns);
    } else {
      delete (process.stdout as { columns?: number }).columns;
    }
  });

  it('shows a tip as soon as the agent is idle and rotates it every TIP_ROTATION_MS', () => {
    const renderer = track(makeRenderer(cyclingProvider(['first', 'second', 'third'])));
    renderer.setWorking(false);
    expect(renderer.getState().tip).toEqual({ kind: 'tip', text: 'first' });

    vi.advanceTimersByTime(TIP_ROTATION_MS - 1);
    expect(renderer.getState().tip?.text).toBe('first');
    vi.advanceTimersByTime(1);
    expect(renderer.getState().tip?.text).toBe('second');
    vi.advanceTimersByTime(TIP_ROTATION_MS);
    expect(renderer.getState().tip?.text).toBe('third');
  });

  it('keeps the current tip when idle is reported again', () => {
    const provider = cyclingProvider(['first', 'second']);
    const renderer = track(makeRenderer(provider));
    renderer.setWorking(false);
    renderer.setWorking(false);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(renderer.getState().tip?.text).toBe('first');
  });

  it('clears the tip and stops rotating while a turn runs, then resumes when it ends', () => {
    const provider = cyclingProvider(['first', 'second']);
    const renderer = track(makeRenderer(provider));
    renderer.setWorking(false);
    renderer.setWorking(true, 'Grokking...');
    expect(renderer.getState().tip).toBeUndefined();

    vi.advanceTimersByTime(TIP_ROTATION_MS * 3);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(renderer.getState().tip).toBeUndefined();

    renderer.setWorking(false);
    expect(renderer.getState().tip).toEqual({ kind: 'tip', text: 'second' });
  });

  it('picks a tip that fits beside the completion summary', () => {
    setColumns(60);
    const long = 'Type /review to review your changes before shipping';
    const renderer = track(makeRenderer(cyclingProvider([long, 'Type ? for shortcuts'])));
    renderer.setWorking(false);
    expect(renderer.getState().tip?.text).toBe(long);

    renderer.setWorking(true, 'Grokking...');
    renderer.setElapsed('0m 4s');
    renderer.setTokens('↑1.2k ↓40');
    renderer.setWorking(false);
    expect(renderer.getState().completionStats).not.toBeNull();
    expect(renderer.getState().tip?.text).toBe('Type ? for shortcuts');
  });

  it('shows nothing when no tip fits the room left', () => {
    setColumns(20);
    const renderer = track(makeRenderer(cyclingProvider(['Type ? for shortcuts'])));
    renderer.setWorking(false);
    expect(renderer.getState().tip).toBeUndefined();
  });

  it('never replaces a pinned upgrade hint, which clears when the next turn starts', () => {
    const renderer = track(makeRenderer(cyclingProvider(['first', 'second'])));
    renderer.setWorking(true, 'Grokking...');
    renderer.setTip({ kind: 'upgrade', text: 'Run /upgrade' });
    renderer.setWorking(false);
    expect(renderer.getState().tip).toEqual({ kind: 'upgrade', text: 'Run /upgrade' });

    vi.advanceTimersByTime(TIP_ROTATION_MS * 2);
    expect(renderer.getState().tip).toEqual({ kind: 'upgrade', text: 'Run /upgrade' });

    renderer.setWorking(true, 'Grokking...');
    expect(renderer.getState().tip).toBeUndefined();
    renderer.setWorking(false);
    expect(renderer.getState().tip?.kind).toBe('tip');
  });

  it('shows no tip without a tip provider', () => {
    const renderer = track(makeRenderer());
    renderer.setWorking(false);
    vi.advanceTimersByTime(TIP_ROTATION_MS);
    expect(renderer.getState().tip).toBeUndefined();
  });

  it('archives a finished summary into the transcript and clears the live row in the same update', () => {
    const renderer = track(makeRenderer());
    renderer.setWorking(true, 'Grokking...');
    renderer.setElapsed('0m 4s');
    renderer.setTokens('↑42 ↓12');
    renderer.setWorking(false);
    expect(renderer.getState().completionStats).toMatchObject({ elapsed: '0m 4s', tokens: '↑42 ↓12' });

    renderer.setWorking(true, 'Grokking...');
    expect(renderer.getState().completionStats).toBeNull();
    expect(renderer.getState().chatMessages).toContainEqual({
      role: 'completion',
      content: 'Completed in 0m 4s · ↑42 ↓12',
    });
  });

  it('clears the live summary when the next user message is submitted', () => {
    const renderer = track(makeRenderer());
    renderer.setWorking(true, 'Grokking...');
    renderer.setElapsed('0m 4s');
    renderer.setTokens('↑42 ↓12');
    renderer.setWorking(false);

    renderer.addUserMessage('next request');
    expect(renderer.getState().completionStats).toBeNull();
    expect(renderer.getState().chatMessages).toContainEqual({
      role: 'completion',
      content: 'Completed in 0m 4s · ↑42 ↓12',
    });
  });

  it('stops rotating once the renderer stops', () => {
    const provider = cyclingProvider(['first', 'second']);
    const renderer = makeRenderer(provider);
    renderer.setWorking(false);
    renderer.stop();
    vi.advanceTimersByTime(TIP_ROTATION_MS * 3);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
