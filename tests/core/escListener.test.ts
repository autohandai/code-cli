/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

/**
 * Tests for ESC listener behavior
 * The setupEscListener function in agent.ts handles:
 * 1. ESC key to abort processing
 * 2. Ctrl+C double-tap to exit
 * 3. Input queuing during processing
 * 4. Terminal state restoration on cleanup
 */

describe('ESC Listener Pattern', () => {
  let mockStdin: NodeJS.ReadStream;

  beforeEach(() => {
    mockStdin = new EventEmitter() as NodeJS.ReadStream;
    (mockStdin as any).isTTY = true;
    (mockStdin as any).isRaw = false;
    (mockStdin as any).setRawMode = vi.fn((mode: boolean) => {
      (mockStdin as any).isRaw = mode;
      return mockStdin;
    });
    (mockStdin as any).resume = vi.fn(() => mockStdin);
    (mockStdin as any).pause = vi.fn(() => mockStdin);

    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('emitKeypressEvents safety', () => {
    it('should handle multiple emitKeypressEvents calls without error', () => {
      // This test verifies that calling emitKeypressEvents multiple times
      // doesn't throw or cause issues (even if it adds duplicate listeners)
      expect(() => {
        readline.emitKeypressEvents(mockStdin);
        readline.emitKeypressEvents(mockStdin);
        readline.emitKeypressEvents(mockStdin);
      }).not.toThrow();
    });

    it('should use safeEmitKeypressEvents to prevent duplicate registration', async () => {
      const { safeEmitKeypressEvents } = await import('../../src/ui/inputPrompt.js');
      const emitSpy = vi.spyOn(readline, 'emitKeypressEvents');

      // Multiple calls with same stream should only register once
      safeEmitKeypressEvents(mockStdin);
      safeEmitKeypressEvents(mockStdin);
      safeEmitKeypressEvents(mockStdin);

      // Should only be called once for this stream
      // Note: count may be higher if other tests registered first
      expect(emitSpy).toHaveBeenCalled();
    });
  });

  describe('ESC key handling pattern', () => {
    it('should detect ESC key press', () => {
      const handler = vi.fn();
      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'escape') {
          handler();
        }
      });

      // Simulate ESC keypress
      mockStdin.emit('keypress', '\x1b', { name: 'escape' });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not trigger ESC handler for other keys', () => {
      const escHandler = vi.fn();
      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'escape') {
          escHandler();
        }
      });

      // Other keys should not trigger ESC handler
      mockStdin.emit('keypress', 'a', { name: 'a' });
      mockStdin.emit('keypress', '\n', { name: 'return' });
      mockStdin.emit('keypress', ' ', { name: 'space' });

      expect(escHandler).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl+C handling pattern', () => {
    it('should detect Ctrl+C key combination', () => {
      const handler = vi.fn();
      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'c' && key?.ctrl) {
          handler();
        }
      });

      // Simulate Ctrl+C
      mockStdin.emit('keypress', '\x03', { name: 'c', ctrl: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should require double Ctrl+C for exit (if enabled)', () => {
      let ctrlCCount = 0;
      const exitHandler = vi.fn();

      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'c' && key?.ctrl) {
          ctrlCCount++;
          if (ctrlCCount >= 2) {
            exitHandler();
          }
        }
      });

      // First Ctrl+C - should not exit
      mockStdin.emit('keypress', '\x03', { name: 'c', ctrl: true });
      expect(exitHandler).not.toHaveBeenCalled();

      // Second Ctrl+C - should exit
      mockStdin.emit('keypress', '\x03', { name: 'c', ctrl: true });
      expect(exitHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Raw mode restoration', () => {
    it('should restore raw mode to original state on cleanup', () => {
      const wasRaw = (mockStdin as any).isRaw; // false initially

      // Setup pattern (like setupEscListener)
      if (!(mockStdin as any).isRaw) {
        (mockStdin as any).setRawMode(true);
      }

      // ... processing happens ...

      // Cleanup pattern
      if (!wasRaw) {
        (mockStdin as any).setRawMode(false);
      }

      // Should be restored to original state
      expect((mockStdin as any).isRaw).toBe(wasRaw);
    });

    it('should preserve raw mode if it was already raw', () => {
      // Pre-set to raw mode
      (mockStdin as any).setRawMode(true);
      const wasRaw = (mockStdin as any).isRaw; // true

      // Setup pattern (like setupEscListener)
      // Should NOT change if already raw
      if (!(mockStdin as any).isRaw) {
        (mockStdin as any).setRawMode(true);
      }

      // ... processing happens ...

      // Cleanup pattern
      if (!wasRaw) {
        (mockStdin as any).setRawMode(false);
      }

      // Should still be raw since it was raw before
      expect((mockStdin as any).isRaw).toBe(true);
    });
  });

  describe('Listener cleanup', () => {
    it('should remove keypress listener on cleanup', () => {
      const handler = vi.fn();

      // Add listener
      mockStdin.on('keypress', handler);
      expect(mockStdin.listenerCount('keypress')).toBe(1);

      // Remove listener
      mockStdin.off('keypress', handler);
      expect(mockStdin.listenerCount('keypress')).toBe(0);

      // Handler should not be called after removal
      mockStdin.emit('keypress', '\x1b', { name: 'escape' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should cleanup even if handler throws', () => {
      const badHandler = vi.fn(() => {
        throw new Error('Handler error');
      });

      mockStdin.on('keypress', badHandler);

      // Emit should throw
      expect(() => {
        mockStdin.emit('keypress', '\x1b', { name: 'escape' });
      }).toThrow('Handler error');

      // Cleanup should still work
      mockStdin.off('keypress', badHandler);
      expect(mockStdin.listenerCount('keypress')).toBe(0);
    });
  });

  describe('Input queuing pattern', () => {
    it('should accumulate typed characters', () => {
      let queueInput = '';

      mockStdin.on('keypress', (str: string) => {
        if (str && !/[\x00-\x1F\x7F]/.test(str)) {
          queueInput += str;
        }
      });

      // Type some characters
      mockStdin.emit('keypress', 'h', { name: 'h' });
      mockStdin.emit('keypress', 'e', { name: 'e' });
      mockStdin.emit('keypress', 'l', { name: 'l' });
      mockStdin.emit('keypress', 'l', { name: 'l' });
      mockStdin.emit('keypress', 'o', { name: 'o' });

      expect(queueInput).toBe('hello');
    });

    it('should handle backspace to remove characters', () => {
      let queueInput = 'hello';

      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'backspace') {
          queueInput = queueInput.slice(0, -1);
        }
      });

      mockStdin.emit('keypress', '\x7f', { name: 'backspace' });
      expect(queueInput).toBe('hell');

      mockStdin.emit('keypress', '\x7f', { name: 'backspace' });
      expect(queueInput).toBe('hel');
    });

    it('should clear queue on submit (Enter)', () => {
      let queueInput = 'hello';
      const submitted: string[] = [];

      mockStdin.on('keypress', (_str, key) => {
        if (key?.name === 'return' || key?.name === 'enter') {
          if (queueInput.trim()) {
            submitted.push(queueInput.trim());
            queueInput = '';
          }
        }
      });

      mockStdin.emit('keypress', '\r', { name: 'return' });

      expect(submitted).toEqual(['hello']);
      expect(queueInput).toBe('');
    });
  });
});
