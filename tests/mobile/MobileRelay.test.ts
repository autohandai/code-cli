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
} from '../../src/mobile/MobileRelay.js';
import type {
  MobileAction,
  MobileHandoffClientLike,
  PublishMobileEventPayload,
} from '../../src/mobile/MobileHandoffClient.js';
import { KeepAwakeController } from '../../src/mobile/KeepAwakeController.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

describe('MobileRelay event bridge', () => {
  afterEach(() => {
    stopMobileRelay();
    vi.useRealTimers();
  });

  it('reports a claimed pairing exactly once across repeated heartbeats', async () => {
    vi.useFakeTimers();
    const sendRelayHeartbeat = vi.fn()
      .mockResolvedValueOnce({
        success: true,
        pairing: {
          id: 'pairing-1',
          status: 'pending',
          claimedAt: null,
        },
      })
      .mockResolvedValue({
        success: true,
        pairing: {
          id: 'pairing-1',
          status: 'claimed',
          claimedAt: '2026-07-20T01:02:03.000Z',
        },
      });
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
    expect(onPairingClaimed).toHaveBeenCalledTimes(1);
    expect(onPairingClaimed).toHaveBeenCalledWith({
      id: 'pairing-1',
      status: 'claimed',
      claimedAt: '2026-07-20T01:02:03.000Z',
    });

    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendRelayHeartbeat).toHaveBeenCalledTimes(5);
    expect(onPairingClaimed).toHaveBeenCalledTimes(1);
  });

  it('delivers a claimed pairing observed before the handler is registered', async () => {
    vi.useFakeTimers();
    const client: MobileHandoffClientLike = {
      getDeviceId: vi.fn().mockResolvedValue('device-1'),
      registerDevice: vi.fn().mockResolvedValue(undefined),
      createPairing: vi.fn(),
      sendRelayHeartbeat: vi.fn().mockResolvedValue({
        success: true,
        pairing: {
          id: 'pairing-1',
          status: 'claimed',
          claimedAt: '2026-07-20T01:02:03.000Z',
        },
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

    expect(onPairingClaimed).toHaveBeenCalledTimes(1);
    expect(onPairingClaimed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'pairing-1',
      status: 'claimed',
    }));
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
});
