/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { TipLine } from '../../../src/ui/ink/TipLine.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

function renderTip(props: React.ComponentProps<typeof TipLine>) {
  return render(<ThemeProvider><TipLine {...props} /></ThemeProvider>);
}

describe('TipLine', () => {
  it('renders a rotating tip with the Tip prefix while working', () => {
    const { lastFrame } = renderTip({ tip: { kind: 'tip', text: 'Use /undo' }, isWorking: true, columns: 80 });
    expect(lastFrame()).toContain('⎿  Tip: Use /undo');
  });

  it('hides a rotating tip when work has stopped', () => {
    const { lastFrame } = renderTip({ tip: { kind: 'tip', text: 'Use /undo' }, isWorking: false, columns: 80 });
    expect(lastFrame()).toBe('');
  });

  it('keeps an upgrade hint visible after work stops with the Plan prefix', () => {
    const { lastFrame } = renderTip({ tip: { kind: 'upgrade', text: 'Run /upgrade' }, isWorking: false, columns: 80 });
    expect(lastFrame()).toContain('⎿  Plan: Run /upgrade');
  });

  it('truncates to the terminal width', () => {
    const { lastFrame } = renderTip({ tip: { kind: 'tip', text: 'x'.repeat(100) }, isWorking: true, columns: 30 });
    const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '');
    expect(frame.length).toBeLessThanOrEqual(30);
    expect(frame.endsWith('…')).toBe(true);
  });

  it('renders nothing without a tip', () => {
    const { lastFrame } = renderTip({ tip: undefined, isWorking: true, columns: 80 });
    expect(lastFrame()).toBe('');
  });
});
