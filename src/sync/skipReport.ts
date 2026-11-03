/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncSkippedFiles } from './rootBudgets.js';

/** Shared wording for interactive status and login restoration. */
export function formatSyncSkippedFiles(skipped: SyncSkippedFiles | undefined, origin: string): string[] {
  if (!skipped) return [];
  return [
    skipped.olderSessions ? `${origin}: skipped ${skipped.olderSessions} older sessions` : '',
    skipped.oversizedFiles ? `${origin}: skipped ${skipped.oversizedFiles} oversized files` : '',
    skipped.incompleteSessions ? `${origin}: skipped ${skipped.incompleteSessions} sessions with oversized files` : '',
    skipped.budgetFiles ? `${origin}: skipped ${skipped.budgetFiles} files beyond a root budget` : '',
  ].filter(Boolean);
}
