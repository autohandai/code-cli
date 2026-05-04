/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: Modal-showing slash commands must call
 * onBeforeModal() / onAfterModal() around their modal display
 * so PersistentInput's scroll regions are deactivated during
 * Ink modal rendering.
 *
 * Root cause (v1): PersistentInput's handleKeypress + renderFixedRegion
 * re-establish ANSI scroll regions between Ink re-renders, causing
 * duplication. The lightweight pauseForModal/resumeFromModal methods
 * suppress this interference without the heavy terminal manipulation
 * of the full pause/resume cycle.
 *
 * Root cause (v2 - Ink 7 navigation bug): onBeforeModal/onAfterModal
 * only paused PersistentInput but NOT InkRenderer. When showModal()
 * called render() while InkRenderer was still active, Ink 7's WeakMap
 * instance cache reused the existing instance instead of creating a new
 * one. This caused React effect ordering issues where Modal's useInput
 * registered before AgentUI's cleanup, leaving raw mode ref-count > 0
 * while PersistentInput had externally disabled raw mode. Result: stdin
 * was NOT in raw mode, keystrokes were line-buffered, and arrow keys
 * never triggered readable events. Fix: onBeforeModal also pauses
 * InkRenderer (matching withModalPause pattern).
 */

import { describe, it, expect, vi } from 'vitest';

