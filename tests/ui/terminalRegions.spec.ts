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

  it('updates input inside the boxed composer line', () => {
    const output = createMockOutput();
    const regions = new TerminalRegions(output);
    regions.enable();
    output.writes = [];

    regions.updateInput('queue this');

    const plain = stripAnsi(output.writes.join(''));
    expect(plain).toContain('│');
    expect(plain).toContain('❯ queue this');
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
    expect(joined).toContain('\x1b[20;1H');
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

  it('uses light gray border color when input starts with ! even in plan mode', () => {
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
      expect(joined).toContain('\x1b[38;2;192;192;192m');
      expect(joined).not.toContain('\x1b[38;2;255;136;0m');
    } finally {
      setTheme(null as unknown as Theme);
      getPlanModeManager().disable();
    }
  });
});
