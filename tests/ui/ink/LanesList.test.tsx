/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { Lane } from '../../../src/core/lanes/LaneManager.js';
import { formatLaneElapsed, formatLaneTokens } from '../../../src/core/lanes/laneFormat.js';
import { LanesList, lanesRowBudget, layoutLaneRow, selectVisibleLanes } from '../../../src/ui/ink/LanesList.js';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function lane(name: string, overrides: Partial<Lane> = {}): Lane {
  return {
    id: `id-${name}`, name, description: `Work on ${name}`, agentName: 'implementer',
    status: 'running', startedAt: 0, ...overrides,
  };
}

const SCREENSHOT_LANES: Lane[] = [
  lane('agents-navigation', { description: 'Fix /agents arrow navigation', totalTokens: 93_100 }),
  lane('selection-highlight', { description: 'Fix invisible selection highlight', totalTokens: 105_200 }),
];

function list(lanes: Lane[], props: Partial<React.ComponentProps<typeof LanesList>> = {}) {
  const view = render(
    <ThemeProvider><LanesList lanes={lanes} width={80} maxRows={6} clock={() => 126_000} {...props} /></ThemeProvider>,
  );
  return { ...view, lines: () => stripAnsi(view.lastFrame() ?? '').split('\n') };
}

describe('lane formatting', () => {
  it.each([
    [0, '0s'], [999, '0s'], [45_000, '45s'], [60_000, '1m 0s'], [126_000, '2m 6s'],
    [3_600_000, '1h 0m'], [3_725_000, '1h 2m'], [-5, '0s'], [Number.NaN, '0s'],
  ])('formats %d ms elapsed as %s', (ms, expected) => {
    expect(formatLaneElapsed(ms)).toBe(expected);
  });

  it.each([
    [undefined, ''], [0, ''], [812, '812 tokens'], [105_200, '105.2k tokens'], [2_400_000, '2.4M tokens'],
  ])('formats %j tokens as %j', (tokens, expected) => {
    expect(formatLaneTokens(tokens)).toBe(expected);
  });
});

describe('layoutLaneRow', () => {
  const subject = lane('selection-highlight', { description: 'Fix invisible selection highlight', totalTokens: 105_200 });

  it('lays out name, description and right-aligned elapsed time and tokens', () => {
    const row = layoutLaneRow(subject, 80, 126_000);
    expect(row).toEqual({
      marker: '○', name: 'selection-highlight', description: 'Fix invisible selection highlight',
      meta: '2m 6s · 105.2k tokens',
    });
  });

  it('measures a finished lane up to the moment it finished', () => {
    expect(layoutLaneRow({ ...subject, status: 'completed', finishedAt: 45_000 }, 80, 999_000).meta).toBe('45s · 105.2k tokens');
  });

  it('leaves tokens out until the lane has reported usage', () => {
    expect(layoutLaneRow({ ...subject, totalTokens: undefined }, 80, 126_000).meta).toBe('2m 6s');
  });

  it.each<[Lane['status'], string]>([
    ['running', '○'], ['completed', '✓'], ['partial', '◐'], ['failed', '✗'], ['cancelled', '⊘'],
  ])('marks a %s lane with %s', (status, marker) => {
    expect(layoutLaneRow({ ...subject, status, finishedAt: 1 }, 80, 2).marker).toBe(marker);
  });

  it('truncates the description first, then the name, and never exceeds the width', () => {
    for (const width of [70, 60, 50, 40, 30, 24, 16, 10, 4, 1]) {
      const row = layoutLaneRow(subject, width, 126_000);
      const used = 2 + row.name.length + (row.description ? 2 + row.description.length : 0) + (row.meta ? 2 + row.meta.length : 0);
      expect(used, `width ${width}`).toBeLessThanOrEqual(Math.max(width, 3));
    }
    expect(layoutLaneRow(subject, 60, 126_000)).toMatchObject({ name: 'selection-highlight', meta: '2m 6s · 105.2k tokens' });
    expect(layoutLaneRow(subject, 60, 126_000).description).toMatch(/…$/);
    expect(layoutLaneRow(subject, 46, 126_000)).toMatchObject({ name: 'selection-highlight', description: '', meta: '2m 6s · 105.2k tokens' });
    expect(layoutLaneRow(subject, 30, 126_000)).toMatchObject({ name: 'selection-highlight', description: '', meta: '2m 6s' });
    expect(layoutLaneRow(subject, 16, 126_000)).toMatchObject({ name: 'selection-hig…', description: '', meta: '' });
  });

  it('strips control sequences a model could put in a name or description', () => {
    const row = layoutLaneRow(lane('ok', { description: 'evil\u001b[2J\u0007 text\nnext' }), 80, 0);
    expect(row.description).toBe('evil text next');
  });
});

describe('selectVisibleLanes', () => {
  const lanes = [
    lane('a', { status: 'completed', finishedAt: 10 }), lane('b'), lane('c', { status: 'failed', finishedAt: 30 }),
    lane('d'), lane('e', { status: 'completed', finishedAt: 20 }),
  ];

  it('shows every lane when they fit', () => {
    expect(selectVisibleLanes(lanes, 5)).toEqual({ visible: lanes, hidden: 0 });
  });

  it('keeps running lanes, then the most recently finished, in their original order', () => {
    const { visible, hidden } = selectVisibleLanes(lanes, 4);
    expect(visible.map(entry => entry.name)).toEqual(['b', 'c', 'd']);
    expect(hidden).toBe(2);
  });

  it('never returns more rows than the capacity, including the overflow row', () => {
    for (let capacity = 0; capacity <= 6; capacity += 1) {
      const { visible, hidden } = selectVisibleLanes(lanes, capacity);
      expect(visible.length + (hidden > 0 ? 1 : 0)).toBeLessThanOrEqual(Math.max(capacity, 1));
      expect(visible.length + hidden).toBe(lanes.length);
    }
  });
});

