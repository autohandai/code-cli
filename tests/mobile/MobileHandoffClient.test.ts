/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import {
  getMobileApiBaseUrl,
  MobileHandoffClient,
} from '../../src/mobile/MobileHandoffClient.js';

const originalApiUrl = process.env.AUTOHAND_API_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalApiUrl === undefined) {
    delete process.env.AUTOHAND_API_URL;
  } else {
    process.env.AUTOHAND_API_URL = originalApiUrl;
  }
});

describe('relay heartbeat', () => {
  it('returns the typed revoked pairing status from the heartbeat response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      pairing: {
        id: 'pairing-sensitive',
        status: 'revoked',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await expect(client.sendRelayHeartbeat('auth-sensitive', {
      sessionId: 'session-sensitive',
      deviceId: 'cli-device-sensitive',
      pairingId: 'pairing-sensitive',
      mode: 'steer',
    })).resolves.toEqual({
      pairingClaimed: false,
      pairingStatus: 'revoked',
    });
  });

  it('reduces a claimed pairing response to a secret-free connection status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      relay: {
        sessionId: 'session-sensitive',
        deviceId: 'cli-device-sensitive',
        pairingId: 'pairing-sensitive',
        mode: 'steer',
        lastSeenAt: '2026-07-21T00:00:00.000Z',
        isFresh: true,
        staleAfterMs: 15_000,
      },
      pairing: {
        id: 'pairing-sensitive',
        status: 'claimed',
        claimedByDeviceId: 'iphone-sensitive',
        claimedAt: '2026-07-21T00:00:01.000Z',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    const status = await client.sendRelayHeartbeat('auth-sensitive', {
      sessionId: 'session-sensitive',
      deviceId: 'cli-device-sensitive',
      pairingId: 'pairing-sensitive',
      mode: 'steer',
    });

    expect(status).toEqual({ pairingClaimed: true, pairingStatus: 'claimed' });
    expect(JSON.stringify(status)).not.toContain('sensitive');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('reports an unclaimed heartbeat without inventing a connection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      relay: { isFresh: true },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await expect(client.sendRelayHeartbeat('auth-sensitive', {
      sessionId: 'session-sensitive',
      deviceId: 'cli-device-sensitive',
      pairingId: 'pairing-sensitive',
      mode: 'steer',
    })).resolves.toEqual({ pairingClaimed: false });
  });
});

describe('mobile device registration identity', () => {
  it('returns the verified profile and account resolved by the mobile API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      device: { deviceId: 'device-1' },
      profile: { id: 'profile-1' },
      account: { id: 'account-1' },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await expect(client.registerDevice('auth-sensitive', {
      deviceId: 'device-1',
      clientType: 'cli',
    })).resolves.toEqual({
      profile: { id: 'profile-1' },
      account: { id: 'account-1' },
    });
  });
});

describe('mobile work lifecycle', () => {
  it('sends the exact steer session scope when claiming live work', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: 'No work available',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await expect(client.claimWork('auth-sensitive', 'device-1', {
      deliveryMode: 'steer',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
    })).resolves.toBeNull();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://preview-api.example.com/v1/work/claim');
    expect(JSON.parse(String(init?.body))).toEqual({
      deviceId: 'device-1',
      deliveryMode: 'steer',
      sessionId: 'session-1',
      pairingId: 'pairing-1',
    });
  });

  it('reports a terminal work result to the same preview API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      work: {
        id: 'work-1',
        repo: '/workspace',
        branch: 'main',
        prompt: 'Run a harmless check',
        priority: 0,
        status: 'failed',
        agentId: null,
        deviceId: 'device-1',
        payload: { deliveryMode: 'steer', lastError: 'The configured model is unavailable.' },
        createdAt: '2026-07-21T02:35:00.000Z',
        updatedAt: '2026-07-21T02:35:01.000Z',
        completedAt: '2026-07-21T02:35:01.000Z',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await client.updateWork('auth-sensitive', 'device-1', 'work-1', {
      status: 'failed',
      completedAt: '2026-07-21T02:35:01.000Z',
      error: 'The configured model is unavailable.',
      payload: { deliveryState: 'failed', executionState: 'failed' },
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://preview-api.example.com/v1/work/work-1');
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'X-Device-ID': 'device-1' }),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      status: 'failed',
      completedAt: '2026-07-21T02:35:01.000Z',
      error: 'The configured model is unavailable.',
      payload: { deliveryState: 'failed', executionState: 'failed' },
    });
  });
});

describe('mobile action polling', () => {
  it('scopes the action request to the exact pairing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      actions: [],
      nextCursor: 7,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = new MobileHandoffClient({ baseUrl: 'https://preview-api.example.com' });

    await client.pollMobileActions('auth-sensitive', 'session-1', 'device-1', 7, 'pairing-1');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://preview-api.example.com/v1/mobile/sessions/session-1/actions?after=7&pairingId=pairing-1'
    );
    expect(init).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({ 'X-Device-ID': 'device-1' }),
    });
  });
});

describe('getMobileApiBaseUrl', () => {
  it('lets AUTOHAND_API_URL override the saved API base URL', () => {
    process.env.AUTOHAND_API_URL = 'https://preview-api.example.com/';

    expect(getMobileApiBaseUrl({
      configPath: '/tmp/config.json',
      api: { baseUrl: 'https://api.autohand.ai' },
    })).toBe('https://preview-api.example.com');
  });

  it('uses the saved API base URL when no environment override is set', () => {
    delete process.env.AUTOHAND_API_URL;

    expect(getMobileApiBaseUrl({
      configPath: '/tmp/config.json',
      api: { baseUrl: 'https://configured-api.example.com/' },
    })).toBe('https://configured-api.example.com');
  });

  it('ignores a blank override and normalizes the saved API base URL', () => {
    process.env.AUTOHAND_API_URL = '   ';

    expect(getMobileApiBaseUrl({
      configPath: '/tmp/config.json',
      api: { baseUrl: '  https://configured-api.example.com/  ' },
    })).toBe('https://configured-api.example.com');
  });
});

describe('dev command environment', () => {
  function probeDevEnvironment(apiUrl?: string): string {
    const command = packageJson.scripts.dev.replace(/bun src\/index\.ts$/, '/usr/bin/env');
    const result = spawnSync('/bin/sh', ['-c', command], {
      encoding: 'utf8',
      env: {
        HOME: process.env.HOME || '/tmp',
        PATH: process.env.PATH || '/usr/bin:/bin',
        ...(apiUrl === undefined ? {} : { AUTOHAND_API_URL: apiUrl }),
      },
    });

    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  }

  it('forwards an explicit AUTOHAND_API_URL through the clean environment', () => {
    expect(probeDevEnvironment('https://preview-api.example.com')).toContain(
      'AUTOHAND_API_URL=https://preview-api.example.com\n'
    );
  });

  it('leaves AUTOHAND_API_URL absent when the parent environment does not set it', () => {
    expect(probeDevEnvironment()).not.toContain('AUTOHAND_API_URL=');
  });
});
