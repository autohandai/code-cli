/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth module types for CLI authentication
 */

/** Authenticated user information */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

/** Device authorization initiation response */
export interface DeviceAuthInitResponse {
  success: boolean;
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expiresIn?: number;
  interval?: number;
  error?: string;
}

/** Device authorization poll response */
export interface DeviceAuthPollResponse {
  success: boolean;
  status: 'pending' | 'authorized' | 'expired';
  token?: string;
  user?: AuthUser;
  error?: string;
}

/** Session validation response */
export interface SessionValidationResponse {
  authenticated: boolean;
  user?: AuthUser;
  error?: string;
}

/** Logout response */
export interface LogoutResponse {
  success: boolean;
  error?: string;
}
