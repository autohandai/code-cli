import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { FULL_SCREEN_GUTTER } from '../../../src/ui/ink/FullScreenFrame.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { copyToClipboard } from '../../../src/ui/clipboard.js';
vi.mock('../../../src/ui/clipboard.js', () => ({ copyToClipboard: vi.fn() }));
const flush = () => new Promise(resolve => setTimeout(resolve, 40));
afterEach(cleanup);
/** Blank columns the full-screen frame keeps between the window edge and every row it draws. */
const gutter = ' '.repeat(FULL_SCREEN_GUTTER);

describe('full-screen composer integration', () => {
  it.each([false, true])('ends with the selected status items and honors shortcuts enabled=%s', async hintsEnabled => {
    const model = new FullScreenTranscript();
    const state = { ...createInitialUIState(), configuredLineExtensions: { help: {
      replaceDefault: true,
      segments: [
        { id: 'project', text: 'selected-project' },
        ...(hintsEnabled ? [{ id: 'hints', text: '? shortcuts' }] : []),
      ],
    } } };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    const rows = () => stripAnsi(view.lastFrame() ?? '').split('\n');
    expect(rows().at(-1)).toContain('selected-project');
    expect(rows().at(-1)?.includes('? shortcuts')).toBe(hintsEnabled);
    expect(rows().join('\n')).not.toContain('Full screen');
    const composerRow = rows().findIndex(line => line.includes('❯'));
    view.stdin.write('\x06'); await flush();
    expect(rows().join('\n')).toContain('Find:');
    expect(rows().findIndex(line => line.includes('Find:'))).toBeLessThan(composerRow);
    expect(rows().at(-1)).toContain('selected-project');
    view.stdin.write('\x1b'); await flush();
    expect(rows().findIndex(line => line.includes('❯'))).toBe(composerRow);
  });

  it('keeps every slash suggestion on its own row when the footer runs out of height', async () => {
    const model = new FullScreenTranscript();
    const state = { ...createInitialUIState(), isWorking: true, status: 'Parsing...',
      activityItems: Array.from({ length: 6 }, (_, i) => ({ id: `task-${i}`, kind: 'todo' as const, label: `Refreshing chart ${i}`, status: i === 0 ? 'in_progress' as const : 'pending' as const })) };
    const slashCommands = [
      { command: '/help', description: 'Show available commands', implemented: true },
      { command: '/model', description: 'Switch the active model', implemented: true },
      { command: '/new', description: 'Start a new conversation', implemented: true },
      { command: '/sessions', description: 'List saved sessions', implemented: true },
      { command: '/undo', description: 'Revert the last mutation', implemented: true },
      { command: '/quit', description: 'Exit Autohand', implemented: true },
    ];
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} slashCommands={slashCommands} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} /></ThemeProvider></I18nProvider>);
    await flush();
    view.stdin.write('/'); await flush(); await flush();
    const rows = stripAnsi(view.lastFrame() ?? '').split('\n');
    expect(rows.length).toBeLessThanOrEqual(24);
    expect(rows.find(row => row.includes('Tab to accept'))?.trimEnd()).toBe(`${gutter}  Tab to accept · ↑↓ to navigate`);
    for (const [command, description] of [['/help', 'Show available commands'], ['/sessions', 'List saved sessions'], ['/quit', 'Exit Autohand']]) {
      expect(rows.find(row => row.includes(command))?.trimEnd()).toMatch(new RegExp(`${command} {2}${description}$`));
    }
    const composerRow = rows.findIndex(row => row.startsWith(`${gutter}❯`));
    expect(rows.findIndex(row => row.includes('Tab to accept'))).toBeLessThan(composerRow);
    expect(rows.slice(-2).join(' ')).toContain('context left');
  });

  it.each([false, true])('finds transcript text while working with queue input enabled=%s', async enableQueueInput => {
    const model = new FullScreenTranscript();
    const onInstruction = vi.fn();
    const onEscape = vi.fn();
    const onCtrlC = vi.fn();
    let state = { ...createInitialUIState(), isWorking: true, status: 'Reading sources', currentInput: 'preserved draft',
      chatMessages: Array.from({ length: 50 }, (_, i) => ({ role: 'assistant' as const, content: `History item ${i}` })),
      streamingResponse: 'The investigation is still running.',
    };
    const frame = () => <I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={model} state={state} enableQueueInput={enableQueueInput} onInstruction={onInstruction} onEscape={onEscape} onCtrlC={onCtrlC} /></ThemeProvider></I18nProvider>;
    const view = render(frame()); await flush();
    const screen = () => stripAnsi(view.lastFrame() ?? '');
    view.stdin.write('\x06'); await flush();
    view.stdin.write('History item 10'); await flush();
    expect(model.view(8).following).toBe(false);
    expect(screen()).toContain('History item 10\n');
    expect(screen()).not.toContain('No match');
    state = { ...state, streamingResponse: `${state.streamingResponse}\nMore ongoing work.` };
    view.rerender(frame()); await flush();
    expect(screen()).toContain('History item 10\n');
    view.stdin.write('\x06'); await flush();
    view.stdin.write('Pending discovery'); await flush();
    expect(screen()).toContain('No match');
    state = { ...state, streamingResponse: `${state.streamingResponse}\nPending discovery is now available.` };
    view.rerender(frame()); await flush();
    expect(screen()).not.toContain('No match');
    expect(screen()).toContain('Pending discovery is now available.');
    view.stdin.write('\r'); await flush();
    view.stdin.write('\x1b'); await flush();
    expect(model.searchQuery).toBeNull();
    if (enableQueueInput) expect(screen()).toContain('preserved draft');
    expect(onInstruction).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
    view.stdin.write('\x06'); await flush();
    view.stdin.write('\x03'); await flush();
    expect(model.searchQuery).toBeNull();
    expect(onCtrlC).not.toHaveBeenCalled();
  });

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
    expect(collapsed.match(new RegExp(`^${gutter}live-row-\\d+$`, 'gmu'))).toHaveLength(5);
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
    const tipRow = rows().findIndex(line => line.startsWith(`${gutter}Tip:`));
    expect(tipRow).toBeGreaterThan(2);
    expect(rows()[tipRow - 1]).toContain('READING_SOURCES');
    expect(rows()[tipRow - 1]).toContain('0m 11s · ↑0 ↓0');
    expect(rows()[tipRow - 1]).toContain('esc to cancel');
    const composerRow = rows().findIndex(line => line.includes('❯ preserved draft'));
    expect(rows().slice(tipRow + 1, composerRow).every(line => /^[▔▁─\s]*$/u.test(line))).toBe(true);
    expect(screen()).not.toContain('Full screen');
    state = { ...state, isWorking: false, status: '' };
    view.rerender(frame()); await flush();
    expect(screen()).not.toContain('READING_SOURCES');
    expect(rows().findIndex(line => line.startsWith(`${gutter}Tip:`))).toBe(tipRow);
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
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Back to bottom · Ctrl+End');
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

