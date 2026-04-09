/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OpenAIChatGPTAuth } from '../types.js';

const OPENAI_AUTH_BASE_URL = 'https://auth.openai.com';
const OPENAI_OAUTH_AUTHORIZE_URL = `${OPENAI_AUTH_BASE_URL}/oauth/authorize`;
const OPENAI_OAUTH_TOKEN_URL = `${OPENAI_AUTH_BASE_URL}/oauth/token`;
const OPENAI_DEVICE_USER_CODE_URL = `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const OPENAI_DEVICE_TOKEN_URL = `${OPENAI_AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const OPENAI_DEVICE_VERIFICATION_URL = `${OPENAI_AUTH_BASE_URL}/codex/device`;
const OPENAI_DEVICE_CALLBACK_URL = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`;
const OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTH_REQUEST_TIMEOUT_MS = 15_000;
const OPENAI_BROWSER_AUTH_TIMEOUT_MS = 5 * 60_000;
const OPENAI_BROWSER_AUTH_SCOPE = 'openid profile email offline_access';
const OPENAI_BROWSER_CALLBACK_HOST = '127.0.0.1';
const OPENAI_BROWSER_CALLBACK_URL_HOST = 'localhost';
const OPENAI_BROWSER_CALLBACK_PORT = 1455;
const OPENAI_BROWSER_CALLBACK_PATH = '/auth/callback';
const OPENAI_BROWSER_OAUTH_ORIGINATOR = 'autohand-code';

export interface OpenAIChatGPTDeviceCode {
  deviceAuthId: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
}

export interface OpenAIChatGPTBrowserPrompt {
  authorizationUrl: string;
  redirectUri: string;
  browserOpened: boolean;
}

interface JwtPayload {
  exp?: number;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
}

interface DeviceTokenPollResponse {
  authorization_code?: string;
  code_verifier?: string;
  error?: string;
  error_description?: string;
  state?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface ParsedResponse {
  payload: unknown;
  detail?: string;
}

interface OpenAIChatGPTBrowserAuthOptions {
  onPrompt?: (prompt: OpenAIChatGPTBrowserPrompt) => void | Promise<void>;
}

interface OAuthCallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return undefined;
  return new Date(payload.exp * 1000).toISOString();
}

function buildTokenBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generatePkceVerifier(): string {
  return toBase64Url(randomBytes(32));
}

function generatePkceChallenge(verifier: string): string {
  return toBase64Url(createHash('sha256').update(verifier).digest());
}

function createState(): string {
  return randomBytes(16).toString('hex');
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  context: string,
  timeoutMs = OPENAI_AUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${context} timed out. Check your connection and try again.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const candidate = payload as Record<string, unknown>;
  const direct = candidate.error_description ?? candidate.error ?? candidate.message ?? candidate.detail;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  const nestedError = candidate.error;
  if (nestedError && typeof nestedError === 'object') {
    const nested = nestedError as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'detail', 'code']) {
      const value = nested[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return undefined;
}

async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  const { payload, detail } = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      detail
        ? `${context} failed with status ${response.status}: ${detail}`
        : `${context} failed with status ${response.status}.`,
    );
  }

  if (payload === undefined) {
    throw new Error(`${context} returned an empty response.`);
  }

  return payload as T;
}

async function parseResponseBody(response: Response): Promise<ParsedResponse> {
  const rawText = await response.text();
  let payload: unknown;

  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }

  const detail = extractErrorDetail(payload) ?? (typeof payload === 'string' && payload.trim() ? payload.trim() : undefined);
  return { payload, detail };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBrowser(url: string): Promise<boolean> {
  try {
    const open = await import('open').then((mod) => mod.default);
    await open(url);
    return true;
  } catch {
    return false;
  }
}

function callbackSuccessHtml(): string {
  return '<!doctype html><html><body><h1>OpenAI sign-in complete.</h1><p>You can close this window.</p></body></html>';
}

function callbackErrorHtml(message: string): string {
  return `<!doctype html><html><body><h1>OpenAI sign-in failed.</h1><p>${message}</p></body></html>`;
}

async function listenForOAuthCallback(expectedState: string): Promise<{
  redirectUri: string;
  waitForResult: () => Promise<OAuthCallbackResult>;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '', `http://${OPENAI_BROWSER_CALLBACK_HOST}`);
      if (url.pathname !== OPENAI_BROWSER_CALLBACK_PATH) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(callbackErrorHtml('Callback route not found.'));
        return;
      }

      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');
      if (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(callbackErrorHtml(errorDescription || error));
        settle?.({
          error,
          errorDescription: errorDescription || undefined,
        });
        return;
      }

      const state = url.searchParams.get('state');
      if (state !== expectedState) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(callbackErrorHtml('State mismatch.'));
        settle?.({
          error: 'state_mismatch',
          errorDescription: 'State mismatch.',
        });
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(callbackErrorHtml('Missing authorization code.'));
        settle?.({
          error: 'missing_code',
          errorDescription: 'Missing authorization code.',
        });
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(callbackSuccessHtml());
      settle?.({ code });
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(callbackErrorHtml('Internal error while handling the callback.'));
      settle?.({
        error: 'callback_error',
        errorDescription: 'Internal error while handling the callback.',
      });
    }
  });
  const timeoutId: NodeJS.Timeout = setTimeout(() => {
    settle?.({
      error: 'timeout',
      errorDescription: 'OpenAI sign-in timed out. Finish the browser sign-in and try again.',
    });
  }, OPENAI_BROWSER_AUTH_TIMEOUT_MS);
  let settle: ((result: OAuthCallbackResult) => void) | undefined;
  let settled = false;

  const waitForResult = new Promise<OAuthCallbackResult>((resolve) => {
    settle = (result) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(result);
    };
  });

  const listenOnPort = async (port: number): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, OPENAI_BROWSER_CALLBACK_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });

  try {
    await listenOnPort(OPENAI_BROWSER_CALLBACK_PORT);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') {
      throw error;
    }

    await listenOnPort(0);
  }

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine OpenAI OAuth callback address.');
  }

  const callbackPort = (address as AddressInfo).port;

  return {
    redirectUri: `http://${OPENAI_BROWSER_CALLBACK_URL_HOST}:${callbackPort}${OPENAI_BROWSER_CALLBACK_PATH}`,
    waitForResult: () => waitForResult,
    close: async () => {
      if (timeoutId) clearTimeout(timeoutId);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

export function extractChatGPTAccountId(token: string): string | undefined {
  const payload = decodeJwtPayload(token);
  return payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
}

export function isChatGPTAuthExpired(auth: OpenAIChatGPTAuth, leewayMs = 60_000): boolean {
  if (!auth.expiresAt) return false;
  return new Date(auth.expiresAt).getTime() <= Date.now() + leewayMs;
}

export async function requestOpenAIChatGPTDeviceCode(): Promise<OpenAIChatGPTDeviceCode> {
  const response = await fetchWithTimeout(OPENAI_DEVICE_USER_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: OPENAI_CODEX_CLIENT_ID,
    }),
  }, 'OpenAI ChatGPT device authorization');

  const payload = await parseJsonResponse<{
    device_auth_id?: string;
    user_code?: string;
    interval?: number | string;
  }>(response, 'OpenAI ChatGPT device authorization');

  if (!payload.device_auth_id || !payload.user_code) {
    throw new Error('OpenAI ChatGPT device authorization returned incomplete data.');
  }

  return {
    deviceAuthId: payload.device_auth_id,
    userCode: payload.user_code,
    verificationUrl: OPENAI_DEVICE_VERIFICATION_URL,
    intervalSeconds: Math.max(1, Number(payload.interval ?? 5)),
  };
}