describe('lanesRowBudget', () => {
  it.each([[undefined, 5], [8, 2], [12, 3], [24, 4], [40, 6], [200, 6]])('gives a %j-row terminal %d rows', (rows, budget) => {
    expect(lanesRowBudget(rows)).toBe(budget);
  });
});

describe('LanesList', () => {
  it('renders nothing without lanes', () => {
    expect(list([]).lastFrame()).toBe('');
  });

  it('shows main first, then one row per lane with right-aligned time and tokens', () => {
    const lines = list(SCREENSHOT_LANES).lines();
    expect(lines).toHaveLength(3);
    expect(lines[0].trimEnd()).toBe('● main');
    expect(lines[1]).toMatch(/^○ agents-navigation {2}Fix \/agents arrow navigation +2m 6s · 93\.1k tokens$/);
    expect(lines[2]).toMatch(/^○ selection-highlight {2}Fix invisible selection highlight +2m 6s · 105\.2k tokens$/);
    expect(lines[1]).toHaveLength(80);
    expect(lines[2]).toHaveLength(80);
  });

  it('marks finished and failed lanes and freezes their elapsed time', () => {
    const lines = list([
      lane('done-lane', { status: 'completed', finishedAt: 61_000 }),
      lane('bad-lane', { status: 'failed', finishedAt: 5_000 }),
    ]).lines();
    expect(lines[1]).toMatch(/^✓ done-lane .* 1m 1s$/);
    expect(lines[2]).toMatch(/^✗ bad-lane .* 5s$/);
  });

  it('keeps every row on one line at a narrow width', () => {
    const lines = list(SCREENSHOT_LANES, { width: 34 }).lines();
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(34);
    expect(lines[2]).toContain('selection-highlight');
    expect(lines[2]).toContain('2m 6s');
  });

  it('caps the rows and summarizes the rest', () => {
    const many = Array.from({ length: 7 }, (_, index) => lane(`lane-${index}`));
    const lines = list(many, { maxRows: 4 }).lines();
    expect(lines).toHaveLength(4);
    expect(lines[0].trimEnd()).toBe('● main');
    expect(lines[3].trimEnd()).toBe('  +5 more');
  });

  it('ticks the elapsed time of a running lane and stops once every lane has finished', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const view = render(<ThemeProvider><LanesList lanes={[lane('ticking', { startedAt: 10_000 })]} width={60} maxRows={6} /></ThemeProvider>);
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('0s');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('3s');

    view.rerender(<ThemeProvider><LanesList lanes={[lane('ticking', { startedAt: 10_000, status: 'completed', finishedAt: 13_000 })]} width={60} maxRows={6} /></ThemeProvider>);
    expect(vi.getTimerCount()).toBe(0);
    view.unmount();
  });
});

describe('lanes underneath the composer', () => {
  function ui(lanes: Lane[] | undefined) {
    const state = { ...createInitialUIState(), ...(lanes ? { lanes } : {}) };
    return render(
      <I18nProvider><ThemeProvider>
        <AgentUI state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} />
      </ThemeProvider></I18nProvider>,
    );
  }

  it('shows nothing about lanes when there are none', async () => {
    const view = ui(undefined);
    await vi.waitFor(() => expect(view.lastFrame()).toBeTruthy());
    expect(stripAnsi(view.lastFrame() ?? '')).not.toContain('● main');
  });

  it('lists main and the lanes below the composer and its status line', async () => {
    const view = ui([lane('selection-highlight', { description: 'Fix invisible selection highlight', startedAt: Date.now() })]);
    await vi.waitFor(() => expect(stripAnsi(view.lastFrame() ?? '')).toContain('○ selection-highlight'));
    const lines = stripAnsi(view.lastFrame() ?? '').split('\n');
    const main = lines.findIndex(line => line.trimEnd() === '● main');
    const laneRow = lines.findIndex(line => line.startsWith('○ selection-highlight'));
    const composer = lines.findIndex(line => line.includes('❯') || line.includes('›'));
    expect(main).toBeGreaterThan(-1);
    expect(laneRow).toBe(main + 1);
    expect(composer).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(composer);
  });

  it('keeps the list inside the full-screen footer, capped, with the composer still above it', async () => {
    const lanes = Array.from({ length: 9 }, (_, index) => lane(`lane-${index}`, { startedAt: Date.now() }));
    const view = render(
      <I18nProvider><ThemeProvider>
        <AgentUI fullScreenTranscript={new FullScreenTranscript()} state={{ ...createInitialUIState(), lanes }}
          onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} />
      </ThemeProvider></I18nProvider>,
    );
    await vi.waitFor(() => expect(stripAnsi(view.lastFrame() ?? '')).toContain('● main'));
    const rows = stripAnsi(view.lastFrame() ?? '').split('\n');
    const composer = rows.findIndex(row => row.includes('❯'));
    // The footer, lanes included, starts on the window edge; only the chat history is inset.
    const main = rows.findIndex(row => row.trimEnd() === '● main');
    // The test terminal reports no row count, so the list gets its default budget.
    const budget = lanesRowBudget(undefined);

    expect(rows.length).toBeLessThanOrEqual(24);
    expect(composer).toBeGreaterThan(-1);
    expect(main).toBeGreaterThan(composer);
    expect(rows.slice(main)).toHaveLength(budget);
    expect(rows.at(-1)?.trimEnd()).toBe(`  +${lanes.length - (budget - 2)} more`);
    expect(rows.filter(row => row.startsWith('○ lane-'))).toHaveLength(budget - 2);
  });
});
