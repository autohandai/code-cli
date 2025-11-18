/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TerminalResizeWatcher } from '../src/ui/terminalResize.js';

class FakeStream extends EventEmitter {
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener);
  }
}

describe('TerminalResizeWatcher', () => {
  it('invokes the provided callback when resize events occur', () => {
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);
    stream.emit('resize');
    stream.emit('resize');

    expect(handler).toHaveBeenCalledTimes(2);
    watcher.dispose();
  });

  it('stops reacting once disposed', () => {
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);
    watcher.dispose();
    stream.emit('resize');

    expect(handler).not.toHaveBeenCalled();
  });
});
