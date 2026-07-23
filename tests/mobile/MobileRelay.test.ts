/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  startMobileRelay,
  stopMobileRelay,
  type MobileChangePreview,
  type MobilePermissionModeChange,
} from '../../src/mobile/MobileRelay.js';
import type {
  MobileAction,
  MobileHandoffClientLike,
  MobilePermissionMode,
  PublishMobileEventPayload,
} from '../../src/mobile/MobileHandoffClient.js';
import { KeepAwakeController } from '../../src/mobile/KeepAwakeController.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

function createPermissionModeChange(
  appliedMode: MobilePermissionMode,
  previousMode: MobilePermissionMode = 'interactive',
): MobilePermissionModeChange {
  return {
    previousMode,
    appliedMode,
    rollbackIfCurrent: vi.fn().mockReturnValue(true),
  };
}

describe('MobileRelay event bridge', () => {
  afterEach(() => {
    stopMobileRelay();
    vi.useRealTimers();
  });

  it('announces a claimed mobile pairing exactly once across repeated heartbeats', async () => {
    vi.useFakeTimers();
    const onMobileConnected = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    startMobileRelay({
      client,
      token: 'auth-sensitive',
      deviceId: 'device-sensitive',
      sessionId: 'session-sensitive',
      pairingId: 'pairing-sensitive',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      onMobileConnected,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onMobileConnected).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(client.sendRelayHeartbeat).toHaveBeenCalledTimes(4);
    expect(onMobileConnected).toHaveBeenCalledOnce();
    expect(onMobileConnected).toHaveBeenCalledWith(
      'Mobile connected. Live prompts will run in this CLI session.'
    );
    expect(onMobileConnected.mock.calls.flat().join(' ')).not.toContain('sensitive');
  });

  it('reports a claimed pairing exactly once through the relay controller', async () => {
    vi.useFakeTimers();
    const sendRelayHeartbeat = vi.fn()
      .mockResolvedValueOnce({ pairingClaimed: false, pairingStatus: 'pending' })
      .mockResolvedValue({ pairingClaimed: true, pairingStatus: 'claimed' });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat,
      claimWork: vi.fn().mockResolvedValue(null),
    };
    const onPairingClaimed = vi.fn();

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    relay.setPairingClaimHandler(onPairingClaimed);

    await vi.advanceTimersByTimeAsync(0);
    expect(onPairingClaimed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onPairingClaimed).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendRelayHeartbeat).toHaveBeenCalledTimes(5);
    expect(onPairingClaimed).toHaveBeenCalledOnce();
  });

  it('delivers a claimed pairing observed before the controller handler is registered', async () => {
    vi.useFakeTimers();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({
        pairingClaimed: true,
        pairingStatus: 'claimed',
      }),
      claimWork: vi.fn().mockResolvedValue(null),
    };
    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(0);
    const onPairingClaimed = vi.fn();
    relay.setPairingClaimHandler(onPairingClaimed);

    expect(onPairingClaimed).toHaveBeenCalledOnce();
  });

  it('stops the active relay when its pairing is revoked', async () => {
    vi.useFakeTimers();
    let resolveHeartbeat!: (value: {
      pairingClaimed: boolean;
      pairingStatus: 'revoked';
    }) => void;
    const heartbeat = new Promise<{
      pairingClaimed: boolean;
      pairingStatus: 'revoked';
    }>((resolve) => {
      resolveHeartbeat = resolve;
    });
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => true),
      unref: vi.fn(),
    }) as unknown as ChildProcess;
    const keepAwakeController = new KeepAwakeController('darwin', () => child);
    const onMobileDisconnected = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn(() => heartbeat),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
      pollMobileActions: vi.fn().mockResolvedValue({ actions: [], nextCursor: 0 }),
    };

    const relay = startMobileRelay({
      client,
      token: 'auth-sensitive',
      deviceId: 'device-sensitive',
      sessionId: 'session-sensitive',
      pairingId: 'pairing-sensitive',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      keepAwakeController,
      keepAwakeByDefault: true,
      onMobileDisconnected,
    });
    const permission = relay.requestPermission('Allow this operation');
    await vi.advanceTimersByTimeAsync(0);

    resolveHeartbeat({ pairingClaimed: false, pairingStatus: 'revoked' });
    await vi.advanceTimersByTimeAsync(0);

    expect(onMobileDisconnected).toHaveBeenCalledOnce();
    expect(onMobileDisconnected).toHaveBeenCalledWith('Mobile disconnected. Pairing stopped.');
    await expect(permission).resolves.toEqual({ decision: 'deny_once' });
    expect(keepAwakeController.currentState()).toEqual({ supported: true, enabled: false });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(client.claimWork).not.toHaveBeenCalled();
    expect(client.pollMobileActions).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(client.sendRelayHeartbeat).toHaveBeenCalledOnce();
    expect(onMobileDisconnected).toHaveBeenCalledOnce();

    const replacementClient: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-2'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: false }),
      claimWork: vi.fn().mockResolvedValue(null),
    };
    startMobileRelay({
      client: replacementClient,
      token: 'replacement-token',
      deviceId: 'device-2',
      sessionId: 'session-2',
      pairingId: 'pairing-2',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(replacementClient.sendRelayHeartbeat).toHaveBeenCalledOnce();
    expect(replacementClient.claimWork).toHaveBeenCalledOnce();
  });

  it('publishes and persists the terminal result for the claimed live turn', async () => {
    vi.useFakeTimers();
    const enqueueInstruction = vi.fn();
    const publishMobileEvent = vi.fn().mockResolvedValue(undefined);
    const updateWork = vi.fn().mockResolvedValue({
      id: 'work-1',
      repo: '/workspace',
      branch: 'main',
      prompt: 'Run a harmless check',
      priority: 0,
      status: 'failed',
      agentId: null,
      deviceId: 'device-1',
      payload: {
        deliveryMode: 'steer',
        sessionId: 'session-1',
        pairingId: 'pairing-1',
      },
      createdAt: '2026-07-21T02:35:00.000Z',
      updatedAt: '2026-07-21T02:35:01.000Z',
    });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn()
        .mockResolvedValueOnce({
          id: 'work-1',
          repo: '/workspace',
          branch: 'main',
          prompt: 'Run a harmless check',
          priority: 0,
          status: 'running',
          agentId: null,
          deviceId: 'device-1',
          payload: {
            deliveryMode: 'steer',
            sessionId: 'session-1',
            pairingId: 'pairing-1',
          },
          createdAt: '2026-07-21T02:35:00.000Z',
          updatedAt: '2026-07-21T02:35:00.000Z',
          startedAt: '2026-07-21T02:35:00.000Z',
        })
        .mockResolvedValue(null),
      updateWork,
      publishMobileEvent,
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(client.claimWork).toHaveBeenCalledWith('token', 'device-1', {
      deliveryMode: 'steer',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
    });
    expect(enqueueInstruction).toHaveBeenCalledWith('Run a harmless check', {
      turn: expect.objectContaining({
        workId: 'work-1',
        prompt: 'Run a harmless check',
        startedAt: '2026-07-21T02:35:00.000Z',
      }),
      relay,
    });
    expect(publishMobileEvent).toHaveBeenCalledWith('token', expect.objectContaining({
      eventType: 'session_turn_state',
      requestId: 'work-1',
      payload: expect.objectContaining({
        workId: 'work-1',
        status: 'running',
        prompt: 'Run a harmless check',
      }),
    }));

    const turn = enqueueInstruction.mock.calls[0]?.[1].turn;
    await relay.finishClaimedTurn(turn, {
      status: 'failed',
      error: 'The configured model is unavailable.',
    });

    expect(updateWork).toHaveBeenCalledWith('token', 'device-1', 'work-1', expect.objectContaining({
      status: 'failed',
      error: 'The configured model is unavailable.',
      payload: { deliveryState: 'failed', executionState: 'failed' },
    }));
    expect(publishMobileEvent).toHaveBeenLastCalledWith('token', expect.objectContaining({
      eventType: 'session_turn_state',
      requestId: 'work-1',
      payload: expect.objectContaining({
        workId: 'work-1',
        status: 'failed',
        error: 'The configured model is unavailable.',
      }),
    }));
  });

  it('retries a transient terminal event failure before reporting the turn complete', async () => {
    vi.useFakeTimers();
    const enqueueInstruction = vi.fn();
    const publishMobileEvent = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary terminal event failure'))
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn()
        .mockResolvedValueOnce({
          id: 'work-1',
          repo: '/workspace',
          branch: 'main',
          prompt: 'Run a harmless check',
          priority: 0,
          status: 'running',
          agentId: null,
          deviceId: 'device-1',
          payload: {
            deliveryMode: 'steer',
            sessionId: 'session-1',
            pairingId: 'pairing-1',
          },
          createdAt: '2026-07-21T02:35:00.000Z',
          updatedAt: '2026-07-21T02:35:00.000Z',
          startedAt: '2026-07-21T02:35:00.000Z',
        })
        .mockResolvedValue(null),
      updateWork: vi.fn().mockResolvedValue({}),
      publishMobileEvent,
    };
    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    const turn = enqueueInstruction.mock.calls[0]?.[1].turn;
    const finishing = relay.finishClaimedTurn(turn, {
      status: 'failed',
      error: 'The configured model is unavailable.',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await finishing;

    const terminalEvents = publishMobileEvent.mock.calls.filter(([, payload]) =>
      payload.eventType === 'session_turn_state' && payload.payload.status === 'failed'
    );
    expect(terminalEvents).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a permanent terminal transport failure after bounded retries', async () => {
    vi.useFakeTimers();
    const terminalError = new Error('terminal work update unavailable');
    const updateWork = vi.fn().mockRejectedValue(terminalError);
    const publishMobileEvent = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
      updateWork,
      publishMobileEvent,
    };
    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    const finishing = relay.finishClaimedTurn({
      workId: 'work-1',
      prompt: 'mobile prompt',
      startedAt: '2026-07-21T02:35:00.000Z',
    }, {
      status: 'failed',
      error: 'The configured model is unavailable.',
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await finishing;

    expect(updateWork).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(terminalError);
    expect(publishMobileEvent).toHaveBeenCalledWith('token', expect.objectContaining({
      eventType: 'session_turn_state',
      payload: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('does not enqueue or publish a claimed item outside the active relay scope', async () => {
    vi.useFakeTimers();
    const enqueueInstruction = vi.fn();
    const publishMobileEvent = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue({
        id: 'wrong-work',
        repo: '/other-workspace',
        branch: 'main',
        prompt: 'must not run',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'different-session',
          pairingId: 'pairing-1',
        },
        createdAt: '2026-07-21T02:35:00.000Z',
        updatedAt: '2026-07-21T02:35:00.000Z',
      }),
      publishMobileEvent,
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(enqueueInstruction).not.toHaveBeenCalled();
    expect(publishMobileEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Claimed work did not match the active mobile relay scope.',
    }));
  });

  it('applies a claimed work permission mode before enqueueing its prompt', async () => {
    vi.useFakeTimers();
    const callOrder: string[] = [];
    const published: PublishMobileEventPayload[] = [];
    const rollbackIfCurrent = vi.fn().mockReturnValue(true);
    const applyPermissionMode = vi.fn().mockImplementation((mode: MobilePermissionMode) => {
      callOrder.push(`mode:${mode}`);
      return {
        previousMode: 'interactive' as const,
        appliedMode: mode,
        rollbackIfCurrent,
      };
    });
    const enqueueInstruction = vi.fn().mockImplementation(() => {
      callOrder.push('enqueue');
    });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-with-permission-mode',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue from mobile',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode: 'unrestricted',
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      applyPermissionMode,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(applyPermissionMode).toHaveBeenCalledWith('unrestricted');
    expect(rollbackIfCurrent).not.toHaveBeenCalled();
    expect(enqueueInstruction).toHaveBeenCalledOnce();
    expect(callOrder).toEqual(['mode:unrestricted', 'enqueue']);
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        requestId: 'work-with-permission-mode',
        payload: {
          requestedMode: 'unrestricted',
          appliedMode: 'unrestricted',
          status: 'applied',
        },
      }),
    ]));
  });

  it('rolls back a claimed work permission mode when enqueueing fails', async () => {
    vi.useFakeTimers();
    const enqueueError = new Error('instruction queue unavailable');
    const rollbackIfCurrent = vi.fn().mockReturnValue(true);
    const updateWork = vi.fn().mockResolvedValue(undefined);
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-with-enqueue-failure',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue under restricted permissions',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode: 'restricted',
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      updateWork,
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(() => {
        throw enqueueError;
      }),
      applyPermissionMode: vi.fn().mockReturnValue({
        previousMode: 'interactive',
        appliedMode: 'restricted',
        rollbackIfCurrent,
      }),
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(rollbackIfCurrent).toHaveBeenCalledOnce();
    expect(updateWork).toHaveBeenCalledWith(
      'token',
      'device-1',
      'work-with-enqueue-failure',
      expect.objectContaining({
        status: 'failed',
        error: enqueueError.message,
      }),
    );
  });

  it('fails claimed work when its permission-mode acknowledgement cannot be delivered', async () => {
    vi.useFakeTimers();
    const transportError = new Error('permission acknowledgement unavailable');
    const rollbackIfCurrent = vi.fn().mockReturnValue(true);
    const applyPermissionMode = vi.fn().mockReturnValue({
      previousMode: 'interactive',
      appliedMode: 'restricted',
      rollbackIfCurrent,
    });
    const enqueueInstruction = vi.fn();
    const updateWork = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-with-undelivered-permission-status',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue under restricted permissions',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode: 'restricted',
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      updateWork,
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        if (payload.eventType === 'permission_mode_status') throw transportError;
      }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      applyPermissionMode,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(applyPermissionMode).toHaveBeenCalledWith('restricted');
    expect(rollbackIfCurrent).toHaveBeenCalledOnce();
    expect(enqueueInstruction).not.toHaveBeenCalled();
    expect(updateWork).toHaveBeenCalledWith(
      'token',
      'device-1',
      'work-with-undelivered-permission-status',
      expect.objectContaining({
        status: 'failed',
        error: 'Failed to acknowledge mobile permission mode change.',
      }),
    );
    expect(onError).toHaveBeenCalledWith(transportError);
  });

  it.each([
    {
      scenario: 'an unsupported permission mode',
      approvalMode: 'full-access',
      applyPermissionMode: vi.fn(),
      expectedModeCall: undefined,
      expectedError: 'Unsupported mobile permission mode.',
    },
    {
      scenario: 'no permission-mode callback',
      approvalMode: 'restricted',
      applyPermissionMode: undefined,
      expectedModeCall: undefined,
      expectedError: 'This CLI session does not support changing permission mode remotely.',
    },
    {
      scenario: 'a permission-mode application failure',
      approvalMode: 'restricted',
      applyPermissionMode: vi.fn().mockImplementation(() => {
        throw new Error('Permission manager unavailable.');
      }),
      expectedModeCall: 'restricted',
      expectedError: 'Permission manager unavailable.',
    },
  ])('blocks claimed work when it has $scenario', async ({
    approvalMode,
    applyPermissionMode,
    expectedModeCall,
    expectedError,
  }) => {
    vi.useFakeTimers();
    const published: PublishMobileEventPayload[] = [];
    const enqueueInstruction = vi.fn();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-with-unsupported-permission-mode',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue under the current policy',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode,
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      updateWork: vi.fn().mockResolvedValue(undefined),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      applyPermissionMode,
    });

    await vi.advanceTimersByTimeAsync(0);

    if (expectedModeCall) {
      expect(applyPermissionMode).toHaveBeenCalledWith(expectedModeCall);
    } else if (applyPermissionMode) {
      expect(applyPermissionMode).not.toHaveBeenCalled();
    }
    expect(enqueueInstruction).not.toHaveBeenCalled();
    expect(client.updateWork).toHaveBeenCalledWith(
      'token',
      'device-1',
      'work-with-unsupported-permission-mode',
      expect.objectContaining({
        status: 'failed',
        error: expectedError,
        payload: {
          deliveryState: 'failed',
          executionState: 'failed',
        },
      }),
    );
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        payload: {
          requestedMode: approvalMode,
          status: 'failed',
          error: expectedError,
        },
      }),
      expect.objectContaining({
        eventType: 'session_turn_state',
        requestId: 'work-with-unsupported-permission-mode',
        payload: expect.objectContaining({
          workId: 'work-with-unsupported-permission-mode',
          status: 'failed',
          error: expectedError,
        }),
      }),
    ]));
  });

  it('cancels claimed work when its relay is replaced during permission-mode application', async () => {
    vi.useFakeTimers();
    const published: PublishMobileEventPayload[] = [];
    const updateWork = vi.fn().mockResolvedValue(undefined);
    const enqueueInstruction = vi.fn();
    const replacementClient: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-2'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
    };
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-from-replaced-relay',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue under restricted permissions',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode: 'restricted',
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      updateWork,
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
    };
    const rollbackIfCurrent = vi.fn().mockReturnValue(true);
    const applyPermissionMode = vi.fn((mode: MobilePermissionMode) => {
      startMobileRelay({
        client: replacementClient,
        token: 'replacement-token',
        deviceId: 'device-2',
        sessionId: 'session-2',
        pairingId: 'pairing-2',
        mode: 'steer',
        pollIntervalMs: 1_000,
        enqueueInstruction: vi.fn(),
      });
      return {
        previousMode: 'interactive' as const,
        appliedMode: mode,
        rollbackIfCurrent,
      };
    });

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      applyPermissionMode,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(applyPermissionMode).toHaveBeenCalledWith('restricted');
    expect(rollbackIfCurrent).toHaveBeenCalledOnce();
    expect(enqueueInstruction).not.toHaveBeenCalled();
    expect(updateWork).toHaveBeenCalledWith(
      'token',
      'device-1',
      'work-from-replaced-relay',
      expect.objectContaining({
        status: 'cancelled',
        payload: {
          deliveryState: 'cancelled',
          executionState: 'cancelled',
        },
      }),
    );
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'session_turn_state',
        requestId: 'work-from-replaced-relay',
        payload: expect.objectContaining({
          workId: 'work-from-replaced-relay',
          status: 'cancelled',
        }),
      }),
    ]));
    expect(published).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'permission_mode_status' }),
    ]));
  });

  it('cancels claimed work when its relay is replaced while publishing the running state', async () => {
    let releaseRunningState!: () => void;
    const runningStatePublication = new Promise<void>((resolve) => {
      releaseRunningState = resolve;
    });
    const updateWork = vi.fn().mockResolvedValue(undefined);
    const enqueueInstruction = vi.fn();
    const rollbackIfCurrent = vi.fn().mockReturnValue(true);
    const applyPermissionMode = vi.fn().mockReturnValue({
      previousMode: 'interactive',
      appliedMode: 'restricted',
      rollbackIfCurrent,
    });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValueOnce({
        id: 'work-replaced-during-running-status',
        repo: '/workspace',
        branch: 'main',
        prompt: 'continue after the running status',
        priority: 0,
        status: 'running',
        agentId: null,
        deviceId: 'device-1',
        payload: {
          deliveryMode: 'steer',
          sessionId: 'session-1',
          pairingId: 'pairing-1',
          approvalMode: 'restricted',
        },
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      }).mockResolvedValue(null),
      updateWork,
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        if (
          payload.eventType === 'session_turn_state'
          && payload.payload.status === 'running'
        ) {
          await runningStatePublication;
        }
      }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
      applyPermissionMode,
    });

    await vi.waitFor(() => expect(client.publishMobileEvent).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        eventType: 'session_turn_state',
        payload: expect.objectContaining({ status: 'running' }),
      }),
    ));

    startMobileRelay({
      client: {
        getDeviceId: vi.fn().mockResolvedValue('device-2'),
        registerDevice: vi.fn().mockResolvedValue(undefined),
        createPairing: vi.fn(),
        sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
        claimWork: vi.fn().mockResolvedValue(null),
      },
      token: 'replacement-token',
      deviceId: 'device-2',
      sessionId: 'session-2',
      pairingId: 'pairing-2',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    releaseRunningState();

    await vi.waitFor(() => expect(updateWork).toHaveBeenCalledWith(
      'token',
      'device-1',
      'work-replaced-during-running-status',
      expect.objectContaining({
        status: 'cancelled',
        payload: {
          deliveryState: 'cancelled',
          executionState: 'cancelled',
        },
      }),
    ));
    expect(rollbackIfCurrent).toHaveBeenCalledOnce();
    expect(enqueueInstruction).not.toHaveBeenCalled();
  });

  it('does not let a revoked heartbeat from a replaced relay stop the new relay', async () => {
    vi.useFakeTimers();
    let resolveOldHeartbeat!: (value: {
      pairingClaimed: boolean;
      pairingStatus: 'revoked';
    }) => void;
    const oldHeartbeat = new Promise<{
      pairingClaimed: boolean;
      pairingStatus: 'revoked';
    }>((resolve) => {
      resolveOldHeartbeat = resolve;
    });
    const oldEnqueueInstruction = vi.fn();
    const oldDisconnected = vi.fn();
    const oldClient: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn(() => oldHeartbeat),
      claimWork: vi.fn().mockResolvedValue(null),
    };

    startMobileRelay({
      client: oldClient,
      token: 'old-token',
      deviceId: 'device-1',
      sessionId: 'old-session',
      pairingId: 'old-pairing',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: oldEnqueueInstruction,
      onMobileDisconnected: oldDisconnected,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(oldClient.sendRelayHeartbeat).toHaveBeenCalledOnce();

    const newClient: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: false }),
      claimWork: vi.fn().mockResolvedValue(null),
    };
    startMobileRelay({
      client: newClient,
      token: 'new-token',
      deviceId: 'device-1',
      sessionId: 'new-session',
      pairingId: 'new-pairing',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    resolveOldHeartbeat({ pairingClaimed: false, pairingStatus: 'revoked' });
    await Promise.resolve();
    await Promise.resolve();

    expect(oldClient.claimWork).not.toHaveBeenCalled();
    expect(oldEnqueueInstruction).not.toHaveBeenCalled();
    expect(oldDisconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(newClient.sendRelayHeartbeat).toHaveBeenCalledTimes(2);
    expect(newClient.claimWork).toHaveBeenCalledTimes(2);
  });

  it('completes an already queued turn only through its origin relay after rerunning go', async () => {
    vi.useFakeTimers();
    const enqueueFromA = vi.fn();
    const publishFromA = vi.fn().mockResolvedValue(undefined);
    const updateFromA = vi.fn().mockResolvedValue({});
    const clientA: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn()
        .mockResolvedValueOnce({
          id: 'work-from-a',
          repo: '/workspace',
          branch: 'main',
          prompt: 'queued by A',
          priority: 0,
          status: 'running',
          agentId: null,
          deviceId: 'device-1',
          payload: {
            deliveryMode: 'steer',
            sessionId: 'session-a',
            pairingId: 'pairing-a',
          },
          createdAt: '2026-07-21T02:35:00.000Z',
          updatedAt: '2026-07-21T02:35:00.000Z',
        })
        .mockResolvedValue(null),
      updateWork: updateFromA,
      publishMobileEvent: publishFromA,
    };
    startMobileRelay({
      client: clientA,
      token: 'token-a',
      deviceId: 'device-1',
      sessionId: 'session-a',
      pairingId: 'pairing-a',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: enqueueFromA,
    });
    await vi.advanceTimersByTimeAsync(0);
    const queuedByA = enqueueFromA.mock.calls[0]?.[1];

    const publishFromB = vi.fn().mockResolvedValue(undefined);
    const clientB: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: false }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: publishFromB,
    };
    startMobileRelay({
      client: clientB,
      token: 'token-b',
      deviceId: 'device-1',
      sessionId: 'session-b',
      pairingId: 'pairing-b',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(0);

    await queuedByA.relay.finishClaimedTurn(queuedByA.turn, {
      status: 'completed',
      output: 'Finished through A',
    });

    expect(updateFromA).toHaveBeenCalledWith(
      'token-a',
      'device-1',
      'work-from-a',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(publishFromA).toHaveBeenLastCalledWith('token-a', expect.objectContaining({
      sessionId: 'session-a',
      pairingId: 'pairing-a',
      payload: expect.objectContaining({ status: 'completed' }),
    }));
    expect(publishFromB).not.toHaveBeenCalled();
  });

  it('round-trips a permission decision from the phone to the agent callback', async () => {
    let published: PublishMobileEventPayload | undefined;
    const actions: MobileAction[] = [];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        published = payload;
      }),
      pollMobileActions: vi.fn().mockImplementation(async () => ({
        actions,
        nextCursor: actions.at(-1)?.sequence ?? 0,
      })),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });

    const response = relay.requestPermission('Run the test suite', { tool: 'shell', command: 'bun test' });
    await vi.waitFor(() => expect(published?.requestId).toBeTruthy(), { timeout: 2_000 });
    actions.push({
      id: 'action-1',
      sequence: 1,
      actionType: 'permission_response',
      requestId: published?.requestId || null,
      payload: { decision: 'allow_once' },
      createdAt: new Date().toISOString(),
    });

    await expect(response).resolves.toEqual({ decision: 'allow_once', alternative: undefined });
  });

  it('returns the approved directory path for a directory action', async () => {
    let published: PublishMobileEventPayload | undefined;
    const actions: MobileAction[] = [];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        published = payload;
      }),
      pollMobileActions: vi.fn().mockImplementation(async () => ({
        actions,
        nextCursor: actions.at(-1)?.sequence ?? 0,
      })),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });

    const response = relay.requestDirectoryAccess('/tmp/shared-fixtures', 'Read fixtures');
    await vi.waitFor(() => expect(published?.requestId).toBeTruthy(), { timeout: 2_000 });
    actions.push({
      id: 'action-2',
      sequence: 1,
      actionType: 'directory_access_response',
      requestId: published?.requestId || null,
      payload: { granted: true },
      createdAt: new Date().toISOString(),
    });

    await expect(response).resolves.toBe('/tmp/shared-fixtures');
  });

  it('waits for a change-batch decision before returning to the agent', async () => {
    let published: PublishMobileEventPayload | undefined;
    const actions: MobileAction[] = [];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        published = payload;
      }),
      pollMobileActions: vi.fn().mockImplementation(async () => ({
        actions,
        nextCursor: actions.at(-1)?.sequence ?? 0,
      })),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });

    const change: MobileChangePreview = {
      id: 'change-1',
      filePath: 'src/App.ts',
      changeType: 'modify',
      originalContent: 'old',
      proposedContent: 'new',
      description: 'Update the app shell',
      toolId: 'tool-1',
      toolName: 'edit_file',
    };
    const response = relay.requestChangesDecision('batch-1', [change]);
    await vi.waitFor(() => expect(published?.eventType).toBe('changes_batch'), { timeout: 2_000 });
    actions.push({
      id: 'action-3',
      sequence: 1,
      actionType: 'changes_decision',
      requestId: published?.requestId || null,
      payload: { action: 'accept_all' },
      createdAt: new Date().toISOString(),
    });

    await expect(response).resolves.toEqual({ action: 'accept_all', selectedChangeIds: undefined });
  });

  it('publishes typed pull-request and deployment snapshots', async () => {
    const published: PublishMobileEventPayload[] = [];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        published.push(payload);
      }),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      deliveryStatusProvider: async () => ({
        pullRequest: {
          id: '42',
          number: 42,
          title: 'Ship mobile delivery state',
          url: 'https://github.com/autohandai/code-cli/pull/42',
          headBranch: 'mobile-delivery',
          baseBranch: 'main',
          status: 'open',
          mergeable: true,
          additions: 80,
          deletions: 12,
          changedFiles: 4,
          checks: [{ id: 'build', name: 'Build', status: 'passed' }],
        },
        deployments: [{
          id: 'preview-42',
          name: 'Mobile preview',
          environment: 'Preview',
          status: 'success',
          previewURL: 'https://preview.example.com/42',
        }],
      }),
    });

    await relay.refreshDeliveryStatus();

    expect(published.map((event) => event.eventType)).toEqual([
      'pull_request_status',
      'deployment_status',
    ]);
    expect(published[0]?.payload).toMatchObject({
      pullRequest: { id: '42', checks: [{ status: 'passed' }] },
    });
    expect(published[1]?.payload).toMatchObject({
      deployments: [{ id: 'preview-42', status: 'success' }],
    });
  });

  it('applies keep-awake actions from the phone and publishes capability state', async () => {
    const published: PublishMobileEventPayload[] = [];
    const child = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => true),
      unref: vi.fn(),
    }) as unknown as ChildProcess;
    const keepAwakeController = new KeepAwakeController('darwin', () => child);
    const actions: MobileAction[] = [{
      id: 'keep-awake-1',
      sequence: 1,
      actionType: 'keep_awake_control',
      requestId: 'request-keep-awake',
      payload: { enabled: true },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => {
        published.push(payload);
      }),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      keepAwakeController,
      keepAwakeByDefault: false,
    });

    await vi.waitFor(() => {
      expect(published).toEqual(expect.arrayContaining([
        expect.objectContaining({
          eventType: 'keep_awake_status',
          payload: { supported: true, enabled: true },
        }),
      ]));
    });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('processes a confirmed PR merge action and publishes the result', async () => {
    const published: PublishMobileEventPayload[] = [];
    const actions: MobileAction[] = [{
      id: 'merge-1',
      sequence: 1,
      actionType: 'pull_request_merge',
      requestId: 'request-merge-1',
      payload: { pullRequestNumber: 42, expectedHeadBranch: 'mobile-merge', method: 'squash' },
      createdAt: new Date().toISOString(),
    }];
    const mergePullRequest = vi.fn().mockResolvedValue({
      pullRequestNumber: 42,
      status: 'merged',
      message: 'Pull request #42 was squash merged.',
    });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      mergePullRequest,
    });

    await vi.waitFor(() => expect(mergePullRequest).toHaveBeenCalledWith({
      pullRequestNumber: 42,
      expectedHeadBranch: 'mobile-merge',
      method: 'squash',
    }));
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'pull_request_merge_result',
        payload: expect.objectContaining({ status: 'merged', pullRequestNumber: 42 }),
      }),
    ]));
  });

  it('resubmits the prompt for a retry_turn action through the normal enqueue path', async () => {
    const published: PublishMobileEventPayload[] = [];
    const enqueueInstruction = vi.fn();
    const actions: MobileAction[] = [{
      id: 'retry-1',
      sequence: 1,
      actionType: 'retry_turn',
      requestId: 'request-retry-1',
      payload: { workId: 'original-work-id', prompt: 'run the failing tests again' },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction,
    });

    await vi.waitFor(() => expect(enqueueInstruction).toHaveBeenCalledTimes(1));
    const [prompt, context] = enqueueInstruction.mock.calls[0] as [string, { turn: { workId: string; prompt: string } }];
    expect(prompt).toBe('run the failing tests again');
    expect(context.turn.prompt).toBe('run the failing tests again');
    // A retry gets its own fresh workId rather than reusing the original failed turn's id.
    expect(context.turn.workId).not.toBe('original-work-id');
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'session_turn_state',
        payload: expect.objectContaining({ status: 'running', prompt: 'run the failing tests again' }),
      }),
    ]));
  });

  it('applies a set_model action via the registered handler and publishes the outcome', async () => {
    const published: PublishMobileEventPayload[] = [];
    const modelChangeHandler = vi.fn().mockResolvedValue({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'applied' as const,
    });
    const actions: MobileAction[] = [{
      id: 'set-model-1',
      sequence: 1,
      actionType: 'set_model',
      requestId: 'request-set-model-1',
      payload: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });
    relay.setModelChangeHandler(modelChangeHandler);

    await vi.waitFor(() => expect(modelChangeHandler).toHaveBeenCalledWith('openrouter', 'anthropic/claude-sonnet-4.5'));
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'model_status',
        payload: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', status: 'applied' },
      }),
    ]));
  });

  it('rejects permission-mode actions until the mobile pairing is claimed', async () => {
    const published: PublishMobileEventPayload[] = [];
    const applyPermissionMode = vi.fn().mockReturnValue(createPermissionModeChange('unrestricted'));
    const actions: MobileAction[] = [{
      id: 'set-permission-mode-before-claim',
      sequence: 1,
      actionType: 'set_permission_mode',
      requestId: 'request-set-permission-mode-before-claim',
      payload: { mode: 'unrestricted' },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({
        pairingClaimed: false,
        pairingStatus: 'pending',
      }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      applyPermissionMode,
    });

    await vi.waitFor(() => expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        requestId: 'request-set-permission-mode-before-claim',
        payload: {
          requestedMode: 'unrestricted',
          status: 'failed',
          error: 'Mobile pairing must be claimed before changing permission mode.',
        },
      }),
    ])));
    expect(applyPermissionMode).not.toHaveBeenCalled();
  });

  it('applies a supported permission mode action and publishes its acknowledgement', async () => {
    const published: PublishMobileEventPayload[] = [];
    const applyPermissionMode = vi.fn().mockReturnValue(createPermissionModeChange('restricted'));
    const actions: MobileAction[] = [{
      id: 'set-permission-mode-1',
      sequence: 1,
      actionType: 'set_permission_mode',
      requestId: 'request-set-permission-mode-1',
      payload: { mode: 'restricted' },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      applyPermissionMode,
    });

    await vi.waitFor(() => expect(applyPermissionMode).toHaveBeenCalledWith('restricted'));
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        requestId: 'request-set-permission-mode-1',
        payload: {
          requestedMode: 'restricted',
          appliedMode: 'restricted',
          status: 'applied',
        },
      }),
    ]));
  });

  it('retries a permission-mode action when its acknowledgement fails', async () => {
    vi.useFakeTimers();
    const transportError = new Error('permission status transport unavailable');
    const published: PublishMobileEventPayload[] = [];
    const applyPermissionMode = vi.fn().mockReturnValue(createPermissionModeChange('restricted'));
    const onError = vi.fn();
    const action: MobileAction = {
      id: 'set-permission-mode-retry',
      sequence: 1,
      actionType: 'set_permission_mode',
      requestId: 'request-set-permission-mode-retry',
      payload: { mode: 'restricted' },
      createdAt: new Date().toISOString(),
    };
    const pollMobileActions = vi.fn().mockImplementation(
      async (_token, _sessionId, _deviceId, cursor: number) => (
        cursor === 0
          ? { actions: [action], nextCursor: 1 }
          : { actions: [], nextCursor: 1 }
      )
    );
    const publishMobileEvent = vi.fn()
      .mockRejectedValueOnce(transportError)
      .mockImplementation(async (_token, payload) => published.push(payload));
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent,
      pollMobileActions,
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      applyPermissionMode,
      onError,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(applyPermissionMode).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(transportError);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(applyPermissionMode).toHaveBeenCalledOnce();
    expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        requestId: 'request-set-permission-mode-retry',
        payload: expect.objectContaining({ status: 'applied' }),
      }),
    ]));
  });

  it('uses the action id to correlate permission-mode acknowledgements without a request id', async () => {
    const published: PublishMobileEventPayload[] = [];
    const applyPermissionMode = vi.fn().mockReturnValue(createPermissionModeChange('restricted'));
    const action: MobileAction = {
      id: 'set-permission-mode-without-request-id',
      sequence: 1,
      actionType: 'set_permission_mode',
      requestId: null,
      payload: { mode: 'restricted' },
      createdAt: new Date().toISOString(),
    };
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions: [action], nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      applyPermissionMode,
    });

    await vi.waitFor(() => expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'permission_mode_status',
        requestId: action.id,
      }),
    ])));
  });

  it('does not apply a permission-mode action without a stable action id', async () => {
    const applyPermissionMode = vi.fn().mockReturnValue(createPermissionModeChange('restricted'));
    const onError = vi.fn();
    const action: MobileAction = {
      id: '   ',
      sequence: 1,
      actionType: 'set_permission_mode',
      requestId: null,
      payload: { mode: 'restricted' },
      createdAt: new Date().toISOString(),
    };
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: true }),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockResolvedValue(undefined),
      pollMobileActions: vi.fn().mockResolvedValue({ actions: [action], nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      applyPermissionMode,
      onError,
    });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Mobile permission-mode action is missing a stable identifier.',
    })));
    expect(applyPermissionMode).not.toHaveBeenCalled();
  });

  it('does not reclassify an applied model change when publishing its status fails', async () => {
    const transportError = new Error('mobile event transport unavailable');
    const publishMobileEvent = vi.fn().mockRejectedValue(transportError);
    const onError = vi.fn();
    const modelChangeHandler = vi.fn().mockResolvedValue({
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4.5',
      status: 'applied' as const,
    });
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent,
      pollMobileActions: vi.fn().mockResolvedValue({
        actions: [{
          id: 'set-model-transport-failure',
          sequence: 1,
          actionType: 'set_model',
          requestId: 'request-set-model-transport-failure',
          payload: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
          createdAt: new Date().toISOString(),
        }],
        nextCursor: 1,
      }),
    };

    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      onError,
    });
    relay.setModelChangeHandler(modelChangeHandler);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(transportError));
    expect(modelChangeHandler).toHaveBeenCalledOnce();
    expect(publishMobileEvent).toHaveBeenCalledOnce();
    expect(publishMobileEvent).toHaveBeenCalledWith('token', expect.objectContaining({
      eventType: 'model_status',
      payload: expect.objectContaining({ status: 'applied' }),
    }));
  });

  it('reports model_status failed when no handler is registered for set_model', async () => {
    const published: PublishMobileEventPayload[] = [];
    const actions: MobileAction[] = [{
      id: 'set-model-2',
      sequence: 1,
      actionType: 'set_model',
      requestId: 'request-set-model-2',
      payload: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
      createdAt: new Date().toISOString(),
    }];
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue(undefined),
      claimWork: vi.fn().mockResolvedValue(null),
      publishMobileEvent: vi.fn().mockImplementation(async (_token, payload) => published.push(payload)),
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    };

    startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
    });

    await vi.waitFor(() => expect(published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'model_status',
        payload: expect.objectContaining({ status: 'failed' }),
      }),
    ])));
  });
});
