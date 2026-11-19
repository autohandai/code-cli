/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { AGENT_SESSIONS_LAYOUT, AgentSessionsScreen, filterTabSpans, type AgentSessionChoice, type AgentSessionsScreenProps } from '../../../src/ui/ink/components/AgentSessionsScreen.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import type { AgentSessionEntry } from '../../../src/session/agentSessionOverview.js';

afterEach(() => { cleanup(); });

const NOW = new Date('2026-03-01T12:00:00.000Z');
const UP = '\u001b[A';
const DOWN = '\u001b[B';
const ENTER = '\r';
const TAB = '\t';
const SHIFT_TAB = '\u001b[Z';
const ESCAPE = '\u001b';
const click = (column: number, row: number) => `\u001b[<0;${column};${row}M`;
const wheel = (down: boolean) => `\u001b[<${down ? 65 : 64};5;8M`;

function entry(sessionId: string, overrides: Partial<AgentSessionEntry> = {}): AgentSessionEntry {
  return {
    sessionId, title: `Title ${sessionId}`, projectPath: '/Users/me/work/alpha', projectName: 'alpha', model: 'fantail',
    messageCount: 6, activeAt: new Date(NOW.getTime() - 180_000), status: 'inactive', current: false, saved: true,
    inCurrentWorkspace: true, ...overrides,
  };
}

const SESSIONS = (): AgentSessionEntry[] => [
  entry('mine', { title: 'Fix the login flow', status: 'ready', current: true, livePid: 100, activeAt: new Date(NOW.getTime() - 3_000) }),
  entry('older', { title: 'Refactor billing', activeAt: new Date(NOW.getTime() - 3 * 3_600_000) }),
  entry('other', { title: 'Port the parser', projectPath: '/Users/me/work/beta', projectName: 'beta', inCurrentWorkspace: false, activeAt: new Date(NOW.getTime() - 600_000) }),
  entry('busy', { title: 'Ship the release', projectPath: '/Users/me/work/beta', projectName: 'beta', inCurrentWorkspace: false, status: 'working', livePid: 4242, phase: 'running_command', activeAt: new Date(NOW.getTime() - 1_000) }),
];

function mount(overrides: Partial<AgentSessionsScreenProps> = {}, entries: AgentSessionEntry[] = SESSIONS(), remaining = 0) {
  const onClose = vi.fn<(choice: AgentSessionChoice | null) => void>();
  const load = vi.fn(async () => ({ entries, remaining }));
  const loadFirstPrompt = vi.fn(async (sessionId: string) => `First prompt of ${sessionId}`);
  const view = render(<ThemeProvider><AgentSessionsScreen load={load} loadFirstPrompt={loadFirstPrompt}
    currentWorkspace="/Users/me/work/alpha" home="/Users/me" pid={100} directoryPreference="ask" onClose={onClose}
    rows={24} columns={120} now={() => NOW} refreshMs={60_000} {...overrides} /></ThemeProvider>);
  const frame = () => stripAnsi(view.lastFrame() ?? '');
  const selected = () => frame().split('\n').find((line) => line.startsWith('›')) ?? '';
  const press = async (keys: string) => { view.stdin.write(keys); await new Promise<void>((resolve) => setImmediate(resolve)); };
  const ready = async () => { await vi.waitFor(() => expect(frame()).toContain('Fix the login flow')); await new Promise<void>((resolve) => setImmediate(resolve)); };
  const rowOf = (text: string) => frame().split('\n').findIndex((line) => line.includes(text)) + 1;
  return { view, frame, selected, press, ready, rowOf, onClose, load, loadFirstPrompt };
}

