/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { TerminalRegions } from '../../src/ui/terminalRegions.js';
import { Theme, setTheme } from '../../src/ui/theme/Theme.js';
import type { ResolvedColors } from '../../src/ui/theme/types.js';
import { COLOR_TOKENS } from '../../src/ui/theme/types.js';
import { getPlanModeManager } from '../../src/commands/plan.js';

function createMockOutput() {
  const output = new EventEmitter() as NodeJS.WriteStream & {
    rows: number;
    columns: number;
    isTTY: boolean;
    writes: string[];
  };
  output.rows = 24;
  output.columns = 80;
  output.isTTY = true;
  output.writes = [];
  output.write = ((chunk: string | Uint8Array) => {
    output.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof output.write;
  return output;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function createMockColors(overrides: Partial<ResolvedColors> = {}): ResolvedColors {
  const base: ResolvedColors = {} as ResolvedColors;
  for (const token of COLOR_TOKENS) {
    base[token] = '#ffffff';
  }
  return { ...base, ...overrides };
}

describe('TerminalRegions', () => {
  beforeEach(() => {
    getPlanModeManager().disable();
  });

  afterEach(() => {
    getPlanModeManager().disable();
  });

  it('renders boxed composer with placeholder when enabled', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);

    regions.enable();

    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('┌');
    expect(plain).toContain('└');
    expect(plain).toContain('❯ Build anything');
    expect(output.writes.join('')).not.toContain('\x1b[1;1H');
  });

  it('renders lazy suggestion text in place of the default placeholder', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);

    regions.enable();
    output.writes = [];

    regions.renderFixedRegion('', 0, 'status', '', 'Run the test suite');

    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('❯ Run the test suite');
    expect(plain).not.toContain('❯ Build anything');
  });

  it('updates input inside the boxed composer line', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateInput('queue this');

    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('❯ queue this');
    // Column = 1 (border) + 2 (prefix "❯ ") + 10 (input "queue this") = 13
    expect(output.writes.join('')).toContain('\x1b[22;13H');
  });

  it('updates status and appends queue count when not already present', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateStatus('74% context left', 2);
    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('74% context left');
    expect(plain).toContain('2 queued');
  });

  it('does not duplicate queued suffix when status already includes queued', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateStatus('74% context left · 2 queued', 2);
    const plain = stripAnsi(output.writes.join(''));
    expect((plain.match(/queued/g) ?? []).length).toBe(1);
  });

  it('applies theme colors to placeholder prefix and status line', () => {
    const theme = new Theme(
      'test',
      createMockColors({
        accent: '#336699',
        muted: '#123456',
        border: '#556677',
        borderAccent: '#aa5500',
      }),
      'truecolor'
    );
    setTheme(theme);

    try {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      regions.renderFixedRegion('', 0, '91% context left');
      regions.updateInput('hello');
      const joined = output.writes.join('');

      expect(joined).toContain('\x1b[38;2;170;85;0m'); // borderAccent
      expect(joined).toContain('\x1b[38;2;51;102;153m'); // accent prefix for non-empty input
      expect(joined).toContain('\x1b[38;2;18;52;86m'); // muted status/placeholder
    } finally {
      setTheme(null as unknown as Theme);
    }
  });

  it('disable clears fixed lines and moves cursor to scroll region end', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.disable();
    const joined = output.writes.join('');

    // Should save/restore cursor while clearing fixed lines
    expect(joined).toContain('\x1b[s');
    expect(joined).toContain('\x1b[u');
    // Should move cursor to the last scroll region row (row 19 for 24-row terminal)
    // so subsequent output continues after the agent's last printed line
    expect(joined).toContain('\x1b[19;1H');
  });

  it('updates activity line above the composer', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateActivity('Working... (esc to interrupt · 0m 01s · 1.2k tokens)');

    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('Working...');
  });

  it('writeAbove anchors output at scroll bottom without restoring stale cursor', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.writeAbove('queued message\n');

    const joined = output.writes.join('');
    expect(joined).toContain('\x1b[19;1H');
    // Empty input keeps the cursor visible so the composer still looks editable.
    expect(joined).toContain('\x1b[?25h');
    expect(joined).toContain('\x1b[22;3H');
    expect(joined).not.toContain('\x1b[s');
    expect(joined).not.toContain('\x1b[u');
  });

  it('status updates keep cursor anchored to the composer input row', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateStatus('82% context left', 1);

    const joined = output.writes.join('');
    expect(joined).toContain('\x1b[24;1H');
    expect(joined).toContain('\x1b[?25h');
    expect(joined).toContain('\x1b[22;3H');
  });

  it('prefers getWindowSize dimensions when stream rows are stale', () => {
    const output = createMockOutput() as NodeJS.WriteStream & {
      rows: number;
      columns: number;
      getWindowSize?: () => [number, number];
      writes: string[];
    };
    output.rows = 7;
    output.columns = 20;
    output.getWindowSize = () => [100, 40];

    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateInput('x');

    const joined = output.writes.join('');
    expect(joined).toContain('\x1b[38;1H');
    // Column = 1 (border) + 2 (prefix "❯ ") + 1 (input "x") = 4
    expect(joined).toContain('\x1b[38;4H');
  });

  it('uses orange border color when plan mode is enabled', () => {
    const theme = new Theme(
      'test-plan',
      createMockColors({
        borderAccent: '#0055aa',
        warning: '#ff8800',
      }),
      'truecolor'
    );
    setTheme(theme);
    getPlanModeManager().enable();

    try {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      regions.renderFixedRegion('', 0, 'status');
      const joined = output.writes.join('');
      expect(joined).toContain('\x1b[38;2;255;136;0m');
    } finally {
      setTheme(null as unknown as Theme);
      getPlanModeManager().disable();
    }
  });

  describe('handleResize', () => {
    it('uses CSI J (Erase in Display) to clear fixed region instead of row-by-row CSI K', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      // Simulate terminal resize
      output.rows = 30;
      output.columns = 100;
      output.emit('resize');

      const joined = output.writes.join('');
      // Should contain CSI J (Erase in Display from cursor to end)
      expect(joined).toContain('\x1b[J');
    });

    it('updates scroll region with new dimensions after resize', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      // Resize from 24 to 30 rows
      output.rows = 30;
      output.columns = 80;
      output.emit('resize');

      const joined = output.writes.join('');
      // New scroll region: 1 to (30 - 5) = 25
      expect(joined).toContain('\x1b[1;25r');
    });

    it('re-renders fixed region with cached input, status, and activity', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();

      // Set some state that should be preserved across resize
      regions.renderFixedRegion('my input', 2, 'test status', 'Working...');
      output.writes = [];

      // Trigger resize
      output.rows = 30;
      output.columns = 80;
      output.emit('resize');

      const plain = stripAnsi(output.writes.join(''));
      // Should re-render with cached content
      expect(plain).toContain('my input');
      expect(plain).toContain('test status');
      expect(plain).toContain('Working...');
    });
  });

  it('uses shell colors when input starts with ! even in plan mode', () => {
    const theme = new Theme(
      'test-shell',
      createMockColors({
        dim: '#c0c0c0',
        warning: '#ff8800',
      }),
      'truecolor'
    );
    setTheme(theme);
    getPlanModeManager().enable();

    try {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      regions.updateInput('! git status');
      const joined = output.writes.join('');
      expect(joined).toContain('\x1b[48;2;255;255;255m');
      expect(joined).toContain('\x1b[38;2;0;0;0m');
      expect(joined).not.toContain('\x1b[38;2;255;136;0m');
    } finally {
      setTheme(null as unknown as Theme);
      getPlanModeManager().disable();
    }
  });

  describe('dynamic fixed region height (multi-line input)', () => {
    it('increases fixedLines for multi-line input', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      // Default is 5 fixed lines (activity + top border + 1 input + bottom border + status)
      expect(regions.getFixedLines()).toBe(5);

      // Render with 3-line input
      regions.renderFixedRegion('line1\nline2\nline3', 0, 'status');

      // Should now be 7 fixed lines (activity + top + 3 input + bottom + status)
      expect(regions.getFixedLines()).toBe(7);
    });

    it('reverts to default fixedLines when input returns to single line', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();

      // Multi-line
      regions.renderFixedRegion('line1\nline2\nline3', 0, 'status');
      expect(regions.getFixedLines()).toBe(7);

      output.writes = [];

      // Back to single-line
      regions.renderFixedRegion('single line', 0, 'status');
      expect(regions.getFixedLines()).toBe(5);
    });

    it('renders large pasted drafts as a single compact indicator line', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      // Large pastes collapse to a compact indicator instead of expanding the prompt.
      const tenLines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
      regions.renderFixedRegion(tenLines, 0, 'status');

      expect(regions.getFixedLines()).toBe(5);
      expect(output.writes.join('')).toContain('[Text pasted: 10 lines]');
    });

    it('renders all visible input lines with border decoration', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      regions.renderFixedRegion('alpha\nbeta', 0, 'status');

      const plain = stripAnsi(output.writes.join(''));
      expect(plain).toContain('alpha');
      expect(plain).toContain('beta');
      // Should have both top and bottom borders
      expect(plain).toContain('┌');
      expect(plain).toContain('└');
    });

    it('updateInput also adjusts fixedLines for multi-line content', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      regions.updateInput('line1\nline2');

      // Should adjust to 6 lines (activity + top + 2 input + bottom + status)
      expect(regions.getFixedLines()).toBe(6);

      const plain = stripAnsi(output.writes.join(''));
      expect(plain).toContain('line1');
      expect(plain).toContain('line2');
    });

    it('re-sets scroll region when fixedLines changes', () => {
      const output = createMockOutput();
      const regions = new TerminalRegions(output);
      regions.enable();
      output.writes = [];

      // Switch from 1-line (5 fixed) to 3-line (7 fixed)
      regions.renderFixedRegion('a\nb\nc', 0, 'status');

      const joined = output.writes.join('');
      // Scroll region should be 1 to (24 - 7) = 17
      expect(joined).toContain('\x1b[1;17r');
    });
  });
});
