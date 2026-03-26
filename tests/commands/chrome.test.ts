/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /chrome slash command:
 * - Modal lifecycle (onBeforeModal / onAfterModal)
 * - No-session guard
 * - /chrome disconnect subcommand
 * - Toggle option (flip + re-show + clear terminal output)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mocks (Bun-compatible) ─────────────────────────────
var mockShowModal = vi.fn();
var mockSaveConfig = vi.fn();
var mockPathExists = vi.fn();
var mockEnsureNativeHostInstalled = vi.fn();
var mockDetectExtensionProfile = vi.fn();
var mockHasActiveHandoff = vi.fn();
var mockCreateBrowserHandoff = vi.fn();
var mockOpenChromeContinuation = vi.fn();

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: mockShowModal,
  ModalOption: {},
}));

vi.mock('../../src/browser/chrome.js', () => ({
  getManifestTarget: () => ({ manifestPath: '/fake/path' }),
  detectExtensionProfile: mockDetectExtensionProfile,
  ensureNativeHostInstalled: mockEnsureNativeHostInstalled,
  createBrowserHandoff: mockCreateBrowserHandoff,
  buildChromeOpenUrl: () => 'about:blank',
  openChromeContinuation: mockOpenChromeContinuation,
  hasActiveHandoff: mockHasActiveHandoff,
}));

vi.mock('../../src/config.js', () => ({
  saveConfig: mockSaveConfig,
}));

vi.mock('fs-extra', () => ({
  default: { pathExists: mockPathExists },
  pathExists: mockPathExists,
}));

vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    red: (s: string) => s,
    gray: (s: string) => s,
    cyan: (s: string) => s,
    yellow: Object.assign((s: string) => s, { bold: (s: string) => s }),
    white: (s: string) => s,
  },
}));

const { chrome } = await import('../../src/commands/chrome.js');

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    sessionManager: {
      getCurrentSession: () => ({
        metadata: { sessionId: 'test-session-123' },
      }),
    },
    workspaceRoot: '/tmp/test',
    config: { chrome: {} } as Record<string, unknown>,
    onBeforeModal: vi.fn(),
    onAfterModal: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPathExists.mockResolvedValue(true);
  mockEnsureNativeHostInstalled.mockResolvedValue(undefined);
  mockDetectExtensionProfile.mockResolvedValue(null);
  mockHasActiveHandoff.mockResolvedValue(false);
  mockCreateBrowserHandoff.mockResolvedValue({});
  mockOpenChromeContinuation.mockResolvedValue(undefined);
  mockSaveConfig.mockResolvedValue(undefined);
  mockShowModal.mockResolvedValue(null); // default: ESC
});

// ─── Modal lifecycle ────────────────────────────────────────────
describe('/chrome command modal lifecycle', () => {
  it('calls onBeforeModal before showModal and onAfterModal after', async () => {
    const callOrder: string[] = [];
    const ctx = makeCtx({
      onBeforeModal: vi.fn(() => callOrder.push('before')),
      onAfterModal: vi.fn(() => callOrder.push('after')),
    });

    mockShowModal.mockImplementation(async () => {
      callOrder.push('modal');
      return null;
    });

    await chrome(ctx as any);
    expect(callOrder).toEqual(['before', 'modal', 'after']);
  });

  it('calls onAfterModal even when showModal throws', async () => {
    const ctx = makeCtx();
    mockShowModal.mockRejectedValue(new Error('render crash'));

    await chrome(ctx as any).catch(() => {});

    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
  });

  it('works when onBeforeModal/onAfterModal are undefined', async () => {
    const ctx = makeCtx();
    delete (ctx as any).onBeforeModal;
    delete (ctx as any).onAfterModal;

    await expect(chrome(ctx as any)).resolves.toBeNull();
  });
});

// ─── No-session guard ───────────────────────────────────────────
describe('/chrome no-session guard', () => {
  it('returns an error message when no active session', async () => {
    const ctx = makeCtx({
      sessionManager: { getCurrentSession: () => null },
    });

    const result = await chrome(ctx as any);
    expect(result).toContain('No active session');
  });
});

