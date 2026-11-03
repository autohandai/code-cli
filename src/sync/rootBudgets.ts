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
export const SYNC_MAX_MANIFEST_FILES = 5000;

export interface SyncSkippedFiles {
  olderSessions: number;
  incompleteSessions: number;
  oversizedFiles: number;
  budgetFiles: number;
  unavailableFiles?: number;
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
  // Reserve settings before history and share file-count capacity across roots.
  const queues = [...roots].map(([root, entries]) => ({ entries, next: 0, used: 0,
    limit: root === 'sessions' ? sessionBudgetBytes(options.sessionsBudgetMb) : SYNC_ROOT_BUDGET_BYTES }));
  while (selected.size < SYNC_MAX_MANIFEST_FILES && queues.some(queue => queue.next < queue.entries.length)) {
    for (const queue of queues) {
      if (selected.size >= SYNC_MAX_MANIFEST_FILES) break;
      if (queue.next >= queue.entries.length) continue;
      const entry = queue.entries[queue.next++];
      if (!entry) continue;
      if (queue.used + entry.size > queue.limit || total + entry.size > options.maxTotalSize) {
        skipped.budgetFiles += 1;
        continue;
      }
      selected.add(entry.path);
      queue.used += entry.size;
      total += entry.size;
    }
  }
  for (const queue of queues) skipped.budgetFiles += Math.max(0, queue.entries.length - queue.next);
  let sessionBytes = files.filter(file => selected.has(file.path) && file.path.startsWith('sessions/'))
    .reduce((sum, file) => sum + file.size, 0);
  const activity = (id: string, entries: SyncFileEntry[]): number => options.sessionActivity?.get(id)
    ?? entries.reduce((latest, entry) => Math.max(latest, Date.parse(entry.modifiedAt) || 0), 0);
  const ordered = [...sessions].sort(([leftId, left], [rightId, right]) =>
    activity(rightId, right) - activity(leftId, left) || leftId.localeCompare(rightId));
  for (const [id, entries] of ordered) {
    if (oversizedSessions.has(id)) continue;
    const size = entries.reduce((sum, file) => sum + file.size, 0);
    if (sessionBytes + size > sessionBudgetBytes(options.sessionsBudgetMb) || total + size > options.maxTotalSize
      || selected.size + entries.length > SYNC_MAX_MANIFEST_FILES) {
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
