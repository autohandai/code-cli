/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseCursorPositionReport,
  parseSgrMouseInput,
  resolveMouseTargetClick,
  resolveComposerClickPosition,
} from '../../../src/ui/ink/mouseInput.js';

describe('parseSgrMouseInput', () => {
  it('parses a left-button press delivered through Ink useInput', () => {
    expect(parseSgrMouseInput('[<0;24;18M')).toEqual({
      action: 'press',
      button: 'left',
      column: 24,
      row: 18,
      modifiers: {
        alt: false,
        ctrl: false,
        shift: false,
      },
    });
  });

  it('leaves ordinary keyboard input outside the mouse protocol', () => {
    expect(parseSgrMouseInput('hello')).toBeNull();
  });

  it('distinguishes wheel input so it cannot reposition the composer cursor', () => {
    expect(parseSgrMouseInput('\u001B[<64;24;18M')).toEqual({
      action: 'wheel',
      button: 'wheel-up',
      column: 24,
      row: 18,
      modifiers: {
        alt: false,
        ctrl: false,
        shift: false,
      },
    });
  });
});

describe('parseCursorPositionReport', () => {
  it('parses a terminal cursor report delivered through Ink useInput', () => {
    expect(parseCursorPositionReport('[12;8R')).toEqual({
      column: 8,
      row: 12,
    });
  });
});

describe('resolveComposerClickPosition', () => {
  it('converts a viewport click into a composer content cell', () => {
    const click = parseSgrMouseInput('[<0;4;12M');
    const cursor = parseCursorPositionReport('[12;8R');

    expect(resolveComposerClickPosition(click!, cursor!, {
      cursorX: 7,
      cursorY: 6,
      height: 3,
      width: 20,
      x: 0,
      y: 5,
    })).toEqual({
      visualColumn: 3,
      visualRow: 0,
    });
  });

  it('recognizes a click inside a measured live-command block', () => {
    const click = parseSgrMouseInput('[<0;12;8M');
    const cursor = parseCursorPositionReport('[12;8R');

    expect(resolveMouseTargetClick(click!, cursor!, {
      cursorX: 7,
      cursorY: 6,
      height: 3,
      width: 20,
      x: 0,
      y: 5,
    }, {
      x: 4,
      y: 1,
      width: 18,
      height: 4,
    })).toBe(true);
  });
});

describe('button-drag reporting', () => {
  it('reports pointer motion with the left button held as a drag', async () => {
    expect(parseSgrMouseInput('\u001B[<32;12;7M')).toMatchObject({ action: 'drag', button: 'left', column: 12, row: 7 });
  });

  it('still reports a plain press and release as press and release', () => {
    expect(parseSgrMouseInput('\u001B[<0;12;7M')?.action).toBe('press');
    expect(parseSgrMouseInput('\u001B[<0;12;7m')?.action).toBe('release');
  });

  it('asks the terminal for drag events and turns them off again', async () => {
    const { ENABLE_SGR_MOUSE_TRACKING, DISABLE_SGR_MOUSE_TRACKING } = await import('../../../src/ui/ink/mouseInput.js');
    expect(ENABLE_SGR_MOUSE_TRACKING).toContain('\u001B[?1002h');
    expect(DISABLE_SGR_MOUSE_TRACKING).toContain('\u001B[?1002l');
  });
});
