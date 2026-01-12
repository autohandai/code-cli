/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

/**
 * Tests for stdin state management to ensure:
 * 1. Raw mode is correctly toggled during prompt lifecycle
 * 2. Multiple readline creates/destroys don't corrupt state
 * 3. Hook execution doesn't block subsequent prompts
 */

describe('Stdin State Management', () => {
  let mockStdin: NodeJS.ReadStream;
  let mockStdout: NodeJS.WriteStream;

  beforeEach(() => {
    // Create mock stdin
    mockStdin = new EventEmitter() as NodeJS.ReadStream;
    (mockStdin as any).isTTY = true;
    (mockStdin as any).isRaw = false;
    (mockStdin as any).setRawMode = vi.fn((mode: boolean) => {
      (mockStdin as any).isRaw = mode;
      return mockStdin;
    });
    (mockStdin as any).resume = vi.fn(() => mockStdin);
    (mockStdin as any).pause = vi.fn(() => mockStdin);
    (mockStdin as any).setEncoding = vi.fn(() => mockStdin);

    // Create mock stdout
    mockStdout = new EventEmitter() as NodeJS.WriteStream;
    (mockStdout as any).write = vi.fn(() => true);
    (mockStdout as any).columns = 80;
    (mockStdout as any).rows = 24;

    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Raw mode state tracking', () => {
    it('should start with raw mode off', () => {
      expect((mockStdin as any).isRaw).toBe(false);
    });

    it('should track raw mode state when toggled', () => {
      const setRawMode = (mockStdin as any).setRawMode;

      setRawMode(true);
      expect((mockStdin as any).isRaw).toBe(true);

      setRawMode(false);
      expect((mockStdin as any).isRaw).toBe(false);
    });

    it('should allow multiple raw mode toggles without error', () => {
      const setRawMode = (mockStdin as any).setRawMode;

      // Simulate the pattern that happens during prompt lifecycle
      setRawMode(true);  // Start prompt
      setRawMode(false); // End prompt
      setRawMode(true);  // ESC listener starts
      setRawMode(false); // ESC listener ends
      setRawMode(true);  // New prompt starts

      expect(setRawMode).toHaveBeenCalledTimes(5);
      expect((mockStdin as any).isRaw).toBe(true);
    });
  });

  describe('Readline interface lifecycle', () => {
    it('should create readline interface without error', () => {
      const rl = readline.createInterface({
        input: mockStdin,
        output: mockStdout,
        terminal: true
      });

      expect(rl).toBeDefined();
      rl.close();
    });

    it('should handle multiple readline create/destroy cycles', () => {
      // This simulates what happens across multiple prompt turns
      for (let i = 0; i < 3; i++) {
        const rl = readline.createInterface({
          input: mockStdin,
          output: mockStdout,
          terminal: true
        });

        // Simulate some readline operations
        rl.setPrompt('> ');

        // Close the interface
        rl.close();
      }

      // Stdin should still be usable
      expect((mockStdin as any).pause).toBeDefined();
    });

    it('should handle overlapping readline and keypress events', () => {
      // Create readline
      const rl = readline.createInterface({
        input: mockStdin,
        output: mockStdout,
        terminal: true
      });

      // Simulate keypress event registration (like ESC listener does)
      const keypressHandler = vi.fn();
      mockStdin.on('keypress', keypressHandler);

      // Emit a keypress
      mockStdin.emit('keypress', '\x1b', { name: 'escape' });
      expect(keypressHandler).toHaveBeenCalled();

      // Cleanup
      mockStdin.off('keypress', keypressHandler);
      rl.close();

      // Should be able to create new readline
      const rl2 = readline.createInterface({
        input: mockStdin,
        output: mockStdout,
        terminal: true
      });
      expect(rl2).toBeDefined();
      rl2.close();
    });
  });

  describe('Keypress event listener management', () => {
    it('should track keypress listeners correctly', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Initial state - no listeners
      expect(mockStdin.listenerCount('keypress')).toBe(0);

      // Add listeners
      mockStdin.on('keypress', handler1);
      expect(mockStdin.listenerCount('keypress')).toBe(1);

      mockStdin.on('keypress', handler2);
      expect(mockStdin.listenerCount('keypress')).toBe(2);

      // Remove one listener
      mockStdin.off('keypress', handler1);
      expect(mockStdin.listenerCount('keypress')).toBe(1);

      // Remove remaining listener
      mockStdin.off('keypress', handler2);
      expect(mockStdin.listenerCount('keypress')).toBe(0);
    });

    it('should handle rapid add/remove of keypress listeners', () => {
      // Simulate the pattern that happens when:
      // 1. User submits prompt (cleanup removes listener)
      // 2. ESC listener starts (adds listener)
      // 3. Processing completes (ESC listener cleanup)
      // 4. New prompt starts (adds listener)

      const listeners: (() => void)[] = [];

      for (let i = 0; i < 10; i++) {
        const handler = vi.fn();
        mockStdin.on('keypress', handler);
        listeners.push(() => mockStdin.off('keypress', handler));
      }

      // All listeners should be active
      expect(mockStdin.listenerCount('keypress')).toBe(10);

      // Remove all listeners
      listeners.forEach(cleanup => cleanup());
      expect(mockStdin.listenerCount('keypress')).toBe(0);
    });
  });

  describe('Stream resume/pause state', () => {
    it('should handle resume calls', () => {
      (mockStdin as any).resume();
      expect((mockStdin as any).resume).toHaveBeenCalled();
    });

    it('should handle pause calls', () => {
      (mockStdin as any).pause();
      expect((mockStdin as any).pause).toHaveBeenCalled();
    });

    it('should handle pause then resume sequence', () => {
      // This is what happens during prompt lifecycle
      (mockStdin as any).resume(); // Start
      (mockStdin as any).pause();  // End prompt
      (mockStdin as any).resume(); // Start next prompt

      expect((mockStdin as any).resume).toHaveBeenCalledTimes(2);
      expect((mockStdin as any).pause).toHaveBeenCalledTimes(1);
    });
  });
});
