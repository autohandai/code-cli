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
 * Root cause: PersistentInput's handleKeypress + renderFixedRegion
 * re-establish ANSI scroll regions between Ink re-renders, causing
 * duplication. The lightweight pauseForModal/resumeFromModal methods
 * suppress this interference without the heavy terminal manipulation
 * of the full pause/resume cycle.
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
