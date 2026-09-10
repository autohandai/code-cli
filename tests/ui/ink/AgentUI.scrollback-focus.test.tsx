/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';

const { setCursorPosition, writeTerminal, mouseTest } = vi.hoisted(() => ({
  setCursorPosition: vi.fn(),
  writeTerminal: vi.fn(),
  mouseTest: { enabled: false },
}));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  const stdout = { isTTY: true, columns: 100, rows: 30, write: writeTerminal, on: vi.fn(), off: vi.fn() };
  return {
    ...actual,
    useCursor: () => ({ setCursorPosition }),
    useStdout: () => {
      const realStdout = actual.useStdout();
      return mouseTest.enabled ? { stdout } : realStdout;
    },
  };
});

import { AgentUI, createInitialUIState } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';
import { ThemeProvider } from '../../../src/ui/theme/ThemeContext.js';

afterEach(() => {
  cleanup();
  setCursorPosition.mockReset();
  writeTerminal.mockReset();
  mouseTest.enabled = false;
});

describe('AgentUI working-turn scrollback stability', () => {
  it('does not refocus an edited composer while the user reads history', async () => {
    const renderTree = (elapsed: string) => (
      <I18nProvider>
        <ThemeProvider>
          <AgentUI
            mouseComposerCursor
            state={{ ...createInitialUIState(), elapsed }}
            onInstruction={() => {}}
            onEscape={() => {}}
            onCtrlC={() => {}}
          />
        </ThemeProvider>
      </I18nProvider>
    );
    const instance = render(renderTree('0s'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.stdin.write('keep this draft while reading history');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.stdin.write('\x1b[<64;5;3M');
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    setCursorPosition.mockClear();

    instance.rerender(renderTree('1s'));
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(setCursorPosition.mock.calls.every(([position]) => position === undefined)).toBe(true);
    expect(instance.lastFrame()).toContain('keep this draft while reading history');
  });

  it.each([
    [64, false, '!'],
    [65, false, '\x1b[200~!\x1b[201~'],
    [64, true, '!'],
    [65, true, '\x1b[200~!\x1b[201~'],
  ] as const)(
    'releases wheel %s during working=%s and keeps history accessible across goal updates',
    async (button, isWorking, editInput) => {
      mouseTest.enabled = true;
      const renderTree = (elapsed: string) => (
        <I18nProvider>
          <ThemeProvider>
            <AgentUI
              mouseComposerCursor
              state={{
                ...createInitialUIState(),
                isWorking,
                elapsed,
                currentInput: 'keep this draft',
                goalPanelVisible: true,
                goalActivity: {
                  version: 2,
                  goal: null,
                  queue: [{ queueId: 'queued', objective: `Queued goal ${elapsed}`, source: 'command', createdAt: 0 }],
                  completed: [],
                  peers: [],
                  updatedAt: 0,
                  sessionAttachment: 'attached',
                },
              }}
              onInstruction={() => {}}
              onEscape={() => {}}
              onCtrlC={() => {}}
            />
          </ThemeProvider>
        </I18nProvider>
      );
      const instance = render(renderTree('0s'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeTerminal).toHaveBeenCalledWith('\x1b[?1000h\x1b[?1006h');
      writeTerminal.mockClear();

      instance.stdin.write(`\x1b[<${button};5;3M`);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeTerminal).toHaveBeenCalledWith('\x1b[?1006l\x1b[?1000l');
      expect(writeTerminal).not.toHaveBeenCalledWith('\x1b[?1000h\x1b[?1006h');
      expect(instance.lastFrame()).toContain('keep this draft');
      writeTerminal.mockClear();
      setCursorPosition.mockClear();

      instance.rerender(renderTree('1s'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeTerminal).not.toHaveBeenCalledWith('\x1b[?1000h\x1b[?1006h');
      expect(setCursorPosition.mock.calls.every(([position]) => position === undefined)).toBe(true);

      instance.stdin.write('\x1b[<64;5;3M\x1b[<65;5;3M');
      instance.stdin.write('\x1b[<0;5;3M');
      instance.stdin.write('\x1b[3;8R');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(writeTerminal).not.toHaveBeenCalledWith('\x1b[6n');
      expect(writeTerminal).not.toHaveBeenCalledWith('\x1b[?1000h\x1b[?1006h');
      expect(instance.lastFrame()).toContain('keep this draft');

      instance.stdin.write(editInput);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(instance.lastFrame()).toContain('keep this draft!');
      expect(writeTerminal).toHaveBeenCalledWith('\x1b[?1000h\x1b[?1006h');
    },
  );

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
            mouseComposerCursor
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
              mouseComposerCursor
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
              mouseComposerCursor
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
              mouseComposerCursor
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
