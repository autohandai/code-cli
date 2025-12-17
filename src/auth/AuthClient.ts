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
  SessionValidationResponse,
  LogoutResponse,
} from './types.js';

const DEFAULT_TIMEOUT = 10000;

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
  async initiateDeviceAuth(): Promise<DeviceAuthInitResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/cli/initiate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ clientId: 'autohand-cli' }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.error || data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        deviceCode: data.deviceCode,
        userCode: data.userCode,
        verificationUri: data.verificationUri,
        verificationUriComplete: data.verificationUriComplete,
        expiresIn: data.expiresIn,
        interval: data.interval,
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
  async pollDeviceAuth(deviceCode: string): Promise<DeviceAuthPollResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/cli/poll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ deviceCode }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok && response.status !== 404) {
        return {
          success: false,
          status: 'pending',
          error: data.error || data.message || `HTTP ${response.status}`,
        };
      }

      return {
        success: data.success !== false,
        status: data.status || 'pending',
        token: data.token,
        user: data.user,
        error: data.error,
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

      if (!response.ok) {
        return { authenticated: false };
      }

      const data = await response.json();
      return {
        authenticated: true,
        user: data.user || data,
      };
    } catch {
      clearTimeout(timeoutId);
      return { authenticated: false };
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
