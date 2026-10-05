/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { cleanup } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { AgentUI, createInitialUIState, type AgentUIProps } from '../../../src/ui/ink/AgentUI.js';
import { I18nProvider } from '../../../src/ui/i18n/index.js';

afterEach(cleanup);

async function composer(props: Partial<AgentUIProps> = {}) {
  const onInstruction = vi.fn();
  const onAxoCommand = vi.fn();
  const onSteer = vi.fn();
  const instance = renderInkScreen(<I18nProvider><AgentUI
    state={createInitialUIState()}
    onInstruction={onInstruction}
    onAxoCommand={onAxoCommand}
    onEscape={() => {}}
    onCtrlC={() => {}}
    {...props}
  /></I18nProvider>);
  const key = async (text: string) => {
    instance.stdin.write(text);
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { ...instance, key, onInstruction, onAxoCommand, onSteer };
}

describe('~axo in the composer', () => {
  it('summons Axo instead of sending a turn, and clears the composer', async () => {
    const ui = await composer();
    await ui.key('~axo');
    await ui.key('\r');
    expect(ui.onAxoCommand).toHaveBeenCalledWith({ kind: 'summon' });
    expect(ui.onInstruction).not.toHaveBeenCalled();
    expect(ui.lastFrame()).not.toContain('~axo');
  });

  it('passes sub-commands through', async () => {
    const ui = await composer();
    await ui.key('~axo say hi there');
    await ui.key('\r');
    expect(ui.onAxoCommand).toHaveBeenCalledWith({ kind: 'say', text: 'hi there' });
  });

  it('never steers a running turn with it', async () => {
    const onSteer = vi.fn();
    const ui = await composer({
      state: { ...createInitialUIState(), isWorking: true },
      onSteer,
      enableQueueInput: true,
      enterWhileWorking: 'steer',
    });
    await ui.key('~axo feed');
    await ui.key('\r');
    expect(onSteer).not.toHaveBeenCalled();
    expect(ui.onInstruction).not.toHaveBeenCalled();
    expect(ui.onAxoCommand).toHaveBeenCalledWith({ kind: 'feed' });
  });

  it('leaves look-alike prompts for the agent', async () => {
    const ui = await composer();
    await ui.key('~axolotl facts please');
    await ui.key('\r');
    expect(ui.onAxoCommand).not.toHaveBeenCalled();
    expect(ui.onInstruction).toHaveBeenCalledWith('~axolotl facts please');
  });
});
