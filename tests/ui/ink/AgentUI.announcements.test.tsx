/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => {
  cleanup();
});

describe('AgentUI announcements', () => {
  it('renders the announcement directly above the active status section', () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
      status: 'Thinking',
      announcement: {
        id: 'announcement-1',
        text: '◆ Voice dictation is here',
        hint: '^X hide  /whatsnew',
        visible: true,
      },
    };
    const { lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <AgentUI
            state={state}
            onInstruction={vi.fn()}
            onEscape={vi.fn()}
            onCtrlC={vi.fn()}
          />
        </ThemeProvider>
      </I18nProvider>,
    );
    const frame = lastFrame() ?? '';

    expect(frame.indexOf('Voice dictation is here')).toBeLessThan(frame.indexOf('Thinking'));
  });

  it('uses Ctrl+X only when visible and leaves composer input untouched', async () => {
    const onDismissAnnouncement = vi.fn();
    const onInputChange = vi.fn();
    const state = {
      ...createInitialUIState(),
      currentInput: 'draft prompt',
      announcement: {
        id: 'announcement-1',
        text: '◆ Voice dictation is here',
        hint: '^X hide  /whatsnew',
        visible: true,
      },
    };
    const { stdin, lastFrame } = render(
      <I18nProvider>
        <ThemeProvider>
          <AgentUI
            state={state}
            onInstruction={vi.fn()}
            onEscape={vi.fn()}
            onCtrlC={vi.fn()}
            onInputChange={onInputChange}
            onDismissAnnouncement={onDismissAnnouncement}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

    onInputChange.mockClear();
    stdin.write('\x18');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onDismissAnnouncement).toHaveBeenCalledWith('announcement-1');
    expect(onInputChange).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('draft prompt');
  });

  it('does not claim Ctrl+X when no announcement is visible', async () => {
    const onDismissAnnouncement = vi.fn();
    const onInputChange = vi.fn();
    const { stdin } = render(
      <I18nProvider>
        <ThemeProvider>
          <AgentUI
            state={createInitialUIState()}
            onInstruction={vi.fn()}
            onEscape={vi.fn()}
            onCtrlC={vi.fn()}
            onInputChange={onInputChange}
            onDismissAnnouncement={onDismissAnnouncement}
          />
        </ThemeProvider>
      </I18nProvider>,
    );

    stdin.write('\x18');
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onDismissAnnouncement).not.toHaveBeenCalled();
  });
});
