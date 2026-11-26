/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_RELAY_LIFECYCLE,
  startMobileRelay,
  stopMobileRelay,
} from '../../src/mobile/MobileRelay.js';
import type {
  MobileAction,
  MobileHandoffClientLike,
  PublishMobileEventPayload,
} from '../../src/mobile/MobileHandoffClient.js';
import { reachableStates, StateMachine, terminalStates } from '../../src/utils/stateMachine.js';
import { randomEventWalk } from '../helpers/stateMachineProperties.js';

function createClient(overrides: Partial<MobileHandoffClientLike> = {}) {
  const published: PublishMobileEventPayload[] = [];
  const client: MobileHandoffClientLike = {
    getDeviceId: vi.fn().mockResolvedValue('device-1'),
    registerDevice: vi.fn().mockResolvedValue(undefined),
    createPairing: vi.fn(),
    sendRelayHeartbeat: vi.fn().mockResolvedValue({ pairingClaimed: false, pairingStatus: 'pending' }),
    claimWork: vi.fn().mockResolvedValue(null),
    publishMobileEvent: vi.fn(async (_token: string, payload: PublishMobileEventPayload) => {
      published.push(payload);
    }),
    ...overrides,
  };
  return { client, published };
}

const relayOptions = {
  token: 'token',
  deviceId: 'device-1',
  sessionId: 'session-1',
  pairingId: 'pairing-1',
  mode: 'steer' as const,
  pollIntervalMs: 60_000,
};

afterEach(() => {
  stopMobileRelay();
  vi.useRealTimers();
});

describe('MOBILE_RELAY_LIFECYCLE transition table', () => {
  const events = ['claim', 'dispose'] as const;

  it('declares the pairing lifecycle edges', () => {
    expect(MOBILE_RELAY_LIFECYCLE.initial).toBe('awaitingClaim');
    expect(MOBILE_RELAY_LIFECYCLE.transitions).toEqual({
      awaitingClaim: { claim: 'connected', dispose: 'disposed' },
      connected: { dispose: 'disposed' },
      disposed: {},
    });
  });

  it('rejects a second claim and anything after disposal', () => {
    const machine = new StateMachine(MOBILE_RELAY_LIFECYCLE);
    machine.send('claim');
    expect(machine.can('claim')).toBe(false);
    machine.send('dispose');
    expect(machine.can('dispose')).toBe(false);
    expect(machine.can('claim')).toBe(false);
  });

  it('has disposed as its only terminal state and reaches every state', () => {
    expect(terminalStates(MOBILE_RELAY_LIFECYCLE)).toEqual(['disposed']);
    expect(reachableStates(MOBILE_RELAY_LIFECYCLE)).toEqual(
      new Set(Object.keys(MOBILE_RELAY_LIFECYCLE.transitions)),
    );
  });

  it('accepts exactly the declared edges under random event walks', () => {
    randomEventWalk(MOBILE_RELAY_LIFECYCLE, events, { seeds: 50, steps: 30 });
  });
});

