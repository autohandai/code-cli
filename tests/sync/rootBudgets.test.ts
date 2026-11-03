/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { selectSyncFiles, sessionBudgetBytes, SYNC_MAX_TOTAL_BYTES, SYNC_ROOT_BUDGET_BYTES } from '../../src/sync/rootBudgets.js';
import { SYNC_INCLUDE_DEFAULT, SYNC_CONSENT_REQUIRED } from '../../src/sync/types.js';
import type { SyncFileEntry } from '../../src/sync/types.js';
const mb = 1024 * 1024;
const file = (path: string, size: number, modifiedAt = '2026-11-01T00:00:00Z'): SyncFileEntry => ({ path, size, modifiedAt, hash: path });
const limits = { maxFileSize: 10 * mb, maxTotalSize: 2 * 1024 * mb };

describe('per-root sync budgets', () => {
  it('preserves config, skills and memory while selecting the newest sessions from 150 MB', () => {
    const files = [file('config.json', 100), file('skills/review/SKILL.md', 200), file('memory/events/LOG.jsonl', 300),
      ...Array.from({ length: 15 }, (_, i) => file(`sessions/session-${i}/messages.jsonl`, 10 * mb))];
    const activity = new Map(Array.from({ length: 15 }, (_, i) => [`session-${i}`, Date.parse(`2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z`)]));
    const result = selectSyncFiles(files, { ...limits, sessionsBudgetMb: 100, sessionActivity: activity });
    expect(result.files.slice(0, 3)).toEqual(files.slice(0, 3));
    expect(result.files.filter(item => item.path.startsWith('sessions/')).map(item => item.path)).toEqual(files.slice(8).map(item => item.path));
    expect(result.skipped.olderSessions).toBe(5);
    expect(result.files.reduce((sum, item) => sum + item.size, 0)).toBe(100 * mb + 600);
  });

  it('budgets each non-session root independently, without consuming the sessions allowance', () => {
    const files = ['memory', 'skills'].flatMap(root => Array.from({ length: 10 }, (_, i) => file(`${root}/${i}.json`, 10 * mb)));
    files.push(file('sessions/one/messages.jsonl', 10 * mb));
    expect(selectSyncFiles(files, limits).files).toEqual(files);
  });

  it('skips oversized individual files and reports counts while preserving ordinary files', () => {
    const small = file('config.json', 10);
    const result = selectSyncFiles([small, file('skills/huge/SKILL.md', 11 * mb)], limits);
    expect(result.files).toEqual([small]);
    expect(result.skipped.oversizedFiles).toBe(1);
  });

  it('keeps a session together and uses its recorded activity instead of file mtimes', () => {
    const files = [file('sessions/index.json', 10), file('sessions/new/metadata.json', 10, '2020-01-01T00:00:00Z'),
      file('sessions/new/messages.jsonl', mb - 20, '2020-01-01T00:00:00Z'), file('sessions/old/messages.jsonl', mb, '2099-01-01T00:00:00Z')];
    const result = selectSyncFiles(files, { ...limits, sessionsBudgetMb: 1, sessionActivity: new Map([['new', 2], ['old', 1]]) });
    expect(result.files).toEqual(files.slice(0, 3));
    expect(result.skipped.olderSessions).toBe(1);
  });

  it('does not upload a partial session when one of its artifacts exceeds the file limit', () => {
    const result = selectSyncFiles([file('config.json', 10), file('sessions/big/metadata.json', 20), file('sessions/big/messages.jsonl', 11 * mb)], limits);
    expect(result.files.map(item => item.path)).toEqual(['config.json']);
    expect(result.skipped.oversizedFiles).toBe(1);
    expect(result.skipped.olderSessions).toBe(0);
    expect(result.skipped.incompleteSessions).toBe(1);
  });

  it('respects a smaller explicit aggregate transfer cap without aborting the operation', () => {
    const result = selectSyncFiles([file('memory/a.json', 10), file('memory/b.json', 10), file('skills/a.md', 10)], { maxFileSize: 20, maxTotalSize: 15 });
    expect(result.files).toHaveLength(1);
    expect(result.skipped.budgetFiles).toBe(2);
  });

  it.each([undefined, -1, 0, NaN, Infinity])('uses a safe default for invalid session budget %s', value => {
    expect(sessionBudgetBytes(value)).toBe(100 * mb);
  });
  it('bounds configured session budgets so every enabled root fits the API aggregate cap', () => {
    expect(sessionBudgetBytes(25.5)).toBe(25.5 * mb);
    expect(sessionBudgetBytes(100000)).toBe(1024 * mb);
    const nonSessionRoots = SYNC_INCLUDE_DEFAULT.length - 1 + Object.keys(SYNC_CONSENT_REQUIRED).length;
    expect(nonSessionRoots * SYNC_ROOT_BUDGET_BYTES + sessionBudgetBytes(100000)).toBeLessThan(SYNC_MAX_TOTAL_BYTES);
  });
});
