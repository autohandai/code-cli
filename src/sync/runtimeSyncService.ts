/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncService } from './SyncService.js';

let globalSyncService: SyncService | null = null;
let pendingBackgroundSync = false;
let enabledOverride: boolean | undefined;

export function setSyncService(service: SyncService | null): void {
  globalSyncService = service;
  if (!service) enabledOverride = undefined;
  else if (enabledOverride !== undefined) service.setEnabled(enabledOverride);
}

/** Remember an explicit /sync choice even while startup authentication is pending. */
export function setBackgroundSyncEnabled(enabled: boolean): void {
  enabledOverride = enabled;
  globalSyncService?.setEnabled(enabled);
}

export function getSyncService(): SyncService | null {
  return globalSyncService;
}

export function scheduleBackgroundSync(): void {
  const syncService = globalSyncService;
  if (!syncService?.isRunning || pendingBackgroundSync) return;

  pendingBackgroundSync = true;
  setTimeout(() => {
    pendingBackgroundSync = false;
    if (globalSyncService !== syncService || !syncService.isRunning) return;
    void syncService.sync().catch(() => {
      // Background sync is opportunistic; explicit /sync still reports errors.
    });
  }, 0);
}
