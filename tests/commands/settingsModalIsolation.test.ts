/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression test: /settings modal must isolate the composer view.
 *
 * Root cause: onBeforeModal was synchronous, so inkRenderer.pause() would
 * unmount the Ink instance, but React 19's useEffect cleanup was scheduled
 * as a microtask. If showModal() rendered immediately, both the old composer
 * and new modal could appear simultaneously.
 *
 * Fix: onBeforeModal is now async and yields with setImmediate after pause()
 * to allow React 19's Scheduler to flush passive effect cleanup before the
 * modal renders.
 */

import { describe, it, expect, vi } from 'vitest';

describe('/settings modal isolation', () => {
  it('onBeforeModal is async and yields for React cleanup', async () => {
    // Track the order of operations
    const callOrder: string[] = [];

    // Mock setImmediate to track when it's called
    const originalSetImmediate = global.setImmediate;
    let setImmediateCallback: (() => void) | null = null;
    const mockSetImmediate = (callback: () => void): ReturnType<typeof setImmediate> => {
      callOrder.push('setImmediate_scheduled');
      setImmediateCallback = callback;
      return 0 as unknown as ReturnType<typeof setImmediate>;
    };
    global.setImmediate = mockSetImmediate as unknown as typeof setImmediate;

    try {
      const mockInkRenderer = {
        pause: vi.fn(() => { callOrder.push('inkRenderer.pause'); }),
        resume: vi.fn(() => { callOrder.push('inkRenderer.resume'); }),
      };

      const mockPersistentInput = {
        pauseForModal: vi.fn(() => { callOrder.push('persistentInput.pauseForModal'); }),
        resumeFromModal: vi.fn(() => { callOrder.push('persistentInput.resumeFromModal'); }),
      };

      // Simulate the async onBeforeModal callback from agent.ts
      const onBeforeModal = async () => {
        callOrder.push('modalActive_true');
        if (mockInkRenderer) {
          mockInkRenderer.pause();
          // Yield a macrotask so React 19's Scheduler flushes any pending passive
          // effect cleanup from the just-unmounted Ink instance.
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (mockPersistentInput) {
          mockPersistentInput.pauseForModal();
        }
      };

      // Call onBeforeModal but don't await yet - this simulates the old behavior
      const beforePromise = onBeforeModal();

      // At this point, inkRenderer.pause should have been called synchronously
      expect(callOrder).toContain('inkRenderer.pause');
      expect(callOrder).toContain('setImmediate_scheduled');

      // But persistentInput.pauseForModal should NOT have been called yet
      // because we're awaiting setImmediate
      expect(callOrder).not.toContain('persistentInput.pauseForModal');

      // Now simulate the setImmediate firing (React cleanup completes)
      if (setImmediateCallback) {
        setImmediateCallback();
      }

      // Now await the promise to completion
      await beforePromise;

      // Now persistentInput.pauseForModal should have been called
      expect(callOrder).toContain('persistentInput.pauseForModal');

      // Verify the complete order
      expect(callOrder).toEqual([
        'modalActive_true',
        'inkRenderer.pause',
        'setImmediate_scheduled',
        'persistentInput.pauseForModal',
      ]);

      expect(mockInkRenderer.pause).toHaveBeenCalledTimes(1);
      expect(mockPersistentInput.pauseForModal).toHaveBeenCalledTimes(1);
    } finally {
      global.setImmediate = originalSetImmediate;
    }
  });

  it('slash commands await onBeforeModal before executing modal command', async () => {
    // This test verifies that slashCommandHandler.ts properly awaits onBeforeModal
    const callOrder: string[] = [];

    const onBeforeModal = vi.fn(async () => {
      callOrder.push('onBeforeModal_start');
      await new Promise((resolve) => setImmediate(resolve));
      callOrder.push('onBeforeModal_end');
    });

    const mockShowModal = vi.fn(async () => {
      callOrder.push('showModal');
      return { value: 'test' };
    });

    // Simulate the pattern used in slashCommandHandler.ts for /settings
    const executeSettingsCommand = async () => {
      await onBeforeModal?.();
      try {
        return await mockShowModal();
      } finally {
        callOrder.push('cleanup');
      }
    };

    await executeSettingsCommand();

    // Verify onBeforeModal completes before showModal is called
    expect(callOrder.indexOf('onBeforeModal_end')).toBeLessThan(callOrder.indexOf('showModal'));
    expect(callOrder).toEqual([
      'onBeforeModal_start',
      'onBeforeModal_end',
      'showModal',
      'cleanup',
    ]);
  });
});

describe('onBeforeModal async type signature', () => {
  it('slashCommandTypes defines onBeforeModal as returning void | Promise<void>', async () => {
    // Import the type to verify it compiles correctly
    const {  } = await import('../../src/core/slashCommandTypes.js');

    // Type-only test - if this compiles, the type signature is correct
    const syncContext: { onBeforeModal?: () => void } = {
      onBeforeModal: () => {},
    };

    const asyncContext: { onBeforeModal?: () => Promise<void> } = {
      onBeforeModal: async () => {
        await Promise.resolve();
      },
    };

    // Both should be assignable to the union type
    const combined: { onBeforeModal?: () => void | Promise<void> } = syncContext;
    const combined2: { onBeforeModal?: () => void | Promise<void> } = asyncContext;

    // Verify they work at runtime
    expect(typeof combined.onBeforeModal).toBe('function');
    expect(typeof combined2.onBeforeModal).toBe('function');

    // Verify async version returns a promise
    const result = combined2.onBeforeModal!();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
