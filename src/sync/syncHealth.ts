/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncSkippedFiles } from './rootBudgets.js';

export interface SyncState {
  lastSync?: string;
  lastManifestHash?: string;
  lastError?: string;
  failingSince?: string;
  skipped?: SyncSkippedFiles;
  remoteSkipped?: SyncSkippedFiles;
}
export interface SyncHealth {
  lastSync: string | null;
  lastError?: string;
  failingSince?: string;
  skipped?: SyncSkippedFiles;
  remoteSkipped?: SyncSkippedFiles;
}

export function resolveSyncHealth(state: SyncState, modifiedAt: number | undefined, interval: number, now = Date.now()): SyncHealth {
  const stale = modifiedAt !== undefined && now - modifiedAt > Math.max(interval, 1000) * 2;
  const lastError = state.lastError || (stale ? 'No successful settings sync within two intervals.' : undefined);
  return {
    lastSync: state.lastSync ?? null,
    ...(lastError ? { lastError, failingSince: state.failingSince ?? state.lastSync ?? new Date(modifiedAt ?? now).toISOString() } : {}),
    ...(state.skipped ? { skipped: state.skipped } : {}),
    ...(state.remoteSkipped ? { remoteSkipped: state.remoteSkipped } : {}),
  };
}
