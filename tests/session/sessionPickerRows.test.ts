import { describe, expect, it } from 'vitest';
import stringWidth from 'string-width';
import { buildSessionPickerRows, sessionGroupLabel } from '../../src/session/sessionPickerRows.js';
import type { SessionMetadata } from '../../src/session/types.js';

const NOW = new Date('2026-09-15T12:00:00Z');

function session(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: overrides.sessionId ?? 's1',
    createdAt: overrides.createdAt ?? '2026-09-15T11:00:00Z',
    lastActiveAt: overrides.lastActiveAt ?? '2026-09-15T11:58:00Z',
    projectPath: '/w/cli-3',
    projectName: overrides.projectName ?? 'cli-3',
    model: 'moa',
    messageCount: overrides.messageCount ?? 4,
    status: 'completed',
    ...overrides,
  } as SessionMetadata;
}

describe('sessionGroupLabel', () => {
  it('names the recency bands from local day boundaries', () => {
    // Built from local wall-clock components (not UTC ISO strings) so this
    // reflects the host's own local calendar day regardless of its offset —
    // NOW itself sits at a UTC instant that lands on different local days
    // depending on timezone, which is exactly the ambiguity local grouping
    // must not have.
    const now = new Date(2026, 8, 15, 14, 0);
    expect(sessionGroupLabel(new Date(2026, 8, 15, 0, 5), now)).toBe('Today');
    expect(sessionGroupLabel(new Date(2026, 8, 14, 23, 0), now)).toBe('Yesterday');
    expect(sessionGroupLabel(new Date(2026, 8, 10, 9, 0), now)).toBe('Previous 7 days');
    expect(sessionGroupLabel(new Date(2026, 8, 1, 9, 0), now)).toBe('Earlier');
  });

  // Regression for a UTC-based startOfLocalDay: these values are built from the
  // running machine's own local wall clock (never process.env.TZ, which worker
  // threads ignore), so the boundary they straddle is always LOCAL midnight,
  // not UTC midnight. A UTC implementation reads 'Today' here in any
  // positive-offset zone; the correct local grouping reads 'Yesterday'.
  it('groups by local calendar day, not UTC day', () => {
    const now = new Date(2026, 8, 15, 0, 30); // 00:30 local time
    const activeAt = new Date(now.getTime() - 60 * 60 * 1000); // 23:30 local, previous local day
    expect(sessionGroupLabel(activeAt, now)).toBe('Yesterday');
  });

  it('keeps two times within the same local day both as Today', () => {
    const now = new Date(2026, 8, 15, 23, 0);
    const activeAt = new Date(2026, 8, 15, 0, 30);
    expect(sessionGroupLabel(activeAt, now)).toBe('Today');
  });
});

describe('buildSessionPickerRows', () => {
  it('heads each recency group once and keeps rows most recent first', () => {
    // Local wall-clock fixtures, same reasoning as the sessionGroupLabel test
    // above: NOW is a fixed UTC instant that straddles different local days
    // depending on the host's offset, which would make this header assertion
    // flaky across timezones.
    const now = new Date(2026, 8, 15, 20, 0);
    const { options } = buildSessionPickerRows({
      now,
      columns: 100,
      singleProject: true,
      entries: [
        { session: session({ sessionId: 'a', lastActiveAt: new Date(2026, 8, 15, 19, 0).toISOString() }), title: 'recent work' },
        { session: session({ sessionId: 'b', lastActiveAt: new Date(2026, 8, 14, 10, 0).toISOString() }), title: 'older work' },
        { session: session({ sessionId: 'c', lastActiveAt: new Date(2026, 8, 14, 9, 0).toISOString() }), title: 'older still' },
      ],
    });

    expect(options.map((option) => option.value)).toEqual(['a', 'b', 'c']);
    expect(options[0]?.header).toBe('Today');
    expect(options[1]?.header).toBe('Yesterday');
    expect(options[2]?.header).toBeUndefined();
  });

  it('right-aligns the count and age columns whatever the row number width', () => {
    // messageCount: index + 1 keeps every entry a real session (none hidden as
    // empty), so no reveal row lands in this list — the reveal row is an
    // action with no columns and must not be pulled into this alignment check.
    const entries = Array.from({ length: 12 }, (_, index) => ({
      session: session({ sessionId: `s${index}`, messageCount: index + 1 }),
      title: `session ${index}`,
    }));
    const { options } = buildSessionPickerRows({ entries, now: NOW, columns: 100, singleProject: true });

    // The modal prefixes "  N. "; the builder pads so every row ends flush.
    const widths = options.map((option, index) => stringWidth(`${index + 1}. ${option.label}`));
    expect(new Set(widths).size).toBe(1);
  });

  it('hides empty sessions behind a reveal row that carries the count', () => {
    const { options, hiddenEmptyCount } = buildSessionPickerRows({
      now: NOW,
      columns: 100,
      singleProject: true,
      entries: [
        { session: session({ sessionId: 'real', messageCount: 3 }), title: 'real work' },
        { session: session({ sessionId: 'empty1', messageCount: 0 }), title: '(no messages)' },
        { session: session({ sessionId: 'empty2', messageCount: 0 }), title: '(no messages)' },
      ],
    });

    expect(hiddenEmptyCount).toBe(2);
    expect(options.map((option) => option.value)).toEqual(['real', '__show_empty__']);
    expect(options[1]?.label).toContain('2 empty sessions');
  });

  it('includes empty sessions once revealed', () => {
    const entries = [
      { session: session({ sessionId: 'real', messageCount: 3 }), title: 'real work' },
      { session: session({ sessionId: 'empty1', messageCount: 0 }), title: '(no messages)' },
    ];
    const { options, hiddenEmptyCount } = buildSessionPickerRows({
      entries, now: NOW, columns: 100, singleProject: true, includeEmpty: true,
    });

    expect(hiddenEmptyCount).toBe(0);
    expect(options.map((option) => option.value)).toEqual(['real', 'empty1']);
  });

  it('shows the project only when the list spans projects', () => {
    const entries = [
      { session: session({ sessionId: 'a', projectName: 'cli-3' }), title: 'work here' },
      { session: session({ sessionId: 'b', projectName: 'elsewhere' }), title: 'work there' },
    ];

    const scoped = buildSessionPickerRows({ entries, now: NOW, columns: 100, singleProject: true });
    expect(scoped.options[0]?.label).not.toContain('cli-3');

    const across = buildSessionPickerRows({ entries, now: NOW, columns: 100, singleProject: false });
    expect(across.options[0]?.label).toContain('cli-3');
    expect(across.options[1]?.label).toContain('elsewhere');
  });

  it('truncates a long title and never exceeds the width', () => {
    const { options } = buildSessionPickerRows({
      now: NOW,
      columns: 60,
      singleProject: true,
      entries: [{ session: session(), title: 'x'.repeat(200) }],
    });

    expect(stringWidth(`  1. ${options[0]?.label}`)).toBeLessThanOrEqual(60);
    expect(options[0]?.label).toContain('…');
  });

  it('flattens newlines and strips ANSI from titles', () => {
    const { options } = buildSessionPickerRows({
      now: NOW,
      columns: 100,
      singleProject: true,
      entries: [{ session: session(), title: '[31mfirst line\nsecond line[39m' }],
    });

    expect(options[0]?.label).toContain('first line second line');
    expect(options[0]?.label).not.toContain('');
  });
});
