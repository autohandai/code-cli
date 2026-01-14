/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Settings Sync Module
 * Synchronizes ~/.autohand/ configuration to cloud storage for logged-in users
 */

// Types
export type {
  SyncConfig,
  SyncManifest,
  SyncFileEntry,
  SyncResult,
  SyncActions,
  SyncApiConfig,
  SyncApiResponse,
  SyncEvent,
} from './types.js';

export {
  DEFAULT_SYNC_CONFIG,
  SYNC_EXCLUDE_ALWAYS,
  SYNC_CONSENT_REQUIRED,
  SYNC_INCLUDE_DEFAULT,
} from './types.js';

// Encryption
export {
  encrypt,
  decrypt,
  encryptConfig,
  decryptConfig,
  isEncrypted,
  computeHash,
  deriveKey,
} from './encryption.js';

// API Client
export { SyncApiClient, getSyncApiClient, resetSyncApiClient } from './SyncApiClient.js';

// Service
export { SyncService, createSyncService } from './SyncService.js';
export type { SyncServiceOptions } from './SyncService.js';
