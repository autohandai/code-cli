/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyMobilePermissionMode,
  configureMobileRelayController,
  enqueueClaimedMobileInstruction,
  enqueueInteractiveInstruction,
} from '../../src/core/agent/AgentDependencyComposer.js';
import type {
  MobileModelChangeHandler,
  MobileRelayController,
} from '../../src/mobile/MobileRelay.js';

describe('enqueueInteractiveInstruction', () => {
  it('wakes the idle Ink loop after queueing a mobile instruction', () => {
    const addQueuedInstruction = vi.fn();
    const resolver = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: resolver,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'mobile prompt');

    expect(addQueuedInstruction).toHaveBeenCalledWith('mobile prompt');
    expect(resolver).toHaveBeenCalledOnce();
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('keeps a claimed mobile turn in the typed pending queue while Ink is active', () => {
    const addQueuedInstruction = vi.fn();
    const resolver = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: resolver,
      pendingInkInstructions: [] as unknown[],
    };
    const mobileTurn = {
      turn: {
        workId: 'work-1',
        prompt: 'mobile prompt',
        startedAt: '2026-07-21T02:35:00.000Z',
      },
      relay: {} as never,
    };

    enqueueClaimedMobileInstruction(host, 'mobile prompt', mobileTurn);

    expect(addQueuedInstruction).not.toHaveBeenCalled();
    expect(host.pendingInkInstructions).toEqual([{
      text: 'mobile prompt',
      mobileTurn,
    }]);
    expect(resolver).toHaveBeenCalledOnce();
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('leaves work queued when the Ink loop is already active', () => {
    const addQueuedInstruction = vi.fn();
    const host = {
      inkRenderer: { addQueuedInstruction },
      inkInstructionResolver: null,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'follow-up prompt');

    expect(addQueuedInstruction).toHaveBeenCalledWith('follow-up prompt');
    expect(host.inkInstructionResolver).toBeNull();
  });

  it('falls back to the pending queue when Ink is unavailable', () => {
    const host = {
      inkRenderer: null,
      inkInstructionResolver: null,
      pendingInkInstructions: [] as string[],
    };

    enqueueInteractiveInstruction(host, 'pending prompt');

    expect(host.pendingInkInstructions).toEqual(['pending prompt']);
  });
});

describe('configureMobileRelayController', () => {
  it('routes remote model changes through the provider configuration manager', async () => {
    let modelChangeHandler: MobileModelChangeHandler | undefined;
    const applyModelChangeRemote = vi.fn().mockResolvedValue({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'applied' as const,
    });
    const relay = {
      setSessionControlHandler: vi.fn(),
      setModelChangeHandler: (handler: MobileModelChangeHandler) => {
        modelChangeHandler = handler;
      },
    } as unknown as MobileRelayController;

    configureMobileRelayController({
      providerConfigManager: { applyModelChangeRemote },
    }, relay);

    expect(modelChangeHandler).toBeDefined();
    await expect(modelChangeHandler?.('openrouter', 'anthropic/claude-sonnet-4.5')).resolves.toEqual({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'applied',
    });
    expect(applyModelChangeRemote).toHaveBeenCalledWith(
      'openrouter',
      'anthropic/claude-sonnet-4.5',
    );
  });
});

describe('applyMobilePermissionMode', () => {
  it('routes mobile permission changes through the active ACP mode setter and notifies locally', () => {
    const applyAcpMode = vi.fn();
    const getPermissionMode = vi.fn()
      .mockReturnValueOnce('interactive')
      .mockReturnValue('restricted');
    const notifyUser = vi.fn();

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode,
      notifyUser,
    }, 'restricted');

    expect(change).toMatchObject({
      previousMode: 'interactive',
      appliedMode: 'restricted',
    });
    expect(applyAcpMode).toHaveBeenCalledWith('restricted');
    expect(notifyUser).toHaveBeenCalledWith(
      'Autohand Mobile changed this session permission mode to restricted.',
    );
  });

  it('returns the effective mode without claiming an unapplied permission change', () => {
    const applyAcpMode = vi.fn();
    const getPermissionMode = vi.fn().mockReturnValue('interactive');
    const notifyUser = vi.fn();

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode,
      notifyUser,
    }, 'restricted');

    expect(change).toMatchObject({
      previousMode: 'interactive',
      appliedMode: 'interactive',
    });
    expect(applyAcpMode).toHaveBeenCalledWith('restricted');
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('restores the previous mode when an uncommitted mobile change is still current', () => {
    let currentMode = 'interactive' as const | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      currentMode = mode === 'restricted' ? 'interactive' : mode;
    });
    const getPermissionMode = vi.fn(() => currentMode);

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode,
    }, 'unrestricted');

    expect(change).toMatchObject({
      previousMode: 'interactive',
      appliedMode: 'unrestricted',
    });
    expect(change.rollbackIfCurrent()).toBe(true);
    expect(currentMode).toBe('interactive');
    expect(applyAcpMode).toHaveBeenNthCalledWith(2, 'interactive');
  });

  it('does not overwrite an intervening local permission-mode change during rollback', () => {
    let currentMode = 'restricted' as 'interactive' | 'restricted' | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      currentMode = mode;
    });
    const getPermissionMode = vi.fn(() => currentMode);

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode,
    }, 'unrestricted');
    currentMode = 'interactive';

    expect(change.rollbackIfCurrent()).toBe(false);
    expect(currentMode).toBe('interactive');
    expect(applyAcpMode).toHaveBeenCalledOnce();
  });

  it('restores the previous interaction mode when its permission profile is unchanged', () => {
    let currentMode = 'unrestricted' as const;
    let currentInteractionMode = 'yolo' as 'default' | 'plan' | 'yolo' | 'automode';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      currentMode = mode as 'unrestricted';
      currentInteractionMode = 'default';
    });
    const setInteractionMode = vi.fn((mode: typeof currentInteractionMode) => {
      currentInteractionMode = mode;
      return mode;
    });

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode: () => currentMode,
      getInteractionMode: () => currentInteractionMode,
      setInteractionMode,
    }, 'unrestricted');

    expect(currentInteractionMode).toBe('default');
    expect(change.rollbackIfCurrent()).toBe(true);
    expect(setInteractionMode).toHaveBeenCalledWith('yolo');
    expect(currentInteractionMode).toBe('yolo');
  });

  it('restores a partially changed mode when the canonical setter throws', () => {
    let currentMode = 'interactive' as 'interactive' | 'restricted' | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      if (mode === 'restricted') {
        currentMode = 'unrestricted';
        throw new Error('permission manager unavailable');
      }
      currentMode = mode;
    });

    expect(() => applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode: () => currentMode,
    }, 'restricted')).toThrow('permission manager unavailable');
    expect(currentMode).toBe('interactive');
    expect(applyAcpMode).toHaveBeenNthCalledWith(2, 'interactive');
  });

  it('does not widen permissions after a partially applied setter failure', () => {
    let currentMode = 'unrestricted' as 'interactive' | 'restricted' | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      currentMode = mode;
      if (mode === 'restricted') {
        throw new Error('permission manager unavailable');
      }
    });

    expect(() => applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode: () => currentMode,
    }, 'restricted')).toThrow('permission manager unavailable');
    expect(currentMode).toBe('restricted');
    expect(applyAcpMode).toHaveBeenCalledOnce();
  });

  it('never widens permissions when rolling back an abandoned mobile change', () => {
    let currentMode = 'unrestricted' as 'interactive' | 'restricted' | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      currentMode = mode;
    });

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode: () => currentMode,
    }, 'restricted');

    expect(change.rollbackIfCurrent()).toBe(false);
    expect(currentMode).toBe('restricted');
    expect(applyAcpMode).toHaveBeenCalledOnce();
  });

  it('throws when a safe rollback cannot restore the previous effective mode', () => {
    let requestedMode = 'interactive' as 'interactive' | 'restricted' | 'unrestricted';
    const applyAcpMode = vi.fn((mode: 'interactive' | 'restricted' | 'unrestricted') => {
      requestedMode = mode;
    });
    const getPermissionMode = vi.fn(() => (
      requestedMode === 'interactive' && applyAcpMode.mock.calls.length > 1
        ? 'unrestricted' as const
        : requestedMode
    ));

    const change = applyMobilePermissionMode({
      applyAcpMode,
      getPermissionMode,
    }, 'unrestricted');

    expect(() => change.rollbackIfCurrent()).toThrow(
      'Failed to restore the previous permission mode after abandoning mobile work.',
    );
  });
});
