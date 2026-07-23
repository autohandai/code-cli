/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authenticateXAIOAuth,
  isXAIOAuthAuthExpired,
  refreshXAIOAuthAuth,
  requestXAIDeviceCode,
  completeXAIDeviceCode,
  mapGrokCliAuthToXAIOAuth,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_DEVICE_CODE_URL,
  XAI_OAUTH_TOKEN_URL,
  XAI_OAUTH_SCOPE,
} from '../../src/providers/xaiAuth.js';

vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

function makeJwt(expiresInSeconds = 3600): string {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    sub: 'user-123',
  };
  return `a.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c`;
}

describe('xaiAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the public Grok CLI OAuth client and endpoints', () => {
    expect(XAI_OAUTH_CLIENT_ID).toBe('b1a00492-073a-47ea-816f-4c329264a828');
    expect(XAI_OAUTH_DEVICE_CODE_URL).toBe('https://auth.x.ai/oauth2/device/code');
    expect(XAI_OAUTH_TOKEN_URL).toBe('https://auth.x.ai/oauth2/token');
    expect(XAI_OAUTH_SCOPE).toContain('offline_access');
    expect(XAI_OAUTH_SCOPE).toContain('grok-cli:access');
  });

  it('detects expired oauth tokens with leeway', () => {
    expect(isXAIOAuthAuthExpired({
      accessToken: 'token',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })).toBe(true);

    expect(isXAIOAuthAuthExpired({
      accessToken: 'token',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }, 60_000)).toBe(false);
  });

  it('maps ~/.grok/auth.json credentials into XAIOAuthAuth', () => {
    const mapped = mapGrokCliAuthToXAIOAuth({
      key: 'access-from-grok-cli',
      refresh_token: 'refresh-from-grok-cli',
      expires_at: '2030-01-01T00:00:00.000Z',
      email: 'user@example.com',
      user_id: 'user-abc',
    });

    expect(mapped).toEqual({
      accessToken: 'access-from-grok-cli',
      refreshToken: 'refresh-from-grok-cli',
      expiresAt: '2030-01-01T00:00:00.000Z',
      email: 'user@example.com',
      userId: 'user-abc',
      lastRefresh: expect.any(String),
    });
  });

  it('requests a device code from auth.x.ai', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        device_code: 'device-code-123',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.x.ai/oauth2/device',
        verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
        expires_in: 600,
        interval: 5,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const deviceCode = await requestXAIDeviceCode();

    expect(deviceCode).toEqual({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
      intervalSeconds: 5,
      expiresInSeconds: 600,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      XAI_OAUTH_DEVICE_CODE_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );

    const body = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string;
    expect(body).toContain(`client_id=${XAI_OAUTH_CLIENT_ID}`);
    expect(body).toContain('scope=');
  });

  it('surfaces device auth failures with status detail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: 'invalid_client',
        error_description: 'client is not allowed',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(requestXAIDeviceCode()).rejects.toThrow(
      /xAI device authorization failed with status 403.*client is not allowed/,
    );
  });

  it('completes device code polling and returns oauth credentials', async () => {
    const accessToken = makeJwt(3600);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: 'authorization_pending',
        }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-token-1',
          id_token: 'id-token-1',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await completeXAIDeviceCode({
      deviceCode: 'device-code-123',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://accounts.x.ai/oauth2/device',
      intervalSeconds: 0,
      expiresInSeconds: 60,
    });

    expect(result.accessToken).toBe(accessToken);
    expect(result.refreshToken).toBe('refresh-token-1');
    expect(result.idToken).toBe('id-token-1');
    expect(result.expiresAt).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const tokenBody = (fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string;
    expect(tokenBody).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code');
    expect(tokenBody).toContain('device_code=device-code-123');
  });

  it('refreshes oauth tokens and rotates the refresh token', async () => {
    const accessToken = makeJwt(7200);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: accessToken,
        refresh_token: 'rotated-refresh',
        expires_in: 7200,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const refreshed = await refreshXAIOAuthAuth({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    expect(refreshed.accessToken).toBe(accessToken);
    expect(refreshed.refreshToken).toBe('rotated-refresh');
    expect(fetchSpy).toHaveBeenCalledWith(
      XAI_OAUTH_TOKEN_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    const body = (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=old-refresh');
  });

  it('runs the full device-code authenticate flow with browser open', async () => {
    const accessToken = makeJwt(3600);
    const onPrompt = vi.fn();

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          device_code: 'device-code-xyz',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://accounts.x.ai/oauth2/device',
          verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=WXYZ-1234',
          expires_in: 300,
          interval: 1,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-token-xyz',
          expires_in: 3600,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const auth = await authenticateXAIOAuth({ onPrompt });

    expect(auth.accessToken).toBe(accessToken);
    expect(auth.refreshToken).toBe('refresh-token-xyz');
    expect(onPrompt).toHaveBeenCalledWith(expect.objectContaining({
      verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=WXYZ-1234',
      userCode: 'WXYZ-1234',
      browserOpened: true,
    }));
  });
});
