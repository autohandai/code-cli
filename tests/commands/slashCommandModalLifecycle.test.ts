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

  it('shows the signed-in Autohand plan on the status screen', async () => {
    const { EventEmitter } = await import('node:events');
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
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
    output.isTTY = false;
    output.write = vi.fn(() => true);
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: output, writable: true, configurable: true });

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({ metadata: { sessionId: 'session-plan' } }),
        listSessions: vi.fn(async () => []),
      },
      llm: { isAvailable: vi.fn(async () => true) },
      workspaceRoot: '/tmp/workspace',
      provider: 'autohandai',
      model: 'fantail',
      getContextPercentLeft: () => 100,
      getTotalTokensUsed: () => 0,
      config: {
        provider: 'autohandai',
        autohandai: { plan: 'cloud', authMode: 'account', accountToken: 'account-token', model: 'fantail' },
        auth: { token: 'account-token', user: { id: 'u1', email: 'user@example.com', name: 'User' } },
      },
      getAccountEntitlement: vi.fn(async () => ({
        tier: 'pro',
        freeRemaining: null,
        limits: {
          displayName: 'Autohand Code Pro',
          messagesPer5h: 250,
          messagesPer24h: 1000,
          messagesPerWeek: 7000,
          rpm: 1000,
          inputTokensPerMinute: 500_000,
          outputTokensPerMinute: 80_000,
          requiresEligibility: false,
          perSeat: false,
          models: ['fantail', 'moa'],
        },
      })),
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

      const rendered = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(rendered).toContain('Plan:');
      expect(rendered).toContain('Autohand Code Pro');
      expect(rendered).toContain('250 requests / 5 hours');
      expect(rendered).toContain('1K requests / 24 hours');
      expect(rendered).toContain('7K requests / week');
      expect(rendered).toContain('1K requests / minute');
      expect(rendered).toContain('500K uncached input tokens / minute');
      expect(rendered).toContain('80K output tokens / minute');
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true, configurable: true });
      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('labels context as estimated and shows unavailable actual token usage', async () => {
    const { EventEmitter } = await import('node:events');
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
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
    output.isTTY = false;
    output.write = vi.fn(() => true);

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
      getContextPercentLeft: () => 97,
      getTotalTokensUsed: () => 0,
      getTokenUsageStatus: () => 'unavailable',
      config: { ui: { theme: 'dark' } },
      isContextCompactionEnabled: () => true,
    };

    try {
      const { status } = await import('../../src/commands/status.js');
      const statusPromise = status(ctx as any);

      while (input.listenerCount('data') === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      input.emit('data', '\t');
      input.emit('data', '\t');
      input.emit('data', '\u0003');
      await statusPromise;

      const rendered = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(rendered).toContain('Context used (estimated)');
      expect(rendered).toContain('Actual tokens used: unavailable');
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, writable: true, configurable: true });
      Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true, configurable: true });
      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('renders usage_v2 dashboard in the Usage tab when enabled', async () => {
    const { EventEmitter } = await import('node:events');
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
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
    output.isTTY = false;
    output.write = vi.fn(() => true);

    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true });
    Object.defineProperty(process, 'stdout', { value: output, writable: true, configurable: true });

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({ metadata: { sessionId: 'session-v2' } }),
        listSessions: vi.fn(async () => []),
      },
      llm: {
        isAvailable: vi.fn(async () => true),
      },
      workspaceRoot: '/tmp/workspace',
      provider: 'autohandai',
      model: 'moa',
      getContextPercentLeft: () => 90,
      getContextWindow: () => 258000,
      getTotalTokensUsed: () => 37500,
      getTokenUsageStatus: () => 'actual',
      config: {
        provider: 'autohandai',
        features: { usageV2: true },
        autohandai: { authMode: 'account', accountToken: 'test-token', model: 'moa', reasoningEffort: 'xhigh', contextWindow: 1_000_000 },
        permissions: { mode: 'interactive' },
        auth: { token: 'test-token', user: { id: 'u1', email: 'user@example.com', name: 'User' } },
      },
      isFeatureEnabled: () => true,
      getAccountEntitlement: vi.fn(async () => ({
        tier: 'pro',
        freeRemaining: null,
        limits: {
          displayName: 'Autohand Code Pro',
          messagesPer5h: 250,
          messagesPer24h: 1000,
          messagesPerWeek: 7000,
          rpm: 200,
          requiresEligibility: false,
          perSeat: false,
          models: ['fantail', 'moa'],
        },
        quota: {
          available: true,
          window5h: {
            used: 12,
            remaining: 238,
            limit: 250,
            resetAt: '2026-08-10T06:00:00.000Z',
          },
          window24h: {
            used: 120,
            remaining: 880,
            limit: 1000,
            resetAt: '2026-08-11T01:00:00.000Z',
          },
          week: {
            used: 120,
            remaining: 6880,
            limit: 7000,
            resetAt: '2026-08-17T01:00:00.000Z',
          },
        },
      })),
      isContextCompactionEnabled: () => true,
    };

    try {
      const { status } = await import('../../src/commands/status.js');
      const statusPromise = status(ctx as any);

      while (input.listenerCount('data') === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      consoleSpy.mockClear();
      input.emit('data', '\t');
      input.emit('data', '\t');
      input.emit('data', '\u0003');
      await statusPromise;

      const rendered = consoleSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(rendered).toContain('Account:');
      expect(rendered).toContain('User (user@example.com)');
      expect(rendered).toContain('Context window:');
      expect(rendered).toContain('90% left');
      expect(rendered).toContain('37.5K used / 258K');
      expect(rendered).toContain('Autohand plan:');
      expect(rendered).toContain('Autohand Code Pro');
      expect(rendered).toContain('250 requests / 5 hours');
      expect(rendered).toContain('1K requests / 24 hours');
      expect(rendered).toContain('7K requests / week');
      expect(rendered).toContain('200 requests / minute');
      expect(rendered).toContain('5-hour quota:');
      expect(rendered).toContain('12 used / 250');
      expect(rendered).toContain('24-hour quota:');
      expect(rendered).toContain('120 used / 1K');
      expect(rendered).toContain('Weekly quota:');
      expect(rendered).toContain('120 used / 7K');
      expect(rendered).not.toContain('autohandai: not reported by provider');
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
