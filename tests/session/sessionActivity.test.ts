/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { sessionActivityAt } from '../../src/session/sessionActivity.js';
import type { SessionMetadata } from '../../src/session/types.js';

function session(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: 's1',
    createdAt: '2026-09-10T11:00:00Z',
    lastActiveAt: '2026-09-15T11:58:00Z',
    projectPath: '/w/cli-3',
    projectName: 'cli-3',
    model: 'moa',
    messageCount: 4,
    status: 'completed',
    ...overrides,
  } as SessionMetadata;
}

describe('sessionActivityAt', () => {
  it('falls back to createdAt when lastActiveAt is missing', () => {
    const s = session({ lastActiveAt: undefined as unknown as string, createdAt: '2026-09-10T11:00:00Z' });
    const activeAt = sessionActivityAt(s);
    expect(Number.isNaN(activeAt.getTime())).toBe(false);
    expect(activeAt.toISOString()).toBe('2026-09-10T11:00:00.000Z');
  });

  // Regression: metadata written by older versions can be missing both
  // timestamps entirely. Before this fix, sessionActivityAt fell back to
  // `new Date(session.createdAt)` unconditionally, which produced an Invalid
  // Date whenever createdAt was also missing/unparseable - poisoning
  // formatAge ("NaNw ago") and the recency sort (NaN comparisons make
  // Array#sort order engine-defined). formatAge's own handling of this
  // sentinel (rendered as "unknown") is a ui-layer concern and is tested in
  // tests/ui/sessionPickerRows.test.ts, where formatAge lives.
  it('returns a valid, stable sentinel when both timestamps are missing', () => {
    const s = session({
      lastActiveAt: undefined as unknown as string,
      createdAt: undefined as unknown as string,
    });
    const activeAt = sessionActivityAt(s);
    expect(Number.isNaN(activeAt.getTime())).toBe(false);
    expect(activeAt.getTime()).toBe(0);
  });

  it('returns a valid, stable sentinel when both timestamps are unparseable garbage', () => {
    const s = session({ lastActiveAt: 'not-a-date', createdAt: 'also-not-a-date' });
    const activeAt = sessionActivityAt(s);
    expect(Number.isNaN(activeAt.getTime())).toBe(false);
    expect(activeAt.getTime()).toBe(0);
  });

  it('sorts deterministically when some entries have unparseable timestamps', () => {
    const good = session({ sessionId: 'good', lastActiveAt: '2026-09-15T11:00:00Z' });
    const brokenA = session({ sessionId: 'brokenA', lastActiveAt: 'garbage', createdAt: 'also-garbage' });
    const brokenB = session({ sessionId: 'brokenB', lastActiveAt: 'garbage', createdAt: 'also-garbage' });

    const sorted = [brokenA, good, brokenB].sort(
      (a, b) => sessionActivityAt(b).getTime() - sessionActivityAt(a).getTime(),
    );

    // The comparator itself must never see NaN, so the ordering is fixed and
    // repeatable across runs/engines rather than left "engine-defined".
    expect(sorted.map((s) => s.sessionId)).toEqual(['good', 'brokenA', 'brokenB']);
  });
});
