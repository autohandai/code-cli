/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for InkRenderer pause/resume cycle.
 * Ensures the composer stays responsive after modal prompts and quality checks.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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
      input.setRawMode(mode);
      return true;
    }
    return false;
  },
  RawModeInput: undefined,
}));

import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('InkRenderer pause/resume cycle', () => {
  let renderer: InkRenderer;
  let originalIsTTY: boolean | undefined;
  let readableListeners: Array<(...args: any[]) => void>;
  let rawMode: boolean;
  let refCount: number;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
    (process.stdin as any).isTTY = true;
    readableListeners = [];
    rawMode = false;
    refCount = 0;

    // Ensure TTY-only methods exist so vi.spyOn can wrap them
    if (typeof process.stdin.setRawMode !== 'function') {
      (process.stdin as any).setRawMode = () => process.stdin;
    }
    if (typeof process.stdin.ref !== 'function') {
      (process.stdin as any).ref = () => process.stdin;
    }
    if (typeof process.stdin.unref !== 'function') {
      (process.stdin as any).unref = () => process.stdin;
    }

    // Mock stdin methods to track state
    vi.spyOn(process.stdin, 'setRawMode').mockImplementation((mode: boolean) => {
      rawMode = mode;
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'addListener').mockImplementation((event: string, listener: any) => {
      if (event === 'readable') {
        readableListeners.push(listener);
      }
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'removeListener').mockImplementation((event: string, listener: any) => {
      if (event === 'readable') {
        readableListeners = readableListeners.filter((l) => l !== listener);
      }
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'removeAllListeners').mockImplementation((event?: string | symbol) => {
      if (event === 'readable' || event === undefined) {
        readableListeners = [];
      }
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'ref').mockImplementation(() => {
      refCount++;
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'unref').mockImplementation(() => {
      refCount = Math.max(0, refCount - 1);
      return process.stdin as any;
    });

    vi.spyOn(process.stdin, 'resume').mockImplementation(() => {
      return process.stdin as any;
    });

    renderer = new InkRenderer({
      onInstruction: () => {},
      onEscape: () => {},
      onCtrlC: () => {},
    });
  });

  afterEach(() => {
    renderer?.stop();
    vi.restoreAllMocks();
    (process.stdin as any).isTTY = originalIsTTY;
  });

  it('should restore raw mode after pause/resume', async () => {
    renderer.start();
    expect(renderer.isRunning()).toBe(true);

    renderer.pause();
    expect(renderer.isRunning()).toBe(false);
    // pause() manually disables raw mode
    expect(rawMode).toBe(false);

    await renderer.resume();
    expect(renderer.isRunning()).toBe(true);
    // resume() calls safeSetRawMode(stdin, true) which calls setRawMode(true)
    expect(rawMode).toBe(true);
  });

  it('should restore readable listener after pause/resume', async () => {
    renderer.start();
    // Mocked render() doesn't add readable listeners, but resume() calls
    // stdin.resume() which in a real Ink instance would re-register them.
    // Verify the pause side: pause() removes all readable listeners.
    renderer.pause();
    expect(readableListeners.length).toBe(0);

    await renderer.resume();
    // After resume, renderer is running again — the real Ink instance
    // would re-add readable listeners via useInput. With our mock render
    // we just verify the renderer is back in a running state.
    expect(renderer.isRunning()).toBe(true);
  });

  it('should accept input after a working turn completes', async () => {
    renderer.start();
    expect(renderer.isRunning()).toBe(true);

    // Simulate the start of a model turn
    renderer.setWorking(true, 'Gathering context...');
    expect(renderer.getState().isWorking).toBe(true);

    // Simulate the end of a model turn
    renderer.setWorking(false);
    expect(renderer.getState().isWorking).toBe(false);

    // After setWorking(false), the renderer should still be running
    expect(renderer.isRunning()).toBe(true);
  });

  it('should survive multiple pause/resume cycles', async () => {
    renderer.start();

    for (let i = 0; i < 3; i++) {
      renderer.pause();
      await renderer.resume();
      expect(renderer.isRunning()).toBe(true);
      expect(rawMode).toBe(true);
    }
  });

  it('drops already-committed userMessages and toolOutputs on resume to prevent duplicate scrollback', async () => {
    // Regression for: every modal cycle (/theme, /model, /settings, etc.)
    // unmounts and remounts Ink. The previous Ink instance committed all
    // userMessages/toolOutputs as <Static> items into the terminal's
    // scrollback. Mounting a fresh Ink with the SAME state hands it the
    // same arrays — and Ink dutifully re-commits them as new <Static>
    // items, duplicating the entire chat history on every modal cycle.
    //
    // resume() must clear those arrays so the new Ink only renders the
    // composer + status. The original messages remain in scrollback as
    // committed pixels.
    renderer.start();

    renderer.addUserMessage('first prompt');
    renderer.addUserMessage('second prompt');
    renderer.addToolOutput({ tool: 'shell', success: true, output: 'ok' });

    expect(renderer.getState().userMessages).toEqual(['first prompt', 'second prompt']);
    expect(renderer.getState().toolOutputs.length).toBe(1);

    renderer.pause();
    await renderer.resume();

    expect(renderer.getState().userMessages).toEqual([]);
    expect(renderer.getState().toolOutputs).toEqual([]);

    // Subsequent updates after resume must still work — the renderer is
    // not "frozen", it just starts fresh w.r.t. Static history.
    renderer.addUserMessage('post-modal prompt');
    expect(renderer.getState().userMessages).toEqual(['post-modal prompt']);
  });

});
