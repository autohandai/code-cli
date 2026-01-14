/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Types for settings sync service
 */

/**
 * Sync configuration stored in config.json
 */
export interface SyncConfig {
  /** Enable/disable sync (default: true for logged users) */
  enabled: boolean;
  /** Sync interval in ms (default: 300000 = 5 min) */
  interval: number;
  /** Last successful sync timestamp (ISO 8601) */
  lastSync?: string;
  /** Glob patterns to exclude from sync */
  exclude?: string[];
  /** Include telemetry data in sync (requires user consent, default: false) */
  includeTelemetry?: boolean;
  /** Include feedback data in sync (requires user consent, default: false) */
  includeFeedback?: boolean;
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: true,
  interval: 5 * 60 * 1000, // 5 minutes
  includeTelemetry: false,
  includeFeedback: false,
};

/**
 * Manifest tracking all synced files
 */
export interface SyncManifest {
  /** Manifest version for future migrations */
  version: number;
  /** User ID from auth */
  userId: string;
  /** Last modification timestamp (ISO 8601) */
  lastModified: string;
  /** List of all synced files */
  files: SyncFileEntry[];
  /** Checksum of manifest for integrity */
  checksum: string;
}

/**
 * Individual file entry in the manifest
 */
export interface SyncFileEntry {
  /** Relative path from ~/.autohand/ */
  path: string;
  /** SHA-256 hash of file content */
  hash: string;
  /** File size in bytes */
  size: number;
  /** Last modification timestamp (ISO 8601) */
  modifiedAt: string;
  /** True if content is encrypted (e.g., API keys) */
  encrypted?: boolean;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of files uploaded */
  uploaded: number;
  /** Number of files downloaded */
  downloaded: number;
  /** Number of conflicts resolved (cloud wins) */
  conflicts: number;
  /** Error message if sync failed */
  error?: string;
  /** Duration of sync in ms */
  duration?: number;
}

/**
 * Actions determined by comparing manifests
 */
export interface SyncActions {
  /** Files to upload (local is newer or new) */
  uploads: SyncFileEntry[];
  /** Files to download (remote is newer or new) */
  downloads: SyncFileEntry[];
  /** Files with conflicts (modified on both sides) */
  conflicts: SyncFileEntry[];
  /** Files to delete locally (removed from remote) */
  localDeletes: string[];
  /** Files to delete remotely (removed locally) */
  remoteDeletes: string[];
}

/**
 * Sync API client configuration
 */
export interface SyncApiConfig {
  /** API base URL (default: https://api.autohand.ai) */
  baseUrl?: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Max file size to sync in bytes (default: 10MB) */
  maxFileSize?: number;
  /** Max total sync size in bytes (default: 100MB) */
  maxTotalSize?: number;
}

/**
 * API response for sync operations
 */
export interface SyncApiResponse {
  success: boolean;
  error?: string;
  manifest?: SyncManifest;
  /** Pre-signed URLs for file uploads */
  uploadUrls?: Record<string, string>;
  /** Pre-signed URLs for file downloads */
  downloadUrls?: Record<string, string>;
}

/**
 * Paths that are always excluded from sync
 */
export const SYNC_EXCLUDE_ALWAYS = [
  'device-id',
  'error.log',
  'feedback.log',
  'version-*.json',
  '.sync-lock',
  '.sync-state.json',
] as const;

/**
 * Paths that require consent to sync
 */
export const SYNC_CONSENT_REQUIRED = {
  telemetry: 'telemetry/',
  feedback: 'feedback/',
} as const;

/**
 * Paths that should always be synced (when sync is enabled)
 */
export const SYNC_INCLUDE_DEFAULT = [
  'config.json',
  'agents/',
  'community-skills/',
  'hooks/',
  'memory/',
  'projects/',
  'sessions/',
  'share/',
  'skills/',
] as const;

/**
 * Sync service events for logging/telemetry
 */
export type SyncEvent =
  | { type: 'sync_started' }
  | { type: 'sync_completed'; result: SyncResult }
  | { type: 'sync_failed'; error: string }
  | { type: 'file_uploaded'; path: string; size: number }
  | { type: 'file_downloaded'; path: string; size: number }
  | { type: 'conflict_resolved'; path: string; strategy: 'cloud_wins' }
  | { type: 'encryption_error'; path: string; error: string };
