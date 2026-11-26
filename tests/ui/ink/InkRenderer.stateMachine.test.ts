/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ink', () => ({
  render: vi.fn(() => ({
    unmount: vi.fn(),
    rerender: vi.fn(),
    clear: vi.fn(),
    waitUntilExit: vi.fn(),
  })),
}));

vi.mock('../../../src/ui/rawMode.js', () => ({
  safeSetRawMode: () => false,
}));

import { render as renderInk } from 'ink';
import { INK_RENDERER_LIFECYCLE, InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
import { StateMachine, reachableStates, terminalStates } from '../../../src/utils/stateMachine.js';
import { randomEventWalk } from '../../helpers/stateMachineProperties.js';

const EVENTS = ['start', 'pause', 'resume', 'mounted', 'stop'] as const;

function createRenderer(): InkRenderer {
  return new InkRenderer({
    onInstruction: () => {},
    onEscape: () => {},
    onCtrlC: () => {},
    loadAxoEnabled: () => false,
  });
}

describe('INK_RENDERER_LIFECYCLE transition table', () => {
  it('declares the allowed edges', () => {
    expect(INK_RENDERER_LIFECYCLE.initial).toBe('idle');
    expect(INK_RENDERER_LIFECYCLE.transitions).toEqual({
      idle: { start: 'mounted', stop: 'stopped' },
      mounted: { pause: 'paused', stop: 'stopped' },
      paused: { resume: 'resuming', stop: 'stopped' },
      resuming: { mounted: 'mounted', pause: 'paused', stop: 'stopped' },
      stopped: {},
    });
  });

  it('rejects invalid edges', () => {
    const machine = new StateMachine(INK_RENDERER_LIFECYCLE);
    expect(machine.can('resume')).toBe(false);
    expect(machine.can('pause')).toBe(false);
    expect(machine.can('mounted')).toBe(false);
    machine.send('start');
    expect(machine.can('start')).toBe(false);
    expect(machine.can('resume')).toBe(false);
    machine.send('pause');
    expect(machine.can('start')).toBe(false);
    expect(machine.can('pause')).toBe(false);
    machine.send('resume');
    expect(machine.can('resume')).toBe(false);
    machine.send('stop');
    for (const event of EVENTS) expect(machine.can(event)).toBe(false);
  });

  it('only stopped is terminal and every state is reachable', () => {
    expect(terminalStates(INK_RENDERER_LIFECYCLE)).toEqual(['stopped']);
    expect(reachableStates(INK_RENDERER_LIFECYCLE)).toEqual(
      new Set(['idle', 'mounted', 'paused', 'resuming', 'stopped']),
    );
  });

  it('accepts exactly the declared edges under random walks', () => {
    randomEventWalk(INK_RENDERER_LIFECYCLE, EVENTS, { seeds: 50, steps: 40 });
  });
});

describe('InkRenderer lifecycle behaviour', () => {
  let renderer: InkRenderer;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(renderInk).mockClear();
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    renderer = createRenderer();
  });

  afterEach(async () => {
    await renderer.stop();
    writeSpy.mockRestore();
  });

  it('mounts exactly once when resume() is called concurrently', async () => {
    renderer.start();
    renderer.pause();
    await Promise.all([renderer.resume(), renderer.resume()]);

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(2);
    expect(renderer.lifecycleState).toBe('mounted');
  });

  it('resume() is idempotent once mounted', async () => {
    renderer.start();
    renderer.pause();
    await renderer.resume();
    await renderer.resume();

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(2);
  });

  it('never remounts after stop()', async () => {
    renderer.start();
    renderer.pause();
    await renderer.stop();
    await renderer.resume();

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(1);
    expect(renderer.isRunning()).toBe(false);
    expect(renderer.lifecycleState).toBe('stopped');
  });

  it('does not mount when stop() lands while resume() is yielding', async () => {
    renderer.start();
    renderer.pause();
    const resuming = renderer.resume();
    await renderer.stop();
    await resuming;

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(1);
    expect(renderer.isRunning()).toBe(false);
  });

  it('a pause() that lands while resume() is yielding keeps the renderer paused', async () => {
    renderer.start();
    renderer.pause();
    const resuming = renderer.resume();
    renderer.pause();
    await resuming;

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(1);
    expect(renderer.lifecycleState).toBe('paused');

    await renderer.resume();
    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(2);
    expect(renderer.isRunning()).toBe(true);
  });

  it('resume() before start() does not mount a half-started UI', async () => {
    await renderer.resume();

    expect(vi.mocked(renderInk)).not.toHaveBeenCalled();
    expect(renderer.lifecycleState).toBe('idle');
  });

  it('start() while paused does not mount a second UI or re-patch stdout', () => {
    renderer.start();
    renderer.pause();
    const patchedWrite = process.stdout.write;
    renderer.start();

    expect(vi.mocked(renderInk)).toHaveBeenCalledTimes(1);
    expect(process.stdout.write).toBe(patchedWrite);
    expect(renderer.lifecycleState).toBe('paused');
  });

  it('a failed start() leaves the renderer stopped', () => {
    vi.mocked(renderInk).mockImplementationOnce(() => {
      throw new Error('mount failed');
    });

    expect(() => renderer.start()).toThrow('mount failed');
    expect(renderer.lifecycleState).toBe('stopped');
    expect(renderer.isRunning()).toBe(false);
  });

  it('stop() is idempotent', async () => {
    renderer.start();
    await renderer.stop();
    await renderer.stop();

    expect(renderer.lifecycleState).toBe('stopped');
  });
});
