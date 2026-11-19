import { describe, expect, it } from 'vitest';
import { FullScreenTranscript } from '../../../src/ui/ink/fullScreenTranscript.js';
import type { ChatLogMessage } from '../../../src/session/chatLog.js';

const messages: ChatLogMessage[] = Array.from({ length: 100 }, (_, i) => ({ role: 'assistant', content: `Message ${i} with enough words to wrap on narrow terminals.` }));

describe('full-screen transcript viewport', () => {
  it('finds a phrase across soft wraps at different terminal widths', () => {
    const model = new FullScreenTranscript();
    const content = 'Earlier context: i dont think this is working while the investigation continues.';
    for (const width of [24, 40, 80]) {
      model.update([{ role: 'user', content }, ...messages], width);
      expect(model.search('i dont think this is working', 8)).toBe(true);
      expect(model.view(8).rows.some(row => row.role === 'user')).toBe(true);
    }
  });

  it('keeps a search result anchored while the first streamed message grows', () => {
    const model = new FullScreenTranscript();
    const content = ['Search target', ...Array.from({ length: 40 }, (_, i) => `Stream row ${i}`)].join('\n');
    model.update([{ role: 'assistant', content }], 60);
    expect(model.search('Search target', 8)).toBe(true);
    const before = model.view(8).lines;
    model.update([{ role: 'assistant', content: `${content}\nMore streaming output` }], 60);
    expect(model.view(8).lines).toEqual(before);
    expect(model.view(8).following).toBe(false);
  });

  it('treats punctuation literally and finds Unicode and hard-wrapped words', () => {
    const model = new FullScreenTranscript();
    model.update([{ role: 'user', content: '🦉 literal [target].*+? regex averylongidentifierwithoutspaces café' }, ...messages], 12);
    expect(model.search('[target].*+?', 8)).toBe(true);
    expect(model.search('averylongidentifierwithoutspaces', 8)).toBe(true);
    expect(model.search('CAFÉ', 8)).toBe(true);
    expect(model.search('target.*', 8)).toBe(false);
  });

  it('does not match a phrase across separate messages', () => {
    const model = new FullScreenTranscript();
    model.update([{ role: 'user', content: 'first half' }, { role: 'assistant', content: 'second half' }], 24);
    expect(model.search('half second', 8)).toBe(false);
  });

  it('refreshes the selected occurrence through resize and new output without advancing it', () => {
    const model = new FullScreenTranscript();
    const key = (flags: object) => flags as Parameters<typeof model.handleKey>[1];
    model.update(messages, 60);
    model.view(8);
    model.handleKey('f', key({ ctrl: true }));
    model.handleKey('Message', key({}));
    model.handleKey('', key({ return: true }));
    model.update([...messages, { role: 'assistant', content: 'Message 100 just arrived' }], 24);
    expect(model.view(8).lines[0]).toContain('Message 1 ');
    model.handleKey('missing', key({}));
    expect(model.searchMatched).toBe(false);
    for (let index = 0; index < 'missing'.length; index++) model.handleKey('', key({ backspace: true }));
    expect(model.searchMatched).toBe(true);
    expect(model.view(8).lines[0]).toContain('Message 0 ');
    for (let index = 0; index < 'Message'.length; index++) model.handleKey('', key({ backspace: true }));
    expect(model.searchQuery).toBe('');
    expect(model.searchMatched).toBe(true);
  });

  it('opens the selected live details even when later messages follow them', () => {
    const model = new FullScreenTranscript();
    const details = { role: 'tool_call' as const, tool: 'live command', detailsId: 'live-output', content: Array.from({ length: 30 }, (_, i) => `live-detail-${i}`).join('\n') };
    model.update([...messages, details, { role: 'notification', content: 'Later notification' }], 60);
    model.focusDetails('live-output');
    expect(model.view(8).lines.join('\n')).toContain('live-detail-0\n');
  });

  it('preserves terminal rows using the current chat-log formatting flag', () => {
    const model = new FullScreenTranscript();
    const content = 'first row  \n    second row\ncolumn A    column B';
    model.update([{ role: 'assistant', content, renderMarkdown: false }], 80);
    expect(model.view(20).lines.slice(0, -1).join('\n')).toBe(content);
  });

  it('marks new output while reading and returns to the tail without consuming interruption at the tail', () => {
    const model = new FullScreenTranscript();
    const key = (flags: object) => flags as Parameters<typeof model.handleKey>[1];
    model.update(messages, 60);
    model.view(8);
    expect(model.handleKey('', key({ ctrl: true, home: true }))).toBe(true);
    expect(model.view(8).lines.join('\n')).toContain('Message 0');
    expect(model.view(8).newActivity).toBe(false);
    model.update([...messages, { role: 'assistant', content: 'New activity arrived' }], 60);
    expect(model.view(8).newActivity).toBe(true);
    expect(model.view(8).lines.join('\n')).not.toContain('New activity arrived');
    expect(model.handleKey('', key({ escape: true }))).toBe(true);
    expect(model.view(8).newActivity).toBe(false);
    expect(model.view(8).lines.join('\n')).toContain('New activity arrived');
    expect(model.handleKey('', key({ escape: true }))).toBe(false);
  });

  it('searches backwards and wraps while preserving the composer key boundary', () => {
    const model = new FullScreenTranscript();
    const key = (flags: object) => flags as Parameters<typeof model.handleKey>[1];
    model.update(messages, 60);
    model.view(8);
    model.handleKey('f', key({ ctrl: true }));
    model.handleKey('Message', key({}));
    expect(model.view(8).lines.join('\n')).toContain('Message 0');
    model.handleKey('', key({ return: true }));
    expect(model.view(8).lines.join('\n')).toContain('Message 1');
    model.handleKey('', key({ return: true, shift: true }));
    expect(model.view(8).lines.join('\n')).toContain('Message 0');
    model.handleKey('', key({ return: true, shift: true }));
    expect(model.view(8).lines.join('\n')).toContain('Message 99');
    model.handleKey('', key({ escape: true }));
    expect(model.searchQuery).toBeNull();
    expect(model.handleKey('draft', key({}))).toBe(false);
  });

  it('renders a bounded tail and preserves the reading anchor when output arrives', () => {
    const model = new FullScreenTranscript();
    model.update(messages, 60);
    expect(model.view(8).lines).toHaveLength(8);
    expect(model.view(8).lines.join('\n')).toContain('Message 99');
    model.scroll(-12, 8);
    const before = model.view(8).lines;
    model.update([...messages, { role: 'assistant', content: 'new streamed answer' }], 60);
    expect(model.view(8).lines).toEqual(before);
    expect(model.view(8).following).toBe(false);
    model.follow();
    expect(model.view(8).lines.join('\n')).toContain('new streamed answer');
  });

  it('opens expanded details at their start and retains their reading position', () => {
    const model = new FullScreenTranscript();
    model.update([...messages, { role: 'tool', content: Array.from({ length: 100 }, (_, i) => `detail ${i}`).join('\n') }], 60);
    model.focusDetails('tool-1');
    expect(model.view(8).lines.join('\n')).toContain('detail 0');
    model.page(1);
    const page = model.view(8).lines;
    model.focusDetails('tool-1');
    expect(model.view(8).lines).toEqual(page);
    model.focusDetails(undefined);
    expect(model.view(8).following).toBe(true);
  });

  it('keeps the anchored message on resize, searches history and resets when history is replaced', () => {
    const model = new FullScreenTranscript();
    model.update(messages, 60);
    expect(model.search('Message 40', 6)).toBe(true);
    expect(model.view(6).lines.join('\n')).toContain('Message 40');
    model.update(messages, 24);
    expect(model.view(6).lines.join('\n')).toContain('Message 40');
    expect(model.search('absent value', 6)).toBe(false);
    model.update([{ role: 'user', content: 'New session' }], 24);
    expect(model.view(6).lines.join('\n')).toContain('New session');
    expect(model.view(6).following).toBe(true);
  });
});

