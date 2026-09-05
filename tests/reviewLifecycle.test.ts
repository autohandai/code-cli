/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { executeReviewWithLifecycle } from '../src/review/reviewLifecycle.js';
import type { ReviewRequest } from '../src/review/reviewRequest.js';

const request: ReviewRequest = {
  kind: 'security',
  audience: 'forensic',
  format: 'markdown',
  target: 'src/auth',
  base: 'origin/main',
  focus: 'credential boundaries',
};

function hooks() {
  return { executeHooks: vi.fn().mockResolvedValue([]) };
}

describe('review lifecycle', () => {
  it('brackets a successful review with typed context', async () => {
    const hookManager = hooks();
    const execute = vi.fn().mockResolvedValue(true);

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'json_rpc',
      sessionId: 'session-1',
      hookManager,
      execute,
    })).resolves.toBe(true);

    expect(execute).toHaveBeenCalledOnce();
    expect(hookManager.executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:completed',
      'review:end',
    ]);
    expect(hookManager.executeHooks).toHaveBeenNthCalledWith(1, 'review:start', expect.objectContaining({
      sessionId: 'session-1',
      reviewAudience: 'forensic',
      reviewFormat: 'markdown',
      reviewKind: 'security',
      reviewPath: 'src/auth',
      reviewScope: 'security',
      reviewSurface: 'json_rpc',
      reviewStatus: 'running',
    }));
    expect(hookManager.executeHooks).toHaveBeenNthCalledWith(3, 'review:end', expect.objectContaining({
      success: true,
      reviewStatus: 'completed',
      duration: expect.any(Number),
    }));
  });

  it('emits failed and end when execution returns false', async () => {
    const hookManager = hooks();

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'cli',
      hookManager,
      execute: vi.fn().mockResolvedValue(false),
    })).resolves.toBe(false);

    expect(hookManager.executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:failed',
      'review:end',
    ]);
    expect(hookManager.executeHooks).toHaveBeenNthCalledWith(2, 'review:failed', expect.objectContaining({
      reviewError: 'Review execution did not complete.',
      reviewStatus: 'failed',
    }));
  });

  it('emits paused and end when the review is cancelled', async () => {
    const hookManager = hooks();
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return false;
    });

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'acp',
      signal: controller.signal,
      hookManager,
      execute,
    })).resolves.toBe(false);

    expect(hookManager.executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:paused',
      'review:end',
    ]);
    expect(hookManager.executeHooks).toHaveBeenNthCalledWith(3, 'review:end', expect.objectContaining({
      success: false,
      reviewStatus: 'paused',
    }));
  });

  it('records thrown failures, closes the lifecycle, and preserves the error', async () => {
    const hookManager = hooks();
    const failure = new Error('provider unavailable');

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'interactive',
      hookManager,
      execute: vi.fn().mockRejectedValue(failure),
    })).rejects.toBe(failure);

    expect(hookManager.executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:failed',
      'review:end',
    ]);
    expect(hookManager.executeHooks).toHaveBeenNthCalledWith(2, 'review:failed', expect.objectContaining({
      reviewError: 'provider unavailable',
    }));
  });

  it('does not let a broken observer prevent or reclassify the review', async () => {
    const executeHooks = vi.fn()
      .mockRejectedValueOnce(new Error('start observer failed'))
      .mockRejectedValueOnce(new Error('completion observer failed'))
      .mockRejectedValueOnce(new Error('end observer failed'));

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'cli',
      hookManager: { executeHooks },
      execute: vi.fn().mockResolvedValue(true),
    })).resolves.toBe(true);

    expect(executeHooks.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:completed',
      'review:end',
    ]);
  });

  it('enforces restricted permissions for the review and restores the session mode', async () => {
    let mode = 'interactive';
    const permissionManager = {
      getMode: vi.fn(() => mode),
      setMode: vi.fn((next: string) => {
        mode = next;
      }),
    };

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'interactive',
      permissionManager,
      execute: vi.fn(async () => {
        expect(mode).toBe('restricted');
        return true;
      }),
    })).resolves.toBe(true);

    expect(permissionManager.setMode.mock.calls).toEqual([
      ['restricted'],
      ['interactive'],
    ]);
    expect(mode).toBe('interactive');
  });

  it('restores the permission mode after a review failure', async () => {
    let mode = 'external';
    const permissionManager = {
      getMode: () => mode,
      setMode: (next: string) => {
        mode = next;
      },
    };

    await expect(executeReviewWithLifecycle({
      request,
      surface: 'acp',
      permissionManager,
      execute: vi.fn().mockRejectedValue(new Error('review failed')),
    })).rejects.toThrow('review failed');

    expect(mode).toBe('external');
  });

  it('publishes every lifecycle event to a transport observer', async () => {
    const onEvent = vi.fn().mockResolvedValue(undefined);

    await executeReviewWithLifecycle({
      request,
      surface: 'acp',
      onEvent,
      execute: vi.fn().mockResolvedValue(true),
    });

    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      'review:start',
      'review:completed',
      'review:end',
    ]);
    expect(onEvent).toHaveBeenLastCalledWith('review:end', expect.objectContaining({
      reviewSurface: 'acp',
      reviewStatus: 'completed',
      success: true,
    }));
  });
});
