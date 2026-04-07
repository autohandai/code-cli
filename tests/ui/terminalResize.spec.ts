/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'vitest';
import { TerminalResizeWatcher } from '../../src/ui/terminalResize.js';

function makeMockStream(): NodeJS.WriteStream & { emitResize: () => void } {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    on: vi.fn((event: string, cb: () => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    off: vi.fn((event: string, cb: () => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(l => l !== cb);
      }
    }),
    emitResize: () => {
      if (listeners['resize']) {
        listeners['resize'].forEach(cb => cb());
      }
    },
  } as unknown as NodeJS.WriteStream & { emitResize: () => void };
}

describe('TerminalResizeWatcher', () => {
  it('debounces rapid resize events', async () => {
    const stream = makeMockStream();
    let callCount = 0;
    const watcher = new TerminalResizeWatcher(stream, () => { callCount++; }, 50);

    // Simulate rapid resizing (like window dragging)
    stream.emitResize();
    stream.emitResize();
    stream.emitResize();
    stream.emitResize();
    stream.emitResize();

    // Should not have called yet (still within debounce window)
    expect(callCount).toBe(0);

    // Wait past debounce window
    await new Promise(r => setTimeout(r, 100));
    expect(callCount).toBe(1);

    // Another burst of the same rapid events
    stream.emitResize();
    stream.emitResize();
    await new Promise(r => setTimeout(r, 100));

    // Still only one more call (debounced)
    expect(callCount).toBe(2);

    watcher.dispose();
  });

  it('does not call after dispose', async () => {
    const stream = makeMockStream();
    let callCount = 0;
    const watcher = new TerminalResizeWatcher(stream, () => { callCount++; }, 50);

    watcher.dispose();
    stream.emitResize();
    await new Promise(r => setTimeout(r, 100));

    expect(callCount).toBe(0);
  });

  it('gracefully handles undefined stream', () => {
    // Should not throw even with undefined stream
    const watcher = new TerminalResizeWatcher(undefined, () => {}, 50);
    watcher.dispose();
  });

  it('gracefully handles double dispose', () => {
    const stream = makeMockStream();
    const watcher = new TerminalResizeWatcher(stream, () => {}, 50);
    watcher.dispose();
    // Should not throw
    watcher.dispose();
  });
});
