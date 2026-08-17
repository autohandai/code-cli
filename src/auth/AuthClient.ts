/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth API Client for CLI authentication
 */
import { AUTH_CONFIG } from '../constants.js';
import type {
  DeviceAuthInitResponse,
  DeviceAuthPollResponse,
  DeviceAuthCancelResponse,
  SessionValidationResponse,
  LogoutResponse,
  AuthUser,
  DeviceAuthClientType,
} from './types.js';

const DEFAULT_TIMEOUT = 10000;
const DEVICE_AUTH_SCHEMA_VERSION = 2 as const;
const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const USER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u;
const CREDENTIAL_PATTERN = /^ahc_[A-Za-z0-9_-]{43}$/u;
const DEVICE_AUTH_ERROR = 'Autohand returned an invalid device-authorization challenge.';
const DEVICE_AUTH_STATUS_ERROR = 'Autohand returned an invalid device-authorization status.';

export interface AccountEntitlementLimits {
  displayName: string;
  messagesPer5h: number | null;
  messagesPer24h: number | null;
  messagesPerWeek: number | null;
  rpm: number;
  inputTokensPerMinute: number | null;
  outputTokensPerMinute: number | null;
  requiresEligibility: boolean;
  perSeat: boolean;
  models: string[];
}

export interface AccountQuotaWindow {
  used: number;
  remaining: number | null;
  limit: number | null;
  resetAt: string | null;
}

export interface AccountQuota {
  available: boolean;
  window5h: AccountQuotaWindow | null;
  window24h: AccountQuotaWindow | null;
  week: AccountQuotaWindow | null;
  message?: string;
}

export interface AccountEntitlement {
  tier: string;
  freeRemaining: number | null;
  limits?: AccountEntitlementLimits;
  quota?: AccountQuota;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isSafeText(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function parseAccountEntitlementLimits(value: unknown): AccountEntitlementLimits | undefined {
  if (!isRecord(value)) return undefined;
  const messagesPer24h = value.messagesPer24h === undefined ? null : value.messagesPer24h;
  const inputTokensPerMinute = value.inputTokensPerMinute === undefined ? null : value.inputTokensPerMinute;
  const outputTokensPerMinute = value.outputTokensPerMinute === undefined ? null : value.outputTokensPerMinute;
  if (
    !isSafeText(value.displayName)
    || (value.messagesPer5h !== null && typeof value.messagesPer5h !== 'number')
    || (messagesPer24h !== null && typeof messagesPer24h !== 'number')
    || (value.messagesPerWeek !== null && typeof value.messagesPerWeek !== 'number')
    || typeof value.rpm !== 'number'
    || (inputTokensPerMinute !== null && typeof inputTokensPerMinute !== 'number')
    || (outputTokensPerMinute !== null && typeof outputTokensPerMinute !== 'number')
    || typeof value.requiresEligibility !== 'boolean'
    || typeof value.perSeat !== 'boolean'
    || !Array.isArray(value.models)
    || !value.models.every((model) => isSafeText(model))) {
    return undefined;
  }

  return {
    displayName: value.displayName,
    messagesPer5h: value.messagesPer5h,
    messagesPer24h,
    messagesPerWeek: value.messagesPerWeek,
    rpm: value.rpm,
    inputTokensPerMinute,
    outputTokensPerMinute,
    requiresEligibility: value.requiresEligibility,
    perSeat: value.perSeat,
    models: value.models,
  };
}

function parseAccountQuotaWindow(value: unknown): AccountQuotaWindow | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)
    || !isNonNegativeNumber(value.used)
    || !isNullableNonNegativeNumber(value.remaining)
    || !isNullableNonNegativeNumber(value.limit)
    || (value.resetAt !== null && !isSafeTimestamp(value.resetAt))) {
    return undefined;
  }
  return {
    used: value.used,
    remaining: value.remaining,
    limit: value.limit,
    resetAt: value.resetAt,
  };
}

function parseAccountQuota(value: unknown): AccountQuota | undefined {
  if (!isRecord(value) || typeof value.available !== 'boolean') return undefined;
  const window5h = parseAccountQuotaWindow(value.window5h);
  const window24h = value.window24h === undefined ? null : parseAccountQuotaWindow(value.window24h);
  const week = parseAccountQuotaWindow(value.week);
  if (window5h === undefined || window24h === undefined || week === undefined) return undefined;
  if (value.available && (window5h === null || week === null)) return undefined;
  const message = isSafeText(value.message) ? value.message : undefined;
  return {
    available: value.available,
    window5h,
    window24h,
    week,
    ...(message ? { message } : {}),
  };
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value);
}

function isSafeTimestamp(value: unknown): value is string {
  return isSafeText(value, 64) && Number.isFinite(Date.parse(value));
}

function responseError(data: unknown, status: number): string {
  if (isRecord(data)) {
    if (isSafeText(data.error)) return data.error;
    if (isRecord(data.error) && isSafeText(data.error.message)) {
      return data.error.message;
    }
    if (isSafeText(data.message)) return data.message;
  }
  return `HTTP ${status}`;
}

