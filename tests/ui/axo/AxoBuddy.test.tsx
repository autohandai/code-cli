/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxoBuddy, AXO_ROWS, shouldShowAxo, type AxoBuddyProps } from '../../../src/ui/axo/AxoBuddy.js';
import { AXO_CUE_MS } from '../../../src/ui/axo/axoPose.js';
import { Theme } from '../../../src/ui/theme/Theme.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { COLOR_TOKENS, type ColorMode, type ResolvedColors } from '../../../src/ui/theme/types.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const colors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, '#999999'])) as ResolvedColors;
const strip = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, '');

function renderAxo(props: Partial<AxoBuddyProps> = {}, colorMode: ColorMode = 'truecolor') {
  const onGone = vi.fn();
  const element = (next: Partial<AxoBuddyProps>) => (
    <ThemeProvider theme={new Theme('axo-test', colors, colorMode)}>
      <AxoBuddy
        axo={{ enabled: true, cue: null }}
        isWorking={false}
        turnStatus={undefined}
        input=""
        columns={100}
        rows={40}
        onGone={onGone}
        {...props}
        {...next}
      />
    </ThemeProvider>
  );
  const instance = render(element({}));
  return { ...instance, onGone, update: (next: Partial<AxoBuddyProps>) => instance.rerender(element(next)) };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('AxoBuddy', () => {
  it('draws Axo in its fixed block of rows', () => {
    const { lastFrame } = renderAxo();
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines).toHaveLength(AXO_ROWS);
    expect(strip(lastFrame() ?? '')).toMatch(/[▀▄█]/);
  });

  it('stays hidden in small terminals and without enough colour', () => {
    expect(shouldShowAxo(true, 60, 40)).toBe(false);
    expect(shouldShowAxo(true, 100, 20)).toBe(false);
    expect(shouldShowAxo(false, 100, 40)).toBe(false);
    expect(renderAxo({}, '16').lastFrame()).toBe('');
  });

  it('greets when summoned and shows what it was told', () => {
    const now = Date.now();
    const { lastFrame } = renderAxo({ axo: { enabled: true, cue: { kind: 'say', id: 1, at: now, text: 'ship it' } } });
    expect(strip(lastFrame() ?? '')).toContain('ship it ◂');
  });

  it('wraps a long answer into lines beside Axo', () => {
    const text = 'Refactoring is like tidying your burrow so future you can find the snacks faster!';
    const { lastFrame } = renderAxo({ axo: { enabled: true, cue: { kind: 'answer', id: 1, at: Date.now(), text } } });
    const frame = strip(lastFrame() ?? '');
    expect(frame).toContain('Refactoring is');
    expect(frame).toContain('snacks faster! ◂');
    expect(frame.split('\n')).toHaveLength(AXO_ROWS);
  });

  it('cries after a failed turn until petted', async () => {
    const ui = renderAxo({ isWorking: true });
    ui.update({ isWorking: false, turnStatus: 'failed' });
    await settle();
    expect(strip(ui.lastFrame() ?? '')).toContain('oh no…');
    ui.update({ isWorking: false, turnStatus: 'failed', axo: { enabled: true, cue: { kind: 'pet', id: 1, at: Date.now() - AXO_CUE_MS.pet } } });
    await settle();
    expect(strip(ui.lastFrame() ?? '')).not.toContain('oh no…');
  });

  it('celebrates a clean finish', async () => {
    const ui = renderAxo({ isWorking: true });
    ui.update({ isWorking: false, turnStatus: 'completed' });
    await settle();
    expect(strip(ui.lastFrame() ?? '')).toContain('done!');
  });

  it('leaves after the goodbye plays', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'Date'] });
    const ui = renderAxo({ axo: { enabled: true, cue: { kind: 'home', id: 1, at: Date.now() } } });
    expect(strip(ui.lastFrame() ?? '')).toContain('bye!');
    await vi.advanceTimersByTimeAsync(AXO_CUE_MS.home + 500);
    expect(ui.onGone).toHaveBeenCalledTimes(1);
  });
});
