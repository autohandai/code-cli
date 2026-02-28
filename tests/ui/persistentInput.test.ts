/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

describe('PersistentInput Shift+Enter suppression', () => {
  it('handleKeypress ignores Shift+Enter CSI u sequences without inserting characters', async () => {
    // Mock process.stdin/stdout before importing PersistentInput
    const mockStdin = new EventEmitter() as NodeJS.ReadStream & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
      isRaw: boolean;
      resume: () => void;
    };
    mockStdin.isTTY = true;
    mockStdin.isRaw = false;
    mockStdin.setRawMode = vi.fn((mode: boolean) => { mockStdin.isRaw = mode; });
    mockStdin.resume = vi.fn();

    const mockStdout = new EventEmitter() as NodeJS.WriteStream & {
      isTTY: boolean;
      rows: number;
      columns: number;
      write: (chunk: string) => boolean;
    };
    mockStdout.isTTY = true;
    mockStdout.rows = 24;
    mockStdout.columns = 80;
    mockStdout.write = vi.fn(() => true);

    // Patch process streams temporarily
    const origStdin = process.stdin;
    const origStdout = process.stdout;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    try {
      const { PersistentInput } = await import('../../src/ui/persistentInput.js');

      const input = new PersistentInput({ silentMode: true });
      input.start();

      // Simulate Shift+Enter (CSI u protocol: ESC[13;2u)
      const shiftEnterSeq = '\x1b[13;2u';
      const shiftEnterKey: readline.Key = { sequence: shiftEnterSeq } as readline.Key;
      mockStdin.emit('keypress', shiftEnterSeq, shiftEnterKey);

      // Also simulate Alt+Enter (ESC[13;3u)
      const altEnterSeq = '\x1b[13;3u';
      const altEnterKey: readline.Key = { sequence: altEnterSeq } as readline.Key;
      mockStdin.emit('keypress', altEnterSeq, altEnterKey);

      // Also simulate Shift+Enter via readline parsed (shift: true)
      const shiftReturnKey: readline.Key = { name: 'return', sequence: '\r', shift: true } as readline.Key;
      mockStdin.emit('keypress', '\r', shiftReturnKey);

      // No characters should have been added
      expect(input.getCurrentInput()).toBe('');

      // Now verify normal typing still works
      mockStdin.emit('keypress', 'a', { name: 'a' } as readline.Key);
      expect(input.getCurrentInput()).toBe('a');

      input.stop();
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: origStdout, writable: true, configurable: true });
    }
  });
});
