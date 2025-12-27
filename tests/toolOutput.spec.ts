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

  it('shows file summary for write_file with path', () => {
    const content = 'const x = 1;';
    const result = formatToolOutputForDisplay({
      tool: 'write_file',
      content,
      charLimit: 4,
      filePath: '/project/utils/helper.js'
    });

    expect(result.truncated).toBe(false);
    expect(result.output).toContain('utils/helper.js');
    expect(result.output).toContain('1 lines');
  });

  it('truncates search output', () => {
    const content = 'abcdefghij';
    const result = formatToolOutputForDisplay({
      tool: 'search',
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
});
