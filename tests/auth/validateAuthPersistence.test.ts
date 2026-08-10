/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthClient } from '../../src/auth/AuthClient.js';

describe('AuthClient.validateSession network error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('throws on network/timeout errors instead of returning authenticated:false', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 100 });

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch failed'));

    await expect(client.validateSession('some-token')).rejects.toThrow('fetch failed');
  });

  it('throws on AbortError (timeout) so callers preserve credentials', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 100 });

    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    await expect(client.validateSession('some-token')).rejects.toThrow();
  });

  it('returns authenticated:false when server rejects the token', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 5000 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 })
    );

    const result = await client.validateSession('bad-token');
    expect(result.authenticated).toBe(false);
  });

  it('throws on non-auth HTTP failures so callers preserve credentials', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 5000 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'server failed' }), { status: 500 })
    );

    await expect(client.validateSession('some-token')).rejects.toThrow('HTTP 500');
  });

  it('returns authenticated:true with user data on success', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 5000 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 'u1', email: 'a@b.com', name: 'A' } }), { status: 200 })
    );

    const result = await client.validateSession('good-token');
    expect(result.authenticated).toBe(true);
    expect(result.user).toEqual({ id: 'u1', email: 'a@b.com', name: 'A' });
  });
});

describe('AuthClient.fetchEntitlement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the authoritative plan name and message allowances', async () => {
    const client = new AuthClient({ baseUrl: 'https://auth.example.com', timeout: 5000 });

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        entitlement: {
          tier: 'pro',
          freeRemaining: null,
          limits: {
            displayName: 'Autohand Code Pro',
            messagesPer5h: 100,
            messagesPerWeek: 1000,
            rpm: 100,
            requiresEligibility: false,
            perSeat: false,
            models: ['fantail', 'moa'],
          },
        },
      }), { status: 200 }),
    );

    await expect(client.fetchEntitlement('pro-token')).resolves.toEqual({
      tier: 'pro',
      freeRemaining: null,
      limits: {
        displayName: 'Autohand Code Pro',
        messagesPer5h: 100,
        messagesPerWeek: 1000,
        rpm: 100,
        requiresEligibility: false,
        perSeat: false,
        models: ['fantail', 'moa'],
      },
    });
  });
});

describe('AuthClient device authorization cancellation', () => {
  const deviceCode = 'D'.repeat(43);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cancels the private device transaction through the canonical API route', async () => {
    const client = new AuthClient({
      baseUrl: 'https://api.autohand.ai/v1/auth',
      timeout: 5000,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        schemaVersion: 1,
        status: 'cancelled',
      }), { status: 200 }),
    );

    await expect(client.cancelDeviceAuth(deviceCode)).resolves.toEqual({
      success: true,
      schemaVersion: 1,
      status: 'cancelled',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.autohand.ai/v1/auth/cli/cancel',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode, schemaVersion: 1 }),
      }),
    );
  });

  it('does not claim cancellation when the API rejects it', async () => {
    const client = new AuthClient({
      baseUrl: 'https://api.autohand.ai/v1/auth',
      timeout: 5000,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'transaction not found' }), { status: 404 }),
    );

    await expect(client.cancelDeviceAuth(deviceCode)).resolves.toEqual({
      success: false,
      error: 'transaction not found',
    });
  });
});
