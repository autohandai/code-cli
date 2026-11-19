/** @license Apache-2.0 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';

const { setCursorPosition } = vi.hoisted(() => ({ setCursorPosition: vi.fn() }));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useCursor: () => ({ setCursorPosition }) };
});

import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { FULL_SCREEN_GUTTER } from '../../../src/ui/ink/FullScreenFrame.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 50));
const gutter = ' '.repeat(FULL_SCREEN_GUTTER);

afterEach(() => {
  cleanup();
  setCursorPosition.mockReset();
});

describe('full-screen history gutter with the real composer footer', () => {
  const setup = (currentInput: string, extra: Record<string, unknown> = {}) => {
    const state = {
      ...createInitialUIState(),
      currentInput,
      chatMessages: [
        { role: 'user' as const, content: 'summarise the release' },
        { role: 'assistant' as const, content: '# Summary\n\n1. First change\n2. Second change\n\n---\n\nRecap: two changes shipped.' },
      ],
      completionStats: { elapsed: '0m 4s', tokens: '↑1 ↓2' },
      tip: { kind: 'tip' as const, text: 'Type /review security to check auth flows' },
      contextPercent: 90,
      ...extra,
    };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} mouseComposerCursor workspaceRoot="/work/project" state={state as never} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    const rows = () => stripAnsi(view.lastFrame() ?? '').split('\n');
    const caret = () => setCursorPosition.mock.calls.map(([position]) => position as { x: number; y: number } | undefined).filter(Boolean).at(-1);
    return { view, rows, caret };
  };

  it('insets the header and chat history only: the composer and footer start on the window edge', async () => {
    const { view, rows } = setup('draft');
    await flush(); await flush();
    const columns = view.stdout.columns;
    const drawn = rows().filter(row => row.trim());
    expect(Math.max(...rows().map(row => stringWidth(row)))).toBeLessThanOrEqual(columns - 1);
    for (const text of ['>_ Autohand Code', 'Summary', 'Recap: two changes shipped.']) {
      expect(drawn.find(row => row.includes(text))?.indexOf(text)).toBe(FULL_SCREEN_GUTTER);
    }
    for (const text of ['Tip: Type /review', '❯ draft', '90% context left']) {
      expect(drawn.find(row => row.includes(text))?.indexOf(text)).toBe(0);
    }
    for (const rule of ['▔', '▁']) {
      expect(drawn.find(row => row.includes(rule))).toBe(rule.repeat(columns - 1));
    }
  });

  it('cuts footer lines that outgrow the footer width on their own row instead of spilling a cell onto the next', async () => {
    const long = 'word '.repeat(60).trim();
    const { view, rows } = setup('draft', {
      tip: { kind: 'tip' as const, text: long },
      announcement: { id: 'a', text: `ANNOUNCE ${long}`, visible: true },
      feedbackSurvey: { id: 's', acknowledgement: `THANKS ${long}` },
    });
    await flush(); await flush();
    const limit = view.stdout.columns - 1;
    const tipRow = rows().findIndex(row => row.includes('Tip: word'));
    expect(rows()[tipRow]).toMatch(/…$/u);
    expect(stringWidth(rows()[tipRow])).toBeLessThanOrEqual(limit);
    expect(rows()[tipRow + 1]).toBe('▔'.repeat(limit));
    for (const text of ['ANNOUNCE word', 'THANKS word']) {
      const index = rows().findIndex(row => row.includes(text));
      expect(index).toBeGreaterThan(0);
      expect(stringWidth(rows()[index])).toBeLessThanOrEqual(limit);
      expect(rows()[index + 1]).not.toMatch(/^\s*\S{1,3}\s*$/u);
    }
    expect(Math.max(...rows().map(row => stringWidth(row)))).toBeLessThanOrEqual(limit);
  });

  it('parks the hardware caret on the cell after the draft, on the window edge', async () => {
    const { rows, caret } = setup('abc');
    await flush(); await flush();
    const row = rows().findIndex(line => line.includes('❯ abc'));
    expect(caret()).toEqual({ x: rows()[row].indexOf('abc') + 3, y: row });
    expect(caret()?.x).toBe('❯ abc'.length);
  });

  it('moves the caret to the composer cell that was clicked', async () => {
    const { view, rows, caret } = setup('abcdef');
    await flush(); await flush();
    const row = rows().findIndex(line => line.includes('❯ abcdef'));
    const clicked = rows()[row].indexOf('cdef');
    const before = caret();
    expect(before).toBeDefined();
    view.stdin.write(`\x1b[<0;${clicked + 1};${row + 1}M`); await flush();
    view.stdin.write(`\x1b[${before!.y + 1};${before!.x + 1}R`); await flush();
    expect(caret()).toEqual({ x: clicked, y: row });
    view.stdin.write('X'); await flush();
    expect(rows()[row]?.trimEnd()).toBe('❯ abXcdef');
  });
});

describe('views that replace the full-screen frame', () => {
  const caret = () => setCursorPosition.mock.calls.map(([position]) => position as { x: number; y: number } | undefined).filter(Boolean).at(-1);
  const mount = (state: Record<string, unknown>) => {
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} state={{ ...createInitialUIState(), ...state } as never} onMessageAgentRun={async () => true} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    return { view, rows: () => stripAnsi(view.lastFrame() ?? '').split('\n') };
  };
  const expectInset = (rows: string[], columns: number) => {
    expect(rows.filter(row => row.trim()).length).toBeGreaterThan(2);
    expect(rows.filter(row => row.trim()).every(row => row.startsWith(gutter))).toBe(true);
    expect(Math.max(...rows.map(row => stringWidth(row)))).toBeLessThanOrEqual(columns);
  };

  it('insets the agent runs panel and keeps its message caret on the typed cell', async () => {
    const run = { id: 'reader', source: 'delegate', name: 'reader', task: `Task ${'that is long '.repeat(20)}`, status: 'running', startedAt: 100, updatedAt: 200, provider: 'autohandai', model: 'fantail', cancellable: true, messageable: true };
    const { view, rows } = mount({ isWorking: true, agentRunsPanelVisible: true, agentRuns: { updatedAt: 200, runs: [run] } });
    await flush();
    expect(rows().find(row => row.includes('Session agents'))?.indexOf('Session agents')).toBe(FULL_SCREEN_GUTTER);
    expectInset(rows(), view.stdout.columns);
    view.stdin.write('m'); await flush();
    view.stdin.write('Stay read-only.'); await flush(); await flush();
    expectInset(rows(), view.stdout.columns);
    const row = rows().findIndex(line => line.includes('❯ Stay read-only.'));
    expect(rows()[row].indexOf('❯')).toBe(FULL_SCREEN_GUTTER);
    expect(caret()).toEqual({ x: rows()[row].indexOf('Stay read-only.') + 'Stay read-only.'.length, y: row });
  });

  it('insets the team view', async () => {
    const team = { name: 'code-cleanup', createdAt: new Date().toISOString(), leadSessionId: 'session-123', status: 'active',
      members: [{ name: 'hunter', agentName: 'code-cleaner', pid: 100, status: 'working' }] };
    const tasks = [{ id: 'task-001', subject: `Remove dead exports ${'and more '.repeat(30)}`, description: 'Find and remove unused exports', status: 'in_progress', owner: 'hunter', blockedBy: [], createdAt: '' }];
    const { view, rows } = mount({ isWorking: true, teamPanelVisible: true, teamActivity: { team, tasks } });
    await flush();
    expect(rows().join('\n')).toContain('code-cleanup');
    expectInset(rows(), view.stdout.columns);
  });
});