function isValidContinuation(value: string): boolean {
  const parts = value.split('.');
  return value.length >= 64
    && value.length <= 4096
    && parts.length === 4
    && parts[0] === 'v1'
    && (parts[1]?.length ?? 0) >= 1
    && (parts[1]?.length ?? 0) <= 32
    && (parts[2]?.length ?? 0) >= 1
    && parts[3]?.length === 43
    && parts.slice(1).every((part) => /^[A-Za-z0-9_-]+$/u.test(part));
}

function isCanonicalVerificationUrl(
  value: string,
  userCode: string,
  deviceCode: string,
  schemaVersion: 1 | 2,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const queryEntries = [...url.searchParams.entries()];
  const continuation = url.searchParams.get('continue');
  const validQuery = schemaVersion === DEVICE_AUTH_SCHEMA_VERSION
    ? queryEntries.length === 1
      && queryEntries[0]?.[0] === 'user_code'
      && url.searchParams.getAll('user_code').length === 1
      && continuation === null
    : queryEntries.length === 2
      && queryEntries.filter(([key]) => key === 'continue').length === 1
      && queryEntries.filter(([key]) => key === 'user_code').length === 1
      && continuation !== null
      && isValidContinuation(continuation);
  return url.protocol === 'https:'
    && url.origin === 'https://autohand.ai'
    && url.pathname === '/signin'
    && url.username === ''
    && url.password === ''
    && url.hash === ''
    && validQuery
    && url.searchParams.get('user_code') === userCode
    && !value.includes(deviceCode);
}

function parseDeviceChallenge(
  data: unknown,
  expectedSchemaVersion: 1 | 2,
): DeviceAuthInitResponse | null {
  if (!isRecord(data)
      || !hasOnlyKeys(data, [
        'success',
        'schemaVersion',
        'deviceCode',
        'userCode',
        'verificationUri',
        'verificationUriComplete',
        'expiresIn',
        'interval',
      ])
      || data.success !== true
      || data.schemaVersion !== expectedSchemaVersion
      || typeof data.deviceCode !== 'string'
      || !DEVICE_CODE_PATTERN.test(data.deviceCode)
      || typeof data.userCode !== 'string'
      || !USER_CODE_PATTERN.test(data.userCode)
      || data.verificationUri !== 'https://autohand.ai/signin'
      || typeof data.verificationUriComplete !== 'string'
      || !isCanonicalVerificationUrl(
        data.verificationUriComplete,
        data.userCode,
        data.deviceCode,
        expectedSchemaVersion,
      )
      || !Number.isInteger(data.expiresIn)
      || (data.expiresIn as number) < 30
      || (data.expiresIn as number) > 900
      || !Number.isInteger(data.interval)
      || (data.interval as number) < 1
      || (data.interval as number) > 30) {
    return null;
  }
  return {
    success: true,
    schemaVersion: expectedSchemaVersion,
    deviceCode: data.deviceCode,
    userCode: data.userCode,
    verificationUri: data.verificationUri,
    verificationUriComplete: data.verificationUriComplete,
    expiresIn: data.expiresIn as number,
    interval: data.interval as number,
  };
}

function parseAuthUser(value: unknown): AuthUser | null {
  if (!isRecord(value)
      || !hasOnlyKeys(
        value,
        value.avatar === undefined
          ? ['id', 'email', 'name']
          : ['id', 'email', 'name', 'avatar'],
      )
      || !isSafeText(value.id)
      || !isSafeText(value.email)
      || !isSafeText(value.name)) {
    return null;
  }
  const validAvatar = value.avatar === undefined
    || value.avatar === null
    || (typeof value.avatar === 'string' && value.avatar.startsWith('https://'));
  if (!validAvatar) return null;
  return {
    id: value.id,
    email: value.email,
    name: value.name,
    ...(typeof value.avatar === 'string' ? { avatar: value.avatar } : {}),
  };
}

function parsePollResponse(
  data: unknown,
  schemaVersion: 1 | 2,
): DeviceAuthPollResponse | null {
  if (!isRecord(data)
      || data.success !== true
      || data.schemaVersion !== schemaVersion
      || typeof data.status !== 'string') {
    return null;
  }
  if (data.status === 'pending') {
    if (!hasOnlyKeys(data, ['success', 'schemaVersion', 'status', 'interval'])
        || !Number.isInteger(data.interval)
        || (data.interval as number) < 1
        || (data.interval as number) > 30) {
      return null;
    }
    return {
      success: true,
      schemaVersion,
      status: 'pending',
      interval: data.interval as number,
    };
  }
  if (data.status === 'authorized') {
    const user = parseAuthUser(data.user);
    if (!hasOnlyKeys(data, ['success', 'schemaVersion', 'status', 'token', 'user'])
        || typeof data.token !== 'string'
        || !CREDENTIAL_PATTERN.test(data.token)
        || user === null) {
      return null;
    }
    return {
      success: true,
      schemaVersion,
      status: 'authorized',
      token: data.token,
      user,
    };
  }
  if (data.status === 'expired' || data.status === 'cancelled') {
    if (!hasOnlyKeys(data, ['success', 'schemaVersion', 'status'])) return null;
    return {
      success: true,
      schemaVersion,
      status: data.status,
    };
  }
  return null;
}

