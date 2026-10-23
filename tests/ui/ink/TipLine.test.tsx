/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import chalk from 'chalk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IdleTipRow,
  MIN_IDLE_TIP_WIDTH,
  TipLine,
  fitsIdleTip,
  idleTipWidth,
} from '../../../src/ui/ink/TipLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function frameOf(node: React.ReactElement): string {
  return stripAnsi(render(<ThemeProvider>{node}</ThemeProvider>).lastFrame() ?? '');
}

describe('TipLine', () => {
  it('pins an upgrade hint under the status line with the Plan prefix', () => {
    expect(frameOf(<TipLine tip={{ kind: 'upgrade', text: 'Run /upgrade' }} columns={80} />))
      .toContain('⎿  Plan: Run /upgrade');
  });

  it('never renders a rotating tip under the status line', () => {
    expect(frameOf(<TipLine tip={{ kind: 'tip', text: 'Use /undo' }} columns={80} />)).toBe('');
  });

  it('truncates the upgrade hint to the terminal width', () => {
    const frame = frameOf(<TipLine tip={{ kind: 'upgrade', text: 'x'.repeat(100) }} columns={30} />);
    expect(frame.length).toBeLessThanOrEqual(30);
    expect(frame.endsWith('…')).toBe(true);
  });

  it('renders nothing without a hint', () => {
    expect(frameOf(<TipLine tip={undefined} columns={80} />)).toBe('');
  });
});

describe('idle tip width', () => {
  it('gives a lone tip the full composer width', () => {
    expect(idleTipWidth(80)).toBe(79);
  });

  it('never goes below zero on a narrow terminal', () => {
    expect(idleTipWidth(0)).toBeGreaterThanOrEqual(0);
  });

  it('accepts only whole tips, prefix included, with at least the minimum width', () => {
    expect(fitsIdleTip('Type / to browse commands', 30)).toBe(true);
    expect(fitsIdleTip('Type / to browse commands!', 30)).toBe(false);
    expect(fitsIdleTip('ok', MIN_IDLE_TIP_WIDTH - 1)).toBe(false);
  });
});

describe('IdleTipRow', () => {
  it('renders the rotating tip dim and italic so it stays quiet above the composer', () => {
    const level = chalk.level;
    chalk.level = 3;
    try {
      const frame = render(
        <ThemeProvider>
          <IdleTipRow tip="Type / to browse commands" columns={60} />
        </ThemeProvider>,
      ).lastFrame() ?? '';

      expect(frame).toContain('\u001b[2m');
      expect(frame).toContain('\u001b[3m');
    } finally {
      chalk.level = level;
    }
  });

  it('left-aligns a lone tip with the composer', () => {
    const tip = 'Tip: Type / to browse commands';
    expect(frameOf(<IdleTipRow tip="Type / to browse commands" columns={60} />))
      .toBe(tip);
  });

  it.each([80, 120, 200])('puts the tip below the completion summary at %i columns', (columns) => {
    const lines = frameOf(
      <IdleTipRow summary="Completed in 0m 4s · ↑1.2k ↓40" tip="Type @ to attach a file" columns={columns} />,
    ).split('\n');
    expect(lines[0]?.trim()).toBe('');
    expect(lines[1]).toBe('Completed in 0m 4s · ↑1.2k ↓40');
    expect(lines[2]).toBe('Tip: Type @ to attach a file');
    expect(lines).toHaveLength(3);
  });

  it('uses the full tip row even when the summary fills the terminal', () => {
    const lines = frameOf(<IdleTipRow summary={'x'.repeat(39)} tip="Type ? for shortcuts" columns={40} />).split('\n');
    expect(lines.slice(-2)).toMatchInlineSnapshot(`
      [
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "Tip: Type ? for shortcuts",
      ]
    `);
  });

  it('keeps tips below a wrapping summary', () => {
    const lines = frameOf(<IdleTipRow summary={'x'.repeat(70)} tip="Type ? for shortcuts" columns={40} />).split('\n');
    expect(lines.at(-1)).toBe('Tip: Type ? for shortcuts');
    expect(lines.every((line) => stringWidth(line) <= 39)).toBe(true);
  });

  it('keeps the summary when the terminal is too narrow for a tip', () => {
    const frame = frameOf(<IdleTipRow summary="Completed" tip="Type ? for shortcuts" columns={20} />);
    expect(frame).toContain('Completed');
    expect(frame).not.toContain('Tip:');
  });

  it('truncates a tip that stopped fitting after a resize', () => {
    const lines = frameOf(<IdleTipRow summary={'x'.repeat(20)} tip={'y'.repeat(70)} columns={60} />).split('\n');
    const row = lines.find((line) => line.includes('Tip:')) ?? '';
    expect(row.endsWith('…')).toBe(true);
    expect(stringWidth(row)).toBeLessThanOrEqual(59);
  });

  it('renders nothing with neither a summary nor a tip', () => {
    expect(frameOf(<IdleTipRow columns={80} />)).toBe('');
  });

  it('keeps display-width truncation on its own row after resizing', () => {
    const lines = frameOf(<IdleTipRow summary="Completed" tip={'界'.repeat(40)} columns={40} />).split('\n');
    expect(lines[1]).toBe('Completed');
    expect(lines[2]).toMatch(/^Tip: 界+…$/u);
    expect(stringWidth(lines[2])).toBeLessThanOrEqual(39);
  });
});
