/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { COMPACT_LINE_CHARS, COMPACT_PREVIEW_LINES, formatToolOutputForDisplay, hiddenLineCount } from '../src/ui/toolOutput.js';

describe('formatToolOutputForDisplay', () => {
  it('shows file summary for read_file with path', () => {
    const content = 'line 1\nline 2\nline 3';
    const result = formatToolOutputForDisplay({
      tool: 'read_file',
      content,
      charLimit: 4,
      filePath: '/project/src/index.ts'
    });

    expect(result.truncated).toBe(false);
    expect(result.output).toContain('src/index.ts');
    expect(result.output).toContain('3 lines');
  });

  it('preserves write_file diff output instead of collapsing to a file summary', () => {
    const content = '  Added 1 line, removed 0 lines\n  1 + const x = 1;';
    const result = formatToolOutputForDisplay({
      tool: 'write_file',
      content,
      charLimit: 4,
      filePath: '/project/utils/helper.js'
    });

    expect(result.truncated).toBe(false);
    expect(result.output).toBe(content);
  });

  it('preserves search_replace diff output instead of collapsing to a file summary', () => {
    const content = '  Added 1 line, removed 1 line\n  3 - old\n  3 + new';
    const result = formatToolOutputForDisplay({
      tool: 'search_replace',
      content,
      charLimit: 4,
      filePath: '/project/utils/helper.js'
    });

    expect(result.truncated).toBe(false);
    expect(result.output).toBe(content);
  });

  it('truncates search output', () => {
    const content = 'abcdefghij';
    const result = formatToolOutputForDisplay({
      tool: 'find',
      content,
      charLimit: 4
    });

    expect(result.truncated).toBe(true);
    expect(result.output).toBe('abcd\n... (truncated, 10 total characters)');
  });

  it('shows full content for other tools', () => {
    const content = 'abcdefghij';
    const result = formatToolOutputForDisplay({
      tool: 'git_status',
      content,
      charLimit: 4
    });

    expect(result.truncated).toBe(false);
    expect(result.output).toBe(content);
  });

  it('shows command for run_command', () => {
    const content = 'v20.10.0';
    const result = formatToolOutputForDisplay({
      tool: 'run_command',
      content,
      charLimit: 300,
      command: 'node',
      commandArgs: ['--version']
    });

    expect(result.output).toContain('$ node --version');
    expect(result.output).toContain('v20.10.0');
  });

  it('shows command without args for run_command', () => {
    const content = 'main\n* feature-branch';
    const result = formatToolOutputForDisplay({
      tool: 'run_command',
      content,
      charLimit: 300,
      command: 'git branch'
    });

    expect(result.output).toContain('$ git branch');
    expect(result.output).toContain('main');
  });

  it('keeps a background PID visible when command output is truncated', () => {
    const result = formatToolOutputForDisplay({
      tool: 'shell',
      content: `${'long command output '.repeat(20)}\n[Background PID: 4242]`,
      charLimit: 80,
      command: 'node server.js',
    });

    expect(result.truncated).toBe(true);
    expect(result.output).toMatch(/\.\.\. \(\d+ chars\)/);
    expect(result.output).toContain('[Background PID: 4242]');
  });

  it('renders ask_followup_question answers without raw XML tags', () => {
    const result = formatToolOutputForDisplay({
      tool: 'ask_followup_question',
      content: '<answer>Review the current uncommitted changes</answer>',
      charLimit: 300,
    });

    expect(result.output).toBe('Answer: Review the current uncommitted changes');
    expect(result.output).not.toContain('<answer>');
    expect(result.output).not.toContain('</answer>');
  });

  // ── tools_registry summary formatting ──────────────────────────────

  describe('tools_registry', () => {
    it('shows tool count summary instead of raw JSON', () => {
      const tools = [
        { name: 'read_file', description: 'Read a file', source: 'builtin' },
        { name: 'write_file', description: 'Write a file', source: 'builtin' },
        { name: 'custom_tool', description: 'A meta tool', source: 'meta' },
      ];
      const result = formatToolOutputForDisplay({
        tool: 'tools_registry',
        content: JSON.stringify(tools, null, 2),
        charLimit: 300,
      });

      // Should NOT contain raw JSON fields
      expect(result.output).not.toContain('"source"');
      expect(result.output).not.toContain('"builtin"');
      // Should contain a human-readable summary
      expect(result.output).toContain('3 tools');
      expect(result.output).toContain('2 builtin');
      expect(result.output).toContain('1 meta');
      expect(result.expandedOutput).toBe(JSON.stringify(tools, null, 2));
    });

    it('handles empty tools array gracefully', () => {
      const result = formatToolOutputForDisplay({
        tool: 'tools_registry',
        content: '[]',
        charLimit: 300,
      });

      expect(result.output).toContain('0 tools');
      expect(result.output).not.toContain('"source"');
    });

    it('handles all-builtin tools', () => {
      const tools = [
        { name: 'read_file', description: 'Read a file', source: 'builtin' },
        { name: 'write_file', description: 'Write a file', source: 'builtin' },
      ];
      const result = formatToolOutputForDisplay({
        tool: 'tools_registry',
        content: JSON.stringify(tools),
        charLimit: 300,
      });

      expect(result.output).toContain('2 tools');
      expect(result.output).toContain('2 builtin');
    });

    it('falls back to truncated content on malformed JSON', () => {
      const result = formatToolOutputForDisplay({
        tool: 'tools_registry',
        content: 'not valid json {{{',
        charLimit: 300,
      });

      // Should not throw, should fall through to default or show truncated
      expect(result.output).toBeTruthy();
    });

    it('does NOT show tool descriptions in the summary', () => {
      const tools = [
        { name: 'read_file', description: 'Read contents of a file from disk', source: 'builtin' },
      ];
      const result = formatToolOutputForDisplay({
        tool: 'tools_registry',
        content: JSON.stringify(tools),
        charLimit: 300,
      });

      // Descriptions are internal — should not leak to TUI
      expect(result.output).not.toContain('Read contents of a file from disk');
    });
  });

  describe('tool_search', () => {
    it('shows a compact result summary and preserves the full result for expansion', () => {
      const tools = [
        { name: 'mcp__cua-driver__list_apps', description: 'List native applications', source: 'builtin' },
        { name: 'mcp__cua-driver__list_windows', description: 'List native windows', source: 'builtin' },
      ];
      const raw = JSON.stringify(tools, null, 2);

      const result = formatToolOutputForDisplay({
        tool: 'tool_search',
        content: raw,
        charLimit: 300,
      });

      expect(result.output).toBe('2 matching tools');
      expect(result.output).not.toContain('description');
      expect(result.expandedOutput).toBe(raw);
    });

    it('bounds retained expansion details for long-running sessions', () => {
      const raw = JSON.stringify([{
        name: 'large_tool',
        description: 'x'.repeat(70 * 1024),
        source: 'builtin',
      }]);

      const result = formatToolOutputForDisplay({
        tool: 'tool_search',
        content: raw,
        charLimit: 300,
      });

      expect(result.expandedOutput?.length).toBeLessThanOrEqual(64 * 1024);
      expect(result.expandedOutput).toContain('details truncated');
      expect(result.expandedOutput).toContain(`${raw.length} total characters`);
    });
  });
});