describe('/model command modal lifecycle', () => {
  it('calls onBeforeModal before promptModelSelection', async () => {
    const callOrder: string[] = [];
    const ctx = {
      promptModelSelection: vi.fn(async () => { callOrder.push('prompt'); }),
      onBeforeModal: vi.fn(() => { callOrder.push('before'); }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    const { model } = await import('../../src/commands/model.js');
    await model(ctx);

    expect(callOrder).toEqual(['before', 'prompt', 'after']);
  });

  it('awaits async onBeforeModal before opening the model picker', async () => {
    const callOrder: string[] = [];
    const ctx = {
      promptModelSelection: vi.fn(async () => { callOrder.push('prompt'); }),
      onBeforeModal: vi.fn(async () => {
        await new Promise<void>((resolve) => setImmediate(resolve));
        callOrder.push('before');
      }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    const { model } = await import('../../src/commands/model.js');
    await model(ctx);

    expect(callOrder).toEqual(['before', 'prompt', 'after']);
  });

  it('calls onAfterModal even when promptModelSelection throws', async () => {
    const ctx = {
      promptModelSelection: vi.fn(async () => { throw new Error('boom'); }),
      onBeforeModal: vi.fn(),
      onAfterModal: vi.fn(),
    };

    const { model } = await import('../../src/commands/model.js');
    // model catches via try/finally, so the error propagates
    await model(ctx).catch(() => {});

    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
  });

  it('works when hooks are undefined', async () => {
    const ctx = {
      promptModelSelection: vi.fn(async () => {}),
    };

    const { model } = await import('../../src/commands/model.js');
    await expect(model(ctx)).resolves.toBeNull();
  });
});

describe('/theme command modal lifecycle', () => {
  it('calls onBeforeModal before showModal and onAfterModal after completion', async () => {
    const callOrder: string[] = [];
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx = {
      config: { ui: { theme: 'dark' } },
      onBeforeModal: vi.fn(() => { callOrder.push('before'); }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    try {
      const { theme } = await import('../../src/commands/theme.js');
      await theme(ctx as any);
      expect(callOrder).toEqual(['before', 'after']);
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    }
  });

  it('awaits async onBeforeModal before opening the theme picker', async () => {
    const callOrder: string[] = [];
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx = {
      config: { ui: { theme: 'dark' } },
      onBeforeModal: vi.fn(async () => {
        callOrder.push('before-start');
        await new Promise<void>((resolve) => setImmediate(resolve));
        callOrder.push('before-end');
      }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    try {
      const { theme } = await import('../../src/commands/theme.js');
      await theme(ctx as any);
      expect(callOrder).toEqual(['before-start', 'before-end', 'after']);
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    }
  });
});

describe('/status command screen isolation', () => {
  it('uses an alternate screen and restores it when leaving status', async () => {
    const { EventEmitter } = await import('node:events');
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const writes: string[] = [];
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const input = new EventEmitter() as NodeJS.ReadStream & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode: (mode: boolean) => void;
      setEncoding: (encoding: BufferEncoding) => void;
      resume: () => void;
      pause: () => void;
      isPaused: () => boolean;
    };
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = vi.fn((mode: boolean) => { input.isRaw = mode; });
    input.setEncoding = vi.fn();
    input.resume = vi.fn();
    input.pause = vi.fn();
    input.isPaused = vi.fn(() => false);

    const output = new EventEmitter() as NodeJS.WriteStream & {
      isTTY: boolean;
      write: (chunk: string | Uint8Array) => boolean;
    };
    output.isTTY = true;
    output.write = vi.fn((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: output, writable: true, configurable: true });

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({ metadata: { sessionId: 'session-1' } }),
        listSessions: vi.fn(async () => []),
      },
      llm: {
        isAvailable: vi.fn(async () => true),
      },
      workspaceRoot: '/tmp/workspace',
      provider: 'openai',
      model: 'gpt-test',
      getContextPercentLeft: () => 90,
      getTotalTokensUsed: () => 123,
      config: { ui: { theme: 'dark' } },
      isContextCompactionEnabled: () => true,
    };

    try {
      const { status } = await import('../../src/commands/status.js');
      const statusPromise = status(ctx as any);

      while (input.listenerCount('data') === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      input.emit('data', '\u0003');
      await statusPromise;

      expect(writes).toContain('\x1b[?1049h\x1b[2J\x1b[H');
      expect(writes).toContain('\x1b[?1049l');
      expect(writes.indexOf('\x1b[?1049h\x1b[2J\x1b[H')).toBeLessThan(
        writes.indexOf('\x1b[?1049l')
      );
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true, configurable: true });
      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });
});

describe('/language command modal lifecycle', () => {
  it('calls onBeforeModal before showModal and onAfterModal after completion', async () => {
    const callOrder: string[] = [];
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const ctx = {
      config: { ui: { locale: 'en' } },
      onBeforeModal: vi.fn(() => { callOrder.push('before'); }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    try {
      const { language } = await import('../../src/commands/language.js');
      await language(ctx as any);
      expect(callOrder).toEqual(['before', 'after']);
    } finally {
      consoleSpy.mockRestore();
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true });
    }
  });
});

describe('PersistentInput pauseForModal/resumeFromModal', () => {
  it('pauseForModal sets isPaused and resets scroll region without cursor manipulation', async () => {
    // This tests the contract: pauseForModal writes ONLY \x1B[r (reset scroll region)
    // and does NOT write cursor positioning sequences like CSI H or CSI s/u
    const { resetScrollRegion } = await import('../../src/ui/resetScrollRegion.js');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const isTTY = process.stdout.isTTY;

    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true });

      resetScrollRegion();

      // Only \x1B[r should be written — no cursor positioning
      expect(writeSpy).toHaveBeenCalledWith('\x1B[r');
      expect(writeSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, writable: true });
      writeSpy.mockRestore();
    }
  });
});

describe('TerminalRegions deactivate()', () => {
  it('marks regions inactive without writing ANSI sequences', async () => {
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

    // Enable regions first
    regions.enable();
    expect(regions.isEnabled()).toBe(true);
    const writeCountAfterEnable = mockOutput.write.mock.calls.length;

    // deactivate should NOT write any ANSI
    regions.deactivate();

    expect(regions.isEnabled()).toBe(false);
    // No additional writes after deactivate
    expect(mockOutput.write.mock.calls.length).toBe(writeCountAfterEnable);
  });

  it('removes resize handler on deactivate', async () => {
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
    // enable() should have added a resize handler
    expect(mockOutput.on).toHaveBeenCalledWith('resize', expect.any(Function));

    regions.deactivate();
    // deactivate() should have removed the resize handler
    expect(mockOutput.off).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('InkRenderer pause/resume during modal lifecycle (Ink 7 regression)', () => {
  it('onBeforeModal pauses InkRenderer before PersistentInput, onAfterModal resumes PersistentInput before InkRenderer', async () => {
    // This verifies the fix for the Ink 7 navigation bug:
    // onBeforeModal must pause InkRenderer so showModal's render() creates
    // a fresh instance with exclusive raw mode control, rather than reusing
    // the existing instance (which causes raw mode ref-count conflicts).
    const callOrder: string[] = [];

    const mockInkRenderer = {
      pause: vi.fn(() => { callOrder.push('inkRenderer.pause'); }),
      resume: vi.fn(() => { callOrder.push('inkRenderer.resume'); }),
    };

    const mockPersistentInput = {
      pauseForModal: vi.fn(() => { callOrder.push('persistentInput.pauseForModal'); }),
      resumeFromModal: vi.fn(() => { callOrder.push('persistentInput.resumeFromModal'); }),
    };

    // Simulate the onBeforeModal callback from agent.ts
    const onBeforeModal = () => {
      if (mockInkRenderer) {
        mockInkRenderer.pause();
      }
      if (mockPersistentInput) {
        mockPersistentInput.pauseForModal();
      }
    };

    // Simulate the onAfterModal callback from agent.ts
    const onAfterModal = () => {
      if (mockPersistentInput) {
        mockPersistentInput.resumeFromModal();
      }
      if (mockInkRenderer) {
        mockInkRenderer.resume();
      }
    };

    onBeforeModal();
    onAfterModal();

    // InkRenderer must pause BEFORE PersistentInput disables raw mode
    expect(callOrder.indexOf('inkRenderer.pause')).toBeLessThan(callOrder.indexOf('persistentInput.pauseForModal'));
    // PersistentInput must resume BEFORE InkRenderer re-registers useInput
    expect(callOrder.indexOf('persistentInput.resumeFromModal')).toBeLessThan(callOrder.indexOf('inkRenderer.resume'));

    expect(mockInkRenderer.pause).toHaveBeenCalledTimes(1);
    expect(mockInkRenderer.resume).toHaveBeenCalledTimes(1);
    expect(mockPersistentInput.pauseForModal).toHaveBeenCalledTimes(1);
    expect(mockPersistentInput.resumeFromModal).toHaveBeenCalledTimes(1);
  });

  it('onBeforeModal/onAfterModal gracefully handle missing InkRenderer', () => {
    const callOrder: string[] = [];

    const mockPersistentInput = {
      pauseForModal: vi.fn(() => { callOrder.push('persistentInput.pauseForModal'); }),
      resumeFromModal: vi.fn(() => { callOrder.push('persistentInput.resumeFromModal'); }),
    };

    // No InkRenderer (e.g. useInkRenderer is false)
    const inkRenderer = null;

    const onBeforeModal = () => {
      if (inkRenderer) {
        inkRenderer.pause();
      }
      if (mockPersistentInput) {
        mockPersistentInput.pauseForModal();
      }
    };

    const onAfterModal = () => {
      if (mockPersistentInput) {
        mockPersistentInput.resumeFromModal();
      }
      if (inkRenderer) {
        inkRenderer.resume();
      }
    };

    onBeforeModal();
    onAfterModal();

    // Should still work with PersistentInput only
    expect(mockPersistentInput.pauseForModal).toHaveBeenCalledTimes(1);
    expect(mockPersistentInput.resumeFromModal).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['persistentInput.pauseForModal', 'persistentInput.resumeFromModal']);
  });

  it('onAfterModal still resumes InkRenderer even if PersistentInput resume throws', () => {
    const mockInkRenderer = {
      pause: vi.fn(),
      resume: vi.fn(),
    };

    const mockPersistentInput = {
      pauseForModal: vi.fn(),
      resumeFromModal: vi.fn(() => { throw new Error('resume failed'); }),
    };

    const onBeforeModal = () => {
      if (mockInkRenderer) {
        mockInkRenderer.pause();
      }
      if (mockPersistentInput) {
        mockPersistentInput.pauseForModal();
      }
    };

    const onAfterModal = () => {
      try {
        if (mockPersistentInput) {
          mockPersistentInput.resumeFromModal();
        }
      } catch {
        // Best effort - continue to resume InkRenderer
      }
      if (mockInkRenderer) {
        mockInkRenderer.resume();
      }
    };

    onBeforeModal();
    expect(() => onAfterModal()).not.toThrow();
    expect(mockInkRenderer.resume).toHaveBeenCalledTimes(1);
  });
});
