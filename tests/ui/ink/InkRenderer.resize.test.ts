/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression coverage for synchronized terminal resize paints.
 * Keeps viewport resets within complete frame writes and preserves inline output.
 */

import { describe, expect, it, vi } from 'vitest';

// Mock ink's render before importing InkRenderer so the module-level
// import gets the stub.  Ink's render() patches console.Console which
// doesn't exist in vitest's node environment.
vi.mock('ink', () => {
  return {
    render: vi.fn(() => ({
      unmount: vi.fn(),
      rerender: vi.fn(),
      clear: vi.fn(),
      waitUntilExit: vi.fn(),
    })),
    Box: (() => null) as any,
    Text: (() => null) as any,
    useInput: vi.fn(),
    useApp: vi.fn(() => ({ exit: vi.fn() })),
    useStdin: vi.fn(() => ({ isStdin: true, isStdout: true })),
    Newline: (() => null) as any,
    Static: (() => null) as any,
    Transform: (() => null) as any,
    measureElement: vi.fn(),
  };
});

// Mock safeSetRawMode to actually call setRawMode so our spy tracks it
vi.mock('../../../src/ui/rawMode.js', () => ({
  safeSetRawMode: (input: any, mode: boolean) => {
    if (input?.isTTY && typeof input.setRawMode === 'function') {
      try {
        input.setRawMode(mode);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  },
  RawModeInput: undefined,
}));

import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('terminal resize painting', () => {
  async function withInteractiveTerminal(run: (writes: string[], failNextWrite: (error: Error) => void) => Promise<void>, writeResult = true): Promise<void> {
    const saved = (['isTTY', 'columns', 'rows', 'writableHighWaterMark'] as const).map(name => [name, Object.getOwnPropertyDescriptor(process.stdout, name)] as const);
    const inputDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const term = process.env.TERM;
    const writes: string[] = [];
    let writeError: Error | undefined;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
      if (writeError) {
        const error = writeError;
        writeError = undefined;
        throw error;
      }
      writes.push(String(chunk));
      const complete = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      complete?.();
      return writeResult;
    }) as typeof process.stdout.write);
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 40 });
    process.env.TERM = 'xterm-256color';
    try {
      await run(writes, error => { writeError = error; });
    } finally {
      write.mockRestore();
      if (inputDescriptor) Object.defineProperty(process.stdin, 'isTTY', inputDescriptor); else Reflect.deleteProperty(process.stdin, 'isTTY');
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(process.stdout, name, descriptor); else Reflect.deleteProperty(process.stdout, name);
      }
      if (term === undefined) delete process.env.TERM; else process.env.TERM = term;
    }
  }

  const resizeTo = (columns: number, rows: number) => {
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: columns });
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: rows });
    process.stdout.emit('resize');
  };

  it('publishes clear and repaint in one write without nested synchronization boundaries', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ fullScreenMode: true, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      try {
        renderer.start();
        await Promise.resolve();
        writes.length = 0;
        process.stdout.write('\x1b[2K');
        process.stdout.write('\x1b[?2026h');
        process.stdout.write('complete frame');
        process.stdout.write('\x1b[?2026l');
        expect(writes).toHaveLength(0);
        await Promise.resolve();
        expect(writes).toEqual(['\x1b[?2026h\x1b[2Kcomplete frame\x1b[?2026l']);
      } finally {
        await renderer.stop();
      }
    });
  });

  it('writes external panel clears before native console output while the renderer is paused', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ onInstruction() {}, onEscape() {}, onCtrlC() {} });
      try {
        renderer.start();
        await Promise.resolve();
        renderer.pause();
        await Promise.resolve();
        writes.length = 0;
        process.stdout.write('\x1b[2J\x1b[H');
        writes.push('native console panel');
        await Promise.resolve();
        expect(writes[0]).toContain('\x1b[2J\x1b[H');
        expect(writes[1]).toBe('native console panel');
      } finally { await renderer.stop(); }
    });
  });

  it('keeps explicit Ink frames atomic while the agent renderer is paused', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ onInstruction() {}, onEscape() {}, onCtrlC() {} });
      try {
        renderer.start();
        await Promise.resolve();
        renderer.pause();
        await Promise.resolve();
        writes.length = 0;
        process.stdout.write('\x1b[?2026h');
        process.stdout.write('modal Ink frame');
        process.stdout.write('\x1b[?2026l');
        expect(writes).toEqual([]);
        await Promise.resolve();
        expect(writes).toEqual(['\x1b[?2026hmodal Ink frame\x1b[?2026l']);
      } finally { await renderer.stop(); }
    });
  });

  it('preserves write callbacks and flushes pending output before restoring stdout', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ fullScreenMode: false, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      const complete = vi.fn();
      try {
        renderer.start();
        await Promise.resolve();
        writes.length = 0;
        process.stdout.write(Buffer.from('buffer'), complete);
        process.stdout.write(' text', 'utf8', complete);
        expect(complete).not.toHaveBeenCalled();
        await renderer.stop();
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('buffer text');
        expect(complete).toHaveBeenCalledTimes(2);
        const flushed = writes.length;
        await Promise.resolve();
        expect(writes).toHaveLength(flushed);
      } finally {
        await renderer.stop();
      }
    });
  });

  it('bounds queued bytes and returns the underlying backpressure signal', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ fullScreenMode: false, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      try {
        renderer.start();
        await Promise.resolve();
        writes.length = 0;
        Object.defineProperty(process.stdout, 'writableHighWaterMark', { configurable: true, value: 16 });
        expect(process.stdout.write('12345678')).toBe(true);
        expect(process.stdout.write('abcdefgh')).toBe(false);
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('12345678abcdefgh');
        const drained = vi.fn();
        process.stdout.once('drain', drained);
        process.stdout.emit('drain');
        expect(drained).toHaveBeenCalledOnce();
      } finally {
        await renderer.stop();
      }
    }, false);
  });

  it('restores stdout if flushing the last frame throws', async () => {
    await withInteractiveTerminal(async (_writes, failNextWrite) => {
      const originalWrite = process.stdout.write;
      const renderer = new InkRenderer({ fullScreenMode: false, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      try {
        renderer.start();
        await Promise.resolve();
        process.stdout.write('pending frame');
        failNextWrite(new Error('terminal write failed'));
        await expect(renderer.stop()).rejects.toThrow('terminal write failed');
        expect(process.stdout.write).toBe(originalWrite);
      } finally {
        await renderer.stop();
      }
    });
  });

  it('resets the full-screen origin inside the next synchronized paint after resize', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ fullScreenMode: true, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      try {
        renderer.start();
        await Promise.resolve();
        writes.length = 0;
        resizeTo(120, 40);
        expect(writes.filter(text => text.includes('\x1b[2J\x1b[H'))).toHaveLength(0);
        resizeTo(80, 40);
        resizeTo(80, 24);
        await Promise.resolve();
        expect(writes).toHaveLength(0);
        process.stdout.write('\x1b[?25l');
        await Promise.resolve();
        expect(writes.join('')).not.toContain('\x1b[2J\x1b[H');
        writes.length = 0;
        process.stdout.write('\x1b[?2026h');
        await Promise.resolve();
        process.stdout.write('\x1b[?25l');
        expect(writes.join('')).not.toContain('\x1b[2J\x1b[H');
        process.stdout.write('resized frame');
        process.stdout.write('\x1b[?2026l');
        await Promise.resolve();
        const frame = writes.join('');
        expect(frame).toContain('\x1b[2J\x1b[H');
        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('\x1b[2J\x1b[Hresized frame');
        expect(frame.indexOf('\x1b[?2026h')).toBeLessThan(frame.indexOf('\x1b[2J\x1b[H'));
        expect(frame.indexOf('resized frame')).toBeLessThan(frame.lastIndexOf('\x1b[?2026l'));
        writes.length = 0;
        process.stdout.write('\x1b[?2026h');
        process.stdout.write('same viewport');
        process.stdout.write('\x1b[?2026l');
        await Promise.resolve();
        expect(writes.join('')).not.toContain('\x1b[2J\x1b[H');
        await renderer.stop();
        writes.length = 0;
        resizeTo(100, 30);
        expect(writes).toHaveLength(0);
      } finally {
        await renderer.stop();
      }
    });
  });

  it('leaves inline terminal resizes to Ink', async () => {
    await withInteractiveTerminal(async writes => {
      const renderer = new InkRenderer({ fullScreenMode: false, onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
      try {
        renderer.start();
        writes.length = 0;
        resizeTo(80, 24);
        expect(writes.some(text => text.includes('\x1b[2J'))).toBe(false);
      } finally {
        await renderer.stop();
      }
    });
  });

});
