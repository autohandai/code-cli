/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  getToolCallLabel,
  truncateToolLoopSignature,
} from '../../../src/core/agent/ToolLoopSignature.js';

describe('ToolLoopSignature', () => {
  it('builds stable call signatures independent of call and object key ordering', () => {
    const first = buildToolLoopCallSignature([
      { id: '1', tool: 'git_log', args: { max_count: 1, oneline: true } },
      { id: '2', tool: 'fff_grep', args: { query: 'TODO', path: 'src' } },
    ]);
    const second = buildToolLoopCallSignature([
      { id: '2', tool: 'fff_grep', args: { path: 'src', query: 'TODO' } },
      { id: '1', tool: 'git_log', args: { oneline: true, max_count: 1 } },
    ]);

    expect(first).toBe(second);
  });

  it('normalizes result output for repeated tool-loop detection', () => {
    const signature = buildToolLoopResultSignature([
      {
        tool: 'run_command',
        success: true,
        output: '\u001b[32mhello\u001b[0m\n\nworld',
      },
      {
        tool: 'read_file',
        success: false,
        error: 'missing\n file',
      },
    ]);

    expect(signature).toBe('read_file:err:missing file|run_command:ok:hello world');
  });

  it('extracts useful display labels from tool calls', () => {
    expect(getToolCallLabel({ tool: 'read_file', args: { path: 'src/index.ts' } })).toBe('src/index.ts');
    expect(getToolCallLabel({ tool: 'run_command', args: { command: 'bun', args: ['test'] } })).toBe('bun test');
    expect(getToolCallLabel({ tool: 'fff_grep', args: { query: 'TODO' } })).toBe('TODO');
  });

  it('truncates long signatures with an ellipsis', () => {
    expect(truncateToolLoopSignature('abcdef', 5)).toBe('ab...');
    expect(truncateToolLoopSignature('abc', 5)).toBe('abc');
  });
});