export interface AuthClientConfig {
  baseUrl?: string;
  timeout?: number;
}

export class AuthClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(config: AuthClientConfig = {}) {
    this.baseUrl = config.baseUrl || AUTH_CONFIG.apiBaseUrl;
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
  }

  /**
   * Initiate device authorization flow
   * Returns device code and user code for display
   */
  async initiateDeviceAuth(clientType: DeviceAuthClientType = 'cli'): Promise<DeviceAuthInitResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/cli/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: 'autohand-cli',
          clientType,
          schemaVersion: DEVICE_AUTH_SCHEMA_VERSION,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json() as unknown;

      if (!response.ok) {
        return {
          success: false,
          error: responseError(data, response.status),
        };
      }

      return parseDeviceChallenge(data, DEVICE_AUTH_SCHEMA_VERSION) ?? {
        success: false,
        error: DEVICE_AUTH_ERROR,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        return { success: false, error: 'Request timeout' };
      }
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Poll for device authorization status
   */
  async pollDeviceAuth(
    deviceCode: string,
    schemaVersion: 1 | 2 = DEVICE_AUTH_SCHEMA_VERSION,
  ): Promise<DeviceAuthPollResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/cli/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceCode,
          schemaVersion,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json() as unknown;

      if (!response.ok) {
        return {
          success: false,
          status: 'pending',
          error: responseError(data, response.status),
        };
      }

      return parsePollResponse(data, schemaVersion) ?? {
        success: false,
        status: 'pending',
        error: DEVICE_AUTH_STATUS_ERROR,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        return { success: false, status: 'pending', error: 'Request timeout' };
      }
      return { success: false, status: 'pending', error: (error as Error).message };
    }
  }

  /**
   * Cancel an active device authorization transaction.
   */
  async cancelDeviceAuth(
    deviceCode: string,
    schemaVersion: 1 | 2 = DEVICE_AUTH_SCHEMA_VERSION,
  ): Promise<DeviceAuthCancelResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/cli/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceCode,
          schemaVersion,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json() as unknown;
      if (!response.ok) {
        return {
          success: false,
          error: responseError(data, response.status),
        };
      }
      if (!isRecord(data)
          || !hasOnlyKeys(data, ['success', 'schemaVersion', 'status'])
          || data.success !== true
          || data.schemaVersion !== schemaVersion
          || data.status !== 'cancelled') {
        return { success: false, error: DEVICE_AUTH_STATUS_ERROR };
      }
      return {
        success: true,
        schemaVersion,
        status: 'cancelled',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        return { success: false, error: 'Request timeout' };
      }
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Validate current session token
   */
  async validateSession(token: string): Promise<SessionValidationResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cookie': `auth_session=${token}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 401 || response.status === 403) {
        return { authenticated: false };
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as { user?: AuthUser } | AuthUser;
      let user: AuthUser | undefined;
      if (typeof data === 'object' && 'user' in data) {
        user = data.user;
      } else if (typeof data === 'object') {
        user = data as AuthUser;
      }
      return {
        authenticated: true,
        user,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      // Re-throw network/timeout errors so callers can distinguish
      // "server confirmed invalid" from "couldn't reach server".
      // Without this, validateAuthOnStartup silently wipes credentials
      // on any transient network failure.
      throw error;
    }
  }

  /**
   * Fetch the caller's own entitlement (tier + free-grant remaining) from GET /me. Used to decide,
   * at a rate-limit failure on another provider, whether Autohand would actually have room before
   * offering a switch. Returns null on any failure — callers treat "unknown" as "don't offer".
   */
  async fetchEntitlement(token: string): Promise<AccountEntitlement | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cookie': `auth_session=${token}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data: unknown = await response.json();
      const entitlement = isRecord(data) && isRecord(data.entitlement) ? data.entitlement : undefined;
      const tier = entitlement?.tier;
      if (typeof tier !== 'string') return null;
      const freeRemaining = entitlement?.freeRemaining;
      const limits = parseAccountEntitlementLimits(entitlement?.limits);
      const quota = parseAccountQuota(entitlement?.quota);

      return {
        tier,
        freeRemaining: typeof freeRemaining === 'number' ? freeRemaining : null,
        ...(limits ? { limits } : {}),
        ...(quota ? { quota } : {}),
      };
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  }

  /**
   * Logout and invalidate session
   */
  async logout(token: string): Promise<LogoutResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cookie': `auth_session=${token}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return { success: response.ok };
    } catch {
      clearTimeout(timeoutId);
      // Even if server logout fails, we clear local token
      return { success: true };
    }
  }
}

// Singleton instance
let instance: AuthClient | null = null;

export function getAuthClient(config?: AuthClientConfig): AuthClient {
  if (!instance) {
    instance = new AuthClient(config);
  }
  return instance;
}
