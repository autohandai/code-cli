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
  it('Shift+Enter inserts real newlines via TextBuffer', async () => {
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout();

    const origStdin = process.stdin;
    const origStdout = process.stdout;
    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    try {
      const { PersistentInput } = await import('../../src/ui/persistentInput.js');

      const input = new PersistentInput({ silentMode: true });
      input.start();

      // Simulate Shift+Enter via readline parsed (shift: true)
      emitKey(mockStdin, '\r', { name: 'return', sequence: '\r', shift: true });

      // Should insert a real newline (TextBuffer handles this)
      expect(input.getCurrentInput()).toBe('\n');

      // Also simulate Alt+Enter (ESC[13;3u)
      emitKey(mockStdin, '\x1b[13;3u', { sequence: '\x1b[13;3u' });

      // Two newlines now
      expect(input.getCurrentInput()).toBe('\n\n');

      // Also simulate Shift+Enter (CSI u protocol: ESC[13;2u)
      emitKey(mockStdin, '\x1b[13;2u', { sequence: '\x1b[13;2u' });

      // Three newlines
      expect(input.getCurrentInput()).toBe('\n\n\n');

      // Now verify normal typing still works after newlines
      emitKey(mockStdin, 'a', { name: 'a' });
      expect(input.getCurrentInput()).toBe('\n\n\na');

      input.stop();
    } finally {
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: origStdout, writable: true, configurable: true });
    }
  });
});

// ── TextBuffer integration ───────────────────────────────────────────

describe('PersistentInput TextBuffer integration', () => {
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

  it('uses TextBuffer for input state — typing accumulates text', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'hello');
    expect(input.getCurrentInput()).toBe('hello');

    input.stop();
  });

  it('backspace deletes one character at a time', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'abc');
    emitKey(mockStdin, '', { name: 'backspace' });
    expect(input.getCurrentInput()).toBe('ab');

    emitKey(mockStdin, '', { name: 'backspace' });
    expect(input.getCurrentInput()).toBe('a');

    input.stop();
  });

  it('backspace at line start merges lines (multi-line)', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    // Type "hello", then Shift+Enter for newline, then "world"
    typeString(mockStdin, 'hello');
    emitKey(mockStdin, '\r', { name: 'return', shift: true });
    typeString(mockStdin, 'world');

    expect(input.getCurrentInput()).toBe('hello\nworld');

    // Move cursor to start of "world" line — use Home key
    emitKey(mockStdin, '', { name: 'home' });

    // Now backspace should merge "world" with "hello"
    emitKey(mockStdin, '', { name: 'backspace' });
    expect(input.getCurrentInput()).toBe('helloworld');

    input.stop();
  });

  it('setCurrentInput replaces text via TextBuffer', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'original');
    input.setCurrentInput('replaced');
    expect(input.getCurrentInput()).toBe('replaced');

    input.stop();
  });

  it('emits input-change event with TextBuffer content', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    const changes: string[] = [];
    input.on('input-change', (text: string) => { changes.push(text); });

    typeString(mockStdin, 'hi');
    // Each character emits a change
    expect(changes).toEqual(['h', 'hi']);

    input.stop();
  });

  it('stop() clears input via TextBuffer', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'data');
    expect(input.getCurrentInput()).toBe('data');

    input.stop();
    expect(input.getCurrentInput()).toBe('');
  });

  it('? shortcut shows help when input is empty (via TextBuffer)', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: false });
    input.start();

    // ? on empty input shows help, does NOT insert ?
    emitKey(mockStdin, '?', { name: '?' });
    expect(input.getCurrentInput()).toBe('');

    input.stop();
  });

  it('? inserts character when input is non-empty', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'test');
    emitKey(mockStdin, '?', { name: '?' });
    expect(input.getCurrentInput()).toBe('test?');

    input.stop();
  });

  it('Enter submits multi-line text with actual newlines', async () => {
    vi.useFakeTimers();
    try {
      const { PersistentInput } = await import('../../src/ui/persistentInput.js');
      const input = new PersistentInput({ silentMode: true });
      input.start();

      const queuedMessages: string[] = [];
      input.on('queued', (text: string) => { queuedMessages.push(text); });

      // Build multi-line input
      typeString(mockStdin, 'line1');
      emitKey(mockStdin, '\r', { name: 'return', shift: true });
      typeString(mockStdin, 'line2');

      expect(input.getCurrentInput()).toBe('line1\nline2');

      // Submit with Enter
      pressEnter(mockStdin);
      vi.advanceTimersByTime(100);

      expect(queuedMessages).toHaveLength(1);
      expect(queuedMessages[0]).toBe('line1\nline2');

      // Input should be cleared after submit
      expect(input.getCurrentInput()).toBe('');

      input.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('arrow keys navigate within TextBuffer', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({ silentMode: true });
    input.start();

    typeString(mockStdin, 'abc');

    // Move left twice, then type 'X'
    emitKey(mockStdin, '', { name: 'left' });
    emitKey(mockStdin, '', { name: 'left' });
    emitKey(mockStdin, 'X', { name: 'X' });

    expect(input.getCurrentInput()).toBe('aXbc');

    input.stop();
  });

  it('Tab accepts the lazy suggestion when the composer is empty', async () => {
    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput({
      silentMode: true,
      suggestionProvider: () => 'Run the test suite',
    });
    input.start();

    emitKey(mockStdin, '\t', { name: 'tab', sequence: '\t' });

    expect(input.getCurrentInput()).toBe('Run the test suite');
    input.stop();
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

  it('keeps multi-line paste in the draft buffer until Enter', async () => {
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

    // Paste should stay in the draft, not auto-queue.
    expect(queuedMessages).toHaveLength(0);
    expect(input.getCurrentInput()).toBe('line one\nline two\nline three');

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

    // Paste should remain in the draft buffer.
    expect(input.getQueueLength()).toBe(0);
    expect(input.getCurrentInput()).toContain('line 1');
    expect(input.getCurrentInput()).toContain('line 15');

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
    vi.useFakeTimers();
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

    vi.advanceTimersByTime(100);

    expect(queuedMessages).toHaveLength(0);
    expect(input.getCurrentInput()).toBe('raw line 1\nraw line 2\nraw line 3');

    input.stop();
    vi.useRealTimers();
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
