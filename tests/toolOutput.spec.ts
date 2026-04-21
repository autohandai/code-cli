/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { formatToolOutputForDisplay } from '../src/ui/toolOutput.js';

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
});
