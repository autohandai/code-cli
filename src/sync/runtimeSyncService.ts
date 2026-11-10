/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncService } from './SyncService.js';

let globalSyncService: SyncService | null = null;
let pendingBackgroundSync: ReturnType<typeof setTimeout> | undefined;
let enabledOverride: boolean | undefined;

export function setSyncService(service: SyncService | null): void {
  if (globalSyncService !== service) clearPendingBackgroundSync();
  globalSyncService = service;
  if (!service) enabledOverride = undefined;
  else if (enabledOverride !== undefined) service.setEnabled(enabledOverride);
}

/** Remember an explicit /sync choice even while startup authentication is pending. */
export function setBackgroundSyncEnabled(enabled: boolean): void {
  enabledOverride = enabled;
  if (!enabled) clearPendingBackgroundSync();
  globalSyncService?.setEnabled(enabled);
}

export function getSyncService(): SyncService | null {
  return globalSyncService;
}

export function scheduleBackgroundSync(): void {
  const syncService = globalSyncService;
  if (!syncService?.isRunning || pendingBackgroundSync !== undefined) return;

  pendingBackgroundSync = setTimeout(() => {
    pendingBackgroundSync = undefined;
    if (globalSyncService !== syncService || !syncService.isRunning) return;
    void syncService.sync().catch(() => {
      // Background sync is opportunistic; explicit /sync still reports errors.
    });
  }, 0);
}

function clearPendingBackgroundSync(): void {
  if (pendingBackgroundSync === undefined) return;
  clearTimeout(pendingBackgroundSync);
  pendingBackgroundSync = undefined;
}
