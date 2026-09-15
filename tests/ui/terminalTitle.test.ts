/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  formatTerminalTitle,
  iTermTabColourSequence,
  shouldWriteTerminalTitle,
  TerminalTitleController,
  terminalTitleSequence,
  WORKING_SPINNER_FRAMES,
} from '../../src/ui/terminalTitle.js';

describe('terminal title', () => {
  it('spins braille while working and marks waiting, completed, and failed turns with small glyphs', () => {
    expect(formatTerminalTitle('Fix caret', 'working')).toBe('⠋ Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'working', 3)).toBe('⠸ Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'working', WORKING_SPINNER_FRAMES.length)).toBe('⠋ Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'waiting')).toBe('◐ Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'idle')).toBe('✓ Fix caret · Autohand');
    expect(formatTerminalTitle('Fix caret', 'failed')).toBe('✗ Fix caret · Autohand');
    expect(formatTerminalTitle(undefined, 'idle')).toBe('✓ Autohand Code');
    expect(formatTerminalTitle('   ', 'waiting')).toBe('◐ Autohand Code');
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
    expect(terminalTitleSequence('a\x1b]0;b\x07c')).toBe('\x1b]0;a ]0;b c\x1b\\');
  });

  it('mirrors status-row spinner frames only while working, and never after the turn ends', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, true);
    controller.setName('Fix caret');
    controller.setFrame(4);
    controller.setState('working');
    controller.setFrame(1);
    controller.setFrame(2);
    controller.setState('waiting');
    controller.setFrame(5);
    controller.setState('working');
    controller.restore();

    expect(write.mock.calls.map(([text]) => text)).toEqual([
      '\x1b]0;✓ Fix caret · Autohand\x1b\\',
      '\x1b]0;⠋ Fix caret · Autohand\x1b\\',
      '\x1b]0;⠙ Fix caret · Autohand\x1b\\',
      '\x1b]0;⠹ Fix caret · Autohand\x1b\\',
      '\x1b]0;◐ Fix caret · Autohand\x1b\\',
      '\x1b]0;⠋ Fix caret · Autohand\x1b\\',
      '\x1b]0;Autohand Code\x1b\\',
    ]);
  });

  it('keeps a failed turn marked through idle and clears it when the next turn starts', () => {
    const controller = new TerminalTitleController(vi.fn(), true);
    controller.setState('failed');
    controller.setState('idle');
    expect(controller.getTitle()).toBe('✗ Autohand Code');
    controller.setState('working');
    expect(controller.getTitle()).toBe('⠋ Autohand Code');
    controller.setState('idle');
    expect(controller.getTitle()).toBe('✓ Autohand Code');
  });

  it('colours the iTerm2 tab per state, leaves it default while working, and resets it on exit', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, true, { tabColour: true });
    controller.setState('working');
    controller.setState('waiting');
    controller.setState('failed');
    controller.restore();

    const colours = write.mock.calls.map(([text]) => text).filter((text) => text.startsWith('\x1b]6;'));
    expect(colours).toEqual([
      iTermTabColourSequence(undefined),
      iTermTabColourSequence([255, 149, 0]),
      iTermTabColourSequence([255, 59, 48]),
      iTermTabColourSequence(undefined),
    ]);
    expect(iTermTabColourSequence([52, 199, 89])).toBe(
      '\x1b]6;1;bg;red;brightness;52\x1b\\\x1b]6;1;bg;green;brightness;199\x1b\\\x1b]6;1;bg;blue;brightness;89\x1b\\',
    );
  });

  it('never writes tab colours for terminals that were not asked for them', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, true);
    controller.setState('waiting');
    controller.setState('failed');
    expect(write.mock.calls.some(([text]) => String(text).startsWith('\x1b]6;'))).toBe(false);
  });

  it('stays silent when disabled', () => {
    const write = vi.fn();
    const controller = new TerminalTitleController(write, false, { tabColour: true });
    controller.setName('x');
    controller.setState('working');
    controller.restore();
    expect(write).not.toHaveBeenCalled();
    expect(controller.getTitle()).toBe('⠋ x · Autohand');
  });
});
