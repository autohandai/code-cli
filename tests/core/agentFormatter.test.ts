/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { formatToolResultsBatch } from '../../src/core/agent/AgentFormatter.js';
import stripAnsi from 'strip-ansi';

describe('formatToolResultsBatch thought display', () => {
  const successResult = { tool: 'read_file' as any, success: true, output: 'file contents here' };

  it('displays thought text before tool results', () => {
    const output = formatToolResultsBatch([successResult], 300, [], 'Analyzing the code structure...');
    expect(output).toContain('Analyzing the code structure...');
  });

  it('no longer filters thoughts that were extracted from JSON', () => {
    // After the fix, thoughts are already extracted from JSON by
    // parseAssistantReactPayload, so they should be displayed even
    // if the original JSON started with {
    const thought = 'The user wants to understand the codebase';
    const output = formatToolResultsBatch([successResult], 300, [], thought);
    expect(output).toContain(thought);
  });

  it('omits thought when null/undefined', () => {
    const output = formatToolResultsBatch([successResult], 300, [], undefined);
    // Should only contain tool output, not any thought line
    expect(output).toContain('read_file');
    expect(output).not.toContain('undefined');
  });
});

describe('formatToolResultsBatch grouped output', () => {
  it('single tool renders flat (no grouping)', () => {
    const results = [
      { tool: 'read_file' as any, success: true, output: 'contents' }
    ];
    const raw = formatToolResultsBatch(results, 300);
    const output = stripAnsi(raw);

    // Should show standard flat format
    expect(output).toContain('✔ read_file');
    // Should NOT show count badge
    expect(output).not.toMatch(/\(\d+\)/);
  });

  it('multiple same-type tools are grouped with count', () => {
    const results = [
      { tool: 'read_file' as any, success: true, output: 'a' },
      { tool: 'read_file' as any, success: true, output: 'b' },
      { tool: 'read_file' as any, success: true, output: 'c' }
    ];
    const calls = [
      { tool: 'read_file', args: { path: 'src/a.ts' } },
      { tool: 'read_file', args: { path: 'src/b.ts' } },
      { tool: 'read_file', args: { path: 'src/c.ts' } }
    ];
    const raw = formatToolResultsBatch(results, 300, calls as any);
    const output = stripAnsi(raw);

    // Group header with count
    expect(output).toContain('read_file');
    expect(output).toContain('(3)');
    // Tree connectors
    expect(output).toContain('├');
    expect(output).toContain('└');
    // Labels from args
    expect(output).toContain('src/a.ts');
    expect(output).toContain('src/b.ts');
    expect(output).toContain('src/c.ts');
  });

  it('mixed tool types create separate groups', () => {
    const results = [
      { tool: 'read_file' as any, success: true, output: 'file content' },
      { tool: 'read_file' as any, success: true, output: 'file content 2' },
      { tool: 'search_files' as any, success: true, output: 'match found' }
    ];
    const calls = [
      { tool: 'read_file', args: { path: 'src/a.ts' } },
      { tool: 'read_file', args: { path: 'src/b.ts' } },
      { tool: 'search_files', args: { query: 'TODO' } }
    ];
    const raw = formatToolResultsBatch(results, 300, calls as any);
    const output = stripAnsi(raw);

    // Two group headers
    expect(output).toContain('read_file');
    expect(output).toContain('(2)');
    expect(output).toContain('search_files');
    // Labels
    expect(output).toContain('src/a.ts');
    expect(output).toContain('TODO');
  });

  it('failed tools show error indicator in group', () => {
    const results = [
      { tool: 'read_file' as any, success: true, output: 'ok' },
      { tool: 'read_file' as any, success: false, error: 'File not found' }
    ];
    const calls = [
      { tool: 'read_file', args: { path: 'src/good.ts' } },
      { tool: 'read_file', args: { path: 'src/missing.ts' } }
    ];
    const raw = formatToolResultsBatch(results, 300, calls as any);
    const output = stripAnsi(raw);

    // Group header should show error icon since not all succeeded
    expect(output).toContain('✖');
    expect(output).toContain('src/missing.ts');
    expect(output).toContain('File not found');
  });

  it('command tools show full command as label', () => {
    const results = [
      { tool: 'run_command' as any, success: true, output: 'output1' },
      { tool: 'run_command' as any, success: true, output: 'output2' }
    ];
    const calls = [
      { tool: 'run_command', args: { command: 'npm', args: ['test'] } },
      { tool: 'run_command', args: { command: 'npm', args: ['run', 'build'] } }
    ];
    const raw = formatToolResultsBatch(results, 300, calls as any);
    const output = stripAnsi(raw);

    expect(output).toContain('npm test');
    expect(output).toContain('npm run build');
  });

  it('collapses groups with more than 4 items', () => {
    const count = 7;
    const results = Array.from({ length: count }, () => ({
      tool: 'read_file' as any, success: true, output: 'content'
    }));
    const calls = Array.from({ length: count }, (_, i) => ({
      tool: 'read_file', args: { path: `src/file${i}.ts` }
    }));
    const raw = formatToolResultsBatch(results, 300, calls as any);
    const output = stripAnsi(raw);

    // Should show count
    expect(output).toContain(`(${count})`);
    // First 4 visible
    expect(output).toContain('src/file0.ts');
    expect(output).toContain('src/file3.ts');
    // Items 5-6 hidden
    expect(output).not.toContain('src/file4.ts');
    // Collapse indicator
    expect(output).toContain('+3 more');
  });
});
