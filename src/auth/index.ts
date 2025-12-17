/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth module exports
 */
export { AuthClient, getAuthClient } from './AuthClient.js';
export type {
  AuthUser,
  DeviceAuthInitResponse,
  DeviceAuthPollResponse,
  SessionValidationResponse,
  LogoutResponse,
} from './types.js';