describe('MobileRelay stale relay guards', () => {
  it('does not read or upload workspace artifacts after the relay stops', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'mobile-relay-artifacts-'));
    try {
      await writeFile(path.join(workspaceRoot, 'report.txt'), 'private build log');
      const uploadMobileArtifact = vi.fn().mockResolvedValue({
        id: 'artifact-1',
        name: 'report.txt',
        kind: 'log',
        mimeType: 'text/plain',
        url: 'https://example.com/a',
      });
      const { client } = createClient({ uploadMobileArtifact });
      const relay = startMobileRelay({ ...relayOptions, client, workspaceRoot, enqueueInstruction: vi.fn() });

      await relay.publishArtifactsFromText('See `report.txt`.');
      expect(uploadMobileArtifact).toHaveBeenCalledOnce();

      stopMobileRelay();
      await relay.publishArtifactsFromText('See `report.txt`.');
      expect(uploadMobileArtifact).toHaveBeenCalledOnce();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('does not collect or publish delivery status after the relay stops', async () => {
    const deliveryStatusProvider = vi.fn().mockResolvedValue({
      deployments: [{ id: 'preview', name: 'Preview', environment: 'Preview', status: 'success' }],
    });
    const { client, published } = createClient();
    const relay = startMobileRelay({
      ...relayOptions,
      client,
      enqueueInstruction: vi.fn(),
      deliveryStatusProvider,
    });

    stopMobileRelay();
    await relay.refreshDeliveryStatus();

    expect(deliveryStatusProvider).not.toHaveBeenCalled();
    expect(published).toEqual([]);
  });

  it('does not publish controller events through a stopped relay', async () => {
    const { client } = createClient();
    const relay = startMobileRelay({ ...relayOptions, client, enqueueInstruction: vi.fn() });

    stopMobileRelay();
    await relay.publishEvent('deployment_status', { deployments: [] });
    await relay.publishPullRequestStatus({
      id: '1',
      number: 1,
      title: 'PR',
      url: 'https://example.com/pr/1',
      headBranch: 'feature',
      baseBranch: 'main',
      status: 'open',
      mergeable: true,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      checks: [],
    });
    await relay.publishDeploymentStatus([]);

    expect(client.publishMobileEvent).not.toHaveBeenCalled();
  });

  it('does not publish a merge result through a relay replaced while the merge ran', async () => {
    let finishMerge!: () => void;
    const mergePullRequest = vi.fn(() => new Promise<{
      pullRequestNumber: number;
      status: 'merged';
      message: string;
    }>((resolve) => {
      finishMerge = () => resolve({ pullRequestNumber: 42, status: 'merged', message: 'merged' });
    }));
    const deliveryStatusProvider = vi.fn().mockResolvedValue({ deployments: [] });
    const actions: MobileAction[] = [{
      id: 'merge-1',
      sequence: 1,
      actionType: 'pull_request_merge',
      requestId: 'request-merge-1',
      payload: { pullRequestNumber: 42, expectedHeadBranch: 'feature', method: 'squash' },
      createdAt: new Date().toISOString(),
    }];
    const { client, published } = createClient({
      pollMobileActions: vi.fn().mockResolvedValue({ actions, nextCursor: 1 }),
    });
    startMobileRelay({
      ...relayOptions,
      client,
      enqueueInstruction: vi.fn(),
      mergePullRequest,
      deliveryStatusProvider,
    });
    await vi.waitFor(() => expect(mergePullRequest).toHaveBeenCalledOnce());

    stopMobileRelay();
    finishMerge();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(published.map((event) => event.eventType)).not.toContain('pull_request_merge_result');
    expect(deliveryStatusProvider).not.toHaveBeenCalled();
  });

  it('revokes the pairing once when unpair is called concurrently', async () => {
    let finishRevoke!: () => void;
    const revokePairing = vi.fn(() => new Promise<void>((resolve) => { finishRevoke = resolve; }));
    const { client } = createClient({ revokePairing });
    const relay = startMobileRelay({ ...relayOptions, client, enqueueInstruction: vi.fn() });

    const first = relay.unpair();
    const second = relay.unpair();
    finishRevoke();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(revokePairing).toHaveBeenCalledOnce();
    expect(relay.connection()).toBeNull();
  });

  it('retries unpair after a failed revoke without staying stuck', async () => {
    const revokePairing = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(undefined);
    const { client } = createClient({ revokePairing });
    const relay = startMobileRelay({ ...relayOptions, client, enqueueInstruction: vi.fn() });

    await expect(relay.unpair()).rejects.toThrow('network down');
    expect(relay.connection()).not.toBeNull();
    await expect(relay.unpair()).resolves.toBe(true);
    expect(revokePairing).toHaveBeenCalledTimes(2);
    expect(relay.connection()).toBeNull();
  });

  it('reports the connected state only after the phone claims the pairing', async () => {
    const sendRelayHeartbeat = vi.fn().mockResolvedValue({ pairingClaimed: false, pairingStatus: 'pending' });
    const { client } = createClient({ sendRelayHeartbeat });
    vi.useFakeTimers();
    const relay = startMobileRelay({ ...relayOptions, pollIntervalMs: 1_000, client, enqueueInstruction: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(relay.connection()?.connected).toBe(false);

    sendRelayHeartbeat.mockResolvedValue({ pairingClaimed: true, pairingStatus: 'claimed' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.connection()?.connected).toBe(true);

    sendRelayHeartbeat.mockResolvedValue({ pairingClaimed: false, pairingStatus: 'claimed' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.connection()?.connected).toBe(true);

    sendRelayHeartbeat.mockResolvedValue({ pairingStatus: 'revoked' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(relay.connection()).toBeNull();
  });
});
