/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import fse from 'fs-extra';
import type { XAIOAuthAuth } from '../types.js';
import { getAutohandHomePath } from './modelCatalogPaths.js';

/** Public Grok CLI OAuth client (not a secret). Shared by Grok CLI / OpenCode / Hermes. */
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
export const XAI_OAUTH_DEVICE_CODE_URL = `${XAI_OAUTH_ISSUER}/oauth2/device/code`;
export const XAI_OAUTH_TOKEN_URL = `${XAI_OAUTH_ISSUER}/oauth2/token`;
export const XAI_OAUTH_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const XAI_OAUTH_SCOPE =
  'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write';

/** Subscription OAuth uses the Grok CLI chat proxy (not developer api.x.ai billing). */
export const XAI_OAUTH_API_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
export const XAI_API_BASE_URL = 'https://api.x.ai/v1';

const XAI_AUTH_REQUEST_TIMEOUT_MS = 15_000;
const XAI_OAUTH_REFRESH_SKEW_MS = 2 * 60_000;

export interface XAIDeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

export interface XAIOAuthPrompt {
  verificationUrl: string;
  userCode: string;
  browserOpened: boolean;
}

export interface XAIOAuthAuthOptions {
  onPrompt?: (prompt: XAIOAuthPrompt) => void | Promise<void>;
  openBrowser?: boolean;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

interface GrokCliAuthEntry {
  key?: string;
  refresh_token?: string;
  expires_at?: string;
  email?: string;
  user_id?: string;
  auth_mode?: string;
}

function buildTokenBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function extractErrorDetail(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const candidate = payload as Record<string, unknown>;
  const direct =
    candidate.error_description ?? candidate.error ?? candidate.message ?? candidate.detail;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  return undefined;
}

async function parseResponseBody(response: Response): Promise<{ payload: unknown; detail?: string }> {
  const rawText = await response.text();
  let payload: unknown;
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText) as unknown;
    } catch {
      payload = rawText;
    }
  }
  const detail =
    extractErrorDetail(payload) ??
    (typeof payload === 'string' && payload.trim() ? payload.trim() : undefined);
  return { payload, detail };
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

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  context: string,
  timeoutMs = XAI_AUTH_REQUEST_TIMEOUT_MS,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function decodeJwtExpiry(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { exp?: number };
    if (!payload?.exp) return undefined;
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return undefined;
  }
}

function toXAIOAuthAuth(
  tokens: OAuthTokenResponse,
  fallback?: Partial<XAIOAuthAuth>,
): XAIOAuthAuth {
  if (!tokens.access_token) {
    throw new Error('xAI token response missing access_token.');
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : (tokens.id_token && decodeJwtExpiry(tokens.id_token)) ||
      decodeJwtExpiry(tokens.access_token) ||
      fallback?.expiresAt;

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? fallback?.refreshToken,
    idToken: tokens.id_token ?? fallback?.idToken,
    expiresAt,
    email: fallback?.email,
    userId: fallback?.userId,
    lastRefresh: new Date().toISOString(),
  };
}

export function isXAIOAuthAuthExpired(auth: XAIOAuthAuth, leewayMs = XAI_OAUTH_REFRESH_SKEW_MS): boolean {
  if (!auth.expiresAt) {
    // Fall back to JWT exp when expiresAt was not persisted.
    const jwtExpiry = decodeJwtExpiry(auth.accessToken);
    if (!jwtExpiry) return false;
    return new Date(jwtExpiry).getTime() <= Date.now() + leewayMs;
  }
  return new Date(auth.expiresAt).getTime() <= Date.now() + leewayMs;
}

export function mapGrokCliAuthToXAIOAuth(entry: GrokCliAuthEntry): XAIOAuthAuth | null {
  if (!entry.key || typeof entry.key !== 'string') {
    return null;
  }
  return {
    accessToken: entry.key,
    refreshToken: typeof entry.refresh_token === 'string' ? entry.refresh_token : undefined,
    expiresAt: typeof entry.expires_at === 'string' ? entry.expires_at : undefined,
    email: typeof entry.email === 'string' ? entry.email : undefined,
    userId: typeof entry.user_id === 'string' ? entry.user_id : undefined,
    lastRefresh: new Date().toISOString(),
  };
}

function getXAIOAuthCachePath(): string {
  return join(getAutohandHomePath(), 'xai-oauth.json');
}

/**
 * Persist OAuth credentials so rotated refresh tokens survive process restarts.
 */
export async function persistXAIOAuthAuth(auth: XAIOAuthAuth): Promise<void> {
  const path = getXAIOAuthCachePath();
  await fse.ensureDir(getAutohandHomePath());
  await fse.writeJson(path, auth, { spaces: 2, mode: 0o600 });
}

/**
 * Load Autohand-owned xAI OAuth credentials (rotated refresh tokens).
 */
