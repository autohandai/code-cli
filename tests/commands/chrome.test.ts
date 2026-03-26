/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for /chrome slash command:
 * - Modal lifecycle (onBeforeModal / onAfterModal)
 * - Full context passed from SlashCommandHandler
 * - No-session guard
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Modal lifecycle ────────────────────────────────────────────
describe('/chrome command modal lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('calls onBeforeModal before showModal and onAfterModal after', async () => {
    const callOrder: string[] = [];

    const showModal = vi.fn(async () => {
      callOrder.push('modal');
      return null; // user pressed ESC
    });

    vi.doMock('../../src/ui/ink/components/Modal.js', () => ({
      showModal,
      ModalOption: {},
    }));

    // Mock browser/chrome and rpcSocket to avoid real filesystem calls
    vi.doMock('../../src/browser/chrome.js', () => ({
      getManifestTarget: () => ({ manifestPath: '/fake/path' }),
      detectExtensionProfile: async () => null,
      ensureNativeHostInstalled: async () => {},
      createBrowserHandoff: async () => ({}),
      buildChromeOpenUrl: () => 'about:blank',
      openChromeContinuation: async () => {},
    }));
    vi.doMock('fs-extra', () => ({
      default: { pathExists: async () => true },
      pathExists: async () => true,
    }));

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({
          metadata: { sessionId: 'test-session-123' },
        }),
      },
      workspaceRoot: '/tmp/test',
      config: {},
      onBeforeModal: vi.fn(() => { callOrder.push('before'); }),
      onAfterModal: vi.fn(() => { callOrder.push('after'); }),
    };

    const { chrome } = await import('../../src/commands/chrome.js');
    await chrome(ctx as any);

    expect(callOrder).toEqual(['before', 'modal', 'after']);
  });

  it('calls onAfterModal even when showModal throws', async () => {
    const showModal = vi.fn(async () => { throw new Error('render crash'); });

    vi.doMock('../../src/ui/ink/components/Modal.js', () => ({
      showModal,
      ModalOption: {},
    }));
    vi.doMock('../../src/browser/chrome.js', () => ({
      getManifestTarget: () => ({ manifestPath: '/fake/path' }),
      detectExtensionProfile: async () => null,
      ensureNativeHostInstalled: async () => {},
      createBrowserHandoff: async () => ({}),
      buildChromeOpenUrl: () => 'about:blank',
      openChromeContinuation: async () => {},
    }));
    vi.doMock('fs-extra', () => ({
      default: { pathExists: async () => true },
      pathExists: async () => true,
    }));

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({
          metadata: { sessionId: 'test-session-123' },
        }),
      },
      workspaceRoot: '/tmp/test',
      config: {},
      onBeforeModal: vi.fn(),
      onAfterModal: vi.fn(),
    };

    const { chrome } = await import('../../src/commands/chrome.js');
    await chrome(ctx as any).catch(() => {});

    expect(ctx.onBeforeModal).toHaveBeenCalledTimes(1);
    expect(ctx.onAfterModal).toHaveBeenCalledTimes(1);
  });

  it('works when onBeforeModal/onAfterModal are undefined', async () => {
    const showModal = vi.fn(async () => null);

    vi.doMock('../../src/ui/ink/components/Modal.js', () => ({
      showModal,
      ModalOption: {},
    }));
    vi.doMock('../../src/browser/chrome.js', () => ({
      getManifestTarget: () => ({ manifestPath: '/fake/path' }),
      detectExtensionProfile: async () => null,
      ensureNativeHostInstalled: async () => {},
      createBrowserHandoff: async () => ({}),
      buildChromeOpenUrl: () => 'about:blank',
      openChromeContinuation: async () => {},
    }));
    vi.doMock('fs-extra', () => ({
      default: { pathExists: async () => true },
      pathExists: async () => true,
    }));

    const ctx = {
      sessionManager: {
        getCurrentSession: () => ({
          metadata: { sessionId: 'test-session-123' },
        }),
      },
      workspaceRoot: '/tmp/test',
      config: {},
      // no onBeforeModal / onAfterModal
    };

    const { chrome } = await import('../../src/commands/chrome.js');
    await expect(chrome(ctx as any)).resolves.toBeNull();
  });
});

// ─── No-session guard ───────────────────────────────────────────
describe('/chrome no-session guard', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns an error message when no active session', async () => {
    vi.doMock('../../src/browser/chrome.js', () => ({
      getManifestTarget: () => ({ manifestPath: '/fake/path' }),
      detectExtensionProfile: async () => null,
      ensureNativeHostInstalled: async () => {},
      createBrowserHandoff: async () => ({}),
      buildChromeOpenUrl: () => 'about:blank',
      openChromeContinuation: async () => {},
    }));
    vi.doMock('fs-extra', () => ({
      default: { pathExists: async () => false },
      pathExists: async () => false,
    }));

    const ctx = {
      sessionManager: {
        getCurrentSession: () => null,
      },
      workspaceRoot: '/tmp/test',
      config: {},
    };

    const { chrome } = await import('../../src/commands/chrome.js');
    const result = await chrome(ctx as any);

    expect(result).toContain('No active session');
  });
});

// ─── SlashCommandHandler passes full context ────────────────────
describe('SlashCommandHandler /chrome context', () => {
  it('passes the full context (not a subset) to the chrome command', async () => {
    // This is a regression test: the handler previously passed only
    // { sessionManager, workspaceRoot, config } which excluded
    // onBeforeModal/onAfterModal, causing garbled modal rendering.
    // Read the source to verify the handler passes this.ctx directly
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../src/core/slashCommandHandler.ts', import.meta.url).pathname.replace('/tests/commands/../../', '/'),
      'utf-8',
    );

    // The handler should call chrome(this.ctx), NOT chrome({ sessionManager: ... })
    const chromeCase = source.match(/case '\/chrome'[\s\S]*?return chrome\(([\s\S]*?)\)/);
    expect(chromeCase).toBeTruthy();

    const arg = chromeCase![1].trim();
    expect(arg).toBe('this.ctx');
  });
});