describe('full-screen transcript mouse selection', () => {
  const expandable = { id: 'fetch-1', tool: 'fetch_url', success: true, output: 'line 1', expandedOutput: 'line 1\nline 2', timestamp: 1 };
  const setup = (extra: Record<string, unknown> = {}) => {
    vi.mocked(copyToClipboard).mockClear();
    const onToggleToolOutputExpanded = vi.fn();
    const onToggleLiveCommandExpanded = vi.fn();
    const state = { ...createInitialUIState(), chatMessages: [{ role: 'assistant' as const, content: 'Copy this sentence please', renderMarkdown: false }], toolOutputs: [expandable], ...extra };
    const view = render(<I18nProvider><ThemeProvider><AgentUI fullScreenTranscript={new FullScreenTranscript()} mouseComposerCursor state={state as never} onInstruction={() => {}} onEscape={() => {}} onCtrlC={() => {}} onToggleToolOutputExpanded={onToggleToolOutputExpanded} onToggleLiveCommandExpanded={onToggleLiveCommandExpanded} /></ThemeProvider></I18nProvider>);
    const rows = () => stripAnsi(view.lastFrame() ?? '').split('\n');
    const locate = (text: string) => {
      const row = rows().findIndex(line => line.includes(text));
      return { row: row + 1, column: rows()[row].indexOf(text) + 1 };
    };
    return { view, rows, locate, onToggleToolOutputExpanded, onToggleLiveCommandExpanded };
  };

  it('copies dragged transcript text instead of expanding output', async () => {
    const { view, rows, locate, onToggleToolOutputExpanded } = setup();
    await flush();
    const { row, column } = locate('this sentence');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<32;${column + 6};${row}M`); await flush();
    view.stdin.write(`\x1b[<32;${column + 12};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column + 12};${row}m`); await flush();
    expect(copyToClipboard).toHaveBeenCalledOnce();
    expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe('this sentence');
    expect(rows().join('\n')).toContain('Copied selection');
    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
  });

  it.each([['a typed character', 'x'], ['a key that changes nothing', '\x1b[C']])('inverts the dragged cells while dragging and after release, until %s', async (_label, keyPress) => {
    const { view, locate } = setup();
    await flush();
    const { row, column } = locate('this sentence');
    const transcriptRow = () => (view.lastFrame() ?? '').split('\n')[row - 1];
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    expect(transcriptRow()).toBe(`${gutter}Copy this sentence please`);
    view.stdin.write(`\x1b[<32;${column + 6};${row}M`); await flush();
    expect(transcriptRow()).toBe(`${gutter}Copy \x1b[7mthis se\x1b[27mntence please`);
    view.stdin.write(`\x1b[<32;${column + 12};${row}M`); await flush();
    expect(transcriptRow()).toBe(`${gutter}Copy \x1b[7mthis sentence\x1b[27m please`);
    view.stdin.write(`\x1b[<0;${column + 12};${row}m`); await flush();
    expect(transcriptRow()).toBe(`${gutter}Copy \x1b[7mthis sentence\x1b[27m please`);
    view.stdin.write(keyPress); await flush();
    expect(view.lastFrame()).not.toContain('\x1b[7m');
    expect(stripAnsi(view.lastFrame() ?? '')).not.toContain('Copied selection');
  });

  it.each(Array.from({ length: FULL_SCREEN_GUTTER }, (_, index) => index + 1))('treats a press on gutter column %i as the first cell of that row', async gutterColumn => {
    const { view, locate } = setup();
    await flush();
    const { row, column } = locate('Copy this');
    expect(column).toBe(FULL_SCREEN_GUTTER + 1);
    view.stdin.write(`\x1b[<0;${gutterColumn};${row}M`); await flush();
    view.stdin.write(`\x1b[<32;${column + 3};${row}M`); await flush();
    expect((view.lastFrame() ?? '').split('\n')[row - 1]).toBe(`${gutter}\x1b[7mCopy\x1b[27m this sentence please`);
    view.stdin.write(`\x1b[<0;${column + 3};${row}m`); await flush();
    expect(vi.mocked(copyToClipboard).mock.calls.at(-1)?.[0]).toBe('Copy');
  });

  it('does not expand anything for a plain click on transcript text', async () => {
    const { view, locate, onToggleToolOutputExpanded, onToggleLiveCommandExpanded } = setup();
    await flush();
    const { row, column } = locate('this sentence');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column};${row}m`); await flush();
    expect(copyToClipboard).not.toHaveBeenCalled();
    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
    expect(onToggleLiveCommandExpanded).not.toHaveBeenCalled();
  });

  it('expands a running command from a click on its own output', async () => {
    const { view, locate, onToggleLiveCommandExpanded, onToggleToolOutputExpanded } = setup({
      liveCommands: [{ id: 'live-1', command: 'bun test', stdout: 'running', stderr: '', isExpanded: false, startedAt: 1 }],
    });
    await flush();
    const { row, column } = locate('running');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column};${row}m`); await flush();
    expect(onToggleLiveCommandExpanded).toHaveBeenCalledWith('live-1');
    expect(onToggleToolOutputExpanded).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('expands the finished tool result that was clicked, not the latest one', async () => {
    const older = { id: 'script-1', tool: 'run_tool_script', success: true, output: '1 tool call · older', expandedOutput: 'Logs:\nolder detail', timestamp: 1 };
    const newer = { id: 'script-2', tool: 'run_tool_script', success: true, output: '1 tool call · newer', expandedOutput: 'Logs:\nnewer detail', timestamp: 2 };
    const { view, locate, onToggleToolOutputExpanded, onToggleLiveCommandExpanded } = setup({
      toolOutputs: [older, newer],
      chatMessages: [
        { role: 'user', content: 'read the build script' },
        { role: 'tool', tool: older.tool, success: true, content: older.output, expandedOutput: older.expandedOutput },
        { role: 'tool', tool: newer.tool, success: true, content: newer.output, expandedOutput: newer.expandedOutput },
        { role: 'tool', tool: 'read_file', success: true, content: 'short result with nothing more to show' },
      ],
    });
    await flush();
    const click = async (text: string) => {
      const { row, column } = locate(text);
      view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
      view.stdin.write(`\x1b[<0;${column};${row}m`); await flush();
    };

    await click('1 tool call · older');
    expect(onToggleToolOutputExpanded).toHaveBeenLastCalledWith('script-1');
    await click('1 tool call · newer');
    expect(onToggleToolOutputExpanded).toHaveBeenLastCalledWith('script-2');
    await click('short result with nothing more to show');
    await click('read the build script');
    expect(onToggleToolOutputExpanded).toHaveBeenCalledTimes(2);
    expect(onToggleLiveCommandExpanded).not.toHaveBeenCalled();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('expands a finished result that is only present in the live tool output list', async () => {
    const { view, locate, onToggleToolOutputExpanded } = setup();
    await flush();
    const { row, column } = locate('line 1');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column};${row}m`); await flush();
    expect(onToggleToolOutputExpanded).toHaveBeenCalledExactlyOnceWith('fetch-1');
  });

  it('collapses expanded details from a click on them and still copies a drag across a result', async () => {
    const { view, locate, onToggleToolOutputExpanded } = setup({ expandedToolOutputId: 'fetch-1' });
    await flush();
    const hint = locate('Ctrl+O collapse');
    view.stdin.write(`\x1b[<0;${hint.column};${hint.row}M`); await flush();
    view.stdin.write(`\x1b[<0;${hint.column};${hint.row}m`); await flush();
    expect(onToggleToolOutputExpanded).toHaveBeenCalledExactlyOnceWith('fetch-1');

    const { row, column } = locate('line 2');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<32;${column + 5};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column + 5};${row}m`); await flush();
    expect(vi.mocked(copyToClipboard).mock.calls.at(-1)?.[0]).toBe('line 2');
    expect(onToggleToolOutputExpanded).toHaveBeenCalledTimes(1);
  });

  it('keeps mouse reports out of the Find query', async () => {
    const { view, rows, locate } = setup();
    await flush();
    view.stdin.write('\x06'); await flush();
    const { row, column } = locate('this sentence');
    view.stdin.write(`\x1b[<0;${column};${row}M`); await flush();
    view.stdin.write(`\x1b[<0;${column};${row}m`); await flush();
    expect(rows().find(line => line.includes('Find:'))).toMatch(/Find: {2}·|Find: ·/);
  });
});
