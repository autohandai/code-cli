/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { Modal } from '../../../src/ui/ink/components/Modal.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { buildSessionPickerRows } from '../../../src/ui/sessionPickerRows.js';
import type { SessionMetadata } from '../../../src/session/types.js';

function session(overrides: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    sessionId: overrides.sessionId ?? 's1',
    createdAt: '2026-09-15T11:00:00Z',
    lastActiveAt: '2026-09-15T11:58:00Z',
    projectPath: '/w/cli-3',
    projectName: overrides.projectName ?? 'cli-3',
    model: 'moa',
    messageCount: overrides.messageCount ?? 4,
    status: 'completed',
    ...overrides,
  } as SessionMetadata;
}

describe('Modal rendering a full-width session picker row', () => {
  it('keeps a row on a single line at ink-testing-library\'s 100-column stdout', () => {
    // ink-testing-library's stdout is fixed at 100 columns (see
    // node_modules/ink-testing-library), so build rows for that exact width -
    // the width buildSessionPickerRows believes the terminal has - and
    // confirm the modal never wraps one onto two lines. This is a real
    // regression: a row built to exactly fill `columns` used to render 2
    // columns past the modal's own chrome and split mid-cell.
    const { options } = buildSessionPickerRows({
      now: new Date('2026-09-15T12:00:00Z'),
      columns: 100,
      singleProject: false,
      entries: [
        { session: session({ sessionId: 'a', projectName: 'workspace', messageCount: 4 }), title: 'Newer project session' },
        { session: session({ sessionId: 'b', projectName: 'elsewhere', messageCount: 6 }), title: 'Other project session' },
      ],
    });

    const { lastFrame } = render(
      <ThemeProvider>
        <Modal title="Resume a session" options={options} onSelect={vi.fn()} onCancel={vi.fn()} />
      </ThemeProvider>
    );

    const lines = stripAnsi(lastFrame() ?? '').split('\n').map((line) => line.trimEnd());
    const rowFor = (title: string) => lines.find((line) => line.includes(title));

    // Both fixtures share the same lastActiveAt, 2 minutes before `now` - the
    // trailing age cell is exactly what wrapped onto its own line in the bug
    // this regression protects against, so it must land on the same line as
    // the rest of the row, not just the title and counts.
    const rowA = rowFor('Newer project session');
    expect(rowA).toBeDefined();
    expect(rowA).toContain('workspace');
    expect(rowA).toContain('4 msgs');
    expect(rowA).toContain('2m ago');

    const rowB = rowFor('Other project session');
    expect(rowB).toBeDefined();
    expect(rowB).toContain('elsewhere');
    expect(rowB).toContain('6 msgs');
    expect(rowB).toContain('2m ago');
  });

  it('keeps mixed single- and double-digit row numbers aligned and unwrapped', () => {
    // Regression for the double-compensation bug: the row builder used to pad
    // titles assuming the modal printed a LEFT-aligned "1. " / "12. " prefix,
    // but the modal right-aligns every number to a shared width instead - so
    // the builder's own slack landed on top of the modal's padding. With 10
    // or more rows (the picker pages at 20, so this is the normal case) that
    // showed up two ways: rows 1-9 wrapped their age cell onto an orphan
    // second line, and the meta columns on rows 1-9 sat one column right of
    // rows 10+.
    const now = new Date(2026, 8, 15, 14, 0); // local wall clock, safely mid-day - avoids the local midnight edge case a fixed UTC instant can straddle
    const entries = Array.from({ length: 12 }, (_, index) => ({
      session: session({
        sessionId: `s${index}`,
        messageCount: index + 1,
        lastActiveAt: new Date(now.getTime() - index * 60_000).toISOString(),
      }),
      title: `Task ${String(index).padStart(2, '0')}`,
    }));
    const { options } = buildSessionPickerRows({ entries, now, columns: 100, singleProject: true });

    const { lastFrame } = render(
      <ThemeProvider>
        <Modal title="Resume a session" options={options} onSelect={vi.fn()} onCancel={vi.fn()} maxVisible={15} />
      </ThemeProvider>
    );

    const rawLines = stripAnsi(lastFrame() ?? '').split('\n').map((line) => line.trimEnd());

    // No wrap: every row occupies exactly one physical line. All 12 fixtures
    // share the same activity window, so exactly one "Today" header line is
    // rendered above the list; the title and the keyboard hint are the
    // frame's first and last non-blank lines. Counting lines this way needs
    // no knowledge of column widths, so it catches a wrap regardless of
    // which cell wraps.
    const listLines = rawLines.filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && trimmed !== 'Resume a session' && trimmed !== 'Today';
    });
    listLines.pop(); // trailing keyboard hint
    expect(listLines).toHaveLength(options.length);

    // Mutual alignment: the ' msgs' column lands in the same place whether
    // the row number is one digit or two - mirrors the labelStartColumn
    // check in tests/ui/ink/HookScriptReview.test.tsx for the other picker.
    const msgsColumn = (needle: string): number => {
      const line = rawLines.find((candidate) => candidate.includes(needle));
      if (!line) throw new Error(`expected a rendered row containing "${needle}"`);
      const index = line.indexOf(' msgs');
      if (index === -1) throw new Error(`expected row "${needle}" to render a msgs column`);
      return index;
    };
    expect(msgsColumn('Task 00')).toBe(msgsColumn('Task 09'));
  });
});
