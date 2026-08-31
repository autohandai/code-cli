/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Device authorization credentials are API keys, not expiring web sessions.
 * The API uses the same prefix to select API-key authentication.
 */
export function isDurableAuthCredential(token: string): boolean {
  return token.startsWith('ahc_');
}
