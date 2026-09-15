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
    expect(sessionGroupLabel(new Date('2026-09-15T00:05:00Z'), NOW)).toBe('Today');
    expect(sessionGroupLabel(new Date('2026-09-14T23:00:00Z'), NOW)).toBe('Yesterday');
    expect(sessionGroupLabel(new Date('2026-09-10T09:00:00Z'), NOW)).toBe('Previous 7 days');
    expect(sessionGroupLabel(new Date('2026-08-01T09:00:00Z'), NOW)).toBe('Earlier');
  });
});

describe('buildSessionPickerRows', () => {
  it('heads each recency group once and keeps rows most recent first', () => {
    const { options } = buildSessionPickerRows({
      now: NOW,
      columns: 100,
      singleProject: true,
      entries: [
        { session: session({ sessionId: 'a' }), title: 'recent work' },
        { session: session({ sessionId: 'b', lastActiveAt: '2026-09-14T10:00:00Z' }), title: 'older work' },
        { session: session({ sessionId: 'c', lastActiveAt: '2026-09-14T09:00:00Z' }), title: 'older still' },
      ],
    });

    expect(options.map((option) => option.value)).toEqual(['a', 'b', 'c']);
    expect(options[0]?.header).toBe('Today');
    expect(options[1]?.header).toBe('Yesterday');
    expect(options[2]?.header).toBeUndefined();
  });

  it('right-aligns the count and age columns whatever the row number width', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      session: session({ sessionId: `s${index}`, messageCount: index }),
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