export async function completeOpenAIChatGPTDeviceCode(deviceCode: OpenAIChatGPTDeviceCode): Promise<OpenAIChatGPTAuth> {
  while (true) {
    const pollResponse = await fetchWithTimeout(OPENAI_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_auth_id: deviceCode.deviceAuthId,
        user_code: deviceCode.userCode,
      }),
    }, 'OpenAI ChatGPT device token poll');

    const { payload, detail } = await parseResponseBody(pollResponse);
    const pollPayload = payload as DeviceTokenPollResponse | undefined;

    const shouldKeepPolling =
      pollResponse.status === 404 ||
      (pollResponse.status === 403 && typeof detail === 'string' && detail.toLowerCase().includes('device authorization is unknown')) ||
      pollPayload?.error === 'authorization_pending' ||
      pollPayload?.state === 'pending' ||
      pollPayload?.state === 'running';

    if (!pollResponse.ok && shouldKeepPolling) {
      await sleep(deviceCode.intervalSeconds * 1000);
      continue;
    }

    if (!pollResponse.ok) {
      throw new Error(
        detail
          ? `OpenAI ChatGPT device token poll failed with status ${pollResponse.status}: ${detail}`
          : `OpenAI ChatGPT device token poll failed with status ${pollResponse.status}.`,
      );
    }

    if (pollPayload?.error === 'authorization_pending' || pollPayload?.state === 'pending' || pollPayload?.state === 'running') {
      await sleep(deviceCode.intervalSeconds * 1000);
      continue;
    }

    if (pollPayload?.error) {
      throw new Error(
        pollPayload.error_description
          ? `OpenAI ChatGPT device authorization failed: ${pollPayload.error_description}`
          : `OpenAI ChatGPT device authorization failed: ${pollPayload.error}`,
      );
    }

    if (!pollPayload?.authorization_code || !pollPayload.code_verifier) {
      await sleep(deviceCode.intervalSeconds * 1000);
      continue;
    }

    const tokenResponse = await fetchWithTimeout(OPENAI_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildTokenBody({
        grant_type: 'authorization_code',
        client_id: OPENAI_CODEX_CLIENT_ID,
        code: pollPayload.authorization_code,
        redirect_uri: OPENAI_DEVICE_CALLBACK_URL,
        code_verifier: pollPayload.code_verifier,
      }),
    }, 'OpenAI ChatGPT token exchange');

    const tokenPayload = await parseJsonResponse<OAuthTokenResponse>(
      tokenResponse,
      'OpenAI ChatGPT token exchange',
    );

    const accessToken = tokenPayload.access_token;
    const refreshToken = tokenPayload.refresh_token;
    const idToken = tokenPayload.id_token;
    const accountId = (idToken && extractChatGPTAccountId(idToken)) || (accessToken && extractChatGPTAccountId(accessToken));

    if (!accessToken || !accountId) {
      throw new Error('OpenAI ChatGPT token exchange returned no usable account credentials.');
    }

    const expiresAt = tokenPayload.expires_in
      ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
      : (idToken && decodeJwtExpiry(idToken)) || decodeJwtExpiry(accessToken);

    return {
      accessToken,
      refreshToken,
      idToken,
      accountId,
      expiresAt,
      lastRefresh: new Date().toISOString(),
    };
  }
}

