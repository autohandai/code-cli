/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for the /model modal rendering corruption bug.
 *
 * Root cause:
 *   pauseForModal() was "lightweight" — it only wrote \x1B[r to reset the
 *   scroll region and called regions.deactivate(). It did NOT clear the
 *   fixed-region lines (input box, status bar, activity line) that were
 *   already painted on screen. Ink then started rendering from the cursor
 *   position left by focusInputCursor() — which was INSIDE the fixed region.
 *   Result: the fixed region's top rows (borders, status) remained visible as
 *   ghost content behind the modal. Combined with the console bridge still
 *   routing log calls to writeAbove() during the modal, this caused both the
 *   "garbled characters" and "welcome banner bleeds through" symptoms.
 *
 * Fix:
 *   pauseForModal() must clear the fixed region lines and position the cursor
 *   at the bottom of the scroll area before deactivating, giving Ink a clean
 *   slate to render into.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

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

function createMockStdout(rows = 24, columns = 80) {
  const mockStdout = new EventEmitter() as NodeJS.WriteStream & {
    isTTY: boolean;
    rows: number;
    columns: number;
    write: (chunk: string) => boolean;
  };
  mockStdout.isTTY = true;
  mockStdout.rows = rows;
  mockStdout.columns = columns;
  mockStdout.write = vi.fn(() => true);
  return mockStdout;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PersistentInput.pauseForModal() — screen clearing before Ink', () => {
  let originalStdin: NodeJS.ReadStream;
  let originalStdout: NodeJS.WriteStream;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true, configurable: true });
    vi.resetModules();
  });

  it('pauseForModal clears fixed-region lines so Ink has a clean canvas', async () => {
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout(24, 80);

    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput();
    input.start();

    const writeCalls = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls;
    const countAfterStart = writeCalls.length;
    expect(countAfterStart).toBeGreaterThan(0); // start() does write (enable + render)

    (mockStdout.write as ReturnType<typeof vi.fn>).mockClear();

    input.pauseForModal();

    const pauseWrites = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls
      .map(([arg]: [string]) => arg as string);

    // Must reset scroll region
    expect(pauseWrites).toContain('\x1B[r');

    // Must write at least one CSI K (erase line) to clear fixed-region rows
    const hasEraseLine = pauseWrites.some((s) => s.includes('\x1B[K') || s === '\x1B[K');
    expect(hasEraseLine).toBe(true);

    // Regions must be marked inactive so renderFixedRegion() no-ops during modal
    // (tested indirectly: a subsequent render() call should not write anything)
    (mockStdout.write as ReturnType<typeof vi.fn>).mockClear();
    input.render(); // render() returns early when !isActive || isPaused
    expect((mockStdout.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);

    input.stop();
  });

  it('pauseForModal positions cursor at scroll region bottom for Ink start position', async () => {
    const rows = 30;
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout(rows, 120);

    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput();
    input.start();

    (mockStdout.write as ReturnType<typeof vi.fn>).mockClear();
    input.pauseForModal();

    const pauseWrites = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls
      .map(([arg]: [string]) => arg as string);

    // Must contain a cursor-positioning sequence that moves OUT of the fixed region.
    // The scroll region bottom is height - fixedLines. With 5 fixed lines and 30 rows,
    // scrollEnd = 25. The cursor must be positioned at row <= 25 (not in fixed area rows 26-30).
    //
    // We assert that at least one CSI H sequence exists (cursor absolute position)
    const hasCursorPosition = pauseWrites.some((s) => /\x1B\[\d+;\d+H/.test(s));
    expect(hasCursorPosition).toBe(true);

    // The cursor row in the CSI H sequence should be <= scrollEnd (rows - 5 = 25)
    const scrollEnd = rows - 5; // 5 fixed lines (activity + topBorder + input + bottomBorder + status)
    const cursorPositions = pauseWrites
      .flatMap((s) => [...s.matchAll(/\x1B\[(\d+);\d+H/g)])
      .map((m) => parseInt(m[1], 10));

    // At least one position should be at or before scrollEnd
    const hasPositionInScrollArea = cursorPositions.some((row) => row <= scrollEnd);
    expect(hasPositionInScrollArea).toBe(true);

    input.stop();
  });

  it('handleKeypress is suppressed (isPaused=true) after pauseForModal', async () => {
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout();

    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput();
    input.start();
    input.pauseForModal();

    (mockStdout.write as ReturnType<typeof vi.fn>).mockClear();

    // Simulate keypress — should be a no-op (isPaused = true)
    mockStdin.emit('keypress', 'a', { name: 'a' });

    // No writes should happen as a result of the keypress
    expect((mockStdout.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(input.getCurrentInput()).toBe('');

    input.stop();
  });

  it('resumeFromModal re-enables regions and re-renders the fixed area', async () => {
    const mockStdin = createMockStdin();
    const mockStdout = createMockStdout();

    Object.defineProperty(process, 'stdin', { value: mockStdin, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true, configurable: true });

    const { PersistentInput } = await import('../../src/ui/persistentInput.js');
    const input = new PersistentInput();
    input.start();
    input.pauseForModal();

    (mockStdout.write as ReturnType<typeof vi.fn>).mockClear();
    input.resumeFromModal();

    const resumeWrites = (mockStdout.write as ReturnType<typeof vi.fn>).mock.calls
      .map(([arg]: [string]) => arg as string);

    // resumeFromModal must re-establish the scroll region
    const hasScrollRegion = resumeWrites.some((s) => /\x1B\[1;\d+r/.test(s));
    expect(hasScrollRegion).toBe(true);

    // And must re-render the fixed region (CSI H for cursor positioning)
    const hasCursorPosition = resumeWrites.some((s) => /\x1B\[\d+;\d+H/.test(s));
    expect(hasCursorPosition).toBe(true);

    input.stop();
  });
});

describe('TerminalRegions.clearFixedRegionForModal()', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('clears all fixed-region rows and positions cursor at scroll bottom', async () => {
    const { TerminalRegions } = await import('../../src/ui/terminalRegions.js');

    const mockOutput = {
      isTTY: true,
      write: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn(),
      columns: 80,
      rows: 24,
    } as any;

    const regions = new TerminalRegions(mockOutput);
    regions.enable();

    // Clear the write spy after enable() to inspect only clearFixedRegionForModal writes
    (mockOutput.write as ReturnType<typeof vi.fn>).mockClear();

    regions.clearFixedRegionForModal();

    const writes = (mockOutput.write as ReturnType<typeof vi.fn>).mock.calls
      .map(([arg]: [string]) => arg as string);

    // Must reset scroll region
    expect(writes).toContain('\x1B[r');

    // Must erase lines in fixed region area (CSI K)
    const eraseCount = writes.filter((s) => s === '\x1B[K').length;
    expect(eraseCount).toBeGreaterThanOrEqual(5); // at least fixedLines erases

    // Must position cursor at scroll bottom (row = height - fixedLines)
    // With 24 rows and 5 fixedLines, scrollEnd = 19
    const scrollEnd = 24 - 5; // 19
    const hasCursorAtScrollBottom = writes.some((s) => s === `\x1B[${scrollEnd};1H`);
    expect(hasCursorAtScrollBottom).toBe(true);

    // Regions must still be inactive after this call
    expect(regions.isEnabled()).toBe(false);
  });

  it('is a no-op when regions are not active', async () => {
    const { TerminalRegions } = await import('../../src/ui/terminalRegions.js');

    const mockOutput = {
      isTTY: true,
      write: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn(),
      columns: 80,
      rows: 24,
    } as any;

    const regions = new TerminalRegions(mockOutput);
    // Never call enable() — regions start inactive

    regions.clearFixedRegionForModal();

    // Should write nothing since regions were never active
    expect((mockOutput.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