describe('full-screen transcript tool results', () => {
  it('marks a tool the user interrupted differently from one that failed', () => {
    const model = new FullScreenTranscript();
    model.update([
      { role: 'tool', tool: 'read_file', success: true, content: 'ok' },
      { role: 'tool', tool: 'write_file', success: false, content: 'permission denied' },
      { role: 'tool', tool: 'run_command', success: false, interrupted: true, content: 'Interrupted' },
    ], 60);
    const lines = model.view(20).lines.map(line => line.replace(/\u001B\[[0-9;]*m/g, ''));
    expect(lines).toContain('✓ read_file');
    expect(lines).toContain('× write_file');
    expect(lines).toContain('⊘ run_command');
    expect(lines).not.toContain('× run_command');
  });
});

describe('full-screen transcript tail when transient rows are removed', () => {
  const history: ChatLogMessage[] = Array.from({ length: 30 }, (_, i) => ({ role: 'notification', content: `History ${i}` }));
  const narration: ChatLogMessage = { role: 'notification', content: 'I need to understand the build.\nLet me read the script.\nThen the workflow.' };
  const call: ChatLogMessage = { role: 'tool_call', tool: 'run_tool_script', content: 'Read build script' };
  const result: ChatLogMessage = { role: 'tool', tool: 'run_tool_script', success: true, content: '1 tool call\ndone' };
  const liveBlock: ChatLogMessage = { role: 'tool_call', tool: 'Running seq', content: 'Ctrl+O expand\nrow-1\nrow-2\nrow-3\nrow-4' };

  it('does not slide history back down when a streamed preview is replaced by its tool call', () => {
    // Recorded on session 446965e5…: the narration preview vanished one frame before the tool
    // rows arrived, so everything above dropped by its height and then jumped back up.
    const model = new FullScreenTranscript();
    const starts: number[] = [];
    for (const frame of [
      [...history, narration],
      history,
      [...history, call],
      [...history, call, liveBlock],
      [...history, call],
      [...history, call, result],
      [...history, call, result, narration],
      [...history, call, result],
    ]) {
      model.update(frame, 60);
      starts.push(model.view(16).start);
    }

    expect(starts).toEqual([...starts].sort((left, right) => left - right));
    expect(model.view(16).following).toBe(true);
  });

  it('leaves the vacated rows blank at the bottom instead of pulling older rows into view', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    const before = model.view(16);
    model.update(history, 60);
    const after = model.view(16);

    expect(after.start).toBe(before.start);
    expect(after.lines).toEqual(before.lines.slice(0, after.lines.length));
    expect(after.lines.length).toBeLessThan(16);
    expect(after.lines.join('\n')).toContain('History 29');
  });

  it('fills the vacated rows with the next output before moving anything', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    const before = model.view(16);
    model.update(history, 60);
    model.update([...history, call], 60);
    const refilled = model.view(16);
    expect(refilled.start).toBe(before.start);
    expect(refilled.lines.join('\n')).toContain('… run_tool_script Read build script');

    model.update([...history, call, result, narration], 60);
    const grown = model.view(16);
    expect(grown.lines).toHaveLength(16);
    expect(grown.start).toBe(grown.total - 16);
  });

  it('lets a growing footer use the vacated rows before it moves the transcript', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    const start = model.view(16).start;
    model.update(history, 60);
    expect(model.view(14).start).toBe(start);
    expect(model.view(10).start).toBe(start + 2);
  });

  it('holds its rows when the footer loses a status row and follows the composer when a menu closes', () => {
    const model = new FullScreenTranscript();
    model.update(history, 60);
    const start = model.view(16).start;
    expect(model.view(17).start).toBe(start);
    expect(model.view(16).start).toBe(start);

    expect(model.view(10).start).toBe(start + 6);
    expect(model.view(16).start).toBe(start);
  });

  it('does not let repeated one-row footer changes push the transcript away from the composer', () => {
    const model = new FullScreenTranscript();
    model.update(history, 60);
    const start = model.view(16).start;
    for (let cycle = 0; cycle < 6; cycle++) {
      model.view(15);
      model.view(16);
    }
    expect(model.view(16).start).toBeLessThanOrEqual(start + 1);
    expect(model.view(16).start).toBeGreaterThanOrEqual(start);
  });

  it('always keeps transcript rows on screen, even when most of it is removed', () => {
    const model = new FullScreenTranscript();
    model.update(history, 60);
    model.view(16);
    model.update(history.slice(0, 3), 60);
    const view = model.view(16);
    expect(view.lines.join('\n')).toContain('History 2');
    expect(view.start).toBeLessThan(view.total);
  });

  it('shows replaced history, a resized transcript and a collapsed details view from their own tail', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    model.view(16);

    model.update(history, 20);
    expect(model.view(16).start).toBe(model.view(16).total - 16);

    model.update([...history, { ...liveBlock, detailsId: 'live-1' }], 20);
    model.focusDetails('live-1');
    model.view(16);
    model.update(history, 20);
    model.focusDetails(undefined);
    expect(model.view(16).start).toBe(model.view(16).total - 16);

    model.update([{ role: 'user', content: 'New session' }], 20);
    expect(model.view(16).lines.join('\n')).toContain('New session');
    expect(model.view(16).start).toBe(0);
  });

  it('keeps wheel scrolling and returning to the tail predictable while rows are held', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    const held = model.view(16).start;
    model.update(history, 60);

    model.scroll(-3, 16);
    expect(model.view(16).start).toBeLessThan(held);
    expect(model.view(16).lines).toHaveLength(16);
    expect(model.view(16).following).toBe(false);
    model.scroll(3, 16);
    expect(model.view(16).following).toBe(true);
    expect(model.view(16).lines).toHaveLength(16);
  });

  it('leaves a reader who scrolled up on the same rows', () => {
    const model = new FullScreenTranscript();
    model.update([...history, narration], 60);
    model.scroll(-10, 16);
    const before = model.view(16).lines;
    model.update(history, 60);
    expect(model.view(16).lines).toEqual(before);
    model.follow();
    expect(model.view(16).start).toBe(model.view(16).total - 16);
  });
});

