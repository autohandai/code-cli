/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { AuthUser, LoadedConfig } from '../types.js';

export function getSignedInUser(config?: LoadedConfig): AuthUser | null {
  if (!config?.auth?.token || !config.auth.user) {
    return null;
  }
  return config.auth.user;
}

export function formatUserDisplay(user: AuthUser): string {
  const name = user.name?.trim();
  const email = user.email?.trim();

  if (name && email && name !== email) {
    return `${name} (${email})`;
  }
  return name || email || user.id;
}

export function formatSignedInAccount(config?: LoadedConfig): string | null {
  const user = getSignedInUser(config);
  return user ? formatUserDisplay(user) : null;
}

export function formatAccount(config?: LoadedConfig, fallback = 'not signed in'): string {
  return formatSignedInAccount(config) ?? fallback;
}

export function getUserGreetingName(config?: LoadedConfig): string | null {
  const user = getSignedInUser(config);
  if (!user) {
    return null;
  }

  const name = user.name?.trim();
  if (name) {
    return name.split(/\s+/)[0] ?? name;
  }

  const emailName = user.email?.split('@')[0]?.trim();
  return emailName || user.id;
}
