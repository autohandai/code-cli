/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from 'ink-testing-library';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { AgentUI, createInitialUIState, type AgentUIProps } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

afterEach(cleanup);

async function composer(props: Partial<AgentUIProps> = {}) {
  const onInstruction = vi.fn();
  const onInputChange = vi.fn();
  const instance = renderInkScreen(<I18nProvider><AgentUI
    state={createInitialUIState()}
    onInstruction={onInstruction}
    onInputChange={onInputChange}
    onEscape={() => {}}
    onCtrlC={() => {}}
    {...props}
  /></I18nProvider>);
  const key = async (text: string) => {
    instance.stdin.write(text);
    await new Promise<void>(resolve => setImmediate(resolve));
  };
  await new Promise<void>(resolve => setImmediate(resolve));
  return { ...instance, key, onInstruction, onInputChange };
}

describe('composer typed-message history', () => {
  it('shows history navigation and the picker in shortcut help', async () => {
    const ui = await composer();
    await ui.key('?');
    expect(ui.lastFrame()).toContain('↑ / ↓ recalls typed messages');
    expect(ui.lastFrame()).toContain('/whatityped opens history');
  });
  it('leaves empty history alone and gives autocomplete arrow keys priority', async () => {
    const ui = await composer({ slashCommands: [
      { command: '/help', description: 'Help', implemented: true },
      { command: '/history', description: 'Sessions', implemented: true },
    ] });
    await ui.key('\x1b[A');
    await ui.key('\x1b[B');
    expect(ui.onInstruction).not.toHaveBeenCalled();
    await ui.key('previous');
    await ui.key('\r');
    await ui.key('/h');
    await ui.key('\x1b[B');
    await ui.key('\t');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('/history ');
  });

  it('recalls slash commands repeatedly without reopening autocomplete', async () => {
    const ui = await composer({ slashCommands: [
      { command: '/help', description: 'Help', implemented: true },
    ] });
    await ui.key('previous');
    await ui.key('\r');
    await ui.key('/help');
    await ui.key('\r');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('/help');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('previous');
  });

  it('restores the full hidden paste when returning to an unfinished draft', async () => {
    const ui = await composer();
    await ui.key('previous');
    await ui.key('\r');
    const paste = 'one\ntwo\nthree\nfour\nfive\nsix';
    await ui.key(`\x1b[200~${paste}\x1b[201~`);
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('previous');
    await ui.key('\x1b[B');
    await ui.key('\r');
    expect(ui.onInstruction).toHaveBeenLastCalledWith(paste);
    await ui.key('\x1b[A');
    await ui.key('\r');
    expect(ui.onInstruction).toHaveBeenLastCalledWith(paste);
  });

  it('keeps queued instruction navigation ahead of message history', async () => {
    const ui = await composer({ state: { ...createInitialUIState(), isWorking: true, queuedInstructions: ['queued'] } });
    await ui.key('previous');
    await ui.key('\r');
    await ui.key('\x1b[A');
    await ui.key('\r');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('queued');
  });

  it('recalls older and newer submissions and restores the draft and cursor', async () => {
    const ui = await composer();
    await ui.key('first prompt');
    await ui.key('\r');
    await ui.key('second prompt');
    await ui.key('\r');
    await ui.key('draft');
    await ui.key('\x1b[D');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('second prompt');
    expect(ui.lastFrame()).toContain('second prompt');
    await ui.key('\x1b[A');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('first prompt');
    await ui.key('\x1b[B');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('second prompt');
    await ui.key('\x1b[B');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('draft');
    await ui.key('X');
    await ui.key('\r');
    expect(ui.onInstruction.mock.calls.map(([text]) => text)).toEqual(['first prompt', 'second prompt', 'drafXt']);
  });

  it('keeps multiline cursor navigation until the top visual row', async () => {
    const ui = await composer();
    await ui.key('previous prompt');
    await ui.key('\r');
    await ui.key('one');
    await ui.key('\x1b\r');
    await ui.key('two');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('one\ntwo');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('previous prompt');
    await ui.key('\x1b[B');
    await ui.key('X');
    await ui.key('\r');
    expect(ui.onInstruction).toHaveBeenLastCalledWith('oneX\ntwo');
  });

  it('edits recalled messages without changing the stored originals and clears recall with Ctrl+C', async () => {
    const ui = await composer();
    await ui.key('original');
    await ui.key('\r');
    await ui.key('\x1b[A');
    await ui.key(' edited');
    await ui.key('\r');
    expect(ui.onInstruction).toHaveBeenLastCalledWith('original edited');
    await ui.key('\x1b[A');
    await ui.key('\x1b[A');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('original');
    await ui.key('\x03');
    await ui.key('\x1b[B');
    expect(ui.onInputChange).toHaveBeenLastCalledWith('');
  });
});
