/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Auth module exports
 */
export { getAuthClient } from './AuthClient.js';
export type { AccountListing, AccountSummary } from './AuthClient.js';
export { accountHeaders, selectedAccountId } from './accountSelection.js';
export { ensureAuthenticated, checkAuthenticated } from './ensureAuth.js';
