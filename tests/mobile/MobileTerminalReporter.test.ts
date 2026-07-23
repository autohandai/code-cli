/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileHandoffClientLike } from '../../src/mobile/MobileHandoffClient.js';
import {
  MobileHandoffClient,
  MobileHandoffRequestError,
} from '../../src/mobile/MobileHandoffClient.js';
import { MobileTerminalReporter } from '../../src/mobile/MobileTerminalReporter.js';
import { startMobileRelay, stopMobileRelay } from '../../src/mobile/MobileRelay.js';

const temporaryDirectories: string[] = [];

async function createOutboxRoot(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autohand-mobile-terminal-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function findReportFiles(root: string): Promise<string[]> {
  if (!await fs.pathExists(root)) return [];
  const scopes = await fs.readdir(root);
  const files = await Promise.all(scopes.map(async (scope) => {
    const scopePath = path.join(root, scope);
    const stat = await fs.stat(scopePath);
    if (!stat.isDirectory()) return [];
    return (await fs.readdir(scopePath))
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.join(scopePath, file));
  }));
  return files.flat();
}

function createClient(options: {
  updateWork?: () => Promise<unknown>;
  publishMobileEvent?: () => Promise<unknown>;
} = {}): MobileHandoffClientLike {
  return {
    getDeviceId: vi.fn(async () => 'device-1'),
    registerDevice: vi.fn(async () => undefined),
    createPairing: vi.fn(),
    sendRelayHeartbeat: vi.fn(async () => ({ pairingClaimed: false })),
    claimWork: vi.fn(async () => null),
    updateWork: vi.fn(options.updateWork ?? (async () => ({}))),
    publishMobileEvent: vi.fn(options.publishMobileEvent ?? (async () => undefined)),
  } as unknown as MobileHandoffClientLike;
}

function createReporter(
  client: MobileHandoffClientLike,
  outboxRoot: string,
  overrides: Partial<ConstructorParameters<typeof MobileTerminalReporter>[0]> = {},
): MobileTerminalReporter {
  return new MobileTerminalReporter({
    client,
    token: 'auth-token-sensitive',
    apiBaseUrl: 'https://preview-api.example.com',
    owner: { profileId: 'profile-sensitive', accountId: 'account-sensitive' },
    deviceId: 'device-1',
    sessionId: 'session-1',
    pairingId: 'pairing-1',
    outboxRoot,
    retryDelayMs: 60_000,
    ...overrides,
  });
}

afterEach(async () => {
  stopMobileRelay();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.remove(directory)));
  vi.restoreAllMocks();
});

