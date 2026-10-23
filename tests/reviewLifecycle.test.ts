/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { executeReviewWithLifecycle } from '../src/review/reviewLifecycle.js';
import { PermissionManager } from '../src/permissions/PermissionManager.js';
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
  it.each([true, false])('permits only inspection during a restricted review and restores scope after success=%s', async success => {
    const manager = new PermissionManager({ settings: { mode: 'restricted' } });
    const execute = async () => {
      expect(manager.checkPermission({ tool: 'read_file', path: 'src/example.ts' }).allowed).toBe(true);
      expect(manager.checkPermission({ tool: 'git_diff' }).allowed).toBe(true);
      expect(manager.checkPermission({ tool: 'write_file', path: 'src/example.ts' }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'run_command', command: 'node', args: ['app.js'] }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'read_file', path: '.env' }).allowed).toBe(false);
      if (!success) throw new Error('Review interrupted');
      return true;
    };
    const result = executeReviewWithLifecycle({ request, surface: 'cli', permissionManager: manager, execute });
    if (success) await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toThrow('Review interrupted');
    expect(manager.getMode()).toBe('restricted');
    expect(manager.checkPermission({ tool: 'read_file', path: 'src/example.ts' }).allowed).toBe(false);
  });

  it('advertises only inspection tools during the review and restores the original tool list', async () => {
    const manager = new PermissionManager({ settings: { mode: 'unrestricted' } });
    const definitions = ['read_file', 'git_diff', 'orchestrate_specialists', 'delegate_task', 'write_file', 'run_command']
      .map(name => ({ name }));
    await executeReviewWithLifecycle({ request, surface: 'interactive', permissionManager: manager, execute: async () => {
      expect(manager.filterAdvertisedTools(definitions).map(tool => tool.name)).toEqual(['read_file', 'git_diff']);
      return true;
    } });
    expect(manager.filterAdvertisedTools(definitions)).toEqual(definitions);
  });

  it('preserves explicit read denials and blocks permissively allowed writes during review', async () => {
    const manager = new PermissionManager({ settings: {
      mode: 'unrestricted', denyList: ['read_file:private.txt'], allPathsAllowed: true,
    } });
    await executeReviewWithLifecycle({ request, surface: 'interactive', permissionManager: manager, execute: async () => {
      expect(manager.checkPermission({ tool: 'read_file', path: 'private.txt' }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'write_file', path: 'public.txt' }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'write_file', requestedTool: 'git_diff', path: 'public.txt' }).allowed).toBe(false);
      return true;
    } });
    expect(manager.getMode()).toBe('unrestricted');
  });

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

  it('allows inspection during review without allowing writes or overriding existing denials', async () => {
    const manager = new PermissionManager({ mode: 'unrestricted', denyList: ['read_file:private/**'], allowPatterns: [{ kind: 'write_file' }] });
    await executeReviewWithLifecycle({ request, surface: 'acp', permissionManager: manager, execute: async () => {
      expect(manager.checkPermission({ tool: 'read_file', path: 'README.md' }).allowed).toBe(true);
      expect(manager.checkPermission({ tool: 'run_command', requestedTool: 'git_diff', command: 'git', args: ['diff'] }).allowed).toBe(true);
      expect(manager.checkPermission({ tool: 'read_file', path: 'private/notes.md' }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'write_file', path: 'README.md' }).allowed).toBe(false);
      expect(manager.checkPermission({ tool: 'run_command', command: 'touch', args: ['file'] }).allowed).toBe(false);
      expect(manager.filterAdvertisedTools([{ name: 'read_file' }, { name: 'write_file' }, { name: 'run_command' }])).toEqual([{ name: 'read_file' }]);
      expect(manager.getMode()).toBe('unrestricted');
      return true;
    } });
    expect(manager.getMode()).toBe('unrestricted');
    expect(manager.checkPermission({ tool: 'write_file', path: 'README.md' }).allowed).toBe(true);
  });

  it('releases the review scope after failure and preserves a prior restricted mode', async () => {
    const manager = new PermissionManager({ mode: 'restricted' });
    await expect(executeReviewWithLifecycle({ request, surface: 'acp', permissionManager: manager, execute: async () => {
      expect(manager.checkPermission({ tool: 'read_file', path: 'README.md' }).allowed).toBe(true);
      throw new Error('Review failed');
    } })).rejects.toThrow('Review failed');
    expect(manager.getRunToolScope()).toBeUndefined();
    expect(manager.getMode()).toBe('restricted');
    expect(manager.checkPermission({ tool: 'read_file', path: 'README.md' }).allowed).toBe(false);
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