// ─── /chrome disconnect subcommand ──────────────────────────────
describe('/chrome disconnect', () => {
  it('disables enabledByDefault and saves config', async () => {
    const config: Record<string, unknown> = {
      chrome: { enabledByDefault: true },
    };
    const ctx = makeCtx({ config });

    const result = await chrome(ctx as any, ['disconnect']);

    expect(result).toContain('disconnected');
    expect((config.chrome as Record<string, unknown>).enabledByDefault).toBe(false);
    expect(mockSaveConfig).toHaveBeenCalledOnce();
  });

  it('does not require an active session', async () => {
    const ctx = makeCtx({
      sessionManager: { getCurrentSession: () => null },
    });

    const result = await chrome(ctx as any, ['disconnect']);
    expect(result).toContain('disconnected');
    expect(result).not.toContain('No active session');
  });
});

// ─── Toggle option ──────────────────────────────────────────────
describe('/chrome toggle enabled by default', () => {
  it('flips enabledByDefault, saves config, and re-shows modal', async () => {
    const config: Record<string, unknown> = {
      chrome: { enabledByDefault: false },
    };
    const ctx = makeCtx({ config });

    let callCount = 0;
    mockShowModal.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { label: 'toggle', value: 'toggle' };
      return null; // ESC on second show
    });

    const result = await chrome(ctx as any);

    expect(result).toBeNull(); // ESC exits
    expect(mockShowModal).toHaveBeenCalledTimes(2);
    expect(mockSaveConfig).toHaveBeenCalledOnce();
    expect((config.chrome as Record<string, unknown>).enabledByDefault).toBe(true);
  });

  it('clears terminal output before re-showing modal after toggle', async () => {
    const ctx = makeCtx({ config: { chrome: { enabledByDefault: false } } });
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    let callCount = 0;
    mockShowModal.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { label: 'toggle', value: 'toggle' };
      return null;
    });

    try {
      await chrome(ctx as any);

      // Should have written ANSI cursor-up + erase sequence before the second modal
      const writes = stdoutSpy.mock.calls.map(c => c[0]);
      const clearWrite = writes.find(
        (w) => typeof w === 'string' && w.includes('\x1b[') && w.includes('A') && w.includes('\x1b[0J')
      );
      expect(clearWrite).toBeTruthy();
    } finally {
      stdoutSpy.mockRestore();
    }
  });

  it('re-shows modal with updated label after toggle', async () => {
    const ctx = makeCtx({ config: { chrome: { enabledByDefault: false } } });

    let callCount = 0;
    mockShowModal.mockImplementation(async (opts: { options: Array<{ label: string; value: string }> }) => {
      callCount++;
      const toggleOpt = opts.options.find(o => o.value === 'toggle');
      if (callCount === 1) {
        expect(toggleOpt?.label).toContain('No');
        return { label: 'toggle', value: 'toggle' };
      }
      // After toggle: label should say "Yes"
      expect(toggleOpt?.label).toContain('Yes');
      return null;
    });

    await chrome(ctx as any);
    expect(mockShowModal).toHaveBeenCalledTimes(2);
  });

  it('keeps cursor on toggle option when re-showing', async () => {
    const ctx = makeCtx({ config: { chrome: { enabledByDefault: false } } });

    let callCount = 0;
    mockShowModal.mockImplementation(async (opts: { initialIndex?: number }) => {
      callCount++;
      if (callCount === 1) return { label: 'toggle', value: 'toggle' };
      // Second call should have initialIndex=3 (the toggle option)
      expect(opts.initialIndex).toBe(3);
      return null;
    });

    await chrome(ctx as any);
  });
});

// ─── SlashCommandHandler passes full context ────────────────────
describe('SlashCommandHandler /chrome context', () => {
  it('passes the full context and args to the chrome command', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/core/slashCommandHandler.ts', import.meta.url).pathname.replace('/tests/commands/../../', '/'),
      'utf-8',
    );

    const chromeCase = source.match(/case '\/chrome'[\s\S]*?return chrome\(([\s\S]*?)\)/);
    expect(chromeCase).toBeTruthy();

    const arg = chromeCase![1].trim();
    expect(arg).toContain('this.ctx');
    expect(arg).toContain('args');
  });
});
