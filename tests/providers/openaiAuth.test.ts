/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authenticateOpenAIChatGPT,
  ensureOpenAIChatGPTAuth,
  isChatGPTAuthExpired,
  extractChatGPTAccountId,
  refreshChatGPTAuth,
  requestOpenAIChatGPTDeviceCode,
  completeOpenAIChatGPTDeviceCode,
} from '../../src/providers/openaiAuth.js';

vi.mock('open', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe('openaiAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the chatgpt account id from a jwt token', () => {
    const payload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
      },
    };
    const token = `a.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c`;

    expect(extractChatGPTAccountId(token)).toBe('account-123');
  });

  it('requests a device code from OpenAI auth', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        device_auth_id: 'device-auth-123',
        user_code: 'ABCD-EFGH',
        interval: '5',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const deviceCode = await requestOpenAIChatGPTDeviceCode();

    expect(deviceCode).toEqual({
      deviceAuthId: 'device-auth-123',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
      intervalSeconds: 5,
    });
  });

  it('surfaces device auth response details when the request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        error: 'invalid_client',
        error_description: 'client is not allowed',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(requestOpenAIChatGPTDeviceCode()).rejects.toThrow(
      'OpenAI ChatGPT device authorization failed with status 403: client is not allowed',
    );
  });

  it('fails with a friendly timeout when requesting a device code stalls', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'AbortError';

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(timeoutErr);

    await expect(requestOpenAIChatGPTDeviceCode()).rejects.toThrow(
      'OpenAI ChatGPT device authorization timed out. Check your connection and try again.',
    );
  });

  it('completes direct device auth flow without codex auth.json', async () => {
    const jwtPayload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
      },
    };
    const idToken = `a.${Buffer.from(JSON.stringify(jwtPayload)).toString('base64url')}.c`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_code: 'auth-code-123',
          code_challenge: 'challenge',
          code_verifier: 'verifier',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id_token: idToken,
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await completeOpenAIChatGPTDeviceCode({
      deviceAuthId: 'device-auth-123',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
      intervalSeconds: 1,
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'https://auth.openai.com/api/accounts/deviceauth/token',
      expect.any(Object),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'https://auth.openai.com/oauth/token',
      expect.any(Object),
    );
    expect(result.accountId).toBe('account-123');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('treats initial unknown device authorization responses as pending', async () => {
    const jwtPayload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
      },
    };
    const idToken = `a.${Buffer.from(JSON.stringify(jwtPayload)).toString('base64url')}.c`;

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          error: 'unknown',
          error_description: 'Device authorization is unknown. Please try again.',
        }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authorization_code: 'auth-code-123',
          code_challenge: 'challenge',
          code_verifier: 'verifier',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          id_token: idToken,
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const result = await completeOpenAIChatGPTDeviceCode({
      deviceAuthId: 'device-auth-123',
      userCode: 'ABCD-EFGH',
      verificationUrl: 'https://auth.openai.com/codex/device',
      intervalSeconds: 0,
    });

    expect(result.accountId).toBe('account-123');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('refreshes chatgpt auth using the OpenAI auth endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        id_token: 'new-id-token',
        expires_in: 3600,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const refreshed = await refreshChatGPTAuth({
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
      accountId: 'account-123',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );
    expect(refreshed.accessToken).toBe('new-access-token');
    expect(refreshed.refreshToken).toBe('new-refresh-token');
    expect(refreshed.accountId).toBe('account-123');
    expect(refreshed.expiresAt).toBeTruthy();
  });

  it('ensures auth by running the browser oauth flow when needed', async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const jwtPayload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
      },
    };
    const idToken = `a.${Buffer.from(JSON.stringify(jwtPayload)).toString('base64url')}.c`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('http://127.0.0.1:')) {
        return realFetch(input, init);
      }

      if (url === 'https://auth.openai.com/oauth/token') {
        return Promise.resolve(
          new Response(JSON.stringify({
            id_token: idToken,
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    try {
      let authorizationUrl = '';
      const authPromise = ensureOpenAIChatGPTAuth({
        onPrompt: ({ authorizationUrl: url }) => {
          authorizationUrl = url;
        },
      } as never);

      for (let i = 0; i < 50 && !authorizationUrl; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const authUrl = new URL(authorizationUrl);
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      const originator = authUrl.searchParams.get('originator');

      expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/auth\/callback$/);
      expect(originator).toBe('autohand-code');

      await realFetch(`${redirectUri}?code=auth-code-123&state=${state}`);

      const result = await authPromise;
      expect(result.accountId).toBe('account-123');
    } finally {
      fetchSpy.mockRestore();
      // Additional delay to ensure server cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  it('authenticates through browser oauth callback without device polling', async () => {
    const realFetch = globalThis.fetch.bind(globalThis);
    const jwtPayload = {
      exp: Math.floor(Date.now() / 1000) + 3600,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-123',
      },
    };
    const idToken = `a.${Buffer.from(JSON.stringify(jwtPayload)).toString('base64url')}.c`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.startsWith('http://127.0.0.1:')) {
        return realFetch(input, init);
      }

      if (url === 'https://auth.openai.com/oauth/token') {
        return Promise.resolve(
          new Response(JSON.stringify({
            id_token: idToken,
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    });

    try {
      let authorizationUrl = '';
      const authPromise = authenticateOpenAIChatGPT({
        onPrompt: ({ authorizationUrl: url }) => {
          authorizationUrl = url;
        },
      });

      for (let i = 0; i < 50 && !authorizationUrl; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(authorizationUrl).toContain('https://auth.openai.com/oauth/authorize');

      const authUrl = new URL(authorizationUrl);
      const redirectUri = authUrl.searchParams.get('redirect_uri');
      const state = authUrl.searchParams.get('state');
      const originator = authUrl.searchParams.get('originator');

      expect(redirectUri).toBeTruthy();
      expect(state).toBeTruthy();
      expect(redirectUri).toMatch(/^http:\/\/localhost:\d+\/auth\/callback$/);
      expect(originator).toBe('autohand-code');

      await realFetch(`${redirectUri}?code=auth-code-123&state=${state}`);

      const result = await authPromise;

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://auth.openai.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(result.accountId).toBe('account-123');
      expect(result.refreshToken).toBe('refresh-token');
    } finally {
      fetchSpy.mockRestore();
      // Additional delay to ensure server cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });

  it('detects expired tokens from expiresAt', () => {
    expect(isChatGPTAuthExpired({
      accessToken: 'token',
      accountId: 'account-123',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })).toBe(true);
  });
});
