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

describe('AgentUI completion summary row', () => {
  it('shows the newest turn summary even when an earlier one sits in the transcript', () => {
    const lines = renderLines({
      ...idle,
      chatMessages: [
        { role: 'user', content: 'first' },
        { role: 'completion', content: 'Completed in 0m 3s · turn one' },
        { role: 'user', content: 'second' },
      ],
      completionStats: { elapsed: '0m 9s', tokens: 'turn two' },
    });

    expect(rowAboveComposer(lines)).toContain('Completed in 0m 9s · turn two');
  });

  it('shows a repeated summary rather than mistaking it for the archived one', () => {
    const lines = renderLines({
      ...idle,
      chatMessages: [{ role: 'completion', content: 'Completed in 0m 4s · 54 tokens' }],
      completionStats: { elapsed: '0m 4s', tokens: '54 tokens' },
    });

    expect(rowAboveComposer(lines)).toContain('Completed in 0m 4s · 54 tokens');
  });

  it('keeps the tip beside that summary', () => {
    const lines = renderLines({
      ...idle,
      chatMessages: [{ role: 'completion', content: 'Completed in 0m 3s · turn one' }],
      completionStats: { elapsed: '0m 9s', tokens: 'turn two' },
      tip: { kind: 'tip', text: 'Type /goals to watch the live goals queue' },
    });

    const row = rowAboveComposer(lines);
    expect(row).toContain('Completed in 0m 9s · turn two');
    expect(row.trimEnd().endsWith('Tip: Type /goals to watch the live goals queue')).toBe(true);
  });

  it('labels a failed turn as Failed', () => {
    const lines = renderLines({
      ...idle,
      chatMessages: [{ role: 'completion', content: 'Completed in 0m 3s · turn one' }],
      completionStats: { elapsed: '0m 9s', tokens: 'turn two', status: 'failed' },
    });

    expect(rowAboveComposer(lines)).toContain('Failed in 0m 9s · turn two');
  });
});