export async function authenticateOpenAIChatGPT(
  options: OpenAIChatGPTBrowserAuthOptions = {},
): Promise<OpenAIChatGPTAuth> {
  const verifier = generatePkceVerifier();
  const challenge = generatePkceChallenge(verifier);
  const state = createState();
  const callback = await listenForOAuthCallback(state);

  try {
    const authorizeUrl = new URL(OPENAI_OAUTH_AUTHORIZE_URL);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', OPENAI_CODEX_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', callback.redirectUri);
    authorizeUrl.searchParams.set('scope', OPENAI_BROWSER_AUTH_SCOPE);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('id_token_add_organizations', 'true');
    authorizeUrl.searchParams.set('codex_cli_simplified_flow', 'true');
    authorizeUrl.searchParams.set('originator', OPENAI_BROWSER_OAUTH_ORIGINATOR);

    const browserOpened = await openBrowser(authorizeUrl.toString());
    await options.onPrompt?.({
      authorizationUrl: authorizeUrl.toString(),
      redirectUri: callback.redirectUri,
      browserOpened,
    });

    const result = await callback.waitForResult();
    if (result.error) {
      throw new Error(result.errorDescription || result.error);
    }
    if (!result.code) {
      throw new Error('OpenAI sign-in did not return an authorization code.');
    }

    const tokenResponse = await fetchWithTimeout(OPENAI_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildTokenBody({
        grant_type: 'authorization_code',
        client_id: OPENAI_CODEX_CLIENT_ID,
        code: result.code,
        redirect_uri: callback.redirectUri,
        code_verifier: verifier,
      }),
    }, 'OpenAI ChatGPT token exchange');

    const tokenPayload = await parseJsonResponse<OAuthTokenResponse>(
      tokenResponse,
      'OpenAI ChatGPT token exchange',
    );

    const accessToken = tokenPayload.access_token;
    const refreshToken = tokenPayload.refresh_token;
    const idToken = tokenPayload.id_token;
    const accountId = (idToken && extractChatGPTAccountId(idToken)) || (accessToken && extractChatGPTAccountId(accessToken));

    if (!accessToken || !accountId) {
      throw new Error('OpenAI ChatGPT token exchange returned no usable account credentials.');
    }

    const expiresAt = tokenPayload.expires_in
      ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
      : (idToken && decodeJwtExpiry(idToken)) || decodeJwtExpiry(accessToken);

    return {
      accessToken,
      refreshToken,
      idToken,
      accountId,
      expiresAt,
      lastRefresh: new Date().toISOString(),
    };
  } finally {
    await callback.close();
  }
}

export async function refreshChatGPTAuth(auth: OpenAIChatGPTAuth): Promise<OpenAIChatGPTAuth> {
  if (!auth.refreshToken) {
    throw new Error('ChatGPT refresh token is missing. Sign in again.');
  }

  const response = await fetchWithTimeout(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: buildTokenBody({
      grant_type: 'refresh_token',
      client_id: OPENAI_CODEX_CLIENT_ID,
      refresh_token: auth.refreshToken,
    }),
  }, 'ChatGPT token refresh');

  const payload = await parseJsonResponse<OAuthTokenResponse>(response, 'ChatGPT token refresh');
  if (!payload.access_token) {
    throw new Error('ChatGPT token refresh returned no access token.');
  }

  const accountId = auth.accountId
    || (payload.id_token && extractChatGPTAccountId(payload.id_token))
    || extractChatGPTAccountId(payload.access_token);

  if (!accountId) {
    throw new Error('ChatGPT token refresh returned no ChatGPT account ID.');
  }

  const expiresAt = payload.expires_in
    ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
    : (payload.id_token && decodeJwtExpiry(payload.id_token)) || decodeJwtExpiry(payload.access_token);

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? auth.refreshToken,
    idToken: payload.id_token ?? auth.idToken,
    accountId,
    expiresAt,
    lastRefresh: new Date().toISOString(),
  };
}

export async function ensureOpenAIChatGPTAuth(
  options: OpenAIChatGPTBrowserAuthOptions = {},
): Promise<OpenAIChatGPTAuth> {
  return authenticateOpenAIChatGPT(options);
}
