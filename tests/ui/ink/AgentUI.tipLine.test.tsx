/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentUI, createInitialUIState, type AgentUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => cleanup());

function renderLines(state: AgentUIState): string[] {
  const { lastFrame } = render(
    <I18nProvider>
      <ThemeProvider>
        <AgentUI state={state} onInstruction={vi.fn()} onEscape={vi.fn()} onCtrlC={vi.fn()} />
      </ThemeProvider>
    </I18nProvider>,
  );
  return stripAnsi(lastFrame() ?? '').split('\n');
}

/** The nearest line above the composer prompt that is more than its border. */
function rowAboveComposer(lines: string[]): string {
  const composerIndex = lines.findIndex((line) => line.includes('❯'));
  expect(composerIndex).toBeGreaterThan(0);
  return lines
    .slice(0, composerIndex)
    .reverse()
    .find((line) => line.replace(/[▔▁─\s]/gu, '').length > 0) ?? '';
}

const idle: AgentUIState = { ...createInitialUIState(), isWorking: false };

describe('AgentUI tips', () => {
  it('shows an idle tip right-aligned on the row directly above the composer', () => {
    const row = rowAboveComposer(renderLines({
      ...idle,
      tip: { kind: 'tip', text: 'Type / to browse every slash command' },
    }));
    expect(row.trimEnd().endsWith('Tip: Type / to browse every slash command')).toBe(true);
    expect(row.indexOf('Tip:')).toBeGreaterThan(0);
  });

  it('shares the row above the composer with the completion summary', () => {
    const row = rowAboveComposer(renderLines({
      ...idle,
      completionStats: { elapsed: '0m 15s', tokens: '↑37.3k ↓433' },
      tip: { kind: 'tip', text: 'Type @ to attach a file' },
    }));
    expect(row.startsWith('Completed in 0m 15s · ↑37.3k ↓433')).toBe(true);
    expect(row.trimEnd().endsWith('Tip: Type @ to attach a file')).toBe(true);
  });

  it('shows no tip anywhere while a turn runs', () => {
    const lines = renderLines({
      ...idle,
      isWorking: true,
      status: 'Grokking...',
      tip: { kind: 'tip', text: 'Type @ to attach a file' },
    });
    expect(lines.some((line) => line.includes('Grokking...'))).toBe(true);
    expect(lines.join('\n')).not.toContain('Tip:');
  });

  it('keeps a pinned upgrade hint under the status line', () => {
    const lines = renderLines({ ...idle, tip: { kind: 'upgrade', text: 'Run /upgrade' } });
    expect(lines.join('\n')).toContain('⎿  Plan: Run /upgrade');
  });
});
