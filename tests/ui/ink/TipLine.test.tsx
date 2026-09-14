/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IdleTipRow,
  MIN_IDLE_TIP_WIDTH,
  TipLine,
  fitsIdleTip,
  idleTipWidth,
} from '../../../src/ui/ink/TipLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => cleanup());

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

  it('leaves a two-column gap after the completion summary', () => {
    expect(idleTipWidth(80, 'x'.repeat(30))).toBe(47);
  });

  it('measures the summary by display width', () => {
    expect(idleTipWidth(80, '完成')).toBe(73);
  });

  it('never goes below zero on a narrow terminal', () => {
    expect(idleTipWidth(20, 'x'.repeat(40))).toBe(0);
  });

  it('accepts only whole tips, prefix included, with at least the minimum width', () => {
    expect(fitsIdleTip('Type / to browse commands', 30)).toBe(true);
    expect(fitsIdleTip('Type / to browse commands!', 30)).toBe(false);
    expect(fitsIdleTip('ok', MIN_IDLE_TIP_WIDTH - 1)).toBe(false);
  });
});

describe('IdleTipRow', () => {
  it('right-aligns a lone tip to the composer edge', () => {
    const tip = 'Tip: Type / to browse commands';
    expect(frameOf(<IdleTipRow tip="Type / to browse commands" columns={60} />))
      .toBe(`${' '.repeat(59 - tip.length)}${tip}`);
  });

  it('puts the tip on the right of the completion summary, on the same row', () => {
    const lines = frameOf(
      <IdleTipRow summary="Completed in 0m 4s · ↑1.2k ↓40" tip="Type @ to attach a file" columns={80} />,
    ).split('\n');
    expect(lines[0]?.trim()).toBe('');
    const row = lines[1] ?? '';
    expect(row.startsWith('Completed in 0m 4s · ↑1.2k ↓40')).toBe(true);
    expect(row.endsWith('Tip: Type @ to attach a file')).toBe(true);
    expect(stringWidth(row)).toBe(79);
  });

  it('keeps the summary and drops the tip when the terminal is too narrow', () => {
    const frame = frameOf(<IdleTipRow summary={'x'.repeat(30)} tip="Type ? for shortcuts" columns={40} />);
    expect(frame).toContain('x'.repeat(30));
    expect(frame).not.toContain('Tip:');
  });

  it('truncates a tip that stopped fitting after a resize', () => {
    const lines = frameOf(<IdleTipRow summary={'x'.repeat(20)} tip={'y'.repeat(50)} columns={60} />).split('\n');
    const row = lines.find((line) => line.includes('xxxx')) ?? '';
    expect(row.endsWith('…')).toBe(true);
    expect(stringWidth(row)).toBeLessThanOrEqual(59);
  });

  it('renders nothing with neither a summary nor a tip', () => {
    expect(frameOf(<IdleTipRow columns={80} />)).toBe('');
  });
});