describe('compact tool output', () => {
  it('retains a complete syntax-colored diff line when its visible text fits', () => {
    const plain = '    1 + const newValue = true;';
    const content = [...plain].map(char => `\x1b[38;2;134;207;163m${char}\x1b[39m`).join('');
    const result = formatToolOutputForDisplay({ tool: 'apply_patch', content, charLimit: 300, mode: 'compact' });

    expect(result.output).toBe(content);
    expect(stripVTControlCharacters(result.output)).toBe(plain);
    expect(result.truncated).toBe(false);
  });

  it('clips visible cells without splitting ANSI color sequences', () => {
    const content = Array.from({ length: 200 }, () => '\x1b[31mx\x1b[39m').join('');
    const result = formatToolOutputForDisplay({ tool: 'shell', content, charLimit: 300, mode: 'compact' });

    expect(stripVTControlCharacters(result.output)).toBe(`${'x'.repeat(COMPACT_LINE_CHARS - 1)}…`);
    expect(result.expandedOutput).toBe(content);
  });

  const lines = (count: number, prefix = 'line') => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n');
  const compact = (options: Partial<Parameters<typeof formatToolOutputForDisplay>[0]> & { tool: string; content: string }) =>
    formatToolOutputForDisplay({ charLimit: 300, mode: 'compact', ...options } as Parameters<typeof formatToolOutputForDisplay>[0]);

  it('shows the first lines of a long fetch_url result and keeps the rest for expansion', () => {
    const content = lines(83);

    const result = compact({ tool: 'fetch_url', content });

    expect(result.output).toBe('line 1\nline 2\nline 3');
    expect(result.output.split('\n')).toHaveLength(COMPACT_PREVIEW_LINES);
    expect(result.expandedOutput).toBe(content);
    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(content.length);
  });

  it('leaves a short result alone and offers nothing to expand', () => {
    const result = compact({ tool: 'fetch_url', content: 'line 1\nline 2\nline 3' });

    expect(result.output).toBe('line 1\nline 2\nline 3');
    expect(result.expandedOutput).toBeUndefined();
    expect(result.truncated).toBe(false);
  });

  it('clips a page that arrives as one enormous line', () => {
    const content = 'x'.repeat(30_000);

    const result = compact({ tool: 'fetch_url', content });

    expect(result.output.length).toBeLessThanOrEqual(COMPACT_LINE_CHARS);
    expect(result.output.endsWith('…')).toBe(true);
    expect(result.expandedOutput).toBe(content);
  });

  it('skips leading blank lines so the preview is not empty', () => {
    const result = compact({ tool: 'web_search', content: `\n\n${lines(10)}` });

    expect(result.output).toBe('line 1\nline 2\nline 3');
  });

  it('shows a command once, then the first lines of its output', () => {
    const content = `$ sed -n 447,497p http.ts\n${lines(83, 'row')}`;

    const result = compact({ tool: 'run_command', content, command: 'sed', commandArgs: ['-n', '447,497p', 'http.ts'] });

    expect(result.output).toBe('$ sed -n 447,497p http.ts\nrow 1\nrow 2\nrow 3');
    expect(result.output.match(/\$ sed/gu)).toHaveLength(1);
    expect(result.expandedOutput).toBe(content);
  });

  it('keeps the background PID visible when it falls outside the preview', () => {
    const content = `$ bun dev\n${lines(40)}\n[Background PID: 4242]`;

    const result = compact({ tool: 'run_command', content, command: 'bun', commandArgs: ['dev'] });

    expect(result.output).toBe('$ bun dev\nline 1\nline 2\nline 3\n[Background PID: 4242]');
  });

  it('shows only the command when it printed nothing', () => {
    const result = compact({ tool: 'shell', content: '$ true', command: 'true' });

    expect(result.output).toBe('$ true');
    expect(result.expandedOutput).toBeUndefined();
  });

  it('previews the end of a failure, where the error is', () => {
    const content = lines(60, 'trace');

    const result = compact({ tool: 'run_command', content, failed: true });

    expect(result.output).toBe('trace 56\ntrace 57\ntrace 58\ntrace 59\ntrace 60');
    expect(result.expandedOutput).toBe(content);
  });

  it('bounds what is kept for expansion', () => {
    const result = compact({ tool: 'fetch_url', content: lines(40_000) });

    expect(result.expandedOutput!.length).toBeLessThanOrEqual(64 * 1024);
    expect(result.expandedOutput).toContain('details truncated');
  });

  it.each([
    ['read_file', { filePath: 'src/index.ts' }, 'src/index.ts\n  83 lines'],
    ['ask_followup_question', {}, 'Answer:'],
  ] as const)('keeps the dedicated summary of %s', (tool, extra, expected) => {
    const result = compact({ tool, content: tool === 'read_file' ? lines(83) : '<answer>yes</answer>', ...extra });

    expect(result.output).toContain(expected);
    expect(result.expandedOutput).toBeUndefined();
  });

  it.each(['git_diff', 'git_diff_range', 'apply_patch'])('previews a large %s diff and retains details for expansion', (tool) => {
    const content = lines(83, '+ added');

    const result = compact({ tool, content });

    expect(result.output).toBe('+ added 1\n+ added 2\n+ added 3');
    expect(result.expandedOutput).toBe(content);
    expect(result.truncated).toBe(true);
  });

  it.each(['find', 'glob', 'search'])('previews %s results by line, not by a character budget', (tool) => {
    const content = lines(200, 'src/file');

    const result = compact({ tool, content });

    expect(result.output).toBe('src/file 1\nsrc/file 2\nsrc/file 3');
    expect(result.expandedOutput).toBe(content);
  });

  it('is off unless asked for: existing callers keep the full output', () => {
    const content = lines(83);

    expect(formatToolOutputForDisplay({ tool: 'fetch_url', content, charLimit: 300 }).output).toBe(content);
    expect(formatToolOutputForDisplay({ tool: 'fetch_url', content, charLimit: 300, mode: 'full' }).output).toBe(content);
  });
});

