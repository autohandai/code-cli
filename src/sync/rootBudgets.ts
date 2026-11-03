/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SyncFileEntry } from './types.js';

const MIB = 1024 * 1024;
export const SYNC_ROOT_BUDGET_BYTES = 100 * MIB;
// All non-session roots at 100 MiB plus 1 GiB of sessions fit below 2 GiB.
export const SYNC_MAX_TOTAL_BYTES = 2 * 1024 * MIB;
export const DEFAULT_SESSIONS_BUDGET_MB = 100;

export interface SyncSkippedFiles {
  olderSessions: number;
  incompleteSessions: number;
  oversizedFiles: number;
  budgetFiles: number;
}
export const emptySyncSkippedFiles = (): SyncSkippedFiles => ({
  olderSessions: 0, incompleteSessions: 0, oversizedFiles: 0, budgetFiles: 0,
});

export function sessionBudgetBytes(value?: number): number {
  return Math.floor((typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(value, 1024) : DEFAULT_SESSIONS_BUDGET_MB) * MIB);
}

interface BudgetOptions {
  maxFileSize: number;
  maxTotalSize: number;
  sessionsBudgetMb?: number;
  sessionActivity?: ReadonlyMap<string, number>;
}

/** Select complete session groups; the input order is preserved for transfers. */
export function selectSyncFiles(files: readonly SyncFileEntry[], options: BudgetOptions): {
  files: SyncFileEntry[];
  skipped: SyncSkippedFiles;
} {
  const skipped = emptySyncSkippedFiles();
  const selected = new Set<string>();
  const sessions = new Map<string, SyncFileEntry[]>();
  const roots = new Map<string, SyncFileEntry[]>();
  const oversizedSessions = new Set<string>();
  let total = 0;
  for (const file of files) {
    const sessionId = file.path.match(/^sessions\/([^/]+)\//u)?.[1];
    if (file.size > options.maxFileSize) {
      skipped.oversizedFiles += 1;
      if (sessionId) oversizedSessions.add(sessionId);
      continue;
    }
    const key = sessionId ?? file.path.split('/')[0];
    const groups = sessionId ? sessions : roots;
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }
  // Non-session roots always get their own allowance before session history.
  for (const [root, entries] of roots) {
    const limit = root === 'sessions'
      ? sessionBudgetBytes(options.sessionsBudgetMb) : SYNC_ROOT_BUDGET_BYTES;
    let used = 0;
    for (const entry of entries) {
      if (used + entry.size > limit || total + entry.size > options.maxTotalSize) {
        skipped.budgetFiles += 1;
        continue;
      }
      selected.add(entry.path);
      used += entry.size;
      total += entry.size;
    }
  }
  let sessionBytes = files.filter(file => selected.has(file.path) && file.path.startsWith('sessions/'))
    .reduce((sum, file) => sum + file.size, 0);
  const activity = (id: string, entries: SyncFileEntry[]): number => options.sessionActivity?.get(id)
    ?? entries.reduce((latest, entry) => Math.max(latest, Date.parse(entry.modifiedAt) || 0), 0);
  const ordered = [...sessions].sort(([leftId, left], [rightId, right]) =>
    activity(rightId, right) - activity(leftId, left) || leftId.localeCompare(rightId));
  for (const [id, entries] of ordered) {
    if (oversizedSessions.has(id)) continue;
    const size = entries.reduce((sum, file) => sum + file.size, 0);
    if (sessionBytes + size > sessionBudgetBytes(options.sessionsBudgetMb) || total + size > options.maxTotalSize) {
      skipped.olderSessions += 1;
      continue;
    }
    for (const file of entries) selected.add(file.path);
    sessionBytes += size;
    total += size;
  }
  skipped.incompleteSessions = oversizedSessions.size;
  return { files: files.filter(file => selected.has(file.path)), skipped };
}
