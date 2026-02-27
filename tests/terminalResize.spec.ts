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
  it('invokes the provided callback after debounce period', async () => {
    vi.useFakeTimers();
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);
    stream.emit('resize');

    // Not called immediately — debounced
    expect(handler).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);

    watcher.dispose();
    vi.useRealTimers();
  });

  it('coalesces rapid resize events into a single callback', async () => {
    vi.useFakeTimers();
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);

    // Rapid-fire events (e.g. dragging window edge)
    stream.emit('resize');
    vi.advanceTimersByTime(20);
    stream.emit('resize');
    vi.advanceTimersByTime(20);
    stream.emit('resize');
    vi.advanceTimersByTime(20);
    stream.emit('resize');

    // Still within debounce window — not called yet
    expect(handler).not.toHaveBeenCalled();

    // After debounce settles
    vi.advanceTimersByTime(100);
    expect(handler).toHaveBeenCalledTimes(1);

    watcher.dispose();
    vi.useRealTimers();
  });

  it('stops reacting once disposed', () => {
    vi.useFakeTimers();
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);
    watcher.dispose();
    stream.emit('resize');
    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('cancels pending debounce timer on dispose', () => {
    vi.useFakeTimers();
    const stream = new FakeStream();
    const handler = vi.fn();

    const watcher = new TerminalResizeWatcher(stream as any, handler);
    stream.emit('resize');

    // Dispose before debounce fires
    watcher.dispose();
    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