describe('hiddenLineCount', () => {
  it('counts the lines a head preview leaves out', () => {
    const expanded = Array.from({ length: 83 }, (_, index) => `line ${index + 1}`).join('\n');

    expect(hiddenLineCount('line 1\nline 2\nline 3', expanded)).toBe(80);
  });

  it('counts the lines a tail preview leaves out', () => {
    const expanded = Array.from({ length: 60 }, (_, index) => `trace ${index + 1}`).join('\n');

    expect(hiddenLineCount('trace 58\ntrace 59\ntrace 60', expanded)).toBe(57);
  });

  it('accounts for a command header and a background PID line', () => {
    const expanded = `$ bun dev\n${Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')}\n[Background PID: 7]`;

    expect(hiddenLineCount('$ bun dev\nline 1\nline 2\nline 3\n[Background PID: 7]', expanded)).toBe(37);
  });

  it.each([
    ['a summary that is not part of the detail', '1 matching tool', '[\n  {"name":"read_file"}\n]'],
    ['a clipped line', `${'x'.repeat(159)}…`, 'x'.repeat(30_000)],
    ['identical text', 'a\nb', 'a\nb'],
    ['an empty preview', '', 'a\nb\nc'],
  ])('returns 0 for %s', (_name, shown, expanded) => {
    expect(hiddenLineCount(shown, expanded)).toBe(0);
  });
});

