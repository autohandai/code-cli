/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';

/**
 * Regression test: immediate-command slash/shell output must route through
 * writeAbove() when terminal regions are active (persistentInputActiveTurn).
 *
 * Bug: /repeat (and other slash commands executed from PersistentInput during
 * an active turn) used console.log() directly, which wrote on top of the
 * fixed input region, corrupting the UI.
 *
 * Fix: route through writeAbove() when terminal regions are active.
 */

// Import the routing helper we'll extract from agent.ts
import { routeOutput, renderTerminalMarkdown } from '../../src/core/immediateCommandRouter.js';

describe('immediateCommandRouter — routeOutput', () => {
  let originalConsoleLog: typeof console.log;
  let consoleLogCalls: string[];
  let writeAboveCalls: string[];
  let writeAbove: (text: string) => void;

  beforeEach(() => {
    originalConsoleLog = console.log;
    consoleLogCalls = [];
    writeAboveCalls = [];
    console.log = (...args: any[]) => consoleLogCalls.push(args.join(' '));
    writeAbove = (text: string) => writeAboveCalls.push(text);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    vi.restoreAllMocks();
  });

  it('routes through writeAbove when terminal regions are active', () => {
    routeOutput('Recurring job scheduled!\n  Job ID: abc123', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(writeAboveCalls).toHaveLength(1);
    expect(writeAboveCalls[0]).toContain('Recurring job scheduled!');
    expect(consoleLogCalls).toHaveLength(0);
  });

  it('falls back to console.log when persistentInputActiveTurn is false', () => {
    routeOutput('Recurring job scheduled!\n  Job ID: abc123', {
      persistentInputActiveTurn: false,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    expect(consoleLogCalls[0]).toContain('Recurring job scheduled!');
    expect(writeAboveCalls).toHaveLength(0);
  });

  it('falls back to console.log when terminal regions are disabled', () => {
    routeOutput('Recurring job scheduled!', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: true,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    expect(writeAboveCalls).toHaveLength(0);
  });

  it('handles empty string without crashing', () => {
    routeOutput('', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    // Empty message should still route, not crash
    expect(writeAboveCalls).toHaveLength(1);
    expect(consoleLogCalls).toHaveLength(0);
  });

  it('handles multi-line output (like /repeat confirmation)', () => {
    const multiLine = [
      'Recurring job scheduled!',
      '',
      '  Job ID:      c0e2ed90',
      '  Prompt:      tell me a joke about life',
      '  Cadence:     every 2 minutes',
      '  Cron:        */2 * * * *',
    ].join('\n');

    routeOutput(multiLine, {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(writeAboveCalls).toHaveLength(1);
    expect(writeAboveCalls[0]).toContain('Recurring job scheduled!');
    expect(writeAboveCalls[0]).toContain('c0e2ed90');
    expect(consoleLogCalls).toHaveLength(0);
  });

  it('converts **bold** markdown to terminal bold in output', () => {
    routeOutput('  ● **react-component-architecture** (100%) — Critical for building', {
      persistentInputActiveTurn: false,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    // Raw ** should NOT appear in the output
    expect(consoleLogCalls[0]).not.toContain('**');
    // The text should contain chalk bold ANSI codes
    expect(consoleLogCalls[0]).toContain(chalk.bold('react-component-architecture'));
  });

  it('converts _italic_ markdown to terminal dim in output', () => {
    routeOutput('🟢 **my-skill** _(active)_', {
      persistentInputActiveTurn: false,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(consoleLogCalls).toHaveLength(1);
    expect(consoleLogCalls[0]).not.toContain('**');
    // Underscored text should be rendered, not raw
    expect(consoleLogCalls[0]).not.toMatch(/(?<!\x1b\[[0-9;]*m)_active_/);
  });

  it('converts markdown in writeAbove path too', () => {
    routeOutput('📚 **Skills Library**', {
      persistentInputActiveTurn: true,
      terminalRegionsDisabled: false,
      writeAbove,
    });

    expect(writeAboveCalls).toHaveLength(1);
    expect(writeAboveCalls[0]).not.toContain('**');
    expect(writeAboveCalls[0]).toContain(chalk.bold('Skills Library'));
  });
});

describe('renderTerminalMarkdown', () => {
  it('converts **text** to chalk.bold', () => {
    const result = renderTerminalMarkdown('Hello **world**');
    expect(result).not.toContain('**');
    expect(result).toContain(chalk.bold('world'));
  });

  it('converts multiple **bold** segments in one line', () => {
    const result = renderTerminalMarkdown('**3** skills available, **2** active');
    expect(result).not.toContain('**');
    expect(result).toContain(chalk.bold('3'));
    expect(result).toContain(chalk.bold('2'));
  });

  it('converts _text_ to chalk.italic', () => {
    const result = renderTerminalMarkdown('status _(active)_');
    expect(result).not.toMatch(/_\(active\)_/);
    expect(result).toContain(chalk.italic('(active)'));
  });

  it('handles mixed bold and italic', () => {
    const result = renderTerminalMarkdown('**my-skill** _(active)_');
    expect(result).toContain(chalk.bold('my-skill'));
    expect(result).toContain(chalk.italic('(active)'));
  });

  it('leaves text without markdown unchanged', () => {
    const plain = 'Just some regular text';
    expect(renderTerminalMarkdown(plain)).toBe(plain);
  });

  it('does not convert underscores inside file paths', () => {
    const path = '~/.autohand/skills/my_skill/SKILL.md';
    const result = renderTerminalMarkdown(path);
    // File path underscores should remain untouched
    expect(result).toContain('my_skill');
  });

  it('handles **bold** at start and end of line', () => {
    const result = renderTerminalMarkdown('**Start** and **End**');
    expect(result).not.toContain('**');
    expect(result).toContain(chalk.bold('Start'));
    expect(result).toContain(chalk.bold('End'));
  });

  it('preserves existing chalk formatting', () => {
    const alreadyFormatted = chalk.yellow.bold('Skill Audit');
    const result = renderTerminalMarkdown(alreadyFormatted);
    // Should not break existing chalk output
    expect(result).toBe(alreadyFormatted);
  });

  it('handles empty string', () => {
    expect(renderTerminalMarkdown('')).toBe('');
  });

  it('converts across multiple lines', () => {
    const input = '**Title**\n  ● **item** — description\n  _(note)_';
    const result = renderTerminalMarkdown(input);
    expect(result).not.toContain('**');
    expect(result).toContain(chalk.bold('Title'));
    expect(result).toContain(chalk.bold('item'));
  });
});
