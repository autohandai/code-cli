import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { Box, Text } from 'ink';
import os from 'node:os';
import path from 'node:path';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import { FULL_SCREEN_GUTTER, FullScreenFrame } from '../../../src/ui/ink/FullScreenFrame.js';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { Theme } from '../../../src/ui/theme/Theme.js';
import { loadTheme } from '../../../src/ui/theme/loader.js';
const flush = () => new Promise(resolve => setTimeout(resolve, 30));
afterEach(cleanup);

describe('full-screen frame', () => {
  it.each([100, 40])('insets the header, transcript and hint by the left gutter, leaves the footer on the window edge and stays inside %i columns', async columns => {
    const theme = new Theme('user-background-test', { ...loadTheme('dark').colors, userMessageBg: '#654321' }, 'truecolor');
    const model = new FullScreenTranscript();
    const gutter = ' '.repeat(FULL_SCREEN_GUTTER);
    expect(FULL_SCREEN_GUTTER).toBe(2);
    const messages = [
      ...Array.from({ length: 30 }, (_, i) => ({ role: 'notification' as const, content: `Message ${i}` })),
      { role: 'user' as const, content: 'please review the layout of this frame so that nothing touches the window edge 界🙂' },
      { role: 'assistant' as const, content: '# Heading\n\nA paragraph that is long enough to wrap at every width this test renders, including the narrow one.\n\n1. First item\n2. Second item\n\n---\n\nRecap: done.' },
    ];
    // The test terminal is always 100 columns wide; the outer box stands in for a terminal of the width under test.
    const frame = () => <ThemeProvider theme={theme}><Box width={columns}><FullScreenFrame model={model} messages={messages} rows={30} columns={columns} workspaceRoot={os.homedir()}
      footer={<Box flexDirection="column"><Text>❯ draft</Text><Text>STATUS_ROW</Text></Box>} /></Box></ThemeProvider>;
    const view = render(frame()); await flush();
    view.rerender(frame()); await flush();
    const check = (expectedHint: RegExp) => {
      const raw = (view.lastFrame() ?? '').split('\n');
      const rows = raw.map(row => stripAnsi(row));
      expect(rows.slice(0, -2).filter(row => row.trim()).every(row => row.startsWith(gutter))).toBe(true);
      expect(Math.max(...rows.map(row => stringWidth(row)))).toBeLessThanOrEqual(columns - 1);
      expect(rows[0]).toMatch(new RegExp(`^${gutter}>_ Autohand Code`));
      expect(rows.at(-2)).toBe('❯ draft');
      expect(rows.at(-1)).toBe('STATUS_ROW');
      expect(rows.at(-3)).toMatch(expectedHint);
      return { raw, rows };
    };
    const tail = check(/^\s*$/);
    expect(tail.rows.find(row => row.includes('Heading'))).toBe(`${gutter}Heading`);
    expect(tail.rows.find(row => row.includes('First item'))).toMatch(new RegExp(`^${gutter}\\S`));
    expect(tail.rows.find(row => row.includes('Recap'))).toBe(`${gutter}Recap: done.`);
    model.scroll(-12);
    view.rerender(frame()); await flush();
    const history = check(new RegExp(`^${gutter}↓ Back to bottom · Ctrl\\+End`));
    const highlighted = history.raw.filter(row => row.includes('\x1b[48;2;101;67;33m'));
    expect(highlighted.length).toBeGreaterThan(0);
    // The gutter is window margin: the user-message background starts after it and still reaches the right edge.
    expect(highlighted.every(row => row.startsWith(`${gutter}\x1b[`) && stringWidth(stripAnsi(row)) === columns - 1)).toBe(true);
    expect(history.rows.join('\n').replace(/\s+/gu, ' ')).toContain('nothing touches the window edge 界🙂');
    model.searchQuery = 'needle';
    view.rerender(frame()); await flush();
    check(new RegExp(`^${gutter}Find: needle`));
  });

  it('preserves the themed user-message background across the transcript row', async () => {
    const theme = new Theme('user-background-test', { ...loadTheme('dark').colors, userMessageBg: '#654321' }, 'truecolor');
    const model = new FullScreenTranscript();
    const view = render(<ThemeProvider theme={theme}><FullScreenFrame model={model} messages={[
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'You are welcome.' },
    ]} rows={24} columns={60} footer={<Text>❯ draft</Text>} /></ThemeProvider>);
    await flush();
    const rows = (view.lastFrame() ?? '').split('\n');
    const userRow = rows.find(row => row.includes('thanks')) ?? '';
    expect(userRow).toContain('\x1b[48;2;101;67;33m');
    expect(stripAnsi(userRow)).toHaveLength(59);
    expect(rows.find(row => row.includes('You are welcome.'))).not.toContain('\x1b[48;2;101;67;33m');
  });

  it.each([24, 40])('fills wrapped Unicode user messages with their background at %i columns', async columns => {
    const theme = new Theme('user-background-test', { ...loadTheme('dark').colors, userMessageBg: '#654321' }, 'truecolor');
    const model = new FullScreenTranscript();
    const view = render(<ThemeProvider theme={theme}><FullScreenFrame model={model} messages={[
      { role: 'user', content: 'thanks for the careful review of this change 界🙂' },
      { role: 'assistant', content: 'You are welcome.' },
    ]} rows={30} columns={columns} footer={<Text>❯ draft</Text>} /></ThemeProvider>);
    await flush();
    const rows = (view.lastFrame() ?? '').split('\n');
    const highlighted = rows.filter(row => row.includes('\x1b[48;2;101;67;33m'));
    expect(highlighted.length).toBeGreaterThanOrEqual(4);
    expect(highlighted.every(row => stringWidth(row) === columns - 1)).toBe(true);
    expect(highlighted.map(row => stripAnsi(row)).join('\n')).toContain('界🙂');
    expect(rows.find(row => row.includes('You are welcome.'))).not.toContain('\x1b[48;2;101;67;33m');
  });

  it('inverts every selected cell of a multi-row selection without relying on detected colour support', async () => {
    const model = new FullScreenTranscript();
    const frame = () => <ThemeProvider><FullScreenFrame model={model} messages={[
      { role: 'assistant', content: 'first 界 row\n\nthird row', renderMarkdown: false },
    ]} rows={24} columns={60} footer={<Text>❯ draft</Text>} /></ThemeProvider>;
    const view = render(frame());
    await flush();
    model.beginSelection(0, 6);
    model.extendSelection(2, 4);
    view.rerender(frame());
    await flush();
    const rows = (view.lastFrame() ?? '').split('\n').slice(3, 6);
    const gutter = ' '.repeat(FULL_SCREEN_GUTTER);
    expect(rows).toEqual([`${gutter}first \x1b[7m界 row\x1b[27m`, `${gutter}\x1b[7m \x1b[27m`, `${gutter}\x1b[7mthird\x1b[27m row`]);
    expect(rows.map(row => stringWidth(stripAnsi(row)) - FULL_SCREEN_GUTTER)).toEqual([12, 1, 9]);
  });

  it('keeps the configured status at the bottom and Find above the anchored composer', async () => {
    const model = new FullScreenTranscript();
    const directory = path.join(os.homedir(), 'Documents', 'autohand', 'cli-3');
    const frame = () => <ThemeProvider><FullScreenFrame model={model} messages={[]} rows={24} columns={100} workspaceRoot={directory}
      footer={<Box flexDirection="column"><Text>❯ draft</Text><Text>STATUS_ROW</Text></Box>} /></ThemeProvider>;
    const view = render(frame()); await flush();
    const lines = () => stripAnsi(view.lastFrame() ?? '').split('\n');
    expect(lines()[0]).toMatch(/Autohand Code \(v\d+\.\d+\.\d+/);
    expect(lines()[1]).toContain('~/Documents/autohand/cli-3');
    expect([...lines().slice(0, 2), ...lines().slice(-2)].map(line => line.replace(/\(v[^)]+\)/u, '(vVERSION)'))).toEqual([
      `${' '.repeat(FULL_SCREEN_GUTTER)}>_ Autohand Code (vVERSION)`,
      `${' '.repeat(FULL_SCREEN_GUTTER)}   ~/Documents/autohand/cli-3`,
      '❯ draft',
      'STATUS_ROW',
    ]);
    expect(lines().at(-1)).toBe('STATUS_ROW');
    expect(lines().join('\n')).not.toContain('Full screen');
    const composerRow = lines().findIndex(line => line.includes('❯ draft'));
    model.searchQuery = 'needle';
    view.rerender(frame()); await flush();
    expect(lines().join('\n')).toContain('Find: needle');
    expect(lines().findIndex(line => line.includes('Find: needle'))).toBeLessThan(composerRow);
    expect(lines().at(-1)).toBe('STATUS_ROW');
    expect(lines().findIndex(line => line.includes('❯ draft'))).toBe(composerRow);
  });
  it('shows unread activity above an anchored composer', async () => {
    const model = new FullScreenTranscript();
    let messages = Array.from({ length: 50 }, (_, i) => ({ role: 'assistant' as const, content: `Message ${i}` }));
    const frame = () => <ThemeProvider><FullScreenFrame model={model} messages={messages} rows={24} columns={100} footer={<Text>❯ draft</Text>} /></ThemeProvider>;
    const view = render(frame()); await flush();
    const composerRow = () => stripAnsi(view.lastFrame() ?? '').split('\n').findIndex(line => line.includes('❯ draft'));
    const row = composerRow();
    model.scroll(-20);
    messages = [...messages, { role: 'assistant', content: 'Incoming response' }];
    view.rerender(frame()); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('New activity · ↓ Back to bottom');
    expect(composerRow()).toBe(row);
    model.follow();
    view.rerender(frame()); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).not.toContain('New activity');
    expect(composerRow()).toBe(row);
  });

  it('keeps history on its rows when a streamed preview is dropped before its tool call arrives', async () => {
    const model = new FullScreenTranscript();
    const history = Array.from({ length: 50 }, (_, i) => ({ role: 'notification' as const, content: `Message ${i}` }));
    const preview = { role: 'assistant' as const, content: 'Reading the build script.\n\nThen the release workflow.' };
    let messages: Array<{ role: 'notification' | 'assistant' | 'tool_call'; content: string; tool?: string }> = [...history, preview];
    const frame = () => <ThemeProvider><FullScreenFrame model={model} messages={messages} rows={24} columns={100} footer={<Text>❯ draft</Text>} /></ThemeProvider>;
    const view = render(frame()); await flush();
    view.rerender(frame()); await flush();
    const rowOf = (text: string) => stripAnsi(view.lastFrame() ?? '').split('\n').findIndex(line => line.trimEnd().endsWith(text));
    const anchored = rowOf('Message 49');
    expect(anchored).toBeGreaterThan(0);

    messages = history;
    view.rerender(frame()); await flush();
    expect(rowOf('Message 49')).toBe(anchored);

    messages = [...history, { role: 'tool_call', tool: 'run_tool_script', content: 'Read build script' }];
    view.rerender(frame()); await flush();
    expect(rowOf('Message 49')).toBe(anchored);
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('… run_tool_script Read build script');

    model.follow();
    messages = history;
    view.rerender(frame()); await flush();
    expect(rowOf('Message 49')).toBeGreaterThan(anchored);
  });

  it('fills the transcript down to the footer once the footer has been measured', async () => {
    // The first render assumes a tall footer; the rows it hands back must not stay blank.
    const model = new FullScreenTranscript();
    const messages = Array.from({ length: 50 }, (_, i) => ({ role: 'notification' as const, content: `Message ${i}` }));
    const frame = () => <ThemeProvider><FullScreenFrame model={model} messages={messages} rows={24} columns={100} footer={<Box flexDirection="column"><Text>status</Text><Text>ruler</Text><Text>❯ draft</Text><Text>ruler</Text><Text>model</Text><Text>hints</Text></Box>} /></ThemeProvider>;
    const view = render(frame()); await flush();
    view.rerender(frame()); await flush();
    const lines = stripAnsi(view.lastFrame() ?? '').split('\n');
    const footerRow = lines.findIndex(line => line.includes('status'));
    expect(footerRow - lines.findIndex(line => line.trimEnd().endsWith('Message 49'))).toBe(3);
  });

  it('does not advertise Escape as a history action while inspecting tool details', async () => {
    const model = new FullScreenTranscript();
    const messages = [{ role: 'tool' as const, content: Array.from({ length: 50 }, (_, i) => `Detail ${i}`).join('\n') }];
    const view = render(<ThemeProvider><FullScreenFrame model={model} messages={messages} detailsId="tool-1" rows={24} columns={100} footer={<Text>❯ draft</Text>} /></ThemeProvider>);
    await flush();
    const line = stripAnsi(view.lastFrame() ?? '').split('\n').find(row => row.includes('Back to bottom'));
    expect(line).toContain('Ctrl+End');
    expect(line).not.toContain('Esc');
  });

  it('never emits a row wider than the terminal while its size props are stale', async () => {
    const theme = new Theme('user-background-test', { ...loadTheme('dark').colors, userMessageBg: '#654321' }, 'truecolor');
    const model = new FullScreenTranscript();
    const view = render(<ThemeProvider theme={theme}><FullScreenFrame model={model} messages={[
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'You are welcome.' },
    ]} rows={24} columns={120} footer={<Text>{'▔'.repeat(119)}</Text>} /></ThemeProvider>);
    await flush();
    const rows = (view.lastFrame() ?? '').split('\n');
    const terminalColumns = view.stdout.columns;
    expect(terminalColumns).toBeLessThan(120);
    expect(rows.map(row => stringWidth(stripAnsi(row)))).toSatisfy((widths: number[]) => widths.every(width => width <= terminalColumns));
    expect(stringWidth(stripAnsi(rows.find(row => row.includes('thanks')) ?? ''))).toBe(terminalColumns - 1);
  });

  it('keeps the composer visible with thousands of transcript rows and a narrow resize', async () => {
    const model = new FullScreenTranscript();
    const messages = [{ role: 'assistant' as const, content: Array.from({ length: 5000 }, (_, i) => `Long output row ${i}`).join('\n\n') }];
    const frame = (rows: number, columns: number) => <ThemeProvider><FullScreenFrame model={model} messages={messages} rows={rows} columns={columns} footer={<Text>❯ preserved draft</Text>} /></ThemeProvider>;
    const view = render(frame(24, 80)); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('❯ preserved draft');
    expect(stripAnsi(view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(24);
    model.scroll(-30, 15);
    view.rerender(frame(20, 60)); await flush();
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('❯ preserved draft');
    expect(stripAnsi(view.lastFrame() ?? '')).toContain('Ctrl+End');
    expect(stripAnsi(view.lastFrame() ?? '').split('\n').length).toBeLessThanOrEqual(20);
    view.unmount();
  });
});
