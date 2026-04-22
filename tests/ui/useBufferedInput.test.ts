/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { useBufferedInput } from '../../src/ui/useBufferedInput.js';
import { StdinBuffer } from '../../src/ui/StdinBuffer.js';
import { Box, Text } from 'ink';

function TestInputComponent({ onInput }: { onInput: (input: string, key: unknown, info?: unknown) => void }) {
  useBufferedInput({
    onInput,
    isActive: true,
  });

  return React.createElement(Box, null, React.createElement(Text, null, 'ready'));
}

describe('useBufferedInput', () => {
  it('renders without crashing', () => {
    const onInput = vi.fn();
    const { lastFrame } = render(React.createElement(TestInputComponent, { onInput }));
    expect(lastFrame()).toContain('ready');
  });

  it('does not interfere with Ink stdin handling', () => {
    const onInput = vi.fn();
    const { stdin } = render(React.createElement(TestInputComponent, { onInput }));

    // Writing to stdin should NOT trigger useBufferedInput's callback
    // because connecting to stdin would break Ink's readable-mode input.
    stdin.write('a');
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe('StdinBuffer sequence parsing', () => {
  it('emits printable data immediately', () => {
    const buffer = new StdinBuffer();
    const spy = vi.fn();
    buffer.on('data', spy);

    buffer.process('hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('buffers incomplete CSI until complete', () => {
    const buffer = new StdinBuffer();
    const spy = vi.fn();
    buffer.on('data', spy);

    buffer.process('\x1b[');
    expect(spy).not.toHaveBeenCalled();

    buffer.process('A');
    expect(spy).toHaveBeenCalledWith('\x1b[A');
  });

  it('emits paste event for bracketed paste', () => {
    const buffer = new StdinBuffer();
    const pasteSpy = vi.fn();
    const dataSpy = vi.fn();
    buffer.on('paste', pasteSpy);
    buffer.on('data', dataSpy);

    buffer.process('\x1b[200~pasted content\x1b[201~');

    expect(pasteSpy).toHaveBeenCalledWith('pasted content');
    expect(dataSpy).not.toHaveBeenCalled();
  });

  it('flushes incomplete sequences on timeout', async () => {
    const buffer = new StdinBuffer({ timeout: 20 });
    const spy = vi.fn();
    buffer.on('data', spy);

    buffer.process('\x1b[');
    expect(spy).not.toHaveBeenCalled();

    await new Promise(r => setTimeout(r, 40));
    expect(spy).toHaveBeenCalledWith('\x1b[');
  });
});