describe('MobileTerminalReporter', () => {
  it('persists a privacy-minimal report and replays both operations after restart', async () => {
    const outboxRoot = await createOutboxRoot();
    const unavailableClient = createClient({
      updateWork: async () => { throw new Error('offline with raw-error-sensitive'); },
      publishMobileEvent: async () => { throw new Error('offline with raw-error-sensitive'); },
    });
    const firstReporter = createReporter(unavailableClient, outboxRoot);

    await firstReporter.report({
      workId: 'work-1',
      status: 'failed',
      startedAt: '2026-07-23T01:00:00.000Z',
      completedAt: '2026-07-23T01:01:00.000Z',
      updateClaimedWork: true,
      prompt: 'prompt-sensitive',
      output: 'output-sensitive',
      error: 'terminal-error-sensitive',
    });

    const [reportPath] = await findReportFiles(outboxRoot);
    expect(reportPath).toBeDefined();
    expect(reportPath).not.toContain('account-sensitive');
    const persisted = await fs.readFile(reportPath!, 'utf8');
    expect(persisted).toContain('work-1');
    expect(persisted).not.toMatch(/auth-token-sensitive|account-sensitive|prompt-sensitive|output-sensitive|terminal-error-sensitive|raw-error-sensitive/);
    expect((await fs.stat(reportPath!)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(reportPath!))).mode & 0o777).toBe(0o700);
    expect(unavailableClient.publishMobileEvent).toHaveBeenCalledWith('auth-token-sensitive', expect.objectContaining({
      payload: expect.objectContaining({
        prompt: 'prompt-sensitive',
        output: 'output-sensitive',
        error: 'terminal-error-sensitive',
      }),
    }));

    const recoveredClient = createClient();
    const recoveredReporter = createReporter(recoveredClient, outboxRoot, {
      token: 'fresh-auth-token-sensitive',
      deviceId: 'device-2',
      sessionId: 'session-2',
      pairingId: 'pairing-2',
      retryDelayMs: 0,
    });

    await recoveredReporter.flush({ ignoreSchedule: true });

    expect(recoveredClient.updateWork).toHaveBeenCalledWith('fresh-auth-token-sensitive', 'device-1', 'work-1', {
      status: 'failed',
      completedAt: '2026-07-23T01:01:00.000Z',
      payload: { deliveryState: 'failed', executionState: 'failed' },
    });
    expect(recoveredClient.publishMobileEvent).toHaveBeenCalledWith('fresh-auth-token-sensitive', {
      sessionId: 'session-1',
      deviceId: 'device-1',
      pairingId: 'pairing-1',
      requestId: 'work-1',
      eventType: 'session_turn_state',
      payload: {
        workId: 'work-1',
        status: 'failed',
        startedAt: '2026-07-23T01:00:00.000Z',
        completedAt: '2026-07-23T01:01:00.000Z',
      },
    });
    expect(await findReportFiles(outboxRoot)).toHaveLength(0);
  });

  it('persists partial acknowledgement and does not resend the acknowledged leg', async () => {
    const outboxRoot = await createOutboxRoot();
    const firstClient = createClient({
      publishMobileEvent: async () => { throw new Error('offline'); },
    });
    await createReporter(firstClient, outboxRoot).report({
      workId: 'work-partial',
      status: 'completed',
      completedAt: '2026-07-23T02:00:00.000Z',
      updateClaimedWork: true,
      output: 'must-not-be-persisted',
    });
    expect(await findReportFiles(outboxRoot)).toHaveLength(1);

    const recoveredClient = createClient();
    await createReporter(recoveredClient, outboxRoot).flush({ ignoreSchedule: true });

    expect(recoveredClient.updateWork).not.toHaveBeenCalled();
    expect(recoveredClient.publishMobileEvent).toHaveBeenCalledOnce();
    expect(await findReportFiles(outboxRoot)).toHaveLength(0);
  });

  it('keeps the first terminal outcome immutable for a scope, session, and work item', async () => {
    const outboxRoot = await createOutboxRoot();
    let workAttempts = 0;
    let eventAttempts = 0;
    const client = createClient({
      updateWork: async () => {
        workAttempts += 1;
        if (workAttempts === 1) throw new Error('offline');
        return {};
      },
      publishMobileEvent: async () => {
        eventAttempts += 1;
        if (eventAttempts === 1) throw new Error('offline');
      },
    });
    const reporter = createReporter(client, outboxRoot, { retryDelayMs: 0 });
    await reporter.report({
      workId: 'work-immutable',
      status: 'failed',
      completedAt: '2026-07-23T02:30:00.000Z',
      updateClaimedWork: true,
      error: 'first-error-sensitive',
    });
    const [reportPath] = await findReportFiles(outboxRoot);
    const persisted = JSON.parse(await fs.readFile(reportPath!, 'utf8')) as Record<string, unknown>;
    expect(persisted.status).toBe('failed');
    expect(JSON.stringify(persisted)).not.toMatch(/first-error-sensitive|contradictory-output-sensitive/);

    await reporter.report({
      workId: 'work-immutable',
      status: 'completed',
      completedAt: '2026-07-23T02:31:00.000Z',
      updateClaimedWork: true,
      output: 'contradictory-output-sensitive',
    });

    expect(client.updateWork).toHaveBeenLastCalledWith('auth-token-sensitive', 'device-1', 'work-immutable', {
      status: 'failed',
      completedAt: '2026-07-23T02:30:00.000Z',
      payload: { deliveryState: 'failed', executionState: 'failed' },
    });
    expect(client.publishMobileEvent).toHaveBeenLastCalledWith('auth-token-sensitive', expect.objectContaining({
      payload: {
        workId: 'work-immutable',
        status: 'failed',
        completedAt: '2026-07-23T02:30:00.000Z',
      },
    }));
    expect(JSON.stringify([
      vi.mocked(client.updateWork!).mock.calls,
      vi.mocked(client.publishMobileEvent!).mock.calls,
    ])).not.toContain('"status":"completed"');
    expect(await findReportFiles(outboxRoot)).toHaveLength(0);
  });

  it('isolates pending reports across verified accounts on the same endpoint and device', async () => {
    const outboxRoot = await createOutboxRoot();
    const firstAccountClient = createClient({
      updateWork: async () => { throw new Error('offline'); },
      publishMobileEvent: async () => { throw new Error('offline'); },
    });
    await createReporter(firstAccountClient, outboxRoot, {
      token: 'account-a-token-sensitive',
      owner: { profileId: 'shared-profile-sensitive', accountId: 'account-a-sensitive' },
      deviceId: 'shared-device-1',
    }).report({
      workId: 'account-a-work',
      status: 'failed',
      completedAt: '2026-07-23T02:45:00.000Z',
      updateClaimedWork: true,
    });
    expect(await findReportFiles(outboxRoot)).toHaveLength(1);

    const secondAccountClient = createClient({
      updateWork: async () => { throw new MobileHandoffRequestError(404); },
      publishMobileEvent: async () => { throw new MobileHandoffRequestError(404); },
    });
    await createReporter(secondAccountClient, outboxRoot, {
      token: 'account-b-token-sensitive',
      owner: { profileId: 'shared-profile-sensitive', accountId: 'account-b-sensitive' },
      deviceId: 'shared-device-1',
    }).flush({ ignoreSchedule: true });

    expect(secondAccountClient.updateWork).not.toHaveBeenCalled();
    expect(secondAccountClient.publishMobileEvent).not.toHaveBeenCalled();
    expect(await findReportFiles(outboxRoot)).toHaveLength(1);

    const recoveredFirstAccountClient = createClient();
    await createReporter(recoveredFirstAccountClient, outboxRoot, {
      token: 'fresh-account-a-token-sensitive',
      owner: { profileId: 'shared-profile-sensitive', accountId: 'account-a-sensitive' },
      deviceId: 'shared-device-1',
    }).flush({ ignoreSchedule: true });
    expect(recoveredFirstAccountClient.updateWork).toHaveBeenCalledOnce();
    expect(recoveredFirstAccountClient.publishMobileEvent).toHaveBeenCalledOnce();
    expect(await findReportFiles(outboxRoot)).toHaveLength(0);
  });

  it('classifies permanent, auth-blocked, and transient delivery failures per leg', async () => {
    const permanentRoot = await createOutboxRoot();
    const permanentClient = createClient({
      updateWork: async () => { throw new MobileHandoffRequestError(404); },
    });
    await createReporter(permanentClient, permanentRoot).report({
      workId: 'retry-action-id',
      status: 'completed',
      completedAt: '2026-07-23T03:00:00.000Z',
      updateClaimedWork: true,
    });
    expect(await findReportFiles(permanentRoot)).toHaveLength(0);

    const authRoot = await createOutboxRoot();
    const authClient = createClient({
      updateWork: async () => { throw new MobileHandoffRequestError(401); },
      publishMobileEvent: async () => { throw new MobileHandoffRequestError(403); },
    });
    const authReporter = createReporter(authClient, authRoot);
    await authReporter.report({
      workId: 'work-auth',
      status: 'failed',
      completedAt: '2026-07-23T03:01:00.000Z',
      updateClaimedWork: true,
    });
    await authReporter.flush();
    expect(authClient.updateWork).toHaveBeenCalledOnce();
    expect(authClient.publishMobileEvent).toHaveBeenCalledOnce();
    expect(await findReportFiles(authRoot)).toHaveLength(1);

    const transientRoot = await createOutboxRoot();
    const transientClient = createClient({
      updateWork: async () => { throw new MobileHandoffRequestError(503); },
      publishMobileEvent: async () => { throw new Error('network unavailable'); },
    });
    const transientReporter = createReporter(transientClient, transientRoot);
    await transientReporter.report({
      workId: 'work-transient',
      status: 'cancelled',
      completedAt: '2026-07-23T03:02:00.000Z',
      updateClaimedWork: true,
    });
    await transientReporter.flush();
    expect(transientClient.updateWork).toHaveBeenCalledOnce();
    expect(transientClient.publishMobileEvent).toHaveBeenCalledOnce();
    expect(await findReportFiles(transientRoot)).toHaveLength(1);
  });

  it('bounds unacknowledged storage by count and age', async () => {
    const outboxRoot = await createOutboxRoot();
    let now = Date.parse('2026-07-23T04:00:00.000Z');
    const offlineClient = createClient({
      updateWork: async () => { throw new Error('offline'); },
      publishMobileEvent: async () => { throw new Error('offline'); },
    });
    const reporter = createReporter(offlineClient, outboxRoot, {
      maxEntries: 2,
      maxAgeMs: 1_000,
      now: () => now,
    });

    for (const workId of ['work-1', 'work-2', 'work-3']) {
      now += 10;
      await reporter.report({
        workId,
        status: 'failed',
        completedAt: new Date(now).toISOString(),
        updateClaimedWork: true,
      });
    }
    expect(await findReportFiles(outboxRoot)).toHaveLength(2);

    now += 1_001;
    await reporter.flush();
    expect(await findReportFiles(outboxRoot)).toHaveLength(0);
  });

  it('routes rich live terminal state through the durable reporter and flushes it on relay cycles', async () => {
    const client = createClient();
    const report = vi.fn(async () => undefined);
    const flush = vi.fn(async () => undefined);
    const relay = startMobileRelay({
      client,
      token: 'token',
      deviceId: 'device-1',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
      mode: 'steer',
      pollIntervalMs: 1_000,
      enqueueInstruction: vi.fn(),
      terminalReporter: { report, flush },
    });

    await Promise.resolve();
    await Promise.resolve();
    await relay.finishClaimedTurn({
      workId: 'work-live',
      prompt: 'prompt-live',
      startedAt: '2026-07-23T05:00:00.000Z',
      updateClaimedWork: true,
    }, {
      status: 'failed',
      output: 'output-live',
      error: 'error-live',
    });

    expect(flush).toHaveBeenCalledWith({ ignoreSchedule: true });
    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      workId: 'work-live',
      status: 'failed',
      updateClaimedWork: true,
      prompt: 'prompt-live',
      output: 'output-live',
      error: 'error-live',
    }));
    expect(client.updateWork).not.toHaveBeenCalled();
  });

  it('coalesces concurrent recovery flushes into one delivery per pending leg', async () => {
    const outboxRoot = await createOutboxRoot();
    const offlineClient = createClient({
      updateWork: async () => { throw new Error('offline'); },
      publishMobileEvent: async () => { throw new Error('offline'); },
    });
    await createReporter(offlineClient, outboxRoot).report({
      workId: 'work-single-flight',
      status: 'completed',
      completedAt: '2026-07-23T06:00:00.000Z',
      updateClaimedWork: true,
    });

    let release!: () => void;
    const deliveryGate = new Promise<void>((resolve) => { release = resolve; });
    const recoveredClient = createClient({
      updateWork: async () => deliveryGate,
      publishMobileEvent: async () => deliveryGate,
    });
    const recoveredReporter = createReporter(recoveredClient, outboxRoot);
    const first = recoveredReporter.flush({ ignoreSchedule: true });
    const second = recoveredReporter.flush({ ignoreSchedule: true });

    expect(second).toBe(first);
    await Promise.resolve();
    release();
    await first;
    expect(recoveredClient.updateWork).toHaveBeenCalledOnce();
    expect(recoveredClient.publishMobileEvent).toHaveBeenCalledOnce();
  });

  it('exposes status and Retry-After without retaining a raw API response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('raw-upstream-error-sensitive', {
      status: 429,
      headers: { 'Retry-After': '2' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    let caught: unknown;
    try {
      await client.publishMobileEvent('token-sensitive', {
        sessionId: 'session-1',
        deviceId: 'device-1',
        pairingId: 'pairing-1',
        eventType: 'session_turn_state',
        payload: { workId: 'work-1', status: 'completed' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(MobileHandoffRequestError);
    expect(caught).toMatchObject({ status: 429, retryAfterMs: 2_000 });
    expect(String(caught)).not.toContain('raw-upstream-error-sensitive');
  });
});
