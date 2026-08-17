/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface SgrMouseInput {
  action: 'press' | 'release' | 'wheel';
  button: 'left' | 'middle' | 'right' | 'none' | 'wheel-up' | 'wheel-down';
  column: number;
  row: number;
  modifiers: {
    alt: boolean;
    ctrl: boolean;
    shift: boolean;
  };
}

const SGR_MOUSE_PATTERN = /^(?:\u001B)?\[<(\d+);(\d+);(\d+)([Mm])$/;
const CURSOR_POSITION_REPORT_PATTERN = /^(?:\u001B)?\[(\d+);(\d+)R$/;

export const ENABLE_SGR_MOUSE_TRACKING = '\u001B[?1000h\u001B[?1006h';
export const DISABLE_SGR_MOUSE_TRACKING = '\u001B[?1006l\u001B[?1000l';
export const REQUEST_CURSOR_POSITION = '\u001B[6n';

export interface TerminalCellPosition {
  column: number;
  row: number;
}

export interface ComposerOutputLayout {
  cursorX: number;
  cursorY: number;
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ComposerClickPosition {
  visualColumn: number;
  visualRow: number;
}

export function parseCursorPositionReport(input: string): TerminalCellPosition | null {
  const match = CURSOR_POSITION_REPORT_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  return {
    column: Number(match[2]),
    row: Number(match[1]),
  };
}

export function resolveComposerClickPosition(
  mouse: SgrMouseInput,
  terminalCursor: TerminalCellPosition,
  layout: ComposerOutputLayout,
): ComposerClickPosition | null {
  if (mouse.action !== 'press' || mouse.button !== 'left') {
    return null;
  }

  const outputOriginColumn = terminalCursor.column - layout.cursorX;
  const outputOriginRow = terminalCursor.row - layout.cursorY;
  const localColumn = mouse.column - outputOriginColumn - layout.x;
  const localRow = mouse.row - outputOriginRow - layout.y;

  if (
    localColumn < 0
    || localColumn >= layout.width
    || localRow < 1
    || localRow >= layout.height - 1
  ) {
    return null;
  }

  return {
    visualColumn: localColumn,
    visualRow: localRow - 1,
  };
}

export function parseSgrMouseInput(input: string): SgrMouseInput | null {
  const match = SGR_MOUSE_PATTERN.exec(input);
  if (!match) {
    return null;
  }

  const buttonCode = Number(match[1]);
  const isWheel = (buttonCode & 0b100_0000) !== 0;
  const button = isWheel
    ? (buttonCode & 0b1) === 0 ? 'wheel-up' : 'wheel-down'
    : (['left', 'middle', 'right', 'none'] as const)[buttonCode & 0b11] ?? 'none';

  return {
    action: isWheel ? 'wheel' : match[4] === 'M' ? 'press' : 'release',
    button,
    column: Number(match[2]),
    row: Number(match[3]),
    modifiers: {
      alt: (buttonCode & 0b1000) !== 0,
      ctrl: (buttonCode & 0b1_0000) !== 0,
      shift: (buttonCode & 0b0100) !== 0,
    },
  };
}
