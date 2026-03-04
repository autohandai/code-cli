/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';

// ── Shared mock helpers ──────────────────────────────────────────────

function createMockStdin() {
  const mockStdin = new EventEmitter() as NodeJS.ReadStream & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => void;
    isRaw: boolean;
    resume: () => void;
    pause: () => void;
  };
  mockStdin.isTTY = true;
  mockStdin.isRaw = false;
  mockStdin.setRawMode = vi.fn((mode: boolean) => { mockStdin.isRaw = mode; });
  mockStdin.resume = vi.fn();
  mockStdin.pause = vi.fn();
  return mockStdin;
}

function createMockStdout() {
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
  return mockStdout;
}

/** Emit a keypress event on mockStdin (matches readline.emitKeypressEvents format) */
function emitKey(mockStdin: EventEmitter, str: string, key: Partial<readline.Key> = {}) {
  mockStdin.emit('keypress', str, key as readline.Key);
}

/** Type a string character by character */
function typeString(mockStdin: EventEmitter, text: string) {
  for (const ch of text) {
    emitKey(mockStdin, ch, { name: ch });
  }
}

/** Send Enter key */
function pressEnter(mockStdin: EventEmitter) {
  emitKey(mockStdin, '\r', { name: 'return' });
}

describe('PersistentInput Shift+Enter handling', () => {
  it('handleKeypress inserts newline marker for Shift+Enter CSI/u and parsed variants', async () => {
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout();

    const origStdin = process.stdin;
    const origStdout = process.stdout;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    try {
      const { PersistentInput } = await import('../../src/ui/persistentInput.js');
      const { NEWLINE_MARKER } = await import('../../src/ui/inputPrompt.js');

      const input = new PersistentInput({ silentMode: true });
      input.start();

      // Simulate Shift+Enter (CSI u protocol: ESC[13;2u)
      emitKey(mockStdin, '\x1b[13;2u', { sequence: '\x1b[13;2u' });

      // Also simulate Alt+Enter (ESC[13;3u)
      emitKey(mockStdin, '\x1b[13;3u', { sequence: '\x1b[13;3u' });

      // Also simulate Shift+Enter via readline parsed (shift: true)
      emitKey(mockStdin, '\r', { name: 'return', sequence: '\r', shift: true });

      // Three newline markers should have been inserted
      expect(input.getCurrentInput()).toBe(`${NEWLINE_MARKER}${NEWLINE_MARKER}${NEWLINE_MARKER}`);

      // Now verify normal typing still works
      emitKey(mockStdin, 'a', { name: 'a' });
      expect(input.getCurrentInput()).toBe(`${NEWLINE_MARKER}${NEWLINE_MARKER}${NEWLINE_MARKER}a`);

      input.stop();
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: origStdout, writable: true, configurable: true });
    }
  });
});

// ── Bracketed paste handling ─────────────────────────────────────────

