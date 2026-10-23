import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
const flush = () => new Promise(resolve => setTimeout(resolve, 40));
afterEach(cleanup);

describe('full-screen composer integration', () => {
  it('expands a running command with Ctrl+O while reading history and keeps the draft', async () => {
    const model = new FullScreenTranscript();
    let state = createInitialUIState();
    state = { ...state, isWorking: true, status: 'Running command', currentInput: 'preserved draft',
      chatMessages: Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `History ${i}` })),
      liveCommands: [{ id: 'live-output', command: 'long command', stdout: Array.from({ length: 60 }, (_, i) => `live-row-${i + 1}`).join('\n'), stderr: '', startedAt: Date.now(), isExpanded: false }],
    };
    const toggle = vi.fn(() => {
      state = { ...state, liveCommands: state.liveCommands.map(entry => ({ ...entry, isExpanded: !entry.isExpanded })) };
      view.rerender(frame());
    });
    const frame = () => <I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} onToggleLiveCommandExpanded={toggle} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>;
    const view = render(frame()); await flush();
    view.stdin.write('\x1b[5~'); await flush();
    expect(model.view(8).following).toBe(false);
    view.stdin.write('\x0f'); await flush();
    expect(toggle).toHaveBeenCalledOnce();
    const expanded = stripAnsi(view.lastFrame() ?? '');
    expect(expanded).toContain('Ctrl+O collapse');
    expect(expanded).toContain('live-row-1\n');
    expect(expanded).toContain('preserved draft');
    view.stdin.write('\x1b[6~'); await flush();
    const reading = model.view(8).lines;
    state = { ...state, notifications: ['Later notification'], liveCommands: state.liveCommands.map(entry => ({ ...entry, stdout: `${entry.stdout}\nlive-row-61` })) };
    view.rerender(frame()); await flush();
    expect(model.view(8).lines).toEqual(reading);
    view.stdin.write('\x0f'); await flush();
    const collapsed = stripAnsi(view.lastFrame() ?? '');
    expect(collapsed).toContain('Ctrl+O expand');
    expect(collapsed).toContain('live-row-61');
    expect(collapsed.match(/^live-row-\d+$/gmu)).toHaveLength(5);
    expect(collapsed).not.toContain('live-row-1\n');
    expect(model.view(8).following).toBe(true);
  });

  it('keeps one working indicator above the tip and composer across turn completion', async () => {
    let state = { ...createInitialUIState(), currentInput: 'preserved draft', isWorking: true, status: 'READING_SOURCES', elapsed: '0m 11s', tokens: '↑0 ↓0', tip: { kind: 'tip' as const, text: 'Type /review security to check auth flows' } };
    const model = new FullScreenTranscript();
    const frame = () => <I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} workspaceRoot="/work/project" state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>;
    const view = render(frame()); await flush();
    const screen = () => stripAnsi(view.lastFrame() ?? '');
    const rows = () => screen().split('\n');
    expect(rows()[0]).toContain('Autohand Code');
    expect(rows()[1]).toContain('/work/project');
    expect(rows()[2]).not.toContain('READING_SOURCES');
    expect(screen().split('READING_SOURCES')).toHaveLength(2);
    const tipRow = rows().findIndex(line => line.startsWith('Tip:'));
    expect(tipRow).toBeGreaterThan(2);
    expect(rows()[tipRow - 1]).toContain('READING_SOURCES');
    expect(rows()[tipRow - 1]).toContain('0m 11s · ↑0 ↓0');
    expect(rows()[tipRow - 1]).toContain('esc to cancel');
    const composerRow = rows().findIndex(line => line.includes('❯ preserved draft'));
    expect(rows().slice(tipRow + 1, composerRow).every(line => /^[▔▁─\s]*$/u.test(line))).toBe(true);
    expect(rows().findIndex(line => line.includes('Full screen'))).toBeGreaterThan(rows().findIndex(line => line.includes('context left')));
    state = { ...state, isWorking: false, status: '' };
    view.rerender(frame()); await flush();
    expect(screen()).not.toContain('READING_SOURCES');
    expect(rows().findIndex(line => line.startsWith('Tip:'))).toBe(tipRow);
    expect(rows().findIndex(line => line.includes('❯ preserved draft'))).toBe(composerRow);
  });
  it.each([false, true])('renders a transcript reminder once in chronological order with fullScreen=%s', async fullScreen => {
    const state = { ...createInitialUIState(), chatMessages: [
      { role: 'assistant' as const, content: 'First response' },
      { role: 'notification' as const, content: 'Repository suggestions available.' },
      { role: 'assistant' as const, content: 'Later response' },
    ] };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={fullScreen ? new FullScreenTranscript() : undefined} state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    const screen = stripAnsi(view.lastFrame() ?? '');
    expect(screen.split('Repository suggestions available.')).toHaveLength(2);
    expect(screen.indexOf('Repository suggestions available.')).toBeGreaterThan(screen.indexOf('First response'));
    expect(screen.indexOf('Repository suggestions available.')).toBeLessThan(screen.indexOf('Later response'));
  });
  it('anchors every rendered frame as slash menus and queued rows appear and disappear', async () => {
    const model = new FullScreenTranscript();
    let state = createInitialUIState();
    const frame = () => <I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} enableQueueInput slashCommands={[{ command: '/about', description: 'About', implemented: true }]} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>;
    const view = render(frame()); await flush();
    const row = (frame: string) => stripAnsi(frame).split('\n').findIndex(line => line.includes('❯'));
    const baseline = row(view.lastFrame() ?? '');
    const start = view.frames.length;
    view.stdin.write('/'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('/about');
    view.stdin.write('\x1b'); await flush();
    state = { ...state, isWorking: true, queuedInstructions: ['queued message'] };
    view.rerender(frame()); await flush();
    state = { ...state, queuedInstructions: Array.from({ length: 40 }, (_, i) => `queued ${i}`) };
    view.rerender(frame()); await flush();
    state = { ...state, isWorking: false, queuedInstructions: [] };
    view.rerender(frame()); await flush();
    expect([...new Set(view.frames.slice(start).map(row))]).toEqual([baseline]);
  });
  it('dismisses shortcuts before leaving history and leaves interruption available at the tail', async () => {
    const model = new FullScreenTranscript();
    const state = { ...createInitialUIState(), chatMessages: Array.from({ length: 100 }, (_, i) => ({ role: 'assistant' as const, content: `Message ${i}` })) };
    const onEscape = vi.fn();
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} onInstruction={() => {}} onEscape={onEscape} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    view.stdin.write('\x1b[5~'); await flush();
    view.stdin.write('?'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Keyboard shortcuts');
    view.stdin.write('\x1b'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).not.toContain('Keyboard shortcuts');
    expect(model.view(8).following).toBe(false);
    view.stdin.write('\x1b'); await flush();
    expect(model.view(8).following).toBe(true);
    expect(onEscape).not.toHaveBeenCalled();
    view.stdin.write('\x1b'); await flush();
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('keeps drafts editable while paging and searching long history', async () => {
    const state = { ...createInitialUIState(), currentInput: 'preserved draft', chatMessages: Array.from({ length: 200 }, (_, index) => ({ role: 'assistant' as const, content: `History entry ${index}` })) };
    const model = new FullScreenTranscript();
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('preserved draft');
    expect(stripAnsi(view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    view.stdin.write('\x1b[5~'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Ctrl+End latest');
    view.stdin.write('\x06'); await flush();
    view.stdin.write('History entry 40'); await flush(); view.stdin.write('\r'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('History entry 40');
    view.stdin.write('\x1b'); await flush();
    view.stdin.write(' added'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('preserved draft added');
    view.stdin.write('\x1b[1;5F'); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('History entry 199');
    view.unmount();
  });
  it('keeps the composer visible with working status and a long queue', async () => {
    const state = { ...createInitialUIState(), currentInput: 'editable during work', isWorking: true, status: 'Running a long command', queuedInstructions: Array.from({ length: 40 }, (_, i) => `queued message ${i}`) };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} state={state} enableQueueInput onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    const screen = stripAnsi(view.lastFrame() ?? '');
    expect(screen).toContain('editable during work');
    expect(screen.split('\n').length).toBeLessThanOrEqual(24);
    view.unmount();
  });

  it('keeps the selected end of a long queue visible without moving the composer', async () => {
    const state = { ...createInitialUIState(), isWorking: true, queuedInstructions: Array.from({ length: 40 }, (_, i) => `queued message ${i}`) };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} state={state} enableQueueInput onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    const row = () => stripAnsi(view.lastFrame() ?? '').split('\n').findIndex(line => line.includes('❯'));
    const baseline = row();
    for (let i = 0; i < 40; i++) { view.stdin.write('\x1b[B'); await flush(); }
    const screen = stripAnsi(view.lastFrame() ?? '');
    expect(screen).toContain('› 40. queued message 39');
    expect(screen).toContain('35 more');
    expect(row()).toBe(baseline);
    expect(screen).not.toContain('1. queued message 0');
  });

  it('keeps the active end of a multiline draft visible', async () => {
    const draft = Array.from({ length: 50 }, (_, index) => `draft line ${index}`).join('\n');
    const state = { ...createInitialUIState(), currentInput: draft };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    const screen = stripAnsi(view.lastFrame() ?? '');
    expect(screen).toContain('draft line 49');
    expect(screen).toContain('context left');
    expect(screen.split('\n').length).toBeLessThanOrEqual(24);
    view.unmount();
  });

});
