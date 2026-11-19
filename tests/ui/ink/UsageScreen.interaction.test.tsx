/** @license Apache-2.0 */
import React from 'react';
import { render, cleanup } from 'ink-testing-library';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import { UsageScreen } from '../../../src/ui/ink/components/UsageScreen.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import type { CapabilityActivity, UsageReportData } from '../../../src/usage/usageReport.js';
import type { SessionMetadata } from '../../../src/session/types.js';

const NOW = '2026-10-05T12:00:00Z';
const BARS = /[▁▂▃▄▅▆▇█]/u;
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 30)); };
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
const session = (id: string, age: number, model: string, tokens: number, messages: number): SessionMetadata => ({
  sessionId: id, title: `Session ${id}`, createdAt: daysAgo(age), lastActiveAt: daysAgo(age), projectPath: '/work', projectName: 'work',
  model, messageCount: messages, status: 'completed',
  usage: { totalTokens: tokens, promptTokens: tokens - 10, completionTokens: 10, turnCount: 2, tokenUsageStatus: 'actual', updatedAt: daysAgo(age) },
});
const used = (id: string, age: number, name: string, origin: CapabilityActivity['origin'], failed = false): CapabilityActivity => ({
  id, date: daysAgo(age), kind: 'skill', name, source: 'agent-user', origin, project: '/work', failed,
});
/** 10-05: 150K in two sessions, 10-03: 5K, 09-30: 900K, 09-15: 77 tokens (outside seven days). */
const data: UsageReportData = {
  generatedAt: NOW, totalSessions: 5, warnings: [], extensions: [],
  sessions: [session('a', 0, 'moa', 120_000, 40), session('b', 0, 'fantail', 30_000, 10), session('c', 2, 'moa', 5_000, 4), session('d', 5, 'kea', 900_000, 200), session('e', 20, 'moa', 77, 1)],
  capabilities: [used('1', 0, 'tdd', 'user'), used('2', 0, 'tdd', 'agent'), used('3', 2, 'review', 'user', true), used('4', 45, 'release-notes', 'user')],
};

function open(columns = 100, rows = 30, report: UsageReportData = data) {
  const view = render(<ThemeProvider><UsageScreen loadReport={async () => report} loadAccount={async () => null} loadTraces={async () => null} account="Local" onClose={() => {}} rows={rows} columns={columns} /></ThemeProvider>);
  const lines = () => stripAnsi(view.lastFrame() ?? '').split('\n');
  const press = async (keys: string) => { view.stdin.write(keys); await flush(); };
  const mouse = async (code: number, column: number, row: number, final: 'M' | 'm' = 'M') => press(`\x1b[<${code};${column + 1};${row + 1}${final}`);
  /** Left-button press on the first cell of `text`, optionally limited to the row matching `onRow`. */
  const click = async (text: string, onRow: (line: string) => boolean = line => line.includes(text)) => {
    const row = lines().findIndex(line => onRow(line) && line.includes(text));
    expect(row, `"${text}" is on screen`).toBeGreaterThanOrEqual(0);
    await mouse(0, lines()[row]!.indexOf(text), row);
  };
  return { view, lines, press, mouse, click, text: () => lines().join('\n') };
}

afterEach(cleanup);

describe('usage screen mouse selection', () => {
  it('opens the report whose tab label is clicked', async () => {
    const screen = open(); await flush();
    await screen.click('5 Skills');
    expect(screen.text()).toContain('Recorded skill activations');
    await screen.click('2 Usage');
    expect(screen.text()).toContain('Session tokens');
  });

  it('selects the day whose bar, value or date is clicked', async () => {
    const screen = open(); await flush(); await screen.press('2');
    expect(screen.text()).toContain('2026-10-05 · 150K tokens · 2 sessions');
    await screen.click('10-03');
    expect(screen.text()).toContain('2026-10-03 · 5K tokens · 1 session');
    await screen.click('900K');
    expect(screen.text()).toContain('2026-09-30 · 900K tokens · 1 session');
    const barRow = screen.lines().findIndex(line => BARS.test(line));
    await screen.mouse(0, screen.lines()[barRow + 9]!.lastIndexOf('█'), barRow + 9);
    expect(screen.text()).toContain('2026-10-05 · 150K tokens · 2 sessions');
  });

  it('leaves the screen unchanged for clicks outside a target, and for release, drag and other buttons', async () => {
    const screen = open(); await flush(); await screen.press('2');
    const before = screen.view.lastFrame();
    const dateRow = screen.lines().findIndex(line => line.includes('10-03'));
    const column = screen.lines()[dateRow]!.indexOf('10-03');
    await screen.click('Session tokens');
    await screen.click('Model breakdown');
    await screen.click('Usage · Local');
    await screen.click('Esc back');
    await screen.mouse(0, column, dateRow, 'm');
    await screen.mouse(32, column, dateRow);
    await screen.mouse(2, column, dateRow);
    expect(screen.view.lastFrame()).toBe(before);
  });

  it('shows the totals of a clicked activity day', async () => {
    const screen = open(); await flush();
    expect(screen.text()).not.toContain('2026-10-03 ·');
    await screen.click('░', line => line.startsWith('Sa'));
    expect(screen.text()).toContain('2026-10-03 · 5K tokens · 1 session');
  });

  it('selects a clicked session and opens it on the second click', async () => {
    const screen = open(); await flush(); await screen.press('6');
    await screen.click('Session a');
    expect(screen.lines().find(line => line.includes('Session a'))).toMatch(/^›/u);
    expect(screen.text()).not.toContain('Session: a');
    await screen.click('Session a');
    expect(screen.text()).toContain('Session: a');
  });

  it('scrolls a long report with the wheel', async () => {
    const screen = open(100, 16); await flush();
    expect(screen.text()).toContain('Activity overview');
    await screen.mouse(65, 0, 6);
    expect(screen.text()).not.toContain('Activity overview');
    await screen.mouse(64, 0, 6);
    expect(screen.text()).toContain('Activity overview');
  });
});

