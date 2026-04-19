/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessTerminal } from '../../../src/ui/terminal/ProcessTerminal.js';

// Mock stdin/stdout
function createMockStream() {
  const listeners = new Map<string, Set<Function>>();
  return {
    listeners,
    isTTY: true,
    columns: 80,
    rows: 24,
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    }),
    removeListener: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach(handler => handler(...args));
    }),
    resume: vi.fn(),
    pause: vi.fn(),
    setRawMode: vi.fn(),
    write: vi.fn(),
  };
}

describe('ProcessTerminal', () => {
  let mockStdin: ReturnType<typeof createMockStream>;
  let mockStdout: ReturnType<typeof createMockStream>;
  let terminal: ProcessTerminal;

  beforeEach(() => {
    mockStdin = createMockStream();
    mockStdout = createMockStream();
    terminal = new ProcessTerminal({
      stdin: mockStdin as unknown as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void },
      stdout: mockStdout as unknown as NodeJS.WriteStream,
    });
  });

  afterEach(async () => {
    try {
      await terminal.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });

  describe('properties', () => {
    it('returns terminal columns', () => {
      expect(terminal.columns).toBe(80);
    });

    it('returns terminal rows', () => {
      expect(terminal.rows).toBe(24);
    });

    it('returns false for kittyProtocolActive before start', () => {
      expect(terminal.kittyProtocolActive).toBe(false);
    });

    it('returns false for bracketedPasteActive before start', () => {
      expect(terminal.bracketedPasteActive).toBe(false);
    });
  });

  describe('start', () => {
    it('enables raw mode on TTY stdin', () => {
      const onInput = vi.fn();
      terminal.start(onInput);

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
      expect(mockStdin.resume).toHaveBeenCalled();
    });

    it('does not call setRawMode on non-TTY stdin', () => {
      mockStdin.isTTY = false;
      const onInput = vi.fn();
      terminal.start(onInput);

      expect(mockStdin.setRawMode).not.toHaveBeenCalled();
    });

    it('enables bracketed paste mode', () => {
      const onInput = vi.fn();
      terminal.start(onInput);

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?2004h');
      expect(terminal.bracketedPasteActive).toBe(true);
    });

    it('queries for Kitty protocol support', () => {
      const onInput = vi.fn();
      terminal.start(onInput);

      // Should send Kitty query: ESC [ ? u
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?u');
    });

    it('hides cursor on start', () => {
      const onInput = vi.fn();
      terminal.start(onInput);

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?25l');
    });

    it('registers resize handler on TTY stdout', () => {
      const onInput = vi.fn();
      const onResize = vi.fn();
      terminal.start(onInput, undefined, onResize);

      expect(mockStdout.on).toHaveBeenCalledWith('resize', expect.any(Function));
    });
  });

  describe('stop', () => {
    it('disables bracketed paste mode', async () => {
      const onInput = vi.fn();
      terminal.start(onInput);
      await terminal.stop();

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?2004l');
      expect(terminal.bracketedPasteActive).toBe(false);
    });

    it('shows cursor on stop', async () => {
      const onInput = vi.fn();
      terminal.start(onInput);
      await terminal.stop();

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?25h');
    });

    it('disables raw mode on TTY stdin', async () => {
      const onInput = vi.fn();
      terminal.start(onInput);
      await terminal.stop();

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      expect(mockStdin.pause).toHaveBeenCalled();
    });

    it('removes event listeners', async () => {
      const onInput = vi.fn();
      terminal.start(onInput);
      await terminal.stop();

      expect(mockStdin.removeListener).toHaveBeenCalled();
      expect(mockStdout.removeListener).toHaveBeenCalled();
    });
  });

  describe('cursor operations', () => {
    it('moveBy moves cursor down with positive value', () => {
      terminal.moveBy(5);
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[5B');
    });

    it('moveBy moves cursor up with negative value', () => {
      terminal.moveBy(-3);
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[3A');
    });

    it('moveBy does nothing with zero', () => {
      terminal.moveBy(0);
      expect(mockStdout.write).not.toHaveBeenCalled();
    });

    it('moveTo positions cursor at 1-based coordinates', () => {
      terminal.moveTo(5, 10);
      // Terminal uses 1-based, so row 5 -> 6, col 10 -> 11
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[6;11H');
    });

    it('hideCursor sends cursor hide sequence', () => {
      terminal.hideCursor();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?25l');
    });

    it('showCursor sends cursor show sequence', () => {
      terminal.showCursor();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?25h');
    });
  });

  describe('clearing operations', () => {
    it('clearLine clears entire line', () => {
      terminal.clearLine();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[2K');
    });

    it('clearToEndOfLine clears from cursor to end', () => {
      terminal.clearToEndOfLine();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[0K');
    });

    it('clearToStartOfLine clears from cursor to start', () => {
      terminal.clearToStartOfLine();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[1K');
    });

    it('clearScreen clears entire screen', () => {
      terminal.clearScreen();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[2J');
    });

    it('clearScreenAndScrollback clears screen and scrollback', () => {
      terminal.clearScreenAndScrollback();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[2J\x1b[H\x1b[3J');
    });

    it('clearToEndOfScreen clears from cursor to end of screen', () => {
      terminal.clearToEndOfScreen();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[0J');
    });
  });

  describe('synchronized output', () => {
    it('beginSync starts synchronized output mode', () => {
      terminal.beginSync();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?2026h');
    });

    it('endSync ends synchronized output mode', () => {
      terminal.endSync();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?2026l');
    });
  });

  describe('terminal title', () => {
    it('setTitle sets window title via OSC 0', () => {
      terminal.setTitle('My App');
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b]0;My App\x07');
    });
  });

  describe('alternate screen buffer', () => {
    it('enterAlternateScreen switches to alternate buffer', () => {
      terminal.enterAlternateScreen();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?1049h');
    });

    it('exitAlternateScreen switches back to main buffer', () => {
      terminal.exitAlternateScreen();
      expect(mockStdout.write).toHaveBeenCalledWith('\x1b[?1049l');
    });
  });

  describe('write', () => {
    it('writes data to stdout', () => {
      terminal.write('Hello, World!');
      expect(mockStdout.write).toHaveBeenCalledWith('Hello, World!');
    });
  });
});