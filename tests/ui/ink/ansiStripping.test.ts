/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for ANSI escape code stripping in shell command output
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { stripAnsiCodes } from '../../../src/ui/displayUtils.js';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';

describe('stripAnsiCodes', () => {
  it('strips SGR color codes (\\x1b[...m)', () => {
    const input = '\x1b[31mred text\x1b[0m and \x1b[1mbold\x1b[0m';
    expect(stripAnsiCodes(input)).toBe('red text and bold');
  });

  it('strips CSI cursor positioning codes', () => {
    const input = '\x1b[2K\x1b[1Gcursor moved\x1b[0J';
    expect(stripAnsiCodes(input)).toBe('cursor moved');
  });

  it('strips OSC sequences (window title)', () => {
    const input = '\x1b]0;Window Title\x07content';
    expect(stripAnsiCodes(input)).toBe('content');
  });

  it('strips OSC sequences with ST terminator (\\x1b\\\\)', () => {
    const input = '\x1b]2;Title\x1b\\content';
    expect(stripAnsiCodes(input)).toBe('content');
  });

  it('handles PTY-style output with mixed escape sequences', () => {
    // Simulate zsh PTY output with prompt escape sequences
    // Note: the '%' is actual content (zsh prompt), not an escape code
    const input = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m /Users/test\r\n';
    expect(stripAnsiCodes(input)).toBe('% /Users/test\r\n');
  });

  it('handles git status output with color codes', () => {
    const input = '## \x1b[32mmain\x1b[m...\x1b[31morigin/main\x1b[m\n';
    expect(stripAnsiCodes(input)).toBe('## main...origin/main\n');
  });

  it('preserves plain text without escape codes', () => {
    const input = 'Hello world\nThis is plain text';
    expect(stripAnsiCodes(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(stripAnsiCodes('')).toBe('');
  });

  it('handles string with only escape codes', () => {
    expect(stripAnsiCodes('\x1b[31m\x1b[0m')).toBe('');
  });
});

describe('InkRenderer ANSI stripping for shell commands', () => {
  let renderer: InkRenderer;
  let mockOptions: Parameters<typeof InkRenderer.prototype.constructor>[0];

  beforeEach(() => {
    mockOptions = {
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
    };
    renderer = new InkRenderer(mockOptions);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips ANSI codes from live command output chunks before buffering', () => {
    const commandId = renderer.startLiveCommand('! pwd');

    // Simulate PTY output with ANSI escape codes
    renderer.appendLiveCommandOutput(commandId, 'stdout', '\x1b[32m/Users/test\x1b[0m\r\n');

    // The output is buffered in pendingLiveOutput, not yet in state
    // finishLiveCommand will flush it and create the ToolOutputEntry
    // For now, verify that when finishLiveCommand is called,
    // the output in the ToolOutputEntry is clean

    renderer.finishLiveCommand(commandId, true);

    const state = renderer.getState();
    const toolOutput = state.toolOutputs[0];

    expect(toolOutput).toBeDefined();
    expect(toolOutput.output).toContain('/Users/test');
    expect(toolOutput.output).not.toContain('\x1b[');
  });

  it('strips ANSI codes from stderr chunks', () => {
    const commandId = renderer.startLiveCommand('! ls');

    renderer.appendLiveCommandOutput(commandId, 'stderr', '\x1b[31merror: file not found\x1b[0m');

    renderer.finishLiveCommand(commandId, false);

    const state = renderer.getState();
    const toolOutput = state.toolOutputs[0];

    expect(toolOutput.output).toContain('error: file not found');
    expect(toolOutput.output).not.toContain('\x1b[');
  });

  it('strips ANSI codes when finishing live command with mixed output', () => {
    const commandId = renderer.startLiveCommand('! git status');

    // Add output with ANSI codes
    renderer.appendLiveCommandOutput(commandId, 'stdout', '\x1b[32mmain\x1b[0m branch\n');
    renderer.appendLiveCommandOutput(commandId, 'stderr', '\x1b[31mwarning\x1b[0m: something');

    renderer.finishLiveCommand(commandId, true);

    const state = renderer.getState();
    const toolOutput = state.toolOutputs[0];

    // Verify ANSI codes are stripped from the combined output
    expect(toolOutput.output).toContain('main branch');
    expect(toolOutput.output).toContain('warning: something');
    expect(toolOutput.output).not.toContain('\x1b[');
  });

  it('creates clean ToolOutputEntry without ANSI codes', () => {
    const commandId = renderer.startLiveCommand('! echo test');

    // Simulate output with ANSI codes
    renderer.appendLiveCommandOutput(commandId, 'stdout', '\x1b[1mbold\x1b[0m text\n');

    renderer.finishLiveCommand(commandId, true);

    const state = renderer.getState();
    const toolOutput = state.toolOutputs[0];

    expect(toolOutput.output).toContain('bold text');
    expect(toolOutput.output).not.toContain('\x1b[');
  });
});

describe('Shell command output display', () => {
  it('should display clean output when PTY produces escape codes', () => {
    // This is an integration-style test that documents the expected behavior
    // When a user types "! pwd" and the shell produces ANSI codes,
    // the output should be stripped and displayed cleanly

    const ptyOutput = '\x1b[1m\x1b[7m%\x1b[27m\x1b[1m\x1b[0m /Users/igorcosta/Documents/autohand/cli-3\r\n';
    const cleaned = stripAnsiCodes(ptyOutput);

    // Should show the path without escape codes
    expect(cleaned).toContain('/Users/igorcosta/Documents/autohand/cli-3');
    expect(cleaned).not.toContain('\x1b[');
    expect(cleaned).not.toContain('\x1b]');
  });

  it('should handle common shell command outputs', () => {
    // Test various common shell outputs that might have ANSI codes

    // Git status with colors
    const gitStatus = '## \x1b[32mmain\x1b[m...\x1b[31morigin/main\x1b[m [ahead \x1b[32m1\x1b[m]\n';
    expect(stripAnsiCodes(gitStatus)).toBe('## main...origin/main [ahead 1]\n');

    // ls with colors
    const lsOutput = '\x1b[34mdirname\x1b[0m  \x1b[32mscript.sh\x1b[0m  file.txt\n';
    expect(stripAnsiCodes(lsOutput)).toBe('dirname  script.sh  file.txt\n');

    // grep with colors
    const grepOutput = '\x1b[01;31m\x1b[Kmatch\x1b[m\x1b[K found\n';
    expect(stripAnsiCodes(grepOutput)).toBe('match found\n');
  });
});
