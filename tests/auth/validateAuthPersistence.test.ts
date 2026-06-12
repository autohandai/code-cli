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
