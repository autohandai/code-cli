/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { InkRenderer } from '../../../src/ui/ink/InkRenderer.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

afterEach(cleanup);

describe('session agent inspector integration', () => {
  it('captures inspection keys without submitting composer text and restores its draft on close', async () => {
    const onInstruction = vi.fn();
    const onCloseAgentRunsPanel = vi.fn();
    const state = { ...createInitialUIState(), currentInput: 'preserved draft', agentRunsPanelVisible: true,
      agentRuns: { updatedAt: 1, runs: [{ id: 'child', source: 'delegate' as const, name: 'reviewer', task: 'Review',
        status: 'completed' as const, startedAt: 1, updatedAt: 2, cancellable: false, output: 'REVIEW_RESULT' }] } };
    const tree = (visible: boolean) => <I18nProvider><ThemeProvider><AgentUI state={{ ...state, agentRunsPanelVisible: visible }}
      onInstruction={onInstruction} onEscape={() => {}} onCtrlC={() => {}} onCloseAgentRunsPanel={onCloseAgentRunsPanel} /></ThemeProvider></I18nProvider>;
    const view = render(tree(true));
    expect(view.lastFrame()).toContain('Session agents');
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\u001b[200~hidden inspector paste\u001b[201~');
    await new Promise<void>((resolve) => setImmediate(resolve));
    view.stdin.write('\r');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('REVIEW_RESULT'));
    expect(onInstruction).not.toHaveBeenCalled();
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Enter details'));
    view.stdin.write('\u001b');
    await vi.waitFor(() => expect(onCloseAgentRunsPanel).toHaveBeenCalledOnce());
    view.rerender(tree(false));
    await vi.waitFor(() => expect(view.lastFrame()).toContain('preserved draft'));
    expect(view.lastFrame()).not.toContain('hidden inspector paste');
  });

  it('keeps session run history when per-turn activity is cleared', () => {
    const renderer = new InkRenderer({ onInstruction: () => {}, onEscape: () => {}, onCtrlC: () => {} });
    const snapshot = { runs: [], updatedAt: 5 };
    renderer.setAgentRuns(snapshot);
    renderer.setAgentRunsPanelVisible(true);
    renderer.clearActivityItems();
    expect(renderer.getState()).toMatchObject({ agentRuns: snapshot, agentRunsPanelVisible: true });
  });
});
