/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Key as InkKey } from 'ink';
import { TextBuffer } from '../../../src/ui/textBuffer.js';
import {
  getComposerHelpLine,
  getTextBufferCursorOffset,
  handleInkTextBufferInput,
} from '../../../src/ui/ink/AgentUI.js';

function createInkKey(overrides: Partial<InkKey> = {}): InkKey {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}

describe('AgentUI TextBuffer integration helpers', () => {
  it('inserts text at the cursor after arrow navigation', () => {
    const buffer = new TextBuffer(20, 10, 'hello');

    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    handleInkTextBufferInput(buffer, 'X', createInkKey());

    expect(buffer.getText()).toBe('hellXo');
    expect(getTextBufferCursorOffset(buffer)).toBe(5);
  });

  it('supports multiline cursor offsets', () => {
    const buffer = new TextBuffer(20, 10, 'hello\nworld');

    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));
    handleInkTextBufferInput(buffer, '', createInkKey({ leftArrow: true }));

    expect(getTextBufferCursorOffset(buffer)).toBe('hello\nwor'.length);
  });

  it('treats residual Shift+Enter fragments as newline insertion', () => {
    const buffer = new TextBuffer(20, 10, 'line1');

    const result = handleInkTextBufferInput(buffer, '13~', createInkKey());

    expect(result).toBe('handled');
    expect(buffer.getText()).toBe('line1\n');
  });

  it('submits on plain Enter without mutating the buffer', () => {
    const buffer = new TextBuffer(20, 10, 'line1');

    const result = handleInkTextBufferInput(buffer, '', createInkKey({ return: true }));

    expect(result).toBe('submit');
    expect(buffer.getText()).toBe('line1');
  });
});

describe('AgentUI layout stability', () => {
  it('keeps a placeholder help row while the first prompt is working', () => {
    expect(getComposerHelpLine(false, '70% context left', '? shortcuts · / commands')).toBe(
      '70% context left · ? shortcuts · / commands'
    );
    expect(getComposerHelpLine(true, '70% context left', '? shortcuts · / commands')).toBe(' ');
  });
});
