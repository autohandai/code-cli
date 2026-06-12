/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { saveConfig } from '../config.js';
import type { AuthUser, LoadedConfig } from '../types.js';
import { getAuthClient } from './index.js';

/**
 * Validate auth token on startup.
 * Returns the authenticated user if valid, undefined otherwise.
 */
export async function validateAuthOnStartup(config: LoadedConfig): Promise<AuthUser | undefined> {
  if (!config.auth?.token) {
    return undefined;
  }

  if (config.auth.expiresAt) {
    const expiresAt = new Date(config.auth.expiresAt);
    if (expiresAt < new Date()) {
      config.auth = undefined;
      try {
        await saveConfig(config);
      } catch {
        // Ignore save errors during startup.
      }
      return undefined;
    }
  }

  try {
    const authClient = getAuthClient();
    const result = await authClient.validateSession(config.auth.token);

    if (result.authenticated) {
      if (result.user && config.auth) {
        config.auth.user = result.user;
      }
      return config.auth?.user;
    }

    config.auth = undefined;
    try {
      await saveConfig(config);
    } catch {
      // Ignore save errors during startup.
    }
    return undefined;
  } catch {
    return config.auth?.user;
  }
}
