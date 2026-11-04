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
    skipped.incompleteSessions ? `${origin}: skipped ${skipped.incompleteSessions} incomplete session${skipped.incompleteSessions === 1 ? '' : 's'}` : '',
    skipped.budgetFiles ? `${origin}: skipped ${skipped.budgetFiles} files beyond a root budget` : '',
    skipped.unavailableFiles ? `${origin}: ${skipped.unavailableFiles} file${skipped.unavailableFiles === 1 ? '' : 's'} unavailable in storage; history is incomplete` : '',
  ].filter(Boolean);
}
