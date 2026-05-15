/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncService } from './SyncService.js';

let globalSyncService: SyncService | null = null;
let pendingBackgroundSync = false;

export function setSyncService(service: SyncService | null): void {
  globalSyncService = service;
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
    void syncService.sync().catch(() => {
      // Background sync is opportunistic; explicit /sync still reports errors.
    });
  }, 0);
}
