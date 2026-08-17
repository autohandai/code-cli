/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';

const { setCursorPosition } = vi.hoisted(() => ({
  setCursorPosition: vi.fn(),
}));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {
    ...actual,
    useCursor: () => ({ setCursorPosition }),
  };
});

import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => {
  cleanup();
  setCursorPosition.mockReset();
});

describe('AgentUI working-turn scrollback stability', () => {
  it('keeps the hardware cursor disabled while a working turn has a draft', async () => {
    const state = {
      ...createInitialUIState(),
      isWorking: true,
      status: 'Working...',
      elapsed: '0s',
      currentInput: 'keep this draft while reviewing history',
    };

    render(
      <I18nProvider>
        <ThemeProvider>
          <AgentUI
            state={state}
            onInstruction={() => {}}
            onEscape={() => {}}
            onCtrlC={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(setCursorPosition).toHaveBeenCalled();
    expect(setCursorPosition.mock.calls.every(([position]) => position === undefined)).toBe(true);
  });

  it('does not refocus the composer when only elapsed status changes', async () => {
    const renderTree = (elapsed: string) => {
      const state = {
        ...createInitialUIState(),
        isWorking: true,
        status: 'Working...',
        elapsed,
        currentInput: '',
      };

      return (
        <I18nProvider>
          <ThemeProvider>
            <AgentUI
              state={state}
              onInstruction={() => {}}
              onEscape={() => {}}
              onCtrlC={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      );
    };

    const instance = render(renderTree('0s'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(setCursorPosition).toHaveBeenCalled();
    setCursorPosition.mockClear();

    instance.rerender(renderTree('1s'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(setCursorPosition).not.toHaveBeenCalled();
  });

  it('does not refocus the idle composer when only status metadata changes', async () => {
    const renderTree = (contextPercent: number) => {
      const state = {
        ...createInitialUIState(),
        status: 'Ready',
        contextPercent,
        currentInput: 'keep this draft while reviewing history',
      };

      return (
        <I18nProvider>
          <ThemeProvider>
            <AgentUI
              state={state}
              onInstruction={() => {}}
              onEscape={() => {}}
              onCtrlC={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      );
    };

    const instance = render(renderTree(90));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(setCursorPosition).toHaveBeenCalled();
    setCursorPosition.mockClear();

    instance.rerender(renderTree(89));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(setCursorPosition).not.toHaveBeenCalled();
  });

  it('does not refocus the composer when a working turn completes', async () => {
    const renderTree = (isWorking: boolean, currentInput = 'keep this draft while reviewing history') => {
      const state = {
        ...createInitialUIState(),
        isWorking,
        status: isWorking ? 'Working...' : 'Ready',
        currentInput,
      };

      return (
        <I18nProvider>
          <ThemeProvider>
            <AgentUI
              state={state}
              onInstruction={() => {}}
              onEscape={() => {}}
              onCtrlC={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      );
    };

    const instance = render(renderTree(true));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(setCursorPosition).toHaveBeenCalled();
    setCursorPosition.mockClear();

    instance.rerender(renderTree(false));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(setCursorPosition).not.toHaveBeenCalled();

    instance.rerender(renderTree(false, 'keep this draft while reviewing history!'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(setCursorPosition.mock.calls.some(([position]) => position !== undefined)).toBe(true);
  });
});