describe('usage screen charts', () => {
  const level = chalk.level;
  beforeAll(() => { chalk.level = 3; });
  afterAll(() => { chalk.level = level; });

  it('keeps blank separator rows so the report fills its frame', async () => {
    const screen = open(); await flush();
    const lines = screen.lines();
    expect(lines).toHaveLength(29);
    expect(lines.at(-1)).toContain('Esc back');
    expect(lines[lines.findIndex(line => line.includes('Provider usage')) - 1]!.trim()).toBe('');
  });

  it('draws every day of the selected range, also in a narrow terminal', async () => {
    const narrow = open(60, 24); await flush(); await narrow.press('2');
    const dates = narrow.lines().find(line => line.includes('10-05'))!;
    expect(dates.match(/\d\d-\d\d/gu)).toEqual(['09-29', '09-30', '10-01', '10-02', '10-03', '10-04', '10-05']);
    narrow.view.unmount();

    const month = open(); await flush(); await month.press('2'); await month.press('r');
    const baseline = month.lines()[month.lines().findIndex(line => line.includes('10-05')) - 1]!;
    expect(baseline.match(/[▁▂▃▄▅▆▇█]+/gu)).toHaveLength(4);
  });

  it('keeps the date axis in place while the selection moves through a dense chart', async () => {
    const screen = open(); await flush(); await screen.press('2'); await screen.press('r');
    const axis = () => screen.lines().find(line => line.includes('09-29'))!;
    const before = axis();
    expect(before).toContain('10-05');
    await screen.press('\x1b[D');
    expect(axis()).toContain('10-04');
    expect(axis().indexOf('09-29')).toBe(before.indexOf('09-29'));
    expect(screen.text()).toContain('2026-10-04 · 0 tokens · 0 sessions');
  });

  it('scales bars to their share of the peak instead of rounding small days up', async () => {
    const screen = open(); await flush(); await screen.press('2');
    const lines = screen.lines();
    const baseline = lines[lines.findIndex(line => line.includes('10-05')) - 1]!;
    const [peak, small, today] = baseline.match(/[▁▂▃▄▅▆▇█]+/gu)!;
    expect(peak).toMatch(/^█+$/u);
    expect(small).toMatch(/^▁+$/u);
    expect(today).toMatch(/^█+$/u);
    const second = lines[lines.findIndex(line => line.includes('10-05')) - 2]!;
    expect(second.match(/[▁▂▃▄▅▆▇█]+/gu)).toEqual([peak, expect.stringMatching(/^▅+$/u)]);
  });

  it('paints every bar and activity cell with a theme colour', async () => {
    const screen = open(); await flush();
    for (const key of ['', '2', '3', '5']) {
      if (key) await screen.press(key);
      let coloured = false;
      for (const [token, code, glyph] of (screen.view.lastFrame() ?? '').matchAll(/\x1b\[([\d;]*)m|([░▒▓▁▂▃▄▅▆▇█])/gu)) {
        if (code?.startsWith('38;')) coloured = true;
        else if (code === '39' || code === '0') coloured = false;
        else if (glyph) expect(coloured, `"${token}" on report ${key || '1'} has a foreground colour`).toBe(true);
      }
    }
  });

  it('grades the activity map in four steps and explains them', async () => {
    const screen = open(); await flush();
    const map = screen.lines().filter(line => /^(?:Su|Mo|Tu|We|Th|Fr|Sa) {2}/u.test(line)).join('');
    expect(map).toContain('░');
    expect(map).toContain('█');
    expect(screen.text()).toMatch(/Less · ░ ▒ ▓ █ More/u);
  });
});

describe('usage screen skills', () => {
  it('summarises the skills used in the period on the overview', async () => {
    const screen = open(); await flush();
    expect(screen.text()).toContain('Skills used: tdd ×2, review ×1');
  });

  it('lists who activated each skill and the activations recorded before the period', async () => {
    const screen = open(); await flush(); await screen.press('5');
    expect(screen.text()).toContain('tdd · 2 uses · 1 by you · 1 by agent · 0 failed · agent-user');
    expect(screen.text()).toContain('review · 1 use · 1 by you · 0 by agent · 1 failed · agent-user');
    await screen.press('\x1b[6~');
    expect(screen.text()).toContain('All recorded activations · including earlier periods');
    expect(screen.text()).toContain('release-notes · 1 use · last 2026-08-21 · agent-user');
  });

  it('points at earlier activations when none fall in the period', async () => {
    const screen = open(100, 30, { ...data, capabilities: [used('4', 45, 'release-notes', 'user')] }); await flush();
    expect(screen.text()).toContain('No skills used in this period · last release-notes on 2026-08-21');
  });
});
