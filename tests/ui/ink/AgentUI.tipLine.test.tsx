/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentUI, createInitialUIState, type AgentUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => cleanup());

function renderState(state: AgentUIState) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <AgentUI state={state} onInstruction={vi.fn()} onEscape={vi.fn()} onCtrlC={vi.fn()} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('AgentUI tip line', () => {
  it('renders the tip on the line after the working status', () => {
    const { lastFrame } = renderState({
      ...createInitialUIState(),
      isWorking: true,
      status: 'Grokking...',
      tip: { kind: 'tip', text: 'Use @filename to give the agent context' },
    });
    const lines = (lastFrame() ?? '').split('\n');
    const statusIndex = lines.findIndex((line) => line.includes('Grokking...'));
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    expect(lines[statusIndex + 1]).toContain('⎿  Tip: Use @filename');
  });

  it('hides a rotating tip once work stops but keeps an upgrade hint', () => {
    const idle = { ...createInitialUIState(), isWorking: false };
    expect(renderState({ ...idle, tip: { kind: 'tip', text: 'gone' } }).lastFrame()).not.toContain('gone');
    expect(renderState({ ...idle, tip: { kind: 'upgrade', text: 'Run /upgrade' } }).lastFrame()).toContain('⎿  Plan: Run /upgrade');
  });
});