describe('PersistentInput bracketed paste handling', () => {
  let mockStdin: ReturnType<typeof createMockStdin>;
  let mockStdout: ReturnType<typeof createMockStdout>;
  let origStdin: NodeJS.ReadStream;
  let origStdout: NodeJS.WriteStream;

  beforeEach(() => {
    mockStdin = createMockStdin();
    mockStdout = createMockStdout();
    origStdin = process.stdin;
    origStdout = process.stdout;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: origStdout, writable: true, configurable: true });
  });

  it('enables bracketed paste on start() and disables on stop()', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });

    input.start();

    // Should have written ESC[?2004h to enable bracketed paste
    const writeCalls = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls;
    const enableCall = writeCalls.find((c: string[]) => c[0]?.includes('\x1b[?2004h'));
    expect(enableCall).toBeTruthy();

    input.stop();

    // Should have written ESC[?2004l to disable bracketed paste
    const writeCallsAfter = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls;
    const disableCall = writeCallsAfter.find((c: string[]) => c[0]?.includes('\x1b[?2004l'));
    expect(disableCall).toBeTruthy();
  });

  it('coalesces multi-line paste into a single queue entry', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    const queuedMessages: string[] = [];
    input.on('queued', (text: string) => { queuedMessages.push(text); });

    // Simulate bracketed paste: ESC[200~ ... ESC[201~
    // Paste start
    emitKey(mockStdin, '\x1b[200~', { sequence: '\x1b[200~' });

    // Pasted content: 3 lines
    typeString(mockStdin, 'line one');
    emitKey(mockStdin, '\r', { name: 'return' });
    typeString(mockStdin, 'line two');
    emitKey(mockStdin, '\r', { name: 'return' });
    typeString(mockStdin, 'line three');

    // Nothing queued yet — still in paste mode
    expect(queuedMessages).toHaveLength(0);

    // Paste end
    emitKey(mockStdin, '\x1b[201~', { sequence: '\x1b[201~' });

    // Should produce exactly ONE queue entry
    expect(queuedMessages).toHaveLength(1);
    expect(queuedMessages[0]).toContain('[Pasted: 3 lines]');
    expect(queuedMessages[0]).toContain('line one');
    expect(queuedMessages[0]).toContain('line two');
    expect(queuedMessages[0]).toContain('line three');

    input.stop();
  });

  it('does NOT queue individual lines during paste', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    const queueFullEvents: number[] = [];
    input.on('queue-full', (max: number) => { queueFullEvents.push(max); });

    // Simulate pasting 15 lines (which would overflow a maxQueueSize=10 without paste handling)
    emitKey(mockStdin, '\x1b[200~', { sequence: '\x1b[200~' });

    for (let i = 1; i <= 15; i++) {
      typeString(mockStdin, `line ${i}`);
      if (i < 15) emitKey(mockStdin, '\r', { name: 'return' });
    }

    emitKey(mockStdin, '\x1b[201~', { sequence: '\x1b[201~' });

    // Should NOT have triggered queue-full
    expect(queueFullEvents).toHaveLength(0);

    // Should have exactly one queued entry
    expect(input.getQueueLength()).toBe(1);

    input.stop();
  });

  it('normal Enter key still queues individually (not in paste mode)', async () => {
    vi.useFakeTimers();
    try {
      const { PersistentInput } = await import('../../src/ui/persistentInput.js');
      const input = new PersistentInput({ silentMode: true });
      input.start();

      const queuedMessages: string[] = [];
      input.on('queued', (text: string) => { queuedMessages.push(text); });

      // Type and submit first message, then wait for debounce to flush
      typeString(mockStdin, 'hello');
      pressEnter(mockStdin);
      vi.advanceTimersByTime(100); // flush rapid-Enter debounce

      // Type and submit second message
      typeString(mockStdin, 'world');
      pressEnter(mockStdin);
      vi.advanceTimersByTime(100); // flush again

      // Should produce two separate queue entries
      expect(queuedMessages).toHaveLength(2);
      expect(queuedMessages[0]).toBe('hello');
      expect(queuedMessages[1]).toBe('world');

      input.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles single-line paste without coalescing', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    const queuedMessages: string[] = [];
    input.on('queued', (text: string) => { queuedMessages.push(text); });

    // Paste a single line
    emitKey(mockStdin, '\x1b[200~', { sequence: '\x1b[200~' });
    typeString(mockStdin, 'just one line');
    emitKey(mockStdin, '\x1b[201~', { sequence: '\x1b[201~' });

    // Single-line paste should just add to currentInput, not auto-queue
    // (or queue as the plain text without [Pasted:] prefix)
    expect(input.getCurrentInput()).toBe('just one line');
    expect(queuedMessages).toHaveLength(0);

    input.stop();
  });

  it('handles rapid paste without bracketed paste markers via debounce', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    const queuedMessages: string[] = [];
    input.on('queued', (text: string) => { queuedMessages.push(text); });

    // Simulate raw paste without bracketed paste markers:
    // Characters arrive very fast with newlines — should NOT queue each line
    // The debounce mechanism should coalesce them
    typeString(mockStdin, 'raw line 1');
    emitKey(mockStdin, '\r', { name: 'return' });
    typeString(mockStdin, 'raw line 2');
    emitKey(mockStdin, '\r', { name: 'return' });
    typeString(mockStdin, 'raw line 3');
    emitKey(mockStdin, '\r', { name: 'return' });

    // Without bracketed paste, the fallback is rapid Enter debounce.
    // Each Enter arrives synchronously, so they should be coalesced
    // into fewer queue entries than 3.
    // This test documents the expected behavior - implementation should
    // coalesce rapid Enters into a single paste entry.

    // For now, with synchronous event emission in tests, the debounce
    // timer hasn't expired between Enters, so all should be coalesced.
    // We'll verify the queue doesn't have 3 separate entries.
    expect(queuedMessages.length).toBeLessThanOrEqual(1);

    input.stop();
  });

  it('can rebind streams after stdin source changes (pipe -> tty)', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');

    const pipedStdin = new EventEmitter() as NodeJS.ReadStream & {
      isTTY: boolean;
      resume: () => void;
      pause: () => void;
      setRawMode?: (mode: boolean) => void;
      isRaw?: boolean;
    };
    pipedStdin.isTTY = false;
    pipedStdin.resume = vi.fn();
    pipedStdin.pause = vi.fn();

    const ttyStdin = createMockStdin();
    const ttyStdout = createMockStdout();

    Object.defineProperty(process, 'stdin', { value: pipedStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: ttyStdout, writable: true, configurable: true });

    const input = new PersistentInput({ silentMode: true });

    // Simulate reopening /dev/tty and rebinding after construction
    Object.defineProperty(process, 'stdin', { value: ttyStdin, writable: true, configurable: true });
    input.rebindStreams();
    input.start();

    emitKey(ttyStdin, 'h', { name: 'h' });
    emitKey(ttyStdin, 'i', { name: 'i' });

    expect(input.getCurrentInput()).toBe('hi');
    input.stop();
  });
});