export async function loadPersistedXAIOAuthAuth(): Promise<XAIOAuthAuth | null> {
  const path = getXAIOAuthCachePath();
  try {
    if (!(await fse.pathExists(path))) {
      return null;
    }
    const raw = (await fse.readJson(path)) as XAIOAuthAuth;
    if (!raw?.accessToken || typeof raw.accessToken !== 'string') {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

/**
 * Load credentials from the official Grok CLI auth file (~/.grok/auth.json), if present.
 */
export async function loadGrokCliAuth(): Promise<XAIOAuthAuth | null> {
  const authPath = join(homedir(), '.grok', 'auth.json');
  try {
    if (!(await fse.pathExists(authPath))) {
      return null;
    }
    const raw = (await fse.readJson(authPath)) as Record<string, GrokCliAuthEntry>;
    for (const [key, entry] of Object.entries(raw)) {
      if (!key.includes('auth.x.ai') || !entry || typeof entry !== 'object') {
        continue;
      }
      const mapped = mapGrokCliAuthToXAIOAuth(entry);
      if (mapped) {
        return mapped;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function requestXAIDeviceCode(): Promise<XAIDeviceCode> {
  const response = await fetchWithTimeout(
    XAI_OAUTH_DEVICE_CODE_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: buildTokenBody({
        client_id: XAI_OAUTH_CLIENT_ID,
        scope: XAI_OAUTH_SCOPE,
      }),
    },
    'xAI device authorization',
  );

  const payload = await parseJsonResponse<DeviceCodeResponse>(
    response,
    'xAI device authorization',
  );

  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error('xAI device authorization returned incomplete data.');
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUrl: payload.verification_uri_complete || payload.verification_uri,
    intervalSeconds: Math.max(1, Number(payload.interval ?? 5)),
    expiresInSeconds: Math.max(30, Number(payload.expires_in ?? 300)),
  };
}

export async function completeXAIDeviceCode(device: XAIDeviceCode): Promise<XAIOAuthAuth> {
  const deadline = Date.now() + device.expiresInSeconds * 1000;
  let intervalMs = device.intervalSeconds * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const pollResponse = await fetchWithTimeout(
      XAI_OAUTH_TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: buildTokenBody({
          grant_type: XAI_OAUTH_DEVICE_GRANT,
          client_id: XAI_OAUTH_CLIENT_ID,
          device_code: device.deviceCode,
        }),
      },
      'xAI device token poll',
    );

    const { payload, detail } = await parseResponseBody(pollResponse);
    const tokenPayload = (payload ?? {}) as OAuthTokenResponse;

    if (pollResponse.ok && tokenPayload.access_token) {
      const auth = toXAIOAuthAuth(tokenPayload);
      await persistXAIOAuthAuth(auth);
      return auth;
    }

    if (tokenPayload.error === 'authorization_pending') {
      continue;
    }
    if (tokenPayload.error === 'slow_down') {
      intervalMs = Math.min(intervalMs + 5000, 30_000);
      continue;
    }
    if (
      tokenPayload.error === 'access_denied' ||
      tokenPayload.error === 'authorization_denied'
    ) {
      throw new Error('xAI device authorization was denied.');
    }
    if (tokenPayload.error === 'expired_token') {
      throw new Error('xAI device code expired. Run sign-in again.');
    }

    throw new Error(
      detail
        ? `xAI device token exchange failed with status ${pollResponse.status}: ${detail}`
        : `xAI device token exchange failed with status ${pollResponse.status}.`,
    );
  }

  throw new Error('xAI device authorization timed out. Finish sign-in in the browser and try again.');
}

/**
 * Sign in with xAI SuperGrok / X Premium via device-code OAuth (works on SSH / headless).
 */
export async function authenticateXAIOAuth(
  options: XAIOAuthAuthOptions = {},
): Promise<XAIOAuthAuth> {
  const device = await requestXAIDeviceCode();
  const shouldOpenBrowser = options.openBrowser !== false;
  const browserOpened = shouldOpenBrowser ? await openBrowser(device.verificationUrl) : false;

  await options.onPrompt?.({
    verificationUrl: device.verificationUrl,
    userCode: device.userCode,
    browserOpened,
  });

  return completeXAIDeviceCode(device);
}

export async function refreshXAIOAuthAuth(auth: XAIOAuthAuth): Promise<XAIOAuthAuth> {
  if (!auth.refreshToken) {
    throw new Error('xAI refresh token is missing. Sign in again with OAuth.');
  }

  const response = await fetchWithTimeout(
    XAI_OAUTH_TOKEN_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: buildTokenBody({
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        client_id: XAI_OAUTH_CLIENT_ID,
      }),
    },
    'xAI token refresh',
  );

  if (response.status === 403) {
    const { detail } = await parseResponseBody(response);
    throw new Error(
      'xAI returned 403 on token refresh. OAuth API access may be restricted for this subscription tier. ' +
        'Use an xAI API key instead, or upgrade SuperGrok access.' +
        (detail ? ` (${detail})` : ''),
    );
  }

  const payload = await parseJsonResponse<OAuthTokenResponse>(response, 'xAI token refresh');
  const refreshed = toXAIOAuthAuth(payload, auth);
  await persistXAIOAuthAuth(refreshed);
  return refreshed;
}

export async function ensureXAIOAuthAuth(
  options: XAIOAuthAuthOptions = {},
): Promise<XAIOAuthAuth> {
  return authenticateXAIOAuth(options);
}