describe('full-screen transcript selection', () => {
  const plain = (lines: string[]) => lines.map(line => line.replace(/\u001B\[[0-9;]*m/g, ''));
  const setup = () => {
    const model = new FullScreenTranscript();
    model.update([
      { role: 'notification', content: 'alpha beta gamma\ndelta epsilon\nzeta eta theta' },
    ], 40);
    model.view(10);
    return model;
  };

  it('copies a single-line drag from the press cell through the release cell', () => {
    const model = setup();
    model.beginSelection(0, 6);
    model.extendSelection(0, 9);
    expect(model.endSelection()).toBe('beta');
  });

  it('copies across lines in either drag direction and trims trailing padding', () => {
    const model = setup();
    model.beginSelection(2, 3);
    model.extendSelection(0, 11);
    expect(model.endSelection()).toBe('gamma\ndelta epsilon\nzeta');
  });

  it('treats a press and release on the same cell as a click, not a copy', () => {
    const model = setup();
    model.beginSelection(1, 2);
    expect(model.endSelection()).toBeNull();
    expect(model.selectionColumns(1)).toBeNull();
  });

  it('exposes the highlighted columns for each visible row', () => {
    const model = setup();
    model.beginSelection(0, 6);
    model.extendSelection(1, 4);
    expect(model.selectionColumns(0)).toEqual([6, Infinity]);
    expect(model.selectionColumns(1)).toEqual([0, 5]);
    expect(model.selectionColumns(2)).toBeNull();
  });

  it('keeps the selection on the same text after the viewport scrolls', () => {
    const model = new FullScreenTranscript();
    model.update(Array.from({ length: 30 }, (_, i) => ({ role: 'notification' as const, content: `row ${i}` })), 40);
    model.view(4);
    model.scroll(-10, 4);
    const top = plain(model.view(4).lines)[0];
    model.beginSelection(0, 0);
    model.extendSelection(0, 5);
    model.scroll(-2, 4);
    model.view(4);
    expect(model.endSelection()).toBe(top.trimEnd());
  });

  it('slices wide characters by terminal cell', () => {
    const model = new FullScreenTranscript();
    model.update([{ role: 'notification', content: '世界 hello' }], 40);
    model.view(4);
    model.beginSelection(0, 2);
    model.extendSelection(0, 3);
    expect(model.endSelection()).toBe('界');
  });

  it('clamps drags that leave the transcript body', () => {
    const model = setup();
    model.beginSelection(1, 0);
    model.extendSelection(50, 200);
    expect(model.endSelection()).toBe('delta epsilon\nzeta eta theta');
  });

  it('clears the highlight on demand', () => {
    const model = setup();
    model.beginSelection(0, 0);
    model.extendSelection(0, 4);
    model.endSelection();
    model.clearSelection();
    expect(model.selectionColumns(0)).toBeNull();
  });

  it('reports a details id only for rows of an expandable entry', () => {
    const model = new FullScreenTranscript();
    model.update([
      { role: 'assistant', content: 'Plain answer text', renderMarkdown: false },
      { role: 'tool_call', tool: 'Running bun test', detailsId: 'live-1', content: 'Ctrl+O expand\nrunning 12 tests' },
    ], 60);
    const rows = plain(model.view(10).lines);
    const hintRow = rows.findIndex(row => row.includes('Ctrl+O expand'));
    expect(hintRow).toBeGreaterThan(0);
    expect(model.detailsAt(hintRow)).toBe('live-1');
    expect(model.detailsAt(rows.findIndex(row => row.includes('running 12 tests')))).toBe('live-1');
    expect(model.detailsAt(rows.findIndex(row => row.includes('running 12 tests')) + 1)).toBeUndefined();
    expect(model.detailsAt(rows.findIndex(row => row.includes('Plain answer text')))).toBeUndefined();
    expect(model.detailsAt(99)).toBeUndefined();
  });
});
