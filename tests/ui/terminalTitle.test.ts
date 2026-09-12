/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  formatTerminalTitle,
  shouldWriteTerminalTitle,
  TerminalTitleController,
  terminalTitleSequence,
} from '../../src/ui/terminalTitle.js';

describe('terminal title', () => {
  it('marks working red, waiting amber, and idle green, with the session name first', () => {
    expect(formatTerminalTitle('Fix caret', 'working')).toBe('🔴 Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'waiting')).toBe('🟡 Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'idle')).toBe('🟢 Fix caret · Autohand');
    expect(formatTerminalTitle(undefined, 'idle')).toBe('🟢 Autohand Code');
    expect(formatTerminalTitle('   ', 'working')).toBe('🔴 Autohand Code');
  });

  it('writes only on a TTY without structured or protocol output', () => {
    expect(shouldWriteTerminalTitle(['node', 'autohand'], true)).toBe(true);
    expect(shouldWriteTerminalTitle(['node', 'autohand'], false)).toBe(false);
    expect(shouldWriteTerminalTitle(['node', 'autohand', '--json'], true)).toBe(false);
    expect(shouldWriteTerminalTitle(['node', 'autohand', '--output-format=stream-json'], true)).toBe(false);
    expect(shouldWriteTerminalTitle(['node', 'autohand', '--mode', 'rpc'], true)).toBe(false);
    expect(shouldWriteTerminalTitle(['node', 'autohand', '--acp'], true)).toBe(false);
  });

  it('strips control characters from the escape payload', () => {
    expect(terminalTitleSequence('a\x1b]0;b\x07c')).toBe('\x1b]0;a ]0;b c\x07');
  });

  it('emits OSC 0 on changes only, and restores the plain title', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, true);
    controller.setState('working');
    controller.setState('working');
    controller.setName('Fix caret');
    controller.setState('waiting');
    controller.setState('idle');
    controller.restore();

    expect(write.mock.calls.map(([text]) => text)).toEqual([
      '\x1b]0;🔴 Autohand Code\x07',
      '\x1b]0;🔴 Fix caret · Autohand\x07',
      '\x1b]0;🟡 Fix caret · Autohand\x07',
      '\x1b]0;🟢 Fix caret · Autohand\x07',
      '\x1b]0;Autohand Code\x07',
    ]);
  });

  it('stays silent when disabled', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, false);
    controller.setName('x');
    controller.setState('working');
    controller.restore();
    expect(write).not.toHaveBeenCalled();
    expect(controller.getTitle()).toBe('🔴 x · Autohand');
  });
});