describe('AgentSessionsScreen', () => {
  it('lists sessions grouped by directory with filter counts, a details pane and working key hints at 120 columns', async () => {
    const screen = mount();
    await screen.ready();
    const frame = screen.frame();
    const lines = frame.split('\n');

    expect(lines[AGENT_SESSIONS_LAYOUT.TAB_ROW]).toContain('All 4   Needs you 0   Working 1   Ready 1   Inactive 2');
    expect(frame).toMatch(/~\/work\/beta 2/u);
    expect(frame).toMatch(/~\/work\/alpha 2/u);
    expect(lines.findIndex((line) => line.includes('~/work/beta'))).toBeLessThan(lines.findIndex((line) => line.includes('~/work/alpha')));
    expect(frame).toMatch(/● Ship the release\s+Working\s+just now/u);
    expect(frame).toMatch(/○ Refactor billing\s+Inactive\s+3h ago/u);
    expect(screen.selected()).toContain('Fix the login flow (this session)');
    expect(frame).toContain('│');
    expect(frame).toContain('Ready · open here');
    expect(frame).toContain('Model fantail');
    expect(frame).toContain('~/work/alpha');
    await vi.waitFor(() => expect(screen.frame()).toContain('First prompt of mine'));
    expect(lines.at(-1)).toContain('esc back · ↑/↓ move · tab filter · enter open');
    expect(lines.length).toBeLessThanOrEqual(23);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(120);
  });

  it('paints the selected row in reverse video even when colour is unavailable', async () => {
    const screen = mount();
    await screen.ready();
    const row = (screen.view.lastFrame() ?? '').split('\n').find((line) => stripAnsi(line).startsWith('›')) ?? '';
    expect(row).toContain('\u001b[7m');
  });

  it('drops the details pane at 80 columns and keeps every line inside the terminal', async () => {
    const screen = mount({ columns: 80 });
    await screen.ready();
    const lines = screen.frame().split('\n');
    expect(screen.frame()).not.toContain('│');
    expect(screen.frame()).toContain('~/work/alpha · fantail');
    expect(screen.frame()).toMatch(/Fix the login flow \(this session\)\s+Ready\s+just now/u);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
  });

  it('moves the selection between sessions with the arrow keys, skipping directory headings', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(UP);
    expect(screen.selected()).toContain('Port the parser');
    await screen.press(UP);
    expect(screen.selected()).toContain('Ship the release');
    await screen.press(UP);
    expect(screen.selected()).toContain('Ship the release');
    await screen.press(`${DOWN}${DOWN}${DOWN}`);
    await screen.press(DOWN);
    expect(screen.selected()).toContain('Refactor billing');
    expect(screen.frame()).toContain('4/4');
  });

  it('keeps the selection on the same session when a refresh reorders the list', async () => {
    let entries = SESSIONS();
    const load = vi.fn(async () => ({ entries, remaining: 0 }));
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const screen = mount({ load, refreshMs: 1_000 });
      await screen.ready();
      await screen.press(DOWN);
      expect(screen.selected()).toContain('Refactor billing');
      entries = [entry('fresh', { title: 'Brand new', activeAt: NOW }), ...SESSIONS().map((item) => item.sessionId === 'older' ? { ...item, activeAt: NOW, status: 'ready' as const } : item)];
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(screen.frame()).toContain('Brand new'));
      expect(screen.selected()).toContain('Refactor billing');
    } finally { vi.useRealTimers(); }
  });

  it('cycles the status filters with Tab and Shift+Tab', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(TAB);
    expect(screen.frame()).toContain('No needs you sessions.');
    await screen.press(TAB);
    expect(screen.selected()).toContain('Ship the release');
    expect(screen.frame()).not.toContain('Refactor billing');
    await screen.press(SHIFT_TAB);
    await screen.press(SHIFT_TAB);
    expect(screen.frame()).toContain('Refactor billing');
    await screen.press(SHIFT_TAB);
    expect(screen.frame()).not.toContain('Ship the release');
    expect(screen.frame()).toContain('Port the parser');
  });

  it('opens a session in the current directory on Enter without asking about directories', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(DOWN);
    await screen.press(ENTER);
    expect(screen.onClose).toHaveBeenCalledWith({ sessionId: 'older', projectPath: '/Users/me/work/alpha', directory: 'current' });
  });

  it('asks which directory to use for a session from elsewhere, and Escape returns to the list', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(UP);
    await screen.press(ENTER);
    expect(screen.frame()).toContain('Working directory · Port the parser');
    expect(screen.frame()).toMatch(/› 1\. Use session directory\s+~\/work\/beta/u);
    expect(screen.frame()).toMatch(/2\. Use current directory\s+~\/work\/alpha/u);
    expect(screen.frame()).toContain('3. Always use session directory');
    expect(screen.frame()).toContain('4. Always use current directory');
    expect(screen.onClose).not.toHaveBeenCalled();

    await screen.press(ESCAPE);
    await vi.waitFor(() => expect(screen.selected()).toContain('Port the parser'));
    expect(screen.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['Enter on the default', ENTER, { directory: 'session' }],
    ['the second option', `${DOWN}${ENTER}`, { directory: 'current' }],
    ['digit 3', '3', { directory: 'session', remember: 'session' }],
    ['digit 4', '4', { directory: 'current', remember: 'current' }],
  ])('resolves the directory choice with %s', async (_name, keys, expected) => {
    const screen = mount();
    await screen.ready();
    await screen.press(UP);
    await screen.press(ENTER);
    for (const key of keys.match(/\u001b\[[A-Z]|[\s\S]/gu) ?? []) await screen.press(key);
    expect(screen.onClose).toHaveBeenCalledWith({ sessionId: 'other', projectPath: '/Users/me/work/beta', ...expected });
  });

  it.each(['session', 'current'] as const)('skips the directory question when the saved preference is %s', async (preference) => {
    const screen = mount({ directoryPreference: preference });
    await screen.ready();
    await screen.press(UP);
    await screen.press(ENTER);
    expect(screen.onClose).toHaveBeenCalledWith({ sessionId: 'other', projectPath: '/Users/me/work/beta', directory: preference });
  });

  it('refuses to open a session that another process has open and names the process', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(`${UP}${UP}`);
    expect(screen.frame()).toContain('Working · open in PID 4242');
    await screen.press(ENTER);
    expect(screen.frame()).toContain('open in another Autohand process (PID 4242)');
    expect(screen.onClose).not.toHaveBeenCalled();
    await screen.press(DOWN);
    expect(screen.frame()).not.toContain('another Autohand process');
  });

  it('returns to the composer without switching on Enter over the current session, Escape, or Ctrl+C', async () => {
    for (const key of [ENTER, ESCAPE, '\u0003', '\u001b[27u', '\u001b[99;5u']) {
      const screen = mount();
      await screen.ready();
      await screen.press(key);
      await vi.waitFor(() => expect(screen.onClose).toHaveBeenCalledWith(null));
      cleanup();
    }
  });

  it('selects a row on click and opens it on a second click', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(click(10, screen.rowOf('○ Refactor billing')));
    expect(screen.selected()).toContain('Refactor billing');
    expect(screen.onClose).not.toHaveBeenCalled();
    await screen.press(click(10, screen.rowOf('○ Refactor billing')));
    expect(screen.onClose).toHaveBeenCalledWith({ sessionId: 'older', projectPath: '/Users/me/work/alpha', directory: 'current' });
  });

  it('handles a press and its release arriving in one chunk, as terminals send a click', async () => {
    const screen = mount();
    await screen.ready();
    const row = screen.rowOf('○ Refactor billing');
    await screen.press(`${click(10, row)}\u001b[<0;10;${row}m`);
    expect(screen.selected()).toContain('Refactor billing');
    expect(screen.onClose).not.toHaveBeenCalled();
  });

  it('ignores clicks on headings, the details pane, empty rows and chrome', async () => {
    const screen = mount();
    await screen.ready();
    const before = screen.selected();
    await screen.press(click(10, screen.rowOf('~/work/beta 2')));
    await screen.press(click(100, screen.rowOf('○ Refactor billing')));
    await screen.press(click(10, 20));
    await screen.press(click(10, 1));
    await screen.press(click(10, 23));
    expect(screen.selected()).toBe(before);
    expect(screen.onClose).not.toHaveBeenCalled();
  });

  it('selects a filter when its tab is clicked and ignores clicks between tabs', async () => {
    const screen = mount();
    await screen.ready();
    const spans = filterTabSpans({ all: 4, 'needs-you': 0, working: 1, ready: 1, inactive: 2 }, 119);
    const working = spans.find((span) => span.filter === 'working')!;
    await screen.press(click(working.end + 1, AGENT_SESSIONS_LAYOUT.TAB_ROW + 1));
    expect(screen.frame()).toContain('Refactor billing');
    await screen.press(click(working.start + 1, AGENT_SESSIONS_LAYOUT.TAB_ROW + 1));
    expect(screen.frame()).not.toContain('Refactor billing');
    expect(screen.selected()).toContain('Ship the release');
  });

  it('moves the selection with the mouse wheel', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(wheel(false));
    expect(screen.selected()).toContain('Ship the release');
    await screen.press(wheel(true));
    expect(screen.selected()).toContain('Refactor billing');
  });

  it('chooses a directory option by click: first click selects, second confirms', async () => {
    const screen = mount();
    await screen.ready();
    await screen.press(UP);
    await screen.press(ENTER);
    const row = screen.rowOf('2. Use current directory');
    expect(row).toBe(AGENT_SESSIONS_LAYOUT.DIRECTORY_OPTIONS_ROW + 2);
    await screen.press(click(5, row));
    expect(screen.frame()).toMatch(/› 2\. Use current directory/u);
    expect(screen.onClose).not.toHaveBeenCalled();
    await screen.press(click(5, row));
    expect(screen.onClose).toHaveBeenCalledWith({ sessionId: 'other', projectPath: '/Users/me/work/beta', directory: 'current' });
  });

  it('caps the list to the terminal height and scrolls to keep the selection and its heading visible', async () => {
    const many = Array.from({ length: 40 }, (_, index) => entry(`s${String(index).padStart(2, '0')}`, {
      title: `Session number ${String(index).padStart(2, '0')}`, activeAt: new Date(NOW.getTime() - index * 60_000),
      current: index === 0, projectPath: index < 20 ? '/Users/me/work/alpha' : '/Users/me/work/beta',
    }));
    const screen = mount({ rows: 16 }, many);
    await vi.waitFor(() => expect(screen.frame()).toContain('Session number 00'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(screen.frame().split('\n').length).toBeLessThanOrEqual(15);
    expect(screen.frame()).not.toContain('Session number 12');

    for (let index = 0; index < 39; index += 1) await screen.press(DOWN);
    expect(screen.selected()).toContain('Session number 39');
    expect(screen.frame()).toContain('40/40');
    expect(screen.frame()).not.toContain('Session number 00');
    expect(screen.frame().split('\n').length).toBeLessThanOrEqual(15);

    for (let index = 0; index < 19; index += 1) await screen.press(UP);
    expect(screen.selected()).toContain('Session number 20');
    expect(screen.frame()).toMatch(/~\/work\/beta 20/u);
  });

  it('loads older sessions from the Show more row', async () => {
    const screen = mount({ pageSize: 30 }, SESSIONS(), 12);
    await screen.ready();
    expect(screen.frame()).toContain('Show more (12 older)');
    expect(screen.load).toHaveBeenLastCalledWith(30);
    await screen.press(`${DOWN}${DOWN}`);
    expect(screen.selected()).toContain('Show more');
    await screen.press(ENTER);
    await vi.waitFor(() => expect(screen.load).toHaveBeenLastCalledWith(60));
    expect(screen.onClose).not.toHaveBeenCalled();
  });

  it('shows empty and failed-load states without crashing', async () => {
    const empty = mount({}, []);
    await vi.waitFor(() => expect(empty.frame()).toContain('No sessions yet.'));
    await empty.press(`${DOWN}${ENTER}`);
    expect(empty.onClose).not.toHaveBeenCalled();
    cleanup();
    const failed = mount({ load: vi.fn(async () => { throw new Error('index unreadable'); }) });
    await vi.waitFor(() => expect(failed.frame()).toContain('Could not load sessions: index unreadable'));
  });
});