describe('run_tool_script result', () => {
  const report = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    ok: true,
    result: { scanned: 200, withTodo: ['src/a.ts', 'src/b.ts'] },
    logs: 'scanned 200 files',
    calls: { total: 201, failed: 1, byTool: { find: 1, read_file: 200 } },
    durationMs: 1840,
    ...overrides,
  }, null, 2);

  it('leads with what the script did, then what it returned', () => {
    const result = formatToolOutputForDisplay({ tool: 'run_tool_script', content: report(), charLimit: 300, mode: 'compact' });
    const [header, ...rest] = result.output.split('\n');

    expect(header).toBe('201 tool calls (read_file ×200, find ×1), 1 failed · 1.8s');
    expect(rest.slice(0, 2)).toEqual(['{', '  "scanned": 200,']);
    expect(rest).toHaveLength(COMPACT_PREVIEW_LINES);
    expect(result.expandedOutput).toContain('"withTodo"');
    expect(result.expandedOutput).toContain('scanned 200 files');
  });

  it('shows a short answer whole, with nothing to expand', () => {
    const result = formatToolOutputForDisplay({
      tool: 'run_tool_script',
      content: report({ result: 42, logs: '', calls: { total: 1, failed: 0, byTool: { read_file: 1 } }, durationMs: 12 }),
      charLimit: 300,
      mode: 'compact',
    });

    expect(result.output).toBe('1 tool call (read_file ×1) · 12ms\n42');
    expect(result.expandedOutput).toBeUndefined();
  });

  it('shows a text answer as text and says when no tool was called', () => {
    const result = formatToolOutputForDisplay({
      tool: 'run_tool_script',
      content: report({ result: 'all good', logs: '', calls: { total: 0, failed: 0, byTool: {} }, durationMs: 3 }),
      charLimit: 300,
      mode: 'full',
    });

    expect(result.output).toBe('no tool calls · 3ms\nall good');
  });

  it('prints everything, logs included, in full mode', () => {
    const result = formatToolOutputForDisplay({ tool: 'run_tool_script', content: report(), charLimit: 300, mode: 'full' });

    expect(result.output).toContain('"src/b.ts"');
    expect(result.output).toContain('Logs:\nscanned 200 files');
    expect(result.expandedOutput).toBeUndefined();
  });

  it('falls back to the raw text when the result is not the expected report', () => {
    const result = formatToolOutputForDisplay({ tool: 'run_tool_script', content: 'not json', charLimit: 300, mode: 'compact' });

    expect(result.output).toBe('not json');
  });
});
